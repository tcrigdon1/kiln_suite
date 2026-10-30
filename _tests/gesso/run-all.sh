#!/bin/sh
# Runs every Gesso browser test (Playwright). Usage: sh run-all.sh
cd "$(dirname "$0")"
for t in smoke full more third fourth fifth sixth monkey toolmonkey; do
  echo "== $t"; node $t.js | grep -E "FAIL|ERR |NO ERRORS|ERRORS"
done
