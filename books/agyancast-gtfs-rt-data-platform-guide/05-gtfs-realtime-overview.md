---
title: "GTFS-RT詳細: BINの中身はどうなっているか"
---

この章では、`*.bin` を「なんとなくの黒箱」にせず、**中身の階層（どこに delay がいるのか）**を押さえます。

ここを理解すると、次章の「BIN→JSONL（イベントログ）」がスムーズになります。

## 1. GTFS-RT BINはProtocol Buffers

配信される `trip_update.bin` などは、Protocol Buffersでシリアライズされたバイナリです。

Protocol Buffers（protobuf）は、ざっくり言うと「**設計図（スキーマ）つきのバイナリJSON**」のようなものです。

特徴:

- JSONやCSVより軽量
- 厳密なスキーマ（message定義）で送受信
- 受け側は同じスキーマでデコードする必要がある

GTFS-RTでは、この“設計図”が `gtfs-realtime.proto`（仕様で公開されている `.proto`）として定義されています。
ライブラリはそれを内蔵していることが多く、`agyancast` でも `gtfs-realtime-bindings` を使ってデコードしています（次章）。

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

実装するときに効くのは、次の前提です。

- 1つのBIN（FeedMessage）の中に、複数の `entity` が入っている
- `entity` の中身は `trip_update` / `vehicle` / `alert` のどれか（または複数）になり得る
- つまり「まず `feed.entity` を回して、欲しい種類だけ拾う」という実装になる

今回のMVPは、主に `trip_update`（TripUpdate）を使っています。

### FeedHeader.timestamp とは

`FeedHeader.timestamp` は、そのフィードが生成された時刻です。
ただし、事業者によっては粒度や意味が揺れることがあるので、
`agyancast` では次のように“優先順位”を決めて観測時刻（event_time）を作っています（後章で詳述）。

1. `TripUpdate.timestamp`
2. `FeedHeader.timestamp`
3. 取得時刻（ingest_time）

## 3. TripUpdateで見るフィールド

TripUpdateは「便（trip）が、いまどの停留所でどれくらいズレているか」を持つ更新データです。

今回の実装で使う主項目（MVPの最小セット）:

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
- `routeId` が生活シーン別ビュー（来訪/通勤など）の判定に使える

### stopTimeUpdate の見方（delayはここにいる）

遅延（delay）は、TripUpdate直下ではなく `stopTimeUpdate[]` の中に入っています。
つまり実装としては次の形になります。

```text
feed.entity[]
  -> entity.trip_update
    -> trip_update.stop_time_update[]
      -> stop_id と delay を読む
```

## 4. delayの扱い（今回仕様）

仕様上は `delay` は正負を取り得ますが、このMVPでは次のルールに統一しています。

- `arrival.delay` 優先、無ければ `departure.delay`
- `Math.max(0, delay)` で負値を0扱い

この判断は「混雑の気配」を作るために、指標を単調（遅れが大きいほど混雑っぽい）に扱いたいからです。

もちろん“早着”の情報が無価値という意味ではありません。
将来のフェーズで必要になったときに解釈を変えられるよう、Raw（変換前のBIN）を残しています。

## 5. 他メッセージの扱い

`agyancast` は `TripUpdate` 以外のフィードも取得してS3 Rawに保存していますが、
**現状の変換処理（transform）では使っていません**。

- `VehiclePosition`: 車両位置から区間速度を推定するなどに使える（将来の拡張候補）
- `Alert`: 運休・迂回などの説明情報として価値がある（将来の拡張候補）

つまり、データ収集は広く、MVP判定は狭くしています。

## 6. まとめ: “BINの黒箱”を開けると実装は単純になる

BINの中身を「FeedMessage → entity[] → TripUpdate → stopTimeUpdate[]」という階層として捉えると、
次章でやることはシンプルです。

- protobufをデコードして `FeedMessage` を得る
- `TripUpdate` を持つ `entity` だけ拾う
- `stop_id` と `delay` を抜き出してイベントログ（JSONL）にする

## 7. 参考

- [GTFS Realtime Reference](https://gtfs.org/documentation/realtime/reference/)
- [Google GTFS Realtime Overview](https://developers.google.com/transit/gtfs-realtime)

次章で、実際にこのBINをどう処理してJSONLへ落としているかをコードと一緒に説明します。
