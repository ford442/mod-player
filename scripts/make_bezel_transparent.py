#!/usr/bin/env python3
from PIL import Image
from pathlib import Path

p = Path('public/bezel.png')
if not p.exists():
    print('bezel.png not found')
    raise SystemExit(1)

backup = p.with_name('bezel.orig.png')
if not backup.exists():
    p.rename(backup)
    print('backup created at', backup)
else:
    print('backup already exists at', backup)

img = Image.open(backup).convert('RGBA')
px = img.load()
width, height = img.size

# threshold: treat pixels near white as transparent
threshold = 250
fuzz = 6
for y in range(height):
    for x in range(width):
        r,g,b,a = px[x,y]
        if r >= threshold and g >= threshold and b >= threshold:
            px[x,y] = (r,g,b,0)
        else:
            # preserve pixel as-is
            pass

img.save(p)
print('Saved transparent bezel to', p)
