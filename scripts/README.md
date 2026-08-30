# Python解析スクリプト

最初に、親フォルダで隔離環境を作成します。

```bash
./scripts/setup_venv.sh
```

## 動画方式（手動打点、推奨）

```bash
.venv/bin/python scripts/video_speed.py rally.mov --fps 240
```

`j/l`で1フレーム、`J/L`で10フレーム移動し、SPACEで打点をマークします。`q`で終了すると、品質ゲートを通過した初速と閾値カウントを表示します。

## 音声方式（自動）

```bash
.venv/bin/python scripts/audio_speed.py rally.mov --mic-pos center
```

片側マイクでは、0番目の打音がどちら側かを明示します。

```bash
.venv/bin/python scripts/audio_speed.py rally.mov --mic-pos near --first-onset-side near
```

`near` は「最初の打音がマイク近側」、`far` は遠側です。近側→遠側の観測間隔から伝搬時間を引き、次の遠側→近側では足すため、補正符号を推測で固定しません。

## 校正と品質

計算正本は親フォルダの `measurement-spec.json` です。既定では物理モデルを使い、実測校正値は次のように明示します。

```bash
.venv/bin/python scripts/video_speed.py rally.mov --calibration-factor 1.03
```

校正値の根拠がない場合はオプションを付けません。既定の品質ゲートは補正後0.20〜0.90秒、初速110km/h以下です。必要なら `--min-dt`、`--max-dt`、`--max-initial-kmh` で変更できます。

## 依存診断・テスト

```bash
.venv/bin/python scripts/diagnose.py --strict
./tests/run_tests.sh
```

動画から音声を抽出する時だけ `ffmpeg` が必要です（`brew install ffmpeg`）。
