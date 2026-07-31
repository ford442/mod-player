/**
 * Structural coverage assertions for visual smoke tests.
 *
 * Detects partial/misaligned shader renders — thin bands, scanline offsets, overlay
 * misalignment — that the existing non-black / opaque-pixel check misses.
 *
 * Bug history this guards against:
 *   #346–#348  solid-black canvas       → global coverage floor (subsumes existing check)
 *   #349       thin band at top          → per-region floor collapses in lower sectors/rows
 *   #350       scanline offset           → centroid displaced from canvas centre
 *   #351       overlay misalignment      → bbox span check catches systematic offsets
 *
 * Architecture:
 *   • computeBrowserCoverage — self-contained function to be passed to page.evaluate();
 *     runs inside the browser, reads pixels via window.currentPatternRenderer, returns
 *     a plain serialisable stats object.
 *   • computeCoverageStats  — identical computation logic for Node.js (testing/offline use).
 *   • assertCoverageResult  — Node.js assertion; takes stats + config, returns failures[].
 *   • Region builders       — circularRegions / horizontalRegions / simpleRegions.
 *   • layoutFromShader      — maps shader filename → layout type.
 *   • regionsForShader      — convenience: filename → region array.
 *
 * No external dependencies — pure arithmetic on RGBA typed arrays.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

/** Luminance threshold that separates a lit pixel from background.
 *  ~0.047 — chosen to sit above the raised night-theme floor in v0.52–v0.54. */
export const LUMA_THRESHOLD = 12;

// ─── Region builders ────────────────────────────────────────────────────────

/**
 * Describe a rectangular coverage region.
 * Coordinates are normalised (0–1 fractions of canvas dimensions).
 *
 * @param {string} name
 * @param {number} x1 left edge (inclusive)
 * @param {number} y1 top edge  (inclusive)
 * @param {number} x2 right edge (exclusive)
 * @param {number} y2 bottom edge (exclusive)
 */
export function rectRegion(name, x1, y1, x2, y2) {
  return { type: 'rect', name, x1, y1, x2, y2 };
}

/**
 * Describe a polar annulus × sector coverage region.
 * Radii are normalised (fraction of Math.min(width, height)).
 * Angles are in radians in the atan2 convention (−π … π).
 *
 * @param {string} name
 * @param {number} innerR  inner radius (normalised)
 * @param {number} outerR  outer radius (normalised)
 * @param {number} sectorStart  start angle (inclusive), −π … π
 * @param {number} sectorEnd    end angle (exclusive)
 */
export function annulusRegion(name, innerR, outerR, sectorStart, sectorEnd) {
  return { type: 'annulus', name, innerR, outerR, sectorStart, sectorEnd };
}

/**
 * Build circular layout regions: numAnnuli annuli × numSectors angular sectors.
 *
 * Radii span [POLAR_INNER=0.15, POLAR_OUTER=0.45] × Math.min(w,h), matching the
 * ring geometry used by all circular shaders (v0.37–v0.57 family).
 *
 * @param {number} numAnnuli  radial bands (default 3)
 * @param {number} numSectors angular partitions (default 4)
 */
export function circularRegions(numAnnuli = 3, numSectors = 4) {
  const INNER_R = 0.15; // matches geometryConstants.ts POLAR_RINGS.INNER_RADIUS
  const OUTER_R = 0.45; // matches geometryConstants.ts POLAR_RINGS.OUTER_RADIUS
  const ringStep = (OUTER_R - INNER_R) / numAnnuli;
  const sectorStep = (2 * Math.PI) / numSectors;

  const regions = [];
  for (let a = 0; a < numAnnuli; a++) {
    for (let s = 0; s < numSectors; s++) {
      const isLast = s === numSectors - 1;
      regions.push(
        annulusRegion(
          `ring${a}_sector${s}`,
          INNER_R + a * ringStep,
          INNER_R + (a + 1) * ringStep,
          -Math.PI + s * sectorStep,
          // Widen the last sector slightly to capture the exact +π boundary from atan2.
          isLast ? Math.PI + 1e-9 : -Math.PI + (s + 1) * sectorStep,
        ),
      );
    }
  }
  return regions;
}

/**
 * Build horizontal layout regions: a grid of rect bands covering the pattern grid area.
 * Grid bounds (y offset 0.15, height 0.70) match GRID_RECT in geometryConstants.ts.
 *
 * @param {number} numColumns
 * @param {number} numRows
 */
