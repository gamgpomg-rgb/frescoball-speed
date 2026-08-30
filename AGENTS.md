# フレスコボール球速計測

- 物理・品質ゲート・片側マイク補正の正本は `measurement-spec.json`。変更後は `python3 scripts/sync_measurement_spec.py` を実行し、生成物 `measurement-spec.js` も更新する。
- 実測校正係数は空欄（物理モデル）を既定とし、スピードガン等の根拠なしに固定値へ変更しない。
- Python解析は `./scripts/setup_venv.sh`、診断は `.venv/bin/python scripts/diagnose.py --strict`、回帰テストは `./tests/run_tests.sh`。
- PWAは安全なTLSのみで配信する。初回の `mkcert -install` 後、Macは `./scripts/serve.sh`、同一Wi-Fiの端末は `./scripts/serve.sh --lan`。ユーザーの既存グローバル設定や証明書設定を自動変更しない。
- PWAの静的資産を追加・変更したら、`sw.js` のキャッシュ名/資産一覧と `scripts/serve_https.py` の許可パスを同時に確認する。LAN配信でリポジトリや証明書鍵を公開しない。
