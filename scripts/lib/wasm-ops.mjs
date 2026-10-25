/**
 * Instruction-level scan of a WebAssembly binary (#491 Phase 2; used by scripts/verify-wasm-features.mjs).
 *
 * Decodes every function body in the code section and counts the opcode
 * classes the build gates care about — SIMD, exception handling, saturating vs
 * trapping float→int, bulk memory, sign extension, atomics. It walks real
 * instructions (opcode + immediates), so a 0xFD byte inside an immediate or a
 * data segment is not mistaken for SIMD (the old byte grep in the retired
 * verify-native-simd.mjs reported "OK" for the non-SIMD JS-engine wasm), and it
 * needs no external tool: Emscripten's release output strips the
 * target_features section, and wasm-dis is only present where emsdk is.
 *
 * An opcode this decoder does not know throws instead of being skipped, so a
 * new toolchain feature can never silently skew a count.
 */

const SECTION_CODE = 10;

class Reader {
  constructor(bytes, pos = 0, end = bytes.length) {
    this.bytes = bytes;
    this.pos = pos;
    this.end = end;
  }

  u8() {
    if (this.pos >= this.end) throw new Error(`unexpected end of input at ${this.pos}`);
    return this.bytes[this.pos++];
  }

  /** Unsigned LEB128 (up to 64 bits; values past 2^53 lose precision, which no count needs). */
  u32() {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const b = this.u8();
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) return result;
      scale *= 128;
    }
    throw new Error(`LEB128 too long at ${this.pos}`);
  }

  /** Signed LEB128 — only its length matters here. */
  sleb() {
    for (let i = 0; i < 10; i++) {
      if ((this.u8() & 0x80) === 0) return;
    }
    throw new Error(`signed LEB128 too long at ${this.pos}`);
  }

  skip(n) {
    if (this.pos + n > this.end) throw new Error(`unexpected end of input at ${this.pos}`);
    this.pos += n;
  }
}

/** Block type: 0x40 (empty), a one-byte value type, or an s33 type index. */
function blockType(r) {
  const b = r.bytes[r.pos];
  if (b === 0x40 || (b >= 0x6e && b <= 0x7f) || b === 0x69 || b === 0x64 || b === 0x63) {
    r.pos++;
    if (b === 0x64 || b === 0x63) heapType(r); // (ref ht) / (ref null ht)
    return;
  }
  r.sleb();
}

function heapType(r) {
  const b = r.bytes[r.pos];
  if (b >= 0x69 && b <= 0x74) {
    r.pos++;
    return;
  }
  r.sleb();
}

function valType(r) {
  const b = r.u8();
  if (b === 0x64 || b === 0x63) heapType(r);
}

/** memarg: alignment (bit 6 = an explicit memory index follows) and offset. */
function memarg(r) {
  const align = r.u32();
  if (align & 0x40) r.u32();
  r.u32();
}

function emptyCounts() {
  return {
    functions: 0,
    instructions: 0,
    simd: 0,
    tryBlocks: 0, // legacy `try` + exnref `try_table`
    catches: 0, // catch / catch_all / try_table catch clauses
    throws: 0, // throw / rethrow / throw_ref
    truncSat: 0,
    truncTrapping: 0,
    memoryCopy: 0,
    memoryFill: 0,
    signExt: 0,
    atomics: 0,
  };
}

