---
title: "用語集: GTFS/GTFS-RTの最低限"
---

## GTFS

公共交通の静的データ仕様。CSVベースで、停留所・路線・時刻表を扱う。

## GTFS-RT

GTFSのリアルタイム拡張。protobufベースで、遅延・車両位置・運行障害を扱う。

## trip_id

1つの運行便を識別するID。`trips.txt` と GTFS-RT の双方で重要。

## stop_id

停留所識別子。`stops.txt` に定義され、`stop_times.txt` や GTFS-RT から参照される。

## TripUpdate

GTFS-RTのメッセージ種別。便の遅延や停留所ごとの予測情報を持つ。

## VehiclePosition

GTFS-RTのメッセージ種別。車両の現在位置、速度、向きなどを持つ。

## Alert

GTFS-RTのメッセージ種別。運休、遅延、障害などの運行情報を持つ。

## Raw / Bronze / Silver

- Raw: 元データ保管
- Bronze: 構造化イベントログ
- Silver: 配信・分析向けに整形した層

## median（中央値）

値を並べたときの中央。外れ値に強く、混雑評価の基礎に使いやすい。

## nowcast

短時間先の予測。ここでは「1時間先程度の混雑見込み」を指す。

## 参考リンク

- GTFS Schedule Reference: [https://gtfs.org/documentation/schedule/reference/](https://gtfs.org/documentation/schedule/reference/)
- GTFS Realtime Reference: [https://gtfs.org/documentation/realtime/reference/](https://gtfs.org/documentation/realtime/reference/)
- GTFS Realtime Overview (Google): [https://developers.google.com/transit/gtfs-realtime](https://developers.google.com/transit/gtfs-realtime)
