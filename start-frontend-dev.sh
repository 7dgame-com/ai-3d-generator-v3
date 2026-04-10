#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Starting ai-3d-generator-v3 frontend dev server..."
echo "   frontend: http://localhost:3008"
echo "   backend:  http://localhost:8089"
echo ""
echo "Reverse proxies are still provided by frontend/vite.config.ts:"
echo "  /api/     -> http://localhost:8081"
echo "  /backend/ -> http://localhost:8089"
echo "  /tripo/   -> https://api.tripo3d.ai/v2/openapi"
echo "  /hyper/   -> https://api.hyper3d.com/api/v2"
echo ""

(cd "$SCRIPT_DIR/frontend" && pnpm run dev)
