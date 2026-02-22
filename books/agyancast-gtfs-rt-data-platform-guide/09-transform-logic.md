---
title: "transform.ts徹底解説: 判定ロジックと補完"
---

transformの中身は `infra/lambda/transform.ts` に詰まっています。ここを「なぜそう書いているのか」も含めて解説します。

対象コード:

- `infra/lambda/transform.ts`

このLambdaの責務は、大きく4つです。

1. Raw（BIN）をデコードして、必要項目を抜き出す
2. Bronze（JSONL）にイベントログとして蓄積する
3. “いまの状態”のスナップショット（latest系JSON）を作る
4. 欠損に備えて、直近値の状態（state）を更新する

## 1. 入力（この処理が読むもの）

- `master/spots.csv`（S3に配置されるマスタ）
- `raw/company=.../dt=.../hour=.../minute=.../*trip_update.bin`（S3 Raw）

会社一覧（`companies`）は、Raw側を走査するのではなく `spots.csv` から作っています。
これは「UIに必要な対象（モール周辺停留所）を中心に処理する」ためです。

## 2. 最新TripUpdateを会社ごとに選ぶ

`listLatestTripUpdate()` で、S3 Rawから各社の最新 `trip_update.bin` を選びます。

やっていることは単純で、当日と前日のフォルダを候補にして、`dt/hour/minute` が一番新しいキーを選びます。

前日も候補に入れるのは、日付またぎや取得遅延があると「当日フォルダにまだデータがない」ことがあるためです。

## 3. イベント時刻の優先順位

`event_time` は次の順で決定しています。

1. `tripUpdate.timestamp`
2. `feed.header.timestamp`
3. ingest時刻

これで「取得遅延」と「観測時刻」を分離できます。

実装上は、次のように“秒→ミリ秒”に変換して `eventTimeMs` を作っています。

- `TripUpdate.timestamp` はエポック秒（epoch seconds）で来る
- `FeedHeader.timestamp` も同様
- なので `* 1000` して `Date` に落とす

## 4. 遅延抽出（stop_id と delay を抜く）

```ts
const delay = stu.arrival?.delay ?? stu.departure?.delay ?? null;
const delaySec = Math.max(0, Number(delay));
```

この値を `(company, stop_id)` で `delayByStop` に保持します。

ここでの判断:

- `arrival.delay` が取れなければ `departure.delay` を使う
- “早着”（負の遅延）は混雑代理指標として扱いにくいので0に丸める

この判断が合わなければ、Raw（BIN）から再処理できるようにしてあります。

## 5. Bronze（イベントログ）を書き出す

抽出した観測は、BronzeにJSONLで書き出します。
1観測（1停留所の遅延）を1行にすることで、後段の集計が単純になります。

- 保存先: `bronze/dt=YYYY-MM-DD/hour=HH/part-YYYY-MM-DD-HHmm.jsonl`
代表的な列:

- `event_time`, `ingest_time`
- `company`, `feed_type`
- `trip_id`, `route_id`
- `stop_id`, `stop_sequence`
- `delay_sec`

## 6. モール単位集約（停留所 → モール）

`spots.csv` を読んで、モールごとに対象停留所を引き、遅延配列を作ります。

- 統計量: `median(delays)`
ステータス変換:

- `<300`: low
- `<600`: medium
- `<1800`: high
- `>=1800`: very_high

この集約は「停留所の世界」を「場所（モール）の世界」に翻訳する処理です。

## 7. 欠損補完（直近値で埋める。ただし期限つき）

`last_stop_delay.json` に前回観測値を保持し、欠損時に利用します。

- 有効期限: `FILL_MAX_AGE_MINUTES`（既定180分）
- 期限超過値は補完に使わない

これで一時欠損による `unknown` 乱発を抑えます。

注意点:

- 補完は“画面体験”のための工夫です
- Bronze（イベントログ）は補完せず、観測できたものだけを積むのが基本です

## 8. 派生データ（同じ入力から別の体験へ）

同じ変換処理内で次も作成しています。

- 来訪（空港）向け最新遅延
- 通勤（セミコン周辺）向け遅延/区間速度

つまり「1つの入力から複数体験に分岐」する実装です。

派生データを増やしても、RawとBronzeが整っていれば“作り直し”ができます。
これが土台を先に作る価値です。

## 9. どこを直すと挙動が変わるか

- しきい値（low/medium/high/very_high）を変えたい: `statusFromDelay`
- 欠損補完の期限を変えたい: `FILL_MAX_AGE_MINUTES`
- 観測レコード（Bronze）に列を足したい: `bronzeRows.push(...)`
- 対象モール/停留所を変えたい: `spots.csv`

次章では、これらの出力（latest.json / daily_delay.json / Parquet mart）が、画面と分析でどう使われるかを整理します。