export function horizontalRegions(numColumns = 4, numRows = 2) {
  const GRID_Y = 0.15;
  const GRID_H = 0.70;
  const regions = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numColumns; c++) {
      regions.push(
        rectRegion(
          `row${r}_col${c}`,
          c / numColumns,
          GRID_Y + (r * GRID_H) / numRows,
          (c + 1) / numColumns,
          GRID_Y + ((r + 1) * GRID_H) / numRows,
        ),
      );
    }
  }
  return regions;
}

/**
 * Build simple/fallback layout regions: 2×2 quadrants covering the full canvas.
 * Used for video shaders (v0.23, v0.24) and any shader without a known layout.
 */
export function simpleRegions() {
  return [
    rectRegion('top_left', 0.0, 0.0, 0.5, 0.5),
    rectRegion('top_right', 0.5, 0.0, 1.0, 0.5),
    rectRegion('bottom_left', 0.0, 0.5, 0.5, 1.0),
    rectRegion('bottom_right', 0.5, 0.5, 1.0, 1.0),
  ];
}

// ─── Layout detection ───────────────────────────────────────────────────────

/**
 * Derive layout type from shader filename.
 *
 * Mirrors the layout information in shaderRegistry.ts without creating a
 * TypeScript dependency in this pure-JS smoke script.
 *
 * @param {string} shaderFile  e.g. 'patternv0.50.wgsl'
 * @returns {'circular' | 'horizontal' | 'simple'}
 */
export function layoutFromShader(shaderFile) {
  // Horizontal panel shaders (layoutMode: 'horizontal_32')
  if (/v0\.(21|39|40|43|44)\.wgsl$/.test(shaderFile)) return 'horizontal';
  // Video overlay shaders — procedural full-screen, no cell-packing path
  if (/v0\.(23|24)\.wgsl$/.test(shaderFile)) return 'simple';
  // All remaining shaders use circular ring layout
  return 'circular';
}

/**
 * Build the canonical region list for a shader based on its layout type.
 *
 * @param {string} shaderFile
 */
export function regionsForShader(shaderFile) {
  switch (layoutFromShader(shaderFile)) {
    case 'horizontal':
      return horizontalRegions();
    case 'simple':
      return simpleRegions();
    default:
      return circularRegions();
  }
}

// ─── Pixel-level computation (Node.js) ──────────────────────────────────────

/**
 * Compute per-region coverage, global coverage, bounding box, and centroid
 * from a flat RGBA pixel array.  Pure function — no DOM, no window.
 *
 * This is the canonical computation logic.  computeBrowserCoverage below
 * duplicates the inner loop so it can be serialised into page.evaluate().
 *
 * @param {Uint8Array|number[]} pixels  flat RGBA [r,g,b,a, r,g,b,a, …]
 * @param {number} width
 * @param {number} height
 * @param {Array}  regions  from circularRegions / horizontalRegions / simpleRegions
 * @param {number} [lumaThreshold=12]
 */
export function computeCoverageStats(pixels, width, height, regions, lumaThreshold = 12) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const minDim = Math.min(width, height);
  const totalPixels = width * height;

  // Pre-compute squared radii for annulus regions to avoid sqrt in the hot loop.
  const regData = regions.map((r) => {
    if (r.type === 'annulus') {
      const iR = r.innerR * minDim;
      const oR = r.outerR * minDim;
      return Object.assign({}, r, { innerR2: iR * iR, outerR2: oR * oR });
    }
    return r;
  });

  let totalLit = 0;
  let litMinX = width;
  let litMaxX = 0;
  let litMinY = height;
  let litMaxY = 0;
  let litSumX = 0;
  let litSumY = 0;

  const regionLit = new Array(regions.length).fill(0);
  const regionTotal = new Array(regions.length).fill(0);

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const lit = l > lumaThreshold;

      if (lit) {
        totalLit++;
        if (x < litMinX) litMinX = x;
        if (x > litMaxX) litMaxX = x;
        if (y < litMinY) litMinY = y;
        if (y > litMaxY) litMaxY = y;
        litSumX += x;
        litSumY += y;
      }

      const nx = x / width;
      const ny = y / height;
      const dx = x - cx;
      const dist2 = dx * dx + dy * dy;
      let angle = null; // computed lazily for annulus regions only

      for (let ri = 0; ri < regData.length; ri++) {
        const reg = regData[ri];
        let inRegion = false;

        if (reg.type === 'rect') {
          inRegion = nx >= reg.x1 && nx < reg.x2 && ny >= reg.y1 && ny < reg.y2;
        } else if (reg.type === 'annulus') {
          if (dist2 >= reg.innerR2 && dist2 < reg.outerR2) {
            if (angle === null) angle = Math.atan2(dy, dx);
            inRegion = angle >= reg.sectorStart && angle < reg.sectorEnd;
          }
        }

        if (inRegion) {
          regionTotal[ri]++;
          if (lit) regionLit[ri]++;
        }
      }
    }
  }

  const globalCoverage = totalPixels > 0 ? totalLit / totalPixels : 0;
  const hasLit = totalLit > 50;

  return {
    width,
    height,
    globalCoverage,
    totalLit,
    totalPixels,
    regions: regions.map((reg, ri) => ({
      name: reg.name,
      coverage: regionTotal[ri] > 0 ? regionLit[ri] / regionTotal[ri] : 0,
      lit: regionLit[ri],
      total: regionTotal[ri],
    })),
    bbox: {
      spanX: hasLit ? (litMaxX - litMinX) / width : 0,
      spanY: hasLit ? (litMaxY - litMinY) / height : 0,
    },
    centroid: {
      x: totalLit > 0 ? litSumX / totalLit / width : 0.5,
      y: totalLit > 0 ? litSumY / totalLit / height : 0.5,
    },
  };
}

