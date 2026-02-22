---
title: "BIN→JSON実装: どうパースして保存しているか"
---

ここから先は実装パートです。
この章では「GTFS-RTのBIN（protobuf）を受け取って、後で使える形（JSONLのイベントログ）に落とす」ところを追います。

流れは2段です。

1. ingest: BINをそのままS3に置く（変換しない）
2. transform: BINをデコードして、必要なレコードだけJSONLにする

## 1. ingest段階ではBINをそのまま保存

まず `infra/lambda/ingest.ts` でGTFS-RTフィードを取得し、S3にそのまま置きます。
この段階では**パースしません**。

- 実装: `infra/lambda/ingest.ts`
- 保存先: `raw/company=.../dt=.../hour=.../minute=.../*.bin`

なぜパースしないのか:

- 最初の変換ロジックは高確率で変わる（仕様と実データの差分が出る）
- 後で「やっぱこのフィールドも欲しい」となる（MVPの次に必ず来る）
- “変換前の真実”が残っていないと、原因追跡と再処理が難しい

Rawに残しておけば、たとえば「しきい値を変えた」「欠損補完のルールを変えた」というときに、過去分をまとめて再生成できます。

## 2. transform段階でBINをデコード

つぎに `infra/lambda/transform.ts` で、各社の最新 `trip_update.bin` を読み、protobufをオブジェクト化します。

（注）いまの実装は `TripUpdate` を中心に処理しています。`VehiclePosition` / `Alert` はRaw保存のみで、変換にはまだ使っていません。

```ts
import { transit_realtime } from 'gtfs-realtime-bindings';

const buffer = await streamToBuffer(obj.Body as any);
const feed = transit_realtime.FeedMessage.decode(buffer);
```

これがBIN→構造化オブジェクト化の中核です。

`gtfs-realtime-bindings` は、GTFS-RTの `.proto` 定義に基づいて `FeedMessage` をデコードしてくれます。
この `feed` は、前章で説明した `FeedMessage`（`header` と `entity[]` を持つ）そのものです。

## 3. 取り出すロジック

```ts
feed.entity.forEach((entity: any) => {
  if (!entity.tripUpdate) return;
  const tripUpdate = entity.tripUpdate;

  tripUpdate.stopTimeUpdate?.forEach((stu: any) => {
    const stopId = stu.stopId;
    const delay = stu.arrival?.delay ?? stu.departure?.delay ?? null;
    if (!stopId || delay === null || delay === undefined) return;

    const delaySec = Math.max(0, Number(delay));
    // ...
  });
});
```

運用データとして扱うなら、ここは割り切ります。

- `tripUpdate` がない entity は無視
- `stopId` と `delay` が揃わないレコードは無視
- 負値は0に丸める

ここでやっていることは、次の翻訳です。

- protobufの階層（TripUpdate → stopTimeUpdate[]）から
- 「停留所の遅延」という観測レコードへ

この「1観測=1レコード」に落とすと、後続の集計・デバッグが一気に楽になります。

## 4. JSONLへの落とし込み（Bronze）

抽出後、イベント単位に整形してJSONLで保存します。

実際のサンプル（抜粋）:

- `samples/daily_delay/bronze/dt=2026-02-14/hour=09/part-2026-02-14-0900.jsonl`

```json
{"event_time":"2026-02-14T00:00:15.000Z","ingest_time":"2026-02-14T00:00:33.268Z","company":"kumabus","feed_type":"trip_update","trip_id":"2_388_20260109","route_id":"1_1313_2_20260109","stop_id":"100002_1","stop_sequence":1,"delay_sec":14}
```

### `event_time` と `ingest_time` を分ける理由

リアルタイム処理では「いつ観測されたデータか」と「いつ取得・保存したか」がズレます。
このズレを混ぜてしまうと、欠損や遅延が起きたときに分析が崩れます。

- `event_time`: GTFS-RTが指している“観測時刻”に近いもの（TripUpdate.timestamp を優先）
- `ingest_time`: `agyancast` が取りに行った時刻

Bronze（イベントログ）にこの2つを持つことで、後から「取得が遅れただけなのか」「観測自体が欠けているのか」を切り分けられます。

この形にする理由:

- Athenaで扱いやすい
- 後続の集計が単純になる
- JSONとして目視デバッグしやすい

## 5. まとめ

今回の変換は次の2段構えです（設計方針の再掲）。

1. Raw: BINをそのまま保存（再処理保険）
2. Bronze: 必要項目だけJSONL化（実務処理用）

これにより、仕様理解が進んだ時に変換ロジックをやり直せます。

次章では「MVPとして“どのデータ範囲で成立させるか”」を、`spots.csv` や集計設計（中央値、更新間隔）と一緒に詰めていきます。
