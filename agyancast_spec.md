# agyancast - 熊本「あーぎゃん予報」システム仕様書

## 1. プロジェクト概要

agyancast は、熊本市内のGTFSおよびGTFS-RTデータを活用し、
バス遅延情報から都市の混雑傾向を推定し、「あーぎゃん予報」として可視化するプロジェクトである。

目的は、単なる遅延表示ではなく、
都市の流れを天気予報のように直感的に提示することである。

------------------------------------------------------------------------

## 2. データソース

### 2.1 公開元

Bus-Vision 熊本オープンデータ
https://km.bus-vision.jp/kumamoto/view/opendataKuma.html

------------------------------------------------------------------------

## 3. GTFS-RT エンドポイント一覧

以下の順番で取得する（表示/リンク順も同じ）。

1. 産交バス（TripUpdate）
2. 産交バス（VehiclePosition）
3. 産交バス（ServiceAlert）
4. 熊本電鉄バス（TripUpdate）
5. 熊本電鉄バス（VehiclePosition）
6. 熊本電鉄バス（ServiceAlert）
7. 熊本バス（TripUpdate）
8. 熊本バス（VehiclePosition）
9. 熊本バス（ServiceAlert）
10. 熊本都市バス（TripUpdate）
11. 熊本都市バス（VehiclePosition）
12. 熊本都市バス（ServiceAlert）

### 熊本バス

-   Vehicle Positions\
    https://km.bus-vision.jp/realtime/kumabus_vpos_update.bin
-   Trip Updates\
    https://km.bus-vision.jp/realtime/kumabus_trip_update.bin
-   Alerts\
    https://km.bus-vision.jp/realtime/kumabus_alrt_update.bin

### 熊本都市バス

-   Vehicle Positions\
    https://km.bus-vision.jp/realtime/toshibus_vpos_update.bin
-   Trip Updates\
    https://km.bus-vision.jp/realtime/toshibus_trip_update.bin
-   Alerts\
    https://km.bus-vision.jp/realtime/toshibus_alrt_update.bin

### 熊本電鉄バス

-   Vehicle Positions\
    https://km.bus-vision.jp/realtime/dentetsu_vpos_update.bin
-   Trip Updates\
    https://km.bus-vision.jp/realtime/dentetsu_trip_update.bin
-   Alerts\
    https://km.bus-vision.jp/realtime/dentetsu_alrt_update.bin

### 産交バス（九州産交）

-   Vehicle Positions\
    https://km.bus-vision.jp/realtime/sankobus_vpos_update.bin
-   Trip Updates\
    https://km.bus-vision.jp/realtime/sankobus_trip_update.bin
-   Alerts\
    https://km.bus-vision.jp/realtime/sankobus_alrt_update.bin

※ 更新頻度：約15秒

------------------------------------------------------------------------

## 4. 静的GTFS

各社の静的GTFSも同プラットフォームより取得可能。
停留所情報、時刻表、route/trip情報を含む。

例： https://km.bus-vision.jp/gtfs/kumabus/gtfsFeed

------------------------------------------------------------------------

## 4.1 モール対象停留所リスト

モール対象停留所は `spots.csv` に集約する。
`spots.csv` は各モールの停留所を各社ごとに列挙した一覧であり、
GTFS-RT の `stop_time_update` に含まれる `stop_id` と結合して利用する。

- ファイル: /Users/nakamurashinnosuke/Documents/GitHub/agyancast/spots.csv
- カラム: mall_name, company, stop_id, stop_name, stop_lat, stop_lon など
- 主キー: (company, stop_id) を想定（将来の差異に備えて安全側）
- 形式: CSV（ヘッダ付き / UTF-8）
- 当面はリポジトリ内の CSV を参照し、運用時は S3 を参照する
- S3 配置場所（決定）: s3://<bucket>/master/spots.csv
- CDK で配置・バージョン管理する

------------------------------------------------------------------------

