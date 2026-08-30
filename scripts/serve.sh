#!/usr/bin/env bash
# Secure static server launcher. Certificates are private to this checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="local"
PORT="8443"

usage() {
  cat <<'EOF'
Usage: ./scripts/serve.sh [--lan] [--port 8443]

  (default) localhost only; safe for this Mac.
  --lan     bind to the local network for an iPhone/iPad on the same Wi-Fi.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lan) MODE="lan" ;;
    --port) PORT="${2:?--port requires a value}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ! command -v mkcert >/dev/null 2>&1; then
  cat >&2 <<'EOF'
mkcert が必要です。初回だけ次を実行してください:
  brew install mkcert
  mkcert -install
その後、このコマンドを再実行してください。自己署名証明書へ安全性を下げてフォールバックすることはしません。
EOF
  exit 2
fi

CERT_DIR="$ROOT/.local-cert"
mkdir -p "$CERT_DIR"
HOST="127.0.0.1"
CERT="$CERT_DIR/localhost.pem"
KEY="$CERT_DIR/localhost-key.pem"
NAMES=(localhost 127.0.0.1 ::1)

if [[ "$MODE" == "lan" ]]; then
  HOST="0.0.0.0"
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$LAN_IP" ]]; then
    LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$LAN_IP" ]]; then
    echo "LAN IPを取得できません。Wi-Fi接続を確認するか、Macで通常モードを使ってください。" >&2
    exit 2
  fi
  CERT="$CERT_DIR/lan-${LAN_IP}.pem"
  KEY="$CERT_DIR/lan-${LAN_IP}-key.pem"
  NAMES+=("$LAN_IP")
  echo "iPhone/iPad: https://${LAN_IP}:${PORT}/"
fi

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  mkcert -cert-file "$CERT" -key-file "$KEY" "${NAMES[@]}"
fi

exec python3 "$ROOT/scripts/serve_https.py" --directory "$ROOT" --host "$HOST" --port "$PORT" --cert "$CERT" --key "$KEY"
