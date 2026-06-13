# フレスコボール球速検証スクリプト

詳細は親フォルダの `20260613_フレスコボール球速測定_技術検証レポート_v1.md` を参照。

## セットアップ
```bash
pip install numpy scipy opencv-python
brew install ffmpeg   # 音声解析で動画から音声を抜く場合に必要
```

## 撮影（iPhone）
1. カメラ → スロー、設定>カメラ>スローモーション撮影 = **1080p/240fps**
2. コート側面・中央付近に三脚固定。両選手が画角に入る位置
3. ファイルは **AirDrop等で「ファイルとして」転送**（再エンコード回避）

## 使い方

### 動画方式（推奨・手動マーク）
```bash
python video_speed.py rally.mov
# j/l でフレーム送り、打点の瞬間に SPACE、q で終了 → 球速一覧と閾値カウントが出る
```

### 音声方式（全自動）
```bash
python audio_speed.py rally.mov --mic-pos center
# 打音を自動検出してラリー全体の球速と 50/55/60... km/h 超え回数を集計
```

### 物理パラメータの確認・校正
```bash
python fresco_physics.py
```
公式球を実測したら `fresco_physics.py` 冒頭の `BALL_DIAMETER_M` / `BALL_MASS_KG` を更新。
スピードガン併走テスト後は `CALIBRATED_V0_FACTOR` に実測係数を直接セットする
（現状の理論値: 平均速×1.070 = 初速）。

## 最初の検証手順（Phase 0）
1. 公式球の質量・直径をキッチンスケール＋ノギスで実測 → `fresco_physics.py` 更新
2. 240fpsでラリーを1本撮影
3. `video_speed.py` と `audio_speed.py` の両方で解析し、値が±1〜2km/hで一致するか確認
4. 可能ならスピードガン or SpeedClockアプリ（$2.99）併走で絶対値を校正
