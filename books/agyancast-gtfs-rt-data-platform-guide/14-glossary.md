---
title: "用語集"
---

## GTFS static

公共交通の予定情報（停留所、路線、時刻表）を表す仕様。通常はzip内のCSV系テキストで配布される。

## GTFS-RT

GTFS staticを補うリアルタイム仕様。protobufバイナリ（`.bin`）で遅延や車両位置を配信する。

## Protocol Buffers

スキーマ駆動のバイナリシリアライズ形式。今回の `*_trip_update.bin` の実体。

## FeedMessage

GTFS-RTのルートメッセージ。`header` と `entity[]` を持つ。

## TripUpdate

便の進捗・遅延を表すGTFS-RTメッセージ。今回の混雑判定の主入力。

## stop_time_update

TripUpdate内の停留所単位更新。`stopId` と `arrival/departure delay` を持つ。

## delay

予定との差分秒。今回のMVPでは負値を0に丸めて混雑代理指標に使う。

## Raw / Bronze / Silver

- Raw: 元バイナリ保管
- Bronze: 構造化イベントログ（JSONL）
- Silver: 配信・分析向け整形データ

## spots.csv

モールと停留所を結ぶマスタ。`(company, stop_id)` をキーに集計対象を定義する。

## median（中央値）

外れ値に強い代表値。モール単位遅延の集約に使用。

## nowcast

短時間先（例: 1時間先）の予測。将来フェーズで追加予定。
