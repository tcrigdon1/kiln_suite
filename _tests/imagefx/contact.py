#!/usr/bin/env python3
"""Build labelled contact sheets from out/*.png (run after test.js)."""
import json, os, sys
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
names = ['000_original.png'] + json.load(open(os.path.join(OUT, 'manifest.json')))
TW, TH, COLS = 320, 213 + 18, 5
checker = Image.new('RGBA', (320, 213))
d = ImageDraw.Draw(checker)
for y in range(0, 213, 12):
    for x in range(0, 320, 12):
        d.rectangle([x, y, x + 11, y + 11], fill=(200, 200, 200, 255) if (x // 12 + y // 12) % 2 else (150, 150, 150, 255))
per = int(sys.argv[1]) if len(sys.argv) > 1 else 30
for s in range(0, len(names), per):
    chunk = names[s:s + per]
    rows = (len(chunk) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * TW, rows * TH), (30, 30, 30))
    dr = ImageDraw.Draw(sheet)
    for k, n in enumerate(chunk):
        im = Image.open(os.path.join(OUT, n)).convert('RGBA').resize((320, 213), Image.LANCZOS)
        bg = checker.copy(); bg.alpha_composite(im)
        x, y = (k % COLS) * TW, (k // COLS) * TH
        sheet.paste(bg.convert('RGB'), (x, y + 18))
        dr.text((x + 4, y + 3), n[:-4], fill=(255, 220, 120))
    sheet.save(os.path.join(OUT, 'contact_%d.png' % (s // per + 1)))
print('ok')
