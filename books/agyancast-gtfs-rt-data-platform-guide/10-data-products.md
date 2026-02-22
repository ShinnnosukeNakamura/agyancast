---
title: "配信データ詳細: 画面でどう使うか"
---

パイプラインの最終成果物は、大きく「配信データ（JSON）」と「分析用データ（Parquet）」です。この章ではその2つを整理します。

重要なのは、これらが単なる“出力ファイル”ではなく、**画面や分析から見たときのAPI（データ契約）**だということです。

## 1. Web配信用データ（JSON）

Web配信用のJSONは、S3のWebバケットに `data/*.json` として配置されます。
フロントエンドは基本的にこの `data/` 配下だけを読めば動くようにしています。

### 1.1 最新ステータス: `data/latest.json`

例:

- `web/public/data/latest.json`（リポジトリ内のサンプル）

構造:

```json
{
  "updated_at": "2026-02-14T22:29:17+0900",
  "statuses": {
    "イオンモール熊本": "high"
  }
}
```

用途:

- 地図ピン色
- 一覧の状態表示

このJSONの設計意図はシンプルです。

- `statuses` は `{ "場所名": "ステータス" }` の辞書にする（フロントがそのまま引ける）
- ステータスは `low` / `medium` / `high` / `very_high` / `unknown`
- 表示文言（例: スイスイ/普通/混雑…）はUI側で自由にマッピングできるようにしておく

### 1.2 詳細（デバッグ用）: `data/latest_detail.json`

`latest.json` は軽量化のため「ステータスだけ」にしています。
一方で運用では「なぜそう判定したか」が重要なので、詳細版も出します。

構造（例）:

```json
{
  "updated_at": "2026-02-14T22:29:17+0900",
  "malls": {
    "イオンモール熊本": {
      "status": "high",
      "delay_sec": 720,
      "sample_count": 12,
      "filled_count": 3
    }
  }
}
```

- `delay_sec`: モール単位の代表遅延（中央値、秒）
- `sample_count`: その判定に使った停留所サンプル数
- `filled_count`: 欠損補完（直近値）で埋めた数

### 1.3 位置マスタ: `data/places.json`

例:

- `web/public/data/places.json`

`places.json` は、地図表示やレイアウトのための“場所マスタ”です。
`spots.csv` の停留所座標からモール座標を推定し、UIが扱いやすい形にしています。

構造の要点:

- `bounds`: 表示領域の緯度経度（ゆとりを持たせたバウンディングボックス）
- `places[]`: モールごとの `lat/lon` と、画面用の正規化座標 `x/y`（0〜100）

### 1.4 日次推移: `data/daily_delay.json`

例:

- `web/public/data/daily_delay.json`

構造の要点:

- `hours`: 00〜23
- `series[モール名]`: **遅延（分）**の配列（0〜23時に対応）
- 欠損時は `null`

用途:

- グラフ表示
- 時間帯比較

`daily_delay.json` は「画面がそのまま描ける形」を優先しています。
一方で、分析には向きません（配列が巨大になりやすく、クエリがしづらい）。

### 1.5 生活シーン別データ（来訪/通勤）

同じ基盤から、行動文脈に合わせた派生JSONも作っています。
（例）:

- `data/visitor_airport_latest.json` / `data/visitor_airport_daily.json`
- `data/commute_semicon_latest.json` / `data/commute_semicon_daily.json`

これは「データを取り直す」のではなく、Bronze（イベントログ）と同じ入力から“別の見え方”を作っているだけです。

## 2. 分析用データ（Parquet mart）

保存先:

- `silver/mart/daily_delay/dt=YYYY-MM-DD/part-YYYY-MM-DD.parquet`

主列:

- `hour`
- `mall_name`
- `median_delay_sec`
- `sample_count`
- `generated_at`

用途:

- Athena分析
- 将来予測の学習素材

Parquetは列指向・圧縮が効くので、スキャン量（=コスト）を抑えつつ分析しやすいのが利点です。

## 3. なぜJSONとParquetを両方持つか

- JSON: フロントがそのまま読める
- Parquet: 分析と再利用に向く

この二層化で、配信速度と分析性を両立します。

## 4. まとめ

- `latest.json` は“いま”のスナップショット（軽さ優先）
- `daily_delay.json` は“今日の流れ”の配信（描画しやすさ優先）
- Parquet mart は分析・再利用のための土台（クエリしやすさ優先）

次章では、これらを継続運用するために「コストと監視をどう考えるか」を整理します。
