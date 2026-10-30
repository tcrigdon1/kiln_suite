#!/bin/bash
# Hands-on Cutline QA suite: drives the UI with real mouse/keyboard input only. Usage: bash run-handson.sh [h3 h5 ...]
cd "$(dirname "$0")"
tests="$*"
if [ -z "$tests" ]; then rm -rf shots out; fi
mkdir -p shots out
[ -z "$tests" ] && tests="h1_library h2_source h3_timeline h4_playback h5_program h6_effects h7_transitions h8_titles h9_color_audio h10_captions_history h11_save_open h12_export h13_mixed h14_prefs_layout h15_context_menus h16_misc"
fail=0; total=0; passed=0
for t in $tests; do
  if [ -f "$t.js" ]; then f="$t.js"; else f=$(ls ${t}_*.js 2>/dev/null | head -1); fi
  echo "=== $f"
  out=$(timeout 600 node "$f" 2>&1); code=$?
  echo "$out" | grep -aE "^ok -|ASSERT FAIL|TEST ERROR|PASS \(|FAILURES" | sed 's/^/  /' | cut -c1-240
  n=$(echo "$out" | grep -c "^ok -"); total=$((total + n)); passed=$((passed + n))
  nf=$(echo "$out" | grep -c "ASSERT FAIL"); total=$((total + nf))
  if [ $code -ne 0 ] || echo "$out" | grep -qE "TEST ERROR|ASSERT FAIL"; then fail=1; fi
done
echo "=== $passed/$total assertions passed"
[ $fail = 0 ] && echo "HANDS-ON ALL PASSED" || echo "HANDS-ON FAILURES"
