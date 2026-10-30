#!/bin/bash
# Cutline second-pass suite (bug hunt + new features). Usage: bash run-pass2.sh [y1 y2 ...]
cd "$(dirname "$0")"
mkdir -p shots out
tests="$*"
[ -z "$tests" ] && tests=$(ls y*_*.js | sed 's/_.*//' | sort -u | tr '\n' ' ')
fail=0; total=0; passed=0
for t in $tests; do
  f=$(ls ${t}_*.js 2>/dev/null | head -1)
  [ -z "$f" ] && { echo "unknown test $t"; continue; }
  echo "=== $f"
  out=$(timeout 900 node "$f" 2>&1); code=$?
  echo "$out" | grep -aE "^ok -|ASSERT FAIL|TEST ERROR|^  · |^PASS|^FAILURES|console:|pageerror" | sed 's/^/  /' | cut -c1-300
  echo "$out" > out/$t.log
  n=$(echo "$out" | grep -c "^ok -"); total=$((total + n)); passed=$((passed + n))
  nf=$(echo "$out" | grep -c "ASSERT FAIL"); total=$((total + nf))
  if [ $code -ne 0 ] || echo "$out" | grep -qE "TEST ERROR|ASSERT FAIL|console: |pageerror"; then fail=1; fi
done
echo "=== $passed/$total assertions passed"
[ $fail = 0 ] && echo "PASS2 ALL PASSED" || echo "PASS2 FAILURES"