// ─── Browser-side computation ────────────────────────────────────────────────

/**
 * Self-contained function for page.evaluate().
 *
 * Reads pixels from window.currentPatternRenderer, runs the coverage computation
 * in the browser, and returns a serialisable stats object.  The function body
 * must not reference any module-scope identifiers — it is serialised via
 * Function.prototype.toString() by Playwright and executed in the browser context.
 *
 * Usage:
 *   import { computeBrowserCoverage } from './lib/coverage-assert.mjs';
 *   import { evaluate } from './lib/browser-launch.mjs';
 *
 *   const stats = await evaluate(page, computeBrowserCoverage, { regions, lumaThreshold: 12 });
 *
 * @param {{ regions: Array, lumaThreshold?: number }} args
 */
export function computeBrowserCoverage({ regions, lumaThreshold = 12 }) {
  /* This body runs in the BROWSER — no Node.js / module references allowed. */

  function luma(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Locate renderer and read pixels.
  // eslint-disable-next-line no-undef
  const renderer = window.currentPatternRenderer;
  if (!renderer || typeof renderer.readPixels !== 'function') {
    return { error: 'no-renderer' };
  }

  let pixels;
  try {
    pixels = renderer.readPixels();
  } catch (e) {
    return { error: `readPixels-threw: ${e.message}` };
  }
  if (!pixels) return { error: 'no-pixels' };

  // Resolve canvas dimensions from the renderer's canvas or a fallback selector.
  const canvas =
    (typeof renderer.getCanvas === 'function' ? renderer.getCanvas() : null) ??
    // eslint-disable-next-line no-undef
    document.querySelector('canvas[data-shader-preview-source="true"]');
  const width = canvas ? canvas.width : 1024;
  const height = canvas ? canvas.height : 1024;

  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return {
      error: `invalid-dimensions: ${width}x${height}, pixels.length=${pixels.length}`,
    };
  }

  const cx = width * 0.5;
  const cy = height * 0.5;
  const minDim = Math.min(width, height);
  const totalPixels = width * height;

  // Pre-compute squared radii for annulus regions.
  const regData = regions.map((reg) => {
    if (reg.type === 'annulus') {
      const iR = reg.innerR * minDim;
      const oR = reg.outerR * minDim;
      return Object.assign({}, reg, { innerR2: iR * iR, outerR2: oR * oR });
    }
    return reg;
  });

  let totalLit = 0;
  let litMinX = width;
  let litMaxX = 0;
  let litMinY = height;
  let litMaxY = 0;
  let litSumX = 0;
  let litSumY = 0;

  const regionLit = new Array(regions.length).fill(0);
  const regionTotal = new Array(regions.length).fill(0);

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = luma(pixels[i], pixels[i + 1], pixels[i + 2]);
      const lit = l > lumaThreshold;

      if (lit) {
        totalLit++;
        if (x < litMinX) litMinX = x;
        if (x > litMaxX) litMaxX = x;
        if (y < litMinY) litMinY = y;
        if (y > litMaxY) litMaxY = y;
        litSumX += x;
        litSumY += y;
      }

      const nx = x / width;
      const ny = y / height;
      const dx = x - cx;
      const dist2 = dx * dx + dy * dy;
      let angle = null; // computed lazily

      for (let ri = 0; ri < regData.length; ri++) {
        const reg = regData[ri];
        let inRegion = false;

        if (reg.type === 'rect') {
          inRegion = nx >= reg.x1 && nx < reg.x2 && ny >= reg.y1 && ny < reg.y2;
        } else if (reg.type === 'annulus') {
          if (dist2 >= reg.innerR2 && dist2 < reg.outerR2) {
            if (angle === null) angle = Math.atan2(dy, dx);
            inRegion = angle >= reg.sectorStart && angle < reg.sectorEnd;
          }
        }

        if (inRegion) {
          regionTotal[ri]++;
          if (lit) regionLit[ri]++;
        }
      }
    }
  }

  const globalCoverage = totalPixels > 0 ? totalLit / totalPixels : 0;
  const hasLit = totalLit > 50;

  return {
    width,
    height,
    globalCoverage,
    totalLit,
    totalPixels,
    regions: regions.map((reg, ri) => ({
      name: reg.name,
      coverage: regionTotal[ri] > 0 ? regionLit[ri] / regionTotal[ri] : 0,
      lit: regionLit[ri],
      total: regionTotal[ri],
    })),
    bbox: {
      spanX: hasLit ? (litMaxX - litMinX) / width : 0,
      spanY: hasLit ? (litMaxY - litMinY) / height : 0,
    },
    centroid: {
      x: totalLit > 0 ? litSumX / totalLit / width : 0.5,
      y: totalLit > 0 ? litSumY / totalLit / height : 0.5,
    },
  };
}

