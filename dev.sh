#!/usr/bin/env bash
# Run the full WhatsApp CRM (server + web) with one command.
#   ./dev.sh            - start both
#   ./dev.sh web        - start only the web app
#   ./dev.sh server     - start only the API server
set -e
cd "$(dirname "$0")"

install_if_missing() {
  if [ ! -d "node_modules" ]; then
    echo ">> installing $1 deps..."
    (cd "$1" && npm install)
  fi
}

run_server() {
  install_if_missing server
  (cd server && npx tsx src/index.ts)
}

run_web() {
  install_if_missing web
  (cd web && npm run dev)
}

case "$1" in
  web)   run_web ;;
  server) run_server ;;
  *)
    echo "Starting WhatsApp CRM..."
    trap 'kill 0' EXIT
    run_server &
    SERVER_PID=$!
    sleep 3
    run_web &
    wait $SERVER_PID
    ;;
esac