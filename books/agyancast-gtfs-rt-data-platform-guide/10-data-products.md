---
title: "配信データ詳細: 画面でどう使うか"
---

## 1. 最新ステータス

例:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/public/data/latest.json`

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

## 2. 日次推移

例:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/public/data/daily_delay.json`

構造の要点:

- `hours`: 00〜23
- `series[モール名]`: 分単位遅延配列
- 欠損時は `null`

用途:

- グラフ表示
- 時間帯比較

## 3. Parquetマート

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

## 4. なぜJSONとParquetを両方持つか

- JSON: フロントがそのまま読める
- Parquet: 分析と再利用に向く

この二層化で、配信速度と分析性を両立します。

## 5. 生活シーン別データ

`transform.ts` / `daily_delay_mart` で次の派生JSONも出しています。

- `visitor_airport_latest.json`
- `visitor_airport_daily.json`
- `commute_semicon_latest.json`
- `commute_semicon_daily.json`

同じ基盤から、行動文脈に合わせたUIを作るためのデータです。
