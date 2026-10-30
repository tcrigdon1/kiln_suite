#!/bin/sh
# Pass-2 hands-on suite for Gesso (real mouse/keyboard/pen input; see PUNCHLIST.md). Usage: sh run-pass2.sh
cd "$(dirname "$0")"; mkdir -p "${TMPDIR:-/tmp}/kiln-tests"
fail=0
for t in a1-edge-cases a2-extremes a3-ui-env a4-tools-offset a5-sparse-masks a6-sessions b1-content-layers b2-roundtrip c1-warp c2-meshwarp c3-export c4-patchfill c5-subject c6-embed c7-comps c8-gallery c9-palette-tour c10-actions c11-brush-type c12-vector; do
  [ -f "$t.js" ] || continue
  echo "== $t"
  node $t.js > "${TMPDIR:-/tmp}/kiln-tests/gesso-pass2-$t.log" 2>&1 || fail=1
  grep -E "^FAIL|passed|ERRORS|pageerror|console:" "${TMPDIR:-/tmp}/kiln-tests/gesso-pass2-$t.log"
done
[ $fail = 0 ] && echo "ALL PASS-2 SCRIPTS PASSED" || echo "SOME PASS-2 SCRIPTS FAILED"
exit $fail
