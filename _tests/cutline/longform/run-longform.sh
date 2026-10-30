#!/bin/bash
# Cutline long-form (10-hour VOD) test suite. Usage: bash run-longform.sh [lf1 lf3 ...]
# Builds the test media first if missing (~7.6 GB in media/, ~25 min of encoding; see build_media.sh).
# Each test is run with a 60-minute cap. lf4 (20-minute export) runs with LF_GL=gl (legacy SwiftShader GL) because
# canvas readback under ANGLE/SwiftShader limits headless exports to ~3-8 fps; everything else uses ANGLE.
cd "$(dirname "$0")"
[ -f media/vod10h.mp4 ] && [ -f media/vod10h.webm ] && [ -f media/vfr.webm ] || bash build_media.sh || exit 1
mkdir -p out shots
tests="$*"; [ -z "$tests" ] && tests="lf1 lf2 lf2w lf3 lf4 lf5 lf6"
fail=0; total=0; passed=0
for t in $tests; do
  case $t in
    lf1) cmd="node lf1_demux.js" ;;
    lf2) cmd="node lf2_import_wave.js vod10h.mp4" ;;
    lf2w) cmd="node lf2_import_wave.js vod10h.webm" ;;
    lf3) cmd="node lf3_handson.js vod10h.mp4" ;;
    lf4) cmd="env LF_GL=gl node lf4_export20.js vod10h.mp4 webm-vp9" ;;
    lf5) cmd="node lf5_audio_project.js" ;;
    lf6) cmd="node lf6_vfr_cancel.js" ;;
    *) echo "unknown test $t"; continue ;;
  esac
  echo "=== $t: $cmd"
  out=$(timeout 3600 $cmd 2>&1); code=$?
  echo "$out" | grep -aE "^ok -|ASSERT FAIL|TEST ERROR|^  · |^PASS|^FAILURES" | cut -c1-400
  echo "$out" > out/$t.log
  n=$(echo "$out" | grep -c "^ok -"); total=$((total + n)); passed=$((passed + n))
  nf=$(echo "$out" | grep -c "ASSERT FAIL"); total=$((total + nf))
  if [ $code -ne 0 ] || echo "$out" | grep -qE "TEST ERROR|ASSERT FAIL"; then fail=1; fi
done
echo "=== $passed/$total assertions passed"
du -sh media | sed 's/^/test media on disk: /'
[ $fail = 0 ] && echo "LONGFORM ALL PASSED" || echo "LONGFORM FAILURES"
