#!/usr/bin/env python3
"""Serve the static PWA over TLS without a JavaScript toolchain.

Use through ``./scripts/serve.sh`` so certificates are supplied by mkcert.
This server intentionally has no HTTP fallback: camera and microphone access
must use a secure context.
"""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
import sys


class AppHandler(SimpleHTTPRequestHandler):
    # Bind-to-LAN mode must never expose the checkout, virtualenv, or mkcert
    # key directory.  The PWA needs only this small, explicit application shell.
    ALLOWED_PATHS = {
        "/", "/index.html", "/measurement-spec.js", "/measurement-spec.json", "/detection-engine.js",
        "/manifest.webmanifest", "/sw.js", "/icons/icon.svg",
        "/result-utils.js", "/motion-core.js", "/motion-review.js",
        "/video-quality.js", "/share-core.js", "/share-media.js",
    }

    def _is_allowed(self) -> bool:
        return self.path.split("?", 1)[0] in self.ALLOWED_PATHS

    def do_GET(self) -> None:  # noqa: N802
        if not self._is_allowed():
            self.send_error(404, "Not found")
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if not self._is_allowed():
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(self)")
        path = self.path.split("?", 1)[0]
        if path in {"/", "/index.html", "/sw.js", "/manifest.webmanifest", "/measurement-spec.js", "/detection-engine.js"}:
            self.send_header("Cache-Control", "no-cache")
        if path == "/sw.js":
            self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def list_directory(self, path: str):  # noqa: ANN201
        self.send_error(403, "Directory listing is disabled")
        return None


class TLSHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="フレスコボールPWAをHTTPSで配信")
    parser.add_argument("--directory", type=Path, default=root)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--cert", type=Path, required=True)
    parser.add_argument("--key", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    directory = args.directory.resolve()
    if not directory.is_dir():
        sys.exit(f"配信ディレクトリがありません: {directory}")
    for path, label in ((args.cert, "証明書"), (args.key, "秘密鍵")):
        if not path.is_file():
            sys.exit(f"{label}がありません: {path}")
    handler = partial(AppHandler, directory=str(directory))
    server = TLSHTTPServer((args.host, args.port), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certfile=args.cert, keyfile=args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    shown_host = args.host if args.host != "0.0.0.0" else "<このMacのLAN IP>"
    print(f"HTTPS server: https://{shown_host}:{args.port}/")
    print("停止するには Ctrl-C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
