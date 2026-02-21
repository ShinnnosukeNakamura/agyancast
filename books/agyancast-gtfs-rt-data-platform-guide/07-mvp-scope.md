---
title: "今回仕様で使うデータ範囲を確定する"
---

この章では「どこまで使うか」を具体化します。

## 1. 入力データ（実運用）

GTFS-RTの取得対象は4事業者 × 3種（TripUpdate / VehiclePosition / Alert）です。

- 参照: `agyancast_spec.md`
- 取得実装: `infra/lambda/ingest.ts`

## 2. MVP判定に使う最小セット

混雑ステータス判定に使うのは次だけです。

- `company`
- `stop_id`
- `delay_sec`
- `event_time`

`trip_id` や `route_id` は補助（通勤・来訪派生）で利用します。

## 3. spots.csvによる対象絞り込み

`spots.csv` で、商業施設に関連する停留所だけを対象にします。

- ファイル: `spots.csv`
- 突合キー: `(company, stop_id)`

この絞り込みが、交通データを「買物混雑」へ翻訳するコアです。

## 4. 集計単位

- 停留所遅延 → モール単位
- 集約統計 → 中央値
- 更新間隔 → 10分

中央値にした理由:

- 一部便の極端値で判定が振れすぎない
- 平均より体感に近い挙動を得やすい

## 5. 出力（MVP）

- `latest.json`: モール別ステータス
- `latest_detail.json`: 遅延秒やサンプル数
- `daily_delay.json`: 日内推移

これで「今」と「今日の流れ」が見えるようになります。