## 5. システムアーキテクチャ案

### 5.1 データ取得

-   ポーリング間隔：10分（JST 05:00〜23:50 のみ稼働・00:00〜05:00は停止）
-   対象：TripUpdates, VehiclePositions
-   取得形式：Protocol Buffers (GTFS-RT)
-   取得時刻/記録時刻は JST で扱う

### 5.1.1 データ更新

-   Bronze / Silver の更新間隔：10分（JST 05:00〜23:50 のみ稼働・00:00〜05:00は停止）

### 5.2 データ保存戦略

#### 生データ保存

-   保存先：Amazon S3
-   保存形式：
    s3://agyancast-raw/yyyy/mm/dd/hh/mm/{company}\_tripupdate.bin

目的： - 履歴保持 - 再処理可能な構造

#### 正規化テーブル（例：RDS / DynamoDB）

actual_stop_pass_log

-   company
-   trip_id
-   stop_id
-   stop_sequence
-   scheduled_arrival_time
-   actual_arrival_time
-   delay_seconds
-   recorded_at

------------------------------------------------------------------------

## 6. 混雑指数算出ロジック

### 6.1 区間所要時間計算

scheduled_duration = stop_times(n+1).arrival_time -
stop_times(n).arrival_time

actual_duration = actual_arrival(n+1) - actual_arrival(n)

delay_ratio = actual_duration / scheduled_duration

### 6.2 混雑指数

混雑指数は 30分集計の遅延秒数（中央値）から単純変換する。

#### 計算式（MVP）

```
window = 30分
median_delay_sec = median(max(0, delay_sec))
congestion_index = 1.0 + min(median_delay_sec, 1800) / 3600
```

- 遅延0秒 -> 1.0
- 遅延5分(300秒) -> 約1.08
- 遅延10分(600秒) -> 約1.17
- 遅延30分(1800秒) -> 1.5（上限）

#### 表示区分（目安）

表示ラベルは 30分集計の中央値遅延（median_delay_sec）で分類する。
（暫定基準）

- 0〜300秒（5分未満）: スイスイ（定刻）
- 300〜600秒（10分未満）: 普通
- 600〜1800秒（30分未満）: 混雑
- 1800秒以上（30分以上）: 大混雑

------------------------------------------------------------------------

## 6.3 MVPの遅延算出方針（初期実装）

初期段階は「モール停留所の遅延（delay）」を直接使う。

- GTFS-RT TripUpdates の `stop_time_update` から `arrival.delay` /
  `departure.delay` を取得
- 対象停留所は `spots.csv` の (company, stop_id) に一致するもの
- 欠損時（対象停留所の delay がない場合）は **直近の最新値で補完** する
  - 補完キー: (company, stop_id)
  - 補完の有効期限: **直近3時間**
  - 3時間以内に最新値がない場合は「データ不足」扱い
- モール単位の集計は 30分で中央値を算出し、混雑指数に変換

将来的には 6.1 の区間所要時間ベースに段階移行する。

------------------------------------------------------------------------

## 7. 予測モデル用集計テーブル

※ 予報は将来対応とし、現フェーズでは実装しない。

section_stats_hourly

-   company
-   route_id
-   from_stop_id
-   to_stop_id
-   day_of_week
-   hour
-   avg_delay_ratio
-   sample_count

用途： - 時間帯別混雑予測 - 週間予報生成

------------------------------------------------------------------------

## 7.1 予報の粒度と更新

※ 将来対応（現フェーズでは未実装）

- 予報対象: 次の1時間（例: 18:00-19:00）
- 予報開始: 現在時刻 + 1時間
- 更新間隔: 15分〜60分
- 表示: 混雑指数（1.0 / 1.2 / 1.5 など）

------------------------------------------------------------------------

## 8. 表示コンセプト

