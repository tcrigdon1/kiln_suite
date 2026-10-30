#!/bin/sh
# Hands-on QA suite for Gesso: real mouse/keyboard input only (see PUNCHLIST.md). Usage: sh run-handson.sh
cd "$(dirname "$0")"; mkdir -p "${TMPDIR:-/tmp}/kiln-tests"
fail=0
for t in s1-start s2-select s3-layers s4-transform s5-text-shapes s6-adjust-view s7-files-ui s8-misc s9-more p2-shapes p2-text p2-watch; do
  echo "== $t"
  node $t.js > "${TMPDIR:-/tmp}/kiln-tests/gesso-handson-$t.log" 2>&1 || fail=1
  grep -E "^FAIL|passed|ERRORS|pageerror|console:" "${TMPDIR:-/tmp}/kiln-tests/gesso-handson-$t.log"
done
[ $fail = 0 ] && echo "ALL HANDS-ON SCRIPTS PASSED" || echo "SOME HANDS-ON SCRIPTS FAILED"
exit $fail
