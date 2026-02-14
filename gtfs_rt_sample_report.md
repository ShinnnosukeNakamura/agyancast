# GTFS-RT サンプル取得結果（検証メモ）

取得日時（JST）: 2026-02-12 23:43:36
保存先: /Users/nakamurashinnosuke/Documents/GitHub/agyancast/samples/gtfs_rt/20260212_234336

## 1. サンプル取得の範囲

- 産交バス（TripUpdate / VehiclePosition / ServiceAlert）
- 熊本電鉄バス（TripUpdate / VehiclePosition / ServiceAlert）
- 熊本バス（TripUpdate / VehiclePosition / ServiceAlert）
- 熊本都市バス（TripUpdate / VehiclePosition / ServiceAlert）

全 12 ファイルを取得・パース済み。

## 2. TripUpdates の内容サマリ

| 会社 | entity数 | TripUpdate数 | stop_time_update数 | stop_idあり | delayあり | trip_update.timestampあり |
|---|---:|---:|---:|---:|---:|---:|
| dentetsu | 3 | 3 | 128 | 128 | 128 | 3 |
| kumabus | 1 | 1 | 24 | 24 | 24 | 1 |
| sankobus | 5 | 5 | 247 | 247 | 247 | 5 |
| toshibus | 1 | 1 | 31 | 31 | 31 | 1 |

結果: 4社すべてで `stop_id` と `delay` が取れており、**モール停留所の遅延集計に必要な要素が揃っている**。

## 3. VehiclePositions の内容サマリ

| 会社 | entity数 | tripあり | route_idあり | vehicle_idあり | positionあり | speedあり | timestampあり |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentetsu | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| kumabus | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| sankobus | 5 | 5 | 5 | 5 | 5 | 3 | 5 |
| toshibus | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

結果: `position` と `timestamp` が全社で存在。`speed` は一部のみ。

## 4. ServiceAlerts の内容サマリ

全社で `active_period` / `informed_entity` / `cause` / `effect` / `header` / `description` が入っているサンプルを確認。

## 5. spots.csv との紐づけ可能性

| 会社 | stop_time_update（stop_idあり） | spots.csvと一致 | 一致stop_idユニーク数 |
|---|---:|---:|---:|
| dentetsu | 128 | 9 | 3 |
| kumabus | 24 | 2 | 2 |
| sankobus | 247 | 14 | 10 |
| toshibus | 31 | 3 | 3 |

結果: **全社で spots.csv の stop_id と一致する stop_time_update が存在**。
→ モールごとの直近混雑を算出可能。

## 6. Bronze テーブル化の可否

結論: **Bronze（イベントログ）化は可能**。

理由:
- TripUpdates には stop_id / delay / timestamp が存在
- VehiclePositions には position / timestamp が存在
- Alerts には cause/effect/期間/本文が存在
- entity数が少なく、重複許容のイベントログ構造に適合

想定 Bronze スキーマ（例）:
- event_time（TripUpdate/VehiclePosition の timestamp、なければ FeedHeader）
- ingest_time
- operator_id
- feed_type（trip_update / vpos / alert）
- entity_id
- trip_id / route_id / vehicle_id
- stop_id / stop_sequence
- delay_sec（arrival/departure）
- latitude / longitude / speed
- alert_cause / alert_effect / alert_text
- payload_version

## 7. 判断

- **spots.csv を用いたモール紐づけは成立**
- **Bronze 生成に必要なスキーマは揃っている**
- したがって、CDK 化に向けた設計整理へ進めてよい