-   天気予報風UI
-   ランドマーク別混雑指数表示
    -   イオンモール熊本
    -   ゆめタウン浜線
    -   ゆめタウン光の森
    -   鶴屋
    -   アミュプラザ熊本
    -   サクラマチ熊本

### 8.1 フロントエンド配信

- フロントは `web/` を S3 に配置して配信する
- `data/latest.json` は Silver の最新スナップショットから生成し、フロントが参照する
- `data/latest_detail.json` は遅延秒などの補足情報を含める
- `data/places.json` は `spots.csv` から生成する（`scripts/build_assets.py` を実行）

表示例： 「本日17-19時 市中心部 あーぎゃん度：強」

------------------------------------------------------------------------

## 8.1 フロントエンド実装仕様（現状）

### 8.1.1 方針

- 静的 HTML/CSS/JS で構成（フレームワーク不使用）
- `web/` をそのままホスティング（S3 + CloudFront または Amplify Hosting）
- 画面更新は `latest.json` の差し替えのみ（HTML再生成は不要）

### 8.1.2 ディレクトリと成果物

- フロントソース: `web/`
  - `web/index.html`
  - `web/styles.css`
  - `web/app.js`
  - `web/assets/kumamoto_map.svg`
  - `web/assets/status-*.svg`
- `web/data/places.json`
- `web/data/latest.json`
- `web/data/latest_detail.json`

### 8.1.3 データ契約

`web/data/places.json`

- `generated_at`: 生成時刻
- `bounds`: 地図の表示範囲
- `places`: 配列
  - `id`, `name`, `lat`, `lon`, `x`, `y`
  - `x`, `y` は SVG 画面上の割合（0-100）

`web/data/latest.json`

- `updated_at`: 更新時刻（画面表示に利用）
- `statuses`: `{ place_id: "low" | "medium" | "high" | "very_high" | "unknown" }`

`web/data/latest_detail.json`

- `updated_at`: 更新時刻
- `malls`: `{ mall_name: { status, delay_sec, sample_count, filled_count } }`

### 8.1.4 表示ロジック（app.js）

- `places.json` と `latest.json` をクライアントで `fetch`
- 吹き出しは左右に固定配置し、線で地点をポインティング
- 表示名は内部的に上書き（例: `アミュプラザくまもと` → `アミュプラザ熊本`）
- ステータス表示:
  - `low`: 空いてます（緑）
  - `medium`: やや混雑（黄）
  - `high`: 混雑（赤）
  - `very_high`: 大混雑（濃赤）
  - `unknown`: データ不足（灰）
- 遅延の参考値（分）を併記する

### 8.1.5 地図生成（SVG）

- 生成スクリプト: `scripts/build_assets.py`
- 生成物: `web/assets/kumamoto_map.svg`, `web/data/places.json`
- OSM / Overpass から抽出（主要要素のみ）
  - 道路: motorway / trunk / primary のみ
  - 河川: 白川のみ
  - 鉄道・公園を控えめに表示
  - 熊本城ラベルは 1 件に集約
- 紙の質感を持つパンフレット風の配色

### 8.1.6 運用更新

- `latest.json` / `latest_detail.json` は 10分ごとに更新（JST 05:00〜23:50 のみ・00:00〜05:00は停止 / Lambda + EventBridge）
- `kumamoto_map.svg` / `places.json` は地図やモール設定を変更したときのみ再生成
- CloudFront のキャッシュは `latest.json` の TTL を短く、その他は長めにする

### 8.1.7 現行の表示対象

- 現行画面は `ゆめタウン光の森` を除外（地図範囲肥大化の回避）
- 代替として `ゆめタウン浜線` を追加

------------------------------------------------------------------------

## 8.2 日次の混雑推移（1日分 / 毎時）

目的: その日のモール別の遅延推移を時系列で可視化する。
当面はローカルで検証し、要件が満たせたら Silver に専用マートを作る。

### 8.2.1 データソース

- S3 Bronze (JSONL)
  - `s3://<data-bucket>/bronze/dt=YYYY-MM-DD/hour=HH/part-*.jsonl`
