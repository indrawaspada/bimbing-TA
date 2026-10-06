#!/usr/bin/env bash
# PREVIEW ONLY: copies the static Vite build into the Emergent workspace's /app/public so the existing
# preview server can display it. Production hosting is Cloudflare Pages (dist/). No backend is used.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x /root/tools/node22/bin/node ] && export PATH=/root/tools/node22/bin:$PATH
node -v | grep -q "^v22" || { echo "Node 22 required"; exit 1; }
yarn -s build
rm -rf /app/public && mkdir -p /app/public && cp -r dist/. /app/public/
echo "preview updated"
