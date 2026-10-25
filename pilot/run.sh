#!/usr/bin/env bash
# Pilot driver v2 — TEACH + CALL phase.
#
# Outline findings (run 40153858416): Yoto card pages fire an
# invisible SEO TrustBox request —
#   GET widget.trustpilot.com/trustbox-data/5763bccae0a06d08e809ecbb
#       ?businessUnitId=5e90bde3fd8fc80001d20050&locale=en-UK
#       &sku=<the page's own SKU>&reviewsPerPage=10
# whose JSON carries productReviewsSummary {sku, starsAverage,
# numberOfReviews{total, oneStar..fiveStars}}. Teach that request
# as yoto.productRating(sku) from two card-page captures, then
# verify with SKU sets never used in teaching.
set -x
mkdir -p pilot-out

URL_A="https://us.yotoplay.com/products/ohana-means-family"
SKU_A="CRSTXX02617"   # 'Ohana Means Family — endpoint: 4.5 / 2
URL_B="https://us.yotoplay.com/products/1-2-3-bougez"
SKU_B="PKATXX01454"   # 1, 2, 3, bougez ! — endpoint: 3.7 / 3

api-anything capture "$URL_A" --example "sku=$SKU_A" > pilot-out/teach-cap-a.json || true
api-anything capture "$URL_B" --example "sku=$SKU_B" > pilot-out/teach-cap-b.json || true

python3 - <<'EOF' > pilot-out/teach-ids.env
import json
def pick(f):
    d = json.load(open(f))
    rid = None
    for c in d.get('candidates', []):
        if 'trustbox-data/5763bccae0a06d08e809ecbb' in c.get('url', ''):
            rid = c['id']
            break
    print(f"capture={d.get('capture')} request={rid}")
    return d.get('capture'), rid
ca, ra = pick('pilot-out/teach-cap-a.json')
cb, rb = pick('pilot-out/teach-cap-b.json')
with open('pilot-out/teach-ids.sh', 'w') as fh:
    fh.write(f"CAP_A={ca}\nREQ_A={ra}\nCAP_B={cb}\nREQ_B={rb}\n")
EOF
cat pilot-out/teach-ids.env
. pilot-out/teach-ids.sh
echo "teaching from capture A=$CAP_A request=$REQ_A ; B=$CAP_B request=$REQ_B"

api-anything add yoto product-rating \
  --from "$CAP_A" --pick-request "$REQ_A" \
  --example "sku=$SKU_A" \
  --from2 "$CAP_B" --example2 "sku=$SKU_B" \
  --extract productReviewsSummary \
  --pick starsAverage,numberOfReviews.total,sku \
  --description "Trustpilot product-review aggregate (starsAverage, review count) for a comma-separated set of Yoto product SKUs. Pilot-learned from Yoto card pages' SEO TrustBox request." \
  2>&1 | tee pilot-out/add.txt

api-anything ops yoto 2>&1 | tee pilot-out/ops.txt

echo "===== verify calls (fresh inputs; expected: Mini 4.7/2013, Player 4.8/807, Ohana 4.5/2)"
api-anything call yoto product-rating "sku=PRMNXX04904,PRMNXX02847,PRMNXX02846,PRMNXX02845" 2>&1 | tee pilot-out/call-mini.txt
api-anything call yoto product-rating "sku=PRP3XX02848,PRP3XX01755,PRP3XX04903" 2>&1 | tee pilot-out/call-player.txt
api-anything call yoto product-rating "sku=$SKU_A" 2>&1 | tee pilot-out/call-ohana.txt
echo "===== no-review SKU (expect an honest empty / zero, not an error storm)"
api-anything call yoto product-rating "sku=PRP4XX05512" 2>&1 | tee pilot-out/call-noreviews.txt

api-anything verify yoto 2>&1 | tee pilot-out/verify.txt

# Keep the learned spec for the report.
cp -r ~/.api-anything pilot-out/api-anything-home || true
find ~/.api-anything -name "*.json" -path "*sites*" -exec cat {} \; | tee pilot-out/learned-spec.json || true
