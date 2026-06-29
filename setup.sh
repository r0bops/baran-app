#!/usr/bin/env bash
# Bootstrap on a fresh clone. The repo currently also ships node_modules + dist
# (Linux x64); if you are on macOS/Windows or anything fails, run this to install
# the right dependencies for your machine.
set -e
cd "$(dirname "$0")"

echo "→ Shared core (TypeScript): install + build"
( cd packages/venrescate-core-ts && npm install && npm run build )

echo "→ Coordinator web: install"
( cd apps/coordinator-web && npm install )

cat <<'EOF'

Done. To run:

  Backend (real API, :3001):   node packages/venrescate-api-server/src/server.mjs
  Backend (Phase-1 stub):      node packages/venrescate-api-stub/src/server.mjs
  Coordinator console (:5173): ( cd apps/coordinator-web && npm run dev )

Tests:
  TS vectors:        ( cd packages/venrescate-core-ts && npm test )
  Core adversarial:  ( cd packages/venrescate-core-ts && npm run test:security )
  API integration:   node test/integration-test.mjs
  Backend suites:    ( cd packages/venrescate-api-server && npm test && npm run test:security )
  Kotlin core:       ./gradlew :venrescate-core:test

Android APK (needs the Android SDK):
  Open this folder in Android Studio and Run, or:  ./gradlew :android:assembleDebug
EOF