function scanBody(r, counts) {
  while (r.pos < r.end) {
    const op = r.u8();
    counts.instructions++;
    switch (op) {
      case 0x02: case 0x03: case 0x04: // block loop if
        blockType(r);
        break;
      case 0x06: // try (legacy EH)
        counts.tryBlocks++;
        blockType(r);
        break;
      case 0x07: // catch tag
        counts.catches++;
        r.u32();
        break;
      case 0x08: // throw tag
        counts.throws++;
        r.u32();
        break;
      case 0x09: // rethrow depth
        counts.throws++;
        r.u32();
        break;
      case 0x0a: // throw_ref
        counts.throws++;
        break;
      case 0x0c: case 0x0d: // br br_if
      case 0x10: case 0x12: // call return_call
      case 0x14: case 0x15: // call_ref return_call_ref
      case 0x18: // delegate
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: // local/global get/set/tee
      case 0x25: case 0x26: // table.get table.set
      case 0xd2: case 0xd4: case 0xd6: // ref.func br_on_null br_on_non_null
        r.u32();
        break;
      case 0x0e: { // br_table
        const n = r.u32();
        for (let i = 0; i <= n; i++) r.u32();
        break;
      }
      case 0x11: case 0x13: // call_indirect return_call_indirect: type, table
        r.u32();
        r.u32();
        break;
      case 0x19: // catch_all
        counts.catches++;
        break;
      case 0x1c: { // select t*
        const n = r.u32();
        for (let i = 0; i < n; i++) valType(r);
        break;
      }
      case 0x1f: { // try_table: block type + catch clauses
        counts.tryBlocks++;
        blockType(r);
        const n = r.u32();
        for (let i = 0; i < n; i++) {
          const kind = r.u8();
          if (kind === 0x00 || kind === 0x01) r.u32(); // catch / catch_ref: tag
          r.u32(); // label
          counts.catches++;
        }
        break;
      }
      case 0x3f: case 0x40: // memory.size memory.grow: memory index
        r.u32();
        break;
      case 0x41: case 0x42: // i32.const i64.const
        r.sleb();
        break;
      case 0x43: // f32.const
        r.skip(4);
        break;
      case 0x44: // f64.const
        r.skip(8);
        break;
      case 0xd0: // ref.null
        heapType(r);
        break;
      case 0xfc:
        scanFc(r, counts);
        break;
      case 0xfd:
        counts.simd++;
        scanFd(r);
        break;
      case 0xfe:
        counts.atomics++;
        scanFe(r);
        break;
      default:
        if (op >= 0x28 && op <= 0x3e) {
          memarg(r); // loads / stores
        } else if (op === 0xa8 || op === 0xa9 || op === 0xaa || op === 0xab
          || op === 0xae || op === 0xaf || op === 0xb0 || op === 0xb1) {
          counts.truncTrapping++;
        } else if (op >= 0xc0 && op <= 0xc4) {
          counts.signExt++;
        } else if (
          op === 0x00 || op === 0x01 || op === 0x05 || op === 0x0b || op === 0x0f
          || op === 0x1a || op === 0x1b || (op >= 0x45 && op <= 0xc4)
          || op === 0xd1 || op === 0xd3 || op === 0xd5
        ) {
          // no immediates
        } else {
          throw new Error(`unknown opcode 0x${op.toString(16)} at byte ${r.pos - 1}`);
        }
    }
  }
}

function scanFc(r, counts) {
  const sub = r.u32();
  if (sub <= 7) {
    counts.truncSat++;
  } else if (sub === 8) { // memory.init data, mem
    r.u32();
    r.u32();
  } else if (sub === 9 || sub === 13 || sub === 15 || sub === 16 || sub === 17) {
    r.u32(); // data.drop elem.drop table.grow table.size table.fill
  } else if (sub === 10) { // memory.copy dst, src
    counts.memoryCopy++;
    r.u32();
    r.u32();
  } else if (sub === 11) { // memory.fill mem
    counts.memoryFill++;
    r.u32();
  } else if (sub === 12 || sub === 14) { // table.init elem, table / table.copy dst, src
    r.u32();
    r.u32();
  } else {
    throw new Error(`unknown 0xFC sub-opcode ${sub} at byte ${r.pos}`);
  }
}

function scanFd(r) {
  const sub = r.u32();
  if (sub <= 11 || sub === 92 || sub === 93) {
    memarg(r); // v128.load* / v128.store / load32_zero / load64_zero
  } else if (sub === 12 || sub === 13) {
    r.skip(16); // v128.const / i8x16.shuffle
  } else if (sub >= 21 && sub <= 34) {
    r.skip(1); // extract_lane / replace_lane
  } else if (sub >= 84 && sub <= 91) {
    memarg(r); // load*_lane / store*_lane
    r.skip(1);
  }
  // everything else (incl. relaxed SIMD) has no immediates
}

function scanFe(r) {
  const sub = r.u32();
  if (sub === 0x03) {
    r.u8(); // atomic.fence: reserved byte
  } else if (sub <= 0x02 || (sub >= 0x10 && sub <= 0x4e)) {
    memarg(r);
  } else {
    throw new Error(`unknown 0xFE sub-opcode ${sub} at byte ${r.pos}`);
  }
}

/**
 * @param {Uint8Array} bytes  a .wasm file
 * @returns {ReturnType<typeof emptyCounts> & { sections: number[] }}
 */
export function scanWasm(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 8 || u8[0] !== 0x00 || u8[1] !== 0x61 || u8[2] !== 0x73 || u8[3] !== 0x6d) {
    throw new Error('not a WebAssembly binary (missing \\0asm magic)');
  }
  const counts = emptyCounts();
  const sections = [];
  const r = new Reader(u8, 8);
  while (r.pos < u8.length) {
    const id = r.u8();
    const size = r.u32();
    const start = r.pos;
    sections.push(id);
    if (id === SECTION_CODE) {
      const bodies = r.u32();
      for (let f = 0; f < bodies; f++) {
        const bodySize = r.u32();
        const bodyEnd = r.pos + bodySize;
        const body = new Reader(u8, r.pos, bodyEnd);
        const groups = body.u32();
        for (let g = 0; g < groups; g++) {
          body.u32();
          valType(body);
        }
        scanBody(body, counts);
        counts.functions++;
        r.pos = bodyEnd;
      }
    }
    r.pos = start + size;
  }
  return { ...counts, sections };
}