- S3 Master
  - `s3://<data-bucket>/master/spots.csv`

### 8.2.2 集計ロジック

- 対象日 (JST) の Bronze を読み込み
- `spots.csv` で `company + stop_id` をモールに紐づけ
- 1時間単位で **遅延秒の中央値** を集計（Bronzeの`event_time`を時間単位で丸める）
- その日の「データがあるぶんだけ」ポイントを描画
- 欠損は `null` として扱い、線はギャップを許容

### 8.2.3 ローカル可視化（現行）

スクリプトで S3 からデータを取得してローカルで描画する。

- 実行例:
  - `python3 scripts/plot_daily_delay.py --date 2026-02-14`
- 出力:
  - `samples/daily_delay/daily_delay_YYYY-MM-DD.csv`
  - `samples/daily_delay/daily_delay_YYYY-MM-DD.json`
  - `samples/daily_delay/daily_delay_YYYY-MM-DD.html`

### 8.2.4 Silver マート（parquet / Hive）

日次の1ファイル方式で維持する（小ファイルを避け、圧縮効率を優先）。

- 例: `s3://<data-bucket>/silver/mart/daily_delay/dt=YYYY-MM-DD/part-YYYY-MM-DD.parquet`
- 例テーブル:
  - `dt` (string, partition)
  - `hour` (string)
  - `mall_name` (string)
  - `median_delay_sec` (int)
  - `sample_count` (int)
  - `generated_at` (timestamp, JST)

### 8.2.5 フロント表示（将来）

- 地図の下にモール別の遅延推移を折れ線グラフで表示
- 1日分のみ表示（当日分）
- データソースは Silver マートを JSON に変換した `web/data/daily_delay.json`

### 8.2.6 Silver マート更新設計（本番想定）

目的: 「毎時の遅延中央値」を DWH (Parquet / Hive) で維持し、Athenaで即参照できるようにする。

- 集計対象: 当日 (JST) の Bronze
- 集計粒度: 1時間
- 指標: 遅延秒の中央値 (モールに紐づく全停留所・全社の合算)
- 更新方式: 10分おきに **当日分の該当時刻バケットのみ** 再作成（JST 05:00〜23:50 のみ・00:00〜05:00は停止）

#### 推奨パイプライン

1. `daily_delay_mart` Lambda（Python推奨）
   - Bronze(JSONL) + `spots.csv` を読み込み
   - 当日分の **hour バケット**を集計
   - `dt=YYYY-MM-DD/hour=HH/` 配下の既存ファイルを削除してから再書き込み
2. 同じLambdaで `web/data/daily_delay.json` を生成し Web バケットに配置

#### Athena / Hive テーブル（例）

```
CREATE EXTERNAL TABLE IF NOT EXISTS agyancast_daily_delay (
  hour string,
  mall_name string,
  median_delay_sec int,
  sample_count int,
  generated_at timestamp
)
PARTITIONED BY (dt string)
STORED AS PARQUET
LOCATION 's3://<data-bucket>/silver/mart/daily_delay/';
```

※ パーティションは `dt/hour` を **Hive形式**で配置し、Athenaから即参照可能とする。

#### フロント用JSON（例）

`web/data/daily_delay.json`

- `date`: 対象日 (YYYY-MM-DD)
- `timezone`: `Asia/Tokyo`
- `hours`: `["00","01",...,"23"]`
- `series`: `{ mall_name: [delay_min_or_null...] }`

このJSONはAthenaから作るより、Lambdaが直接生成する方が遅延とコストが小さい。

## 9. 今後の拡張

-   天候データ統合
-   イベントカレンダー連携
-   混雑ヒートマップ
-   API公開

------------------------------------------------------------------------

## 10. リポジトリ名

agyancast

コンセプト： 熊本の都市混雑を"予報"するローカルデータプロジェクト。
