---
title: "変換処理を読む: transform.tsの実装解説"
---

この章では、`transform.ts` の処理を上から追います。

対象ファイル:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/infra/lambda/transform.ts`

## 1. 会社ごとの最新TripUpdateを読む

処理の流れは次です。

1. 対象会社一覧を作る
2. 会社ごとに最新 `trip_update.bin` を取得
3. `FeedMessage.decode(buffer)` でprotobufをデコード

```ts
const feed = transit_realtime.FeedMessage.decode(buffer);
```

## 2. stop_time_updateから遅延を抽出

```ts
const delay = stu.arrival?.delay ?? stu.departure?.delay ?? null;
```

- `stopId` がないデータはスキップ
- `delay` がないデータもスキップ
- 数値化して0未満を切り上げ

## 3. 遅延のステータス化

```ts
if (delaySec < 300) return 'low';
if (delaySec < 600) return 'medium';
if (delaySec < 1800) return 'high';
return 'very_high';
```

しきい値は5分/10分/30分です。

## 4. モール単位への集約

- `spots.csv` を読み込む
- `(company, stop_id)` で突合
- 遅延配列を集めて中央値を取る

中央値採用の理由:

- 外れ値に強い
- 単純平均より「体感」に寄りやすい

## 5. 欠損補完（3時間）

各停留所の直近値を `last_stop_delay.json` に保持し、欠損時に使います。

- 補完キー: `(company, stop_id)`
- 有効期限: 3時間

これにより、1回の欠損で画面が全部 `unknown` になるのを避けています。

## 6. 生成される成果物

- `latest.json`
- `latest_detail.json`
- `visitor/airport_latest.json`
- `commute/semicon_latest.json`
- Bronzeイベントログ

1つのLambdaが「変換＋配信用JSON生成」まで担う構成です。

## 7. 改善ポイント（次フェーズ）

- 複数便の重みづけ（同一路線偏り対策）
- 時刻帯別の基準線（平日/休日差）
- 早着（負値）を扱う別指標の検討
