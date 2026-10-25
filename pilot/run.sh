#!/usr/bin/env bash
# Pilot driver v1 — OUTLINE phase.
# Capture three Yoto pages and dump each request outline so the
# Trustpilot data request can be identified and an operation
# designed. Revised between runs; see REPORT for findings.
set -x
mkdir -p pilot-out

cap() { # name url example
  echo "===== capture $1 : $2 (example $3) ====="
  api-anything capture "$2" --example "$3" --outline \
    > "pilot-out/$1.json" 2> "pilot-out/$1.err" || true
  cat "pilot-out/$1.err" || true
  cat "pilot-out/$1.json"
  echo
}

# A: Yoto Mini — widget carries a pooled data-sku list; the
#    example value is one of those SKUs, expected inside the
#    Trustpilot requests the page fires.
cap a "https://us.yotoplay.com/players/yoto-mini-4" "sku=PRP3XX02848"
# B: Yoto Player — widget present but data-sku empty; example is
#    a variant SKU from the page's embedded JSON.
cap b "https://us.yotoplay.com/players/yoto-player-4" "sku=PRP4XX05512"
# C: a Yoto card page — no Trustpilot widget at all; does any
#    Trustpilot request fire here?
cap c "https://us.yotoplay.com/products/ohana-means-family" "sku=CRSTXX02617"

cp -r ~/.api-anything pilot-out/api-anything-home || true
ls -la pilot-out
