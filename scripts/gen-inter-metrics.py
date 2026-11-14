#!/usr/bin/env python3
"""Regenerate the Inter advance-width table embedded in sankey-render.js.

Dev-time only (not used by the CLI at run time). Requires fontTools and a local copy
of the Inter variable font (Google Fonts: Inter[opsz,wght].ttf).

Usage: python3 scripts/gen-inter-metrics.py /path/to/Inter-VariableFont_opsz,wght.ttf
Prints a JSON object {upm, chars, w600: [...], w700: [...]} to stdout.
"""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

CHARS = ''.join(chr(c) for c in range(32, 127)) + '£€¥–—…‘’“”•·×÷°%éèêëàâäôöûüçñßÉÀ→'

def widths(path, wght):
    f = TTFont(path)
    inst = instantiateVariableFont(f, {'wght': wght, 'opsz': 14})
    cmap = inst.getBestCmap()
    hmtx = inst['hmtx']
    upm = inst['head'].unitsPerEm
    return upm, [hmtx[cmap[ord(ch)]][0] if ord(ch) in cmap else None for ch in CHARS]

upm, w600 = widths(sys.argv[1], 600)
_, w700 = widths(sys.argv[1], 700)
print(json.dumps({'upm': upm, 'chars': CHARS, 'w600': w600, 'w700': w700}, ensure_ascii=False))
