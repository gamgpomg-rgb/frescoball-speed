#!/usr/bin/env bash
# Create an isolated environment for the optional Python analysis scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV="$ROOT/.venv"

"$PYTHON_BIN" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$ROOT/scripts/requirements.txt"
"$VENV/bin/python" "$ROOT/scripts/diagnose.py" --strict
echo "Ready: $VENV/bin/python scripts/video_speed.py <video>"
