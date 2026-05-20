#!/usr/bin/env python3
"""Generate shader thumbnail previews."""

import os
import math
from pathlib import Path

# Try to use PIL if available, otherwise generate SVGs
try:
    from PIL import Image, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("PIL not available, generating SVG thumbnails instead")

SHADER_NAMES = [
    "patternv0.21", "patternv0.23", "patternv0.24", "patternv0.30",
    "patternv0.35_bloom", "patternv0.37", "patternv0.38", "patternv0.39",
    "patternv0.40", "patternv0.42", "patternv0.43", "patternv0.44",
    "patternv0.45", "patternv0.45b", "patternv0.46", "patternv0.47",
    "patternv0.48", "patternv0.49", "patternv0.50", "patternv0.51", "patternv0.55"
]

def get_color_for_shader(name: str) -> tuple[int, int, int]:
    """Generate a color based on shader name."""
    # Extract version number
    parts = name.split("v")
    if len(parts) > 1:
        try:
            version = float(parts[-1].replace("_bloom", "").replace("b", ""))
            # Create color based on version
            hue = (version * 360 / 60) % 360  # Cycle through hues

            # Convert HSV to RGB (simplified)
            h = hue / 60.0
            c = 200  # Chroma
            x = c * (1 - abs((h % 2) - 1))

            if h < 1:
                r, g, b = int(c), int(x), 0
            elif h < 2:
                r, g, b = int(x), int(c), 0
            elif h < 3:
                r, g, b = 0, int(c), int(x)
            elif h < 4:
                r, g, b = 0, int(x), int(c)
            elif h < 5:
                r, g, b = int(x), 0, int(c)
            else:
                r, g, b = int(c), 0, int(x)

            m = 55
            return (r + m, g + m, b + m)
        except (ValueError, IndexError):
            pass

    # Default colors for non-versioned shaders
    return (100, 150, 200)

def generate_pil_thumbnail(name: str, output_path: str) -> None:
    """Generate a PNG thumbnail using PIL."""
    size = 96
    color = get_color_for_shader(name)

    # Create a new image
    img = Image.new('RGB', (size, size), color='black')
    draw = ImageDraw.Draw(img)

    # Draw background gradient (approximated with bands)
    for i in range(size):
        ratio = i / size
        r = int(color[0] * (0.5 + ratio * 0.5))
        g = int(color[1] * (0.5 + ratio * 0.5))
        b = int(color[2] * (0.5 + ratio * 0.5))
        draw.line([(0, i), (size, i)], fill=(r, g, b))

    # Draw a geometric pattern
    center = size // 2
    for i in range(0, size, 16):
        # Draw circles
        r = (i + 8) % size
        if r > 0:
            draw.ellipse(
                [(center - r, center - r), (center + r, center + r)],
                outline=(200, 200, 200),
                width=1
            )

    # Add shader name text
    draw.text((size // 2, size - 12), name, fill=(200, 200, 200), anchor="mm")

    img.save(output_path, 'PNG')
    print(f"Generated: {output_path}")

def generate_svg_thumbnail(name: str, output_path: str) -> None:
    """Generate an SVG thumbnail (saved as .svg, not .png)."""
    size = 96
    color = get_color_for_shader(name)

    svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:rgb({color[0]},{color[1]},{color[2]});stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb({color[0]//2},{color[1]//2},{color[2]//2});stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="{size}" height="{size}" fill="url(#grad)"/>
  <circle cx="{size//2}" cy="{size//2}" r="{size//4}" fill="none" stroke="#cccccc" stroke-width="1" opacity="0.6"/>
  <circle cx="{size//2}" cy="{size//2}" r="{size//3}" fill="none" stroke="#cccccc" stroke-width="1" opacity="0.4"/>
  <text x="{size//2}" y="{size - 8}" font-size="8" fill="#cccccc" text-anchor="middle" font-family="monospace">{name}</text>
</svg>'''

    with open(output_path, 'w') as f:
        f.write(svg_content)
    print(f"Generated: {output_path}")

def main():
    """Generate all shader thumbnails."""
    output_dir = Path(__file__).parent / 'shaders' / 'thumbnails'
    output_dir.mkdir(parents=True, exist_ok=True)

    for shader_name in SHADER_NAMES:
        if HAS_PIL:
            output_path = output_dir / f"{shader_name}.png"
            generate_pil_thumbnail(shader_name, str(output_path))
        else:
            output_path = output_dir / f"{shader_name}.svg"
            generate_svg_thumbnail(shader_name, str(output_path))

if __name__ == '__main__':
    main()
