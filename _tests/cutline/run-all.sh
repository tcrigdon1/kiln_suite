#!/bin/bash
# Runs the Cutline Playwright test suite. Usage: bash run-all.sh
cd "$(dirname "$0")"
fail=0
for t in t2.js t4.js t5.js t6.js t8.js t_shaders.js t_mp4.js t_dec2.js t_nest.js t_match.js t_gate.js t_2d.js t_menus.js t_ctx.js; do
  echo "=== $t"
  out=$(node $t 2>&1)
  echo "$out" | grep -av "^move" | grep -aE "ok -|ASSERT|TEST ERROR|console:|pageerror" | head -60
  if echo "$out" | grep -aqE "TEST ERROR|pageerror|console: "; then fail=1; fi
done
echo "=== ffprobe export"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact "${TMPDIR:-/tmp}/kiln-tests/out.webm"
[ $fail = 0 ] && echo "ALL PASSED" || echo "FAILURES"
