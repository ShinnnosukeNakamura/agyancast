---
title: "GTFS-RT詳細: BINの中身はどうなっているか"
---

この章では、`*.bin` を「なんとなくの黒箱」にせず、構造を押さえます。

## 1. GTFS-RT BINはProtocol Buffers

配信される `trip_update.bin` などは、Protocol Buffersでシリアライズされたバイナリです。

特徴:

- JSONやCSVより軽量
- 厳密なスキーマ（message定義）で送受信
- 受け側は同じスキーマでデコードする必要がある

## 2. 主要メッセージ階層

GTFS-RT Referenceで定義される基本構造は次です。

```text
FeedMessage
  - header: FeedHeader
  - entity[]: FeedEntity
      - trip_update: TripUpdate
      - vehicle: VehiclePosition
      - alert: Alert
```

今回のMVPは、主に `trip_update` を使っています。

## 3. TripUpdateで見るフィールド

今回の実装で使う主項目:

- `trip.tripId`
- `trip.routeId`
- `timestamp`
- `stopTimeUpdate[].stopId`
- `stopTimeUpdate[].stopSequence`
- `stopTimeUpdate[].arrival.delay`
- `stopTimeUpdate[].departure.delay`

理由:

- `stopId` と `delay` が混雑代理指標の最短経路
- `timestamp` が鮮度判定に必要
- `routeId` が空港/通勤系の判定に使える

## 4. delayの扱い（今回仕様）

仕様上は `delay` は正負を取り得ますが、このMVPでは次のルールに統一しています。

- `arrival.delay` 優先、無ければ `departure.delay`
- `Math.max(0, delay)` で負値を0扱い

この判断は「混雑度指標として単調に扱う」ためです。

## 5. 他メッセージの扱い

- `VehiclePosition`: 通勤区間の速度算出に一部利用
- `Alert`: 取得・保存はしているが、MVPの主判定には未使用

つまり、データ収集は広く、MVP判定は狭くしています。

## 6. 参考

- GTFS Realtime Reference: [https://gtfs.org/documentation/realtime/reference/](https://gtfs.org/documentation/realtime/reference/)
- Google GTFS Realtime Overview: [https://developers.google.com/transit/gtfs-realtime](https://developers.google.com/transit/gtfs-realtime)

次章で、実際にこのBINをどう処理してJSONLへ落としているかをコードと一緒に説明します。