// ─── Assertion ───────────────────────────────────────────────────────────────

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Assert a coverage result against configuration floors.
 *
 * Checks (in order):
 *   (a) Global lit-pixel coverage ≥ globalFloor       — catches solid-black (#346–#348)
 *   (b) Per-region coverage ≥ regionFloor             — catches thin bands (#349)
 *   (c) Lit-pixel bounding box spans ≥ min axes       — catches systematic offsets (#351)
 *   (d) Lit-mass centroid within centroidTolerance     — catches scanline offsets (#350)
 *
 * @param {{ error?: string, globalCoverage: number, regions: Array,
 *            bbox: {spanX, spanY}, centroid: {x, y} }} stats
 * @param {{ globalFloor?: number, regionFloor?: number,
 *            bboxSpanMinX?: number, bboxSpanMinY?: number,
 *            centroidTolerance?: number }} [config]
 * @returns {{ pass: boolean, failures: string[] }}
 */
export function assertCoverageResult(stats, config) {
  const {
    globalFloor = 0.02,
    regionFloor = 0.05,
    bboxSpanMinX = 0.2,
    bboxSpanMinY = 0.2,
    centroidTolerance = 0.25,
  } = config ?? {};

  const failures = [];

  if (stats.error) {
    failures.push(`coverage-read error: ${stats.error}`);
    return { pass: false, failures };
  }

  // (a) Global coverage
  if (stats.globalCoverage < globalFloor) {
    failures.push(
      `global coverage ${pct(stats.globalCoverage)} < ${pct(globalFloor)} floor` +
        ` (${stats.totalLit}/${stats.totalPixels} lit pixels — catches solid-black render)`,
    );
  }

  // (b) Per-region coverage
  if (regionFloor > 0 && Array.isArray(stats.regions)) {
    for (const region of stats.regions) {
      if (region.total < 100) continue; // skip trivially small regions
      if (region.coverage < regionFloor) {
        failures.push(
          `region "${region.name}" coverage ${pct(region.coverage)} < ${pct(regionFloor)} floor` +
            ` (${region.lit}/${region.total} px — catches thin band / partial render)`,
        );
      }
    }
  }

  // (c) Bounding box span
  if (stats.bbox) {
    if (stats.bbox.spanX < bboxSpanMinX) {
      failures.push(
        `lit-pixel bbox width ${pct(stats.bbox.spanX)} < ${pct(bboxSpanMinX)} of canvas` +
          ` (catches thin vertical bands / collapsed horizontal extent)`,
      );
    }
    if (stats.bbox.spanY < bboxSpanMinY) {
      failures.push(
        `lit-pixel bbox height ${pct(stats.bbox.spanY)} < ${pct(bboxSpanMinY)} of canvas` +
          ` (catches thin horizontal bands like #349 Tunnel)`,
      );
    }
  }

  // (d) Centroid within tolerance of canvas centre
  if (stats.centroid) {
    const offX = Math.abs(stats.centroid.x - 0.5);
    const offY = Math.abs(stats.centroid.y - 0.5);
    if (offX > centroidTolerance) {
      failures.push(
        `lit-mass centroid x=${stats.centroid.x.toFixed(3)} deviates ${pct(offX)} from centre` +
          ` > ${pct(centroidTolerance)} tolerance (catches systematic horizontal offsets)`,
      );
    }
    if (offY > centroidTolerance) {
      failures.push(
        `lit-mass centroid y=${stats.centroid.y.toFixed(3)} deviates ${pct(offY)} from centre` +
          ` > ${pct(centroidTolerance)} tolerance (catches scanline offsets like #350/#351)`,
      );
    }
  }

  return { pass: failures.length === 0, failures };
}
