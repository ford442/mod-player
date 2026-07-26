#!/usr/bin/env python3
"""Safe tier-A WGSL migration: strip lib functions by brace matching, add includes."""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHADERS = ROOT / "shaders"

LIBS = [
    ("lib/notes.wgsl", []),
    ("lib/palette.wgsl", ["selectPalette"]),
    ("lib/sdf.wgsl", ["sdRoundedBox", "sdCircle", "sdEllipse"]),
    ("lib/tonemap.wgsl", ["acesToneMap"]),
    ("lib/color_preserve.wgsl", []),
    ("lib/pitch.wgsl", ["pitchClassFromIndex", "fifthsHue", "octaveBrightness", "pitchHueForPalette", "neonPalette"]),
    ("lib/dura.wgsl", ["unpackDurationInfo", "calculateSustainBrightness"]),
    ("lib/top_emitter.wgsl", ["calculateTopIntensity"]),
    ("lib/brilliant_led.wgsl", ["brilliantLEDCore"]),
    ("lib/velocity_led.wgsl", ["normalizedCellVolume"]),
]

SKIP = {"circular_led_body", "circular_night_body", "circular_led_velocity_body", "circular_led_reactive_body", "theme_"}


def strip_fn(text: str, name: str) -> str:
    sig = f"fn {name}("
    while True:
        idx = text.find(sig)
        if idx == -1:
            break
        brace = text.find("{", idx)
        if brace == -1:
            break
        depth = 0
        i = brace
        while i < len(text):
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            i += 1
        while i < len(text) and text[i] == "\n":
            i += 1
        text = text[:idx] + text[i:]
    return text


def migrate(path: Path) -> dict:
    rel = path.name
    text = path.read_text()
    if any(s in text for s in SKIP) and "//#include" in text and path.stat().st_size < 2000:
        return {"file": rel, "skipped": "tier-b"}

    existing = set(m.group(1) for m in re.finditer(r'//#include\s+"([^"]+)"', text))
    added: list[str] = []

    if "const NOTE_MIN:" in text and "lib/notes.wgsl" not in existing:
        text = re.sub(
            r"(?:// DURA: Note duration constants\n)?const NOTE_MIN: u32 = 1u;\nconst NOTE_MAX: u32 = 119u;\nconst NOTE_OFF_MIN: u32 = 120u;\n\n?",
            "",
            text,
        )
        added.append("lib/notes.wgsl")
        existing.add("lib/notes.wgsl")

    if "struct NoteDurationInfo" in text and "lib/dura.wgsl" not in existing:
        text = re.sub(
            r"// DURA: Structure to hold unpacked note duration info\nstruct NoteDurationInfo \{[\s\S]*?\n\}\n\n?",
            "",
            text,
            count=1,
        )

    if "COLOR_PRESERVE_SCALE" in text and "lib/color_preserve.wgsl" not in existing:
        text = re.sub(
            r"// Scale factor for hue-preservation[\s\S]*?const COLOR_PRESERVE_MAX: f32\s+=\s+0\.85;\n\n?",
            "",
            text,
            count=1,
        )
        added.append("lib/color_preserve.wgsl")
        existing.add("lib/color_preserve.wgsl")

    for inc, fns in LIBS:
        if inc in existing:
            continue
        if inc == "lib/notes.wgsl":
            continue
        if inc == "lib/color_preserve.wgsl":
            continue
        need = any(f"fn {fn}(" in text for fn in fns)
        if not need:
            continue
        for fn in fns:
            text = strip_fn(text, fn)
        added.append(inc)
        existing.add(inc)

    if not added:
        return {"file": rel, "changed": False}

    text = re.sub(r"\n{3,}", "\n\n", text)
    m = re.search(r"^(.*?)(?=struct Uniforms|@group\(0\)|const THEME_)", text, re.S)
    header = m.group(1) if m else ""
    rest = text[len(header) :]
    includes = sorted(existing)
    block = "\n".join(f'//#include "{i}"' for i in includes) + "\n\n"
    path.write_text(header.rstrip() + "\n\n" + block + rest.lstrip("\n"))
    return {"file": rel, "changed": True, "includes": includes}


def main() -> None:
    files = [Path(p) for p in sys.argv[1:]] if len(sys.argv) > 1 else sorted(SHADERS.glob("patternv*.wgsl"))
    for f in files:
        if "legacy" in str(f):
            continue
        print(migrate(f))


if __name__ == "__main__":
    main()
