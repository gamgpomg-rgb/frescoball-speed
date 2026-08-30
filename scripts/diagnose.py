#!/usr/bin/env python3
"""Report whether the optional Python and HTTPS tooling is ready."""
from __future__ import annotations

import argparse
import importlib
from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def main() -> int:
    parser = argparse.ArgumentParser(description="フレスコボール計測ツールの依存関係を診断")
    parser.add_argument("--strict", action="store_true", help="必須Python依存が欠ける場合に非ゼロ終了")
    args = parser.parse_args()

    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    missing: list[str] = []
    for module, package in (("numpy", "numpy"), ("scipy", "scipy"), ("cv2", "opencv-python")):
        try:
            loaded = importlib.import_module(module)
            print(f"OK  Python package: {package} ({getattr(loaded, '__version__', 'installed')})")
        except Exception as exc:  # ImportError and incompatible binary installs are both actionable.
            missing.append(package)
            print(f"NG  Python package: {package} ({exc})")

    try:
        from fresco_physics import SPEC_VERSION, theoretical_v0_factor
        print(f"OK  Measurement spec: {SPEC_VERSION}; theoretical 7m factor={theoretical_v0_factor():.9f}")
    except Exception as exc:
        missing.append("measurement specification")
        print(f"NG  Measurement spec: {exc}")

    for command, purpose in (("ffmpeg", "動画から音声を抽出する場合"), ("mkcert", "HTTPSでPWAを端末へ配信する場合"), ("node", "Web計算の回帰テスト")):
        path = shutil.which(command)
        print(f"{'OK' if path else 'INFO'} {command}: {path or '未導入'} ({purpose})")

    if args.strict and missing:
        print("\n不足: " + ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
