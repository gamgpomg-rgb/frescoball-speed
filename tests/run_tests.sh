#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 "$ROOT/scripts/sync_measurement_spec.py" --check
python3 -m unittest discover -s "$ROOT/tests" -p 'test_*.py'
if command -v node >/dev/null 2>&1; then
  for test_file in "$ROOT"/tests/test_*.js; do
    node "$test_file"
  done
else
  echo "node がないため Web 計算テストをスキップしました" >&2
fi
