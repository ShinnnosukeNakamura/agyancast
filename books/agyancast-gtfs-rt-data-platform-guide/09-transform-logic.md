---
title: "transform.ts徹底解説: 判定ロジックと補完"
---

対象コード:

- `infra/lambda/transform.ts`

## 1. 最新TripUpdateを会社ごとに選ぶ

`listLatestTripUpdate()` で、S3 Rawから各社の最新 `trip_update.bin` を選びます。

ポイント:

- 当日 + 前日を候補に探索
- `dt/hour/minute` をキーとして最新を選択

## 2. イベント時刻の優先順位

`event_time` は次の順で決定しています。

1. `tripUpdate.timestamp`
2. `feed.header.timestamp`
3. ingest時刻

これで「取得遅延」と「観測時刻」を分離できます。

## 3. 遅延抽出

```ts
const delay = stu.arrival?.delay ?? stu.departure?.delay ?? null;
const delaySec = Math.max(0, Number(delay));
```

この値を `(company, stop_id)` で `delayByStop` に保持します。

## 4. モール単位集約

`spots.csv` を読んで、モールごとに対象停留所を引き、遅延配列を作ります。

- 統計量: `median(delays)`
- ステータス変換:
  - `<300`: low
  - `<600`: medium
  - `<1800`: high
  - `>=1800`: very_high

## 5. 欠損補完

`last_stop_delay.json` に前回観測値を保持し、欠損時に利用します。

- 有効期限: `FILL_MAX_AGE_MINUTES`（既定180分）
- 期限超過値は補完に使わない

これで一時欠損による `unknown` 乱発を抑えます。

## 6. 派生データ

同じ変換処理内で次も作成しています。

- 来訪（空港）向け最新遅延
- 通勤（セミコン周辺）向け遅延/区間速度

つまり「1つの入力から複数体験に分岐」する実装です。

## 7. Bronze書き出し

最後に `bronze/dt=.../hour=.../part-....jsonl` を出力します。

これが後段のdaily mart集計入力になります。
