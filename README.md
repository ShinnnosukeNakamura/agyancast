# agyancast（あーぎゃん予報）

熊本市内のバス遅延から **街の混雑感** を推定し、
モール周辺の混雑を「天気予報のように」直感的に可視化するプロジェクトです。

---

## なぜ作ったか（背景 / 経緯）
- 熊本のバス遅延は日々の混雑感をよく反映している
- ただ遅延数値を出すだけでは直感的に伝わらない
- 「混雑指数」として **モールごとに見える化** することで、
  街の流れを読みやすくしたい

---

## できていること（現状）

### 1. リアルタイム遅延 → 混雑表示
- GTFS-RT TripUpdate の `delay` を利用
- モールに紐づく停留所の遅延中央値から混雑レベルを決定
- 5分未満: スイスイ / 10分未満: 普通 / 10分以上: 混雑 / 30分以上: 大混雑

### 2. DWH（Silverマート）
- Bronze(JSONL) → **Silver(Parquet)** で毎時集計
- 1日1ファイル（`dt=YYYY-MM-DD` パーティション）
- Athenaから即クエリ可能

### 3. フロント（地図 + 混雑表示）
- `web/` をそのままS3へデプロイ
- `latest.json` と `latest_detail.json` を参照して表示
- 地図下に **当日分の遅延推移グラフ** を表示

---

## システム概要

```
GTFS-RT (TripUpdate)
        |
        v
  S3 raw (bin)
        |
        v
  Bronze (JSONL)
        |
        | 10分おき
        v
  Silver latest (json)   --> front
  Silver mart (parquet)  --> Athena
```

---

## データ構成

### Raw
```
s3://<data-bucket>/raw/company=.../dt=YYYY-MM-DD/hour=HH/minute=MM/*.bin
```

### Bronze (JSONL)
```
s3://<data-bucket>/bronze/dt=YYYY-MM-DD/hour=HH/part-*.jsonl
```

### Silver (最新)
```
s3://<data-bucket>/silver/latest.json
s3://<data-bucket>/silver/latest_detail.json
```

### Silver (mart / parquet)
```
s3://<data-bucket>/silver/mart/daily_delay/
  dt=YYYY-MM-DD/
    part-YYYY-MM-DD.parquet
```

### Web (フロント用)
```
s3://<web-bucket>/data/latest.json
s3://<web-bucket>/data/latest_detail.json
s3://<web-bucket>/data/daily_delay.json
```

---

## モールと停留所の対応
- `spots.csv` に集約
- `(company, stop_id)` をキーにモールへ紐づけ

例:
```
mall_name,company,stop_id
ゆめタウン浜線,産交バス,XXXX
```

---

## 混雑判定ロジック（MVP）

### 遅延中央値で判定
- 0〜5分未満: スイスイ
- 5〜10分未満: 普通
- 10〜30分未満: 混雑
- 30分以上: 大混雑

### 欠損補完
- (company, stop_id) の直近値で補完
- 有効期限は **3時間**

---

## 日次グラフ（毎時の遅延推移）

### 生成内容
- `daily_delay.json`
- `hours`: 00〜23
- `series`: `{ mall_name: [delay_min_or_null...] }`

### 表示要件（フロント）
- 05:00〜24:00 で表示
- 24時はダミーとして null OK

---

## デプロイ/運用

### デプロイ先
- [http://agyancast-dev-web.s3-website-ap-northeast-1.amazonaws.com/](http://agyancast-dev-web.s3-website-ap-northeast-1.amazonaws.com/)

### CDK
- S3（data/web）
- Lambda（Ingest / Transform / DailyDelayMart）
- EventBridge（10分おき）

### 初回反映について
- デプロイ後、最初のEventBridge実行で当日分が反映

---

## Athenaで見る

SQLファイル:
```
athena/create_daily_delay_table.sql
```

実行スクリプト:
```
python3 athena/run_athena_sql.py --sample-date 2026-02-14
```

---

## 主要ファイル

agyancast_spec.md
frontend_handoff.md
infra/lib/agyancast-data-stack.ts
infra/lambda/transform.ts
infra/lambda_py/daily_delay_mart/handler.py

---

## 今後やるかもしれないこと
- 区間所要時間ベースの混雑指標
- イベント/天候と混雑の相関
- 予報（翌1時間・朝昼晩）

---

## 連絡・運用メモ
- データ更新: 10分おき
- JST前提で集計
- フロントは静的HTML/JS
