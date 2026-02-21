---
title: "TripUpdate実践: delayはどう読むべきか"
---

この章は、MVPの心臓部です。

## 1. まず何を見るか

`agyancast` の初期実装は、TripUpdateの次を使っています。

- `stop_time_update[].stop_id`
- `stop_time_update[].arrival.delay`
- （欠損時）`stop_time_update[].departure.delay`

実コード（抜粋元）:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/infra/lambda/transform.ts`

```ts
const delay =
  stu.arrival?.delay ??
  stu.departure?.delay ??
  null;
```

## 2. delayの意味

GTFS-RT仕様上、`delay` は秒単位の予定差です。

- 正: 遅れ
- 負: 早着（理論上あり得る）
- 0: 定刻

ただしこのMVPでは、混雑指標として扱う都合で負値を0に丸めています。

```ts
const delaySec = Math.max(0, Number(delay));
```

この設計の意図:

- 「空いていて早着」を混雑の低さと同義にしない
- 混雑指標を遅延寄りの単調指標にする

## 3. stop_idでどこを見ているか

`stop_id` は「どの停留所の遅延か」を示します。

本プロジェクトでは、全停留所ではなく `spots.csv` に登録した対象停留所だけを集計しています。

- キー: `(company, stop_id)`
- 目的: モール単位の混雑を計算する

## 4. サンプル検証結果（2026-02-12）

`/Users/nakamurashinnosuke/Documents/GitHub/agyancast/samples/gtfs_rt/20260212_234336/summary.json` では、次を確認済みです。

- 全4社で `stop_id` と `delay` を取得できた
- `spots.csv` と一致する `stop_id` が全社で存在した

これは「MVPの入力要件が満たされた」ことを意味します。

## 5. timestampは何に使うか

同じ遅延でも、古い値だと現況を誤認します。

そのため実装では、次の優先順でイベント時刻を決めています。

1. `tripUpdate.timestamp`
2. `feed.header.timestamp`
3. 取得時刻（ingest時刻）

時刻を持つことで、後段で「鮮度判定」や「直近補完」が可能になります。

## 6. 初学者がつまずきやすい点

- `trip_id` が取れても `stop_time_update` が空のケースがある
- `arrival.delay` だけ/`departure.delay` だけ存在するケースがある
- すべての停留所で毎回データが出るとは限らない

設計上は「欠損を前提にする」ことが重要です。
