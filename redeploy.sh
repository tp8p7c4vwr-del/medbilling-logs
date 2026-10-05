#!/usr/bin/env bash
# Stage public/ for GitHub Pages redeploy (tp8p7c4vwr-del/medbilling-logs).
# 1) copies public/ to a temp dir (set BUMP_SW=1 to auto-bump the sw.js cache version; otherwise bump V yourself)
# 2) uploads a tarball to a temporary (3-day) shipstatic URL
# 3) prints the line to commit as .deploy/bundle.txt on main (via the GitHub connector); the Actions
#    workflow then downloads it, verifies the sha256, commits it to site/ and publishes gh-pages.
set -euo pipefail
cd "$(dirname "$0")"
T=$(mktemp -d); mkdir -p "$T/site" "$T/stage"
cp -a public/. "$T/site/"
[ "${BUMP_SW:-0}" = 1 ] && sed -i "s/^const V = '[^']*';/const V = 'bl-$(date +%Y%m%d%H%M%S)';/" "$T/site/sw.js"
tar -C "$T/site" -czf "$T/stage/bundle.tgz" .
echo '<!doctype html><title>staging</title>' > "$T/stage/index.html"
SHA=$(sha256sum "$T/stage/bundle.tgz" | cut -d' ' -f1)
URL=$(npx -y @shipstatic/ship "$T/stage" --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["url"])')
echo "BUNDLE_LINE: $URL/bundle.tgz $SHA"
