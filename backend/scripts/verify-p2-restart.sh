#!/usr/bin/env bash
set -euo pipefail

# Run two independent Node processes against a disposable P2 database. The
# process boundary is intentional: it exercises restart recovery rather than
# merely calling the recovery functions in the same process.
: "${AI3D_QUEUE_P2_RESTART_RUN_ID:=restart-$(date +%s)-${RANDOM}}"
export AI3D_QUEUE_P2_RESTART_RUN_ID

./node_modules/.bin/tsx src/scripts/verifyQueueP2Restart.ts prepare
./node_modules/.bin/tsx src/scripts/verifyQueueP2Restart.ts resume
