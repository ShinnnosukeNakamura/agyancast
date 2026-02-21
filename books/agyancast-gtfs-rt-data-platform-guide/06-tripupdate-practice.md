---
title: "BIN→JSON実装: どうパースして保存しているか"
---

この章は、質問の核心である「BINをどう扱っているか」を実装ベースで説明します。

## 1. ingest段階ではBINをそのまま保存

まず `ingest.ts` で12フィードを取得し、S3 Rawにそのまま置きます。

- 実装: `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/infra/lambda/ingest.ts`
- 保存先: `raw/company=.../dt=.../hour=.../minute=.../*.bin`

ここでは**パースしません**。生データ保持を優先します。

## 2. transform段階でBINをデコード

`transform.ts` で最新 `trip_update.bin` を読み、protobufをオブジェクト化します。

```ts
import { transit_realtime } from 'gtfs-realtime-bindings';

const buffer = await streamToBuffer(obj.Body as any);
const feed = transit_realtime.FeedMessage.decode(buffer);
```

これがBIN→構造化オブジェクト化の中核です。

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

重要点:

- `tripUpdate` がない entity は無視
- `stopId` と `delay` が揃わないレコードは無視
- 負値は0に丸める

## 4. JSONLへの落とし込み（Bronze）

抽出後、イベント単位に整形してJSONLで保存します。

実際のサンプル（抜粋）:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/samples/daily_delay/bronze/dt=2026-02-14/hour=09/part-2026-02-14-0900.jsonl`

```json
{"event_time":"2026-02-14T00:00:15.000Z","ingest_time":"2026-02-14T00:00:33.268Z","company":"kumabus","feed_type":"trip_update","trip_id":"2_388_20260109","route_id":"1_1313_2_20260109","stop_id":"100002_1","stop_sequence":1,"delay_sec":14}
```

この形にする理由:

- Athenaで扱いやすい
- 後続の集計が単純になる
- JSONとして目視デバッグしやすい

## 5. まとめ

今回の変換は次の2段構えです。

1. Raw: BINをそのまま保存（再処理保険）
2. Bronze: 必要項目だけJSONL化（実務処理用）

これにより、仕様理解が進んだ時に変換ロジックをやり直せます。
