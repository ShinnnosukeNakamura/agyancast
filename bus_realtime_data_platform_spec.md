# バス・リアルタイムデータ基盤 - 現行仕様

## 1. 目的（現フェーズ）

以下を満たすシステムを構築する。

-   現在の混雑状況を可視化できること
-   将来の予測に拡張可能な設計であること
-   初期段階で過度に複雑化しないこと

本フェーズでは**予測ロジックは含めない**。

------------------------------------------------------------------------

## 1.1 agyancast 仕様との対応

本ドキュメントは、リアルタイム混雑可視化に関する**データ基盤部分**を扱う。
全体仕様は `agyancast_spec.md` を参照する。

- データソース/GTFS-RT エンドポイントは `agyancast_spec.md` の「2. データソース」「3. GTFS-RT エンドポイント一覧」
- モール対象停留所リストは `agyancast_spec.md` の「4.1 モール対象停留所リスト」と `spots.csv`
- 混雑指数・予報ロジックは `agyancast_spec.md` の「6. 混雑指数算出ロジック」「7.1 予報の粒度と更新」（本フェーズでは未実装）

------------------------------------------------------------------------

## 2. 全体アーキテクチャ（レイヤー構成）

### Raw レイヤー（S3）

目的: 元データを恒久的に保存する。

-   受信した protobuf（pb）ファイルをそのまま保存
-   変換は行わない
-   不変の真実（Source of Truth）として扱う
-   将来の再処理を可能にする

保存パス（決定）:

```
s3://<bucket>/raw/
  company=<xxx>/
    dt=YYYY-MM-DD/
      hour=HH/
        minute=MM/
          <file>.bin
```

dt/hour/minute は **取得時刻（ingest_time）の JST** に基づいて付与する。

company の定義:

- GTFS-RT には operator_id/agency_id が存在しないため、**取得元フィードの識別子**を company とする
  （例: `sankobus`, `dentetsu`, `kumabus`, `toshibus`）
- static GTFS の `agency_id` は別カラムとして保持し、必要なら company とマッピングする

------------------------------------------------------------------------

### Bronze レイヤー（S3 + Event Log）

目的: 構造化されたイベントログ。

各レコードは1回の観測イベントを表す。

テーブル: `bus_events_bronze`

カラム例:

-   event_time
-   ingest_time
-   company
-   agency_id（static GTFS から補完できる場合のみ）
-   route_id
-   vehicle_id
-   latitude
-   longitude
-   passenger_count（存在する場合）
-   status
-   payload_version

特性:

-   重複は許容する
-   夜間の重複データも許容する
-   大きなクリーニングは行わない
-   当面は JSONL で保存する（Lambda 安定運用のため）
-   将来的に Parquet 化する
-   Athena でクエリする

パーティション（決定）:

- `dt`（JSTの日付）
- `hour`（時）

保存パス例:

```
s3://<bucket>/bronze/
  dt=YYYY-MM-DD/
    hour=HH/
      part-xxxx.jsonl
```

------------------------------------------------------------------------

### イベント時刻の定義（JST）

イベント時刻は **GTFS-RT 内の timestamp を優先**して採用する。
理由: 取得/保存の遅延に左右されず、観測時刻に近い基準で集計できるため。

優先順位:

1. TripUpdate または VehiclePosition の `timestamp`
2. FeedHeader の `timestamp`
3. 取得時刻（ingest_time）

`event_time` / `ingest_time` は **JST で保存**する（例: `2026-02-12T23:45:00+09:00`）。
`event_date` は `event_time` を JST に丸めた日付とし、パーティションに使用する。

------------------------------------------------------------------------

### Silver レイヤー（最新状態スナップショット）

目的: 「いまの混雑表示」に必要な最新状態をスナップショットとして保持する。

方針:

-   Bronze から `event_time` の最新レコードを抽出
-   freshness 列で稼働判定（`is_operating`）
-   30分間隔で CTAS 生成し S3 に保存
-   欠損補完: (company, stop_id) 単位の直近値で補完（有効期限: 3時間）
-   欠損補完のため、最新 stop_id の状態を `silver/state/last_stop_delay.json` に保持

保存パス例:

```
s3://<bucket>/silver/latest/
  dt=YYYY-MM-DD/
    hour=HH/
      part-xxxx.parquet
```

フロント連携:

- `silver/latest.json` を生成し、Web 配信用バケットの `data/latest.json` に同期する
- フロントは `data/latest.json` を参照して混雑状況を描画する
- `spots.csv` から `data/places.json` を生成し、フロントの地図表示に利用する

追加の計算フィールド:

-   `occupancy_rate = passenger_count / vehicle_capacity`
-   `data_freshness_minutes = now - last_event_time`
-   `is_operating = 鮮度しきい値による稼働判定`

注記:

-   latest は「履歴の特殊ケース」であり、Bronze から直接生成する
-   予測フェーズで時系列が必要になったら Silver（時系列）を追加する

------------------------------------------------------------------------

## 3. マスターデータ

テーブル: `route_master`

-   route_id
-   company
-   agency_id（static GTFS 由来）
-   vehicle_capacity
-   average_headway（任意）

用途:

-   混雑率の算出
-   将来の予測拡張

------------------------------------------------------------------------

## 4. サービングレイヤー（任意）

DynamoDB に格納する可能性があるもの:

-   車両の最新状態
-   現在の混雑状況
-   将来の予測（後続フェーズ）

DynamoDB はデータレイクではなく、**提供（Serving）専用の層**として扱う。
本フェーズでは Silver 層に DynamoDB は使用しない。

------------------------------------------------------------------------

## 5. まだ含めない項目

以下は意図的に後回しとする。

-   完全に重複排除された時系列 Silver テーブル（Iceberg など）
-   Iceberg 形式（将来/任意）
-   複雑な予測モデル
-   深夜バスの明示的な時刻表検証

------------------------------------------------------------------------

## 6. 設計原則

-   元データを保存する
-   ストレージと計算を分離する
-   まずはシンプルに始める
-   進化可能なアーキテクチャにする
-   早すぎる最適化を避ける

------------------------------------------------------------------------

## 7. 次フェーズ（将来）

-   時間バケットの集計テーブルを構築
-   短期の簡易予測（トレンドベース）を追加
-   更新/削除が必要になったら Iceberg を導入
-   小ファイルのコンパクション戦略を実装

------------------------------------------------------------------------

## 8. CDK による構築方針（案）

本基盤は AWS CDK で構築する。

-   CDK v2 を前提
-   言語: TypeScript
-   主要リソース: S3（Raw/Bronze/Silver/Web）、Glue Data Catalog、Athena、Lambda/ECS、EventBridge、DynamoDB（任意）
-   スタック分割は後述の未決事項で確定する

### Web 配信

- S3 の静的ホスティングを利用（`web/` を配信）
- `data/latest.json` を Silver から同期して可視化に利用する

------------------------------------------------------------------------

## 8.1 （任意）Lambda + DuckDB + PyIceberg による Iceberg 生成案

Bronze の Parquet を Lambda で読み込み、Iceberg テーブルに append する。
参考実装として、Lambda で DuckDB + PyArrow + PyIceberg を使う構成が示されている。

- Lambda で DuckDB を使い、S3 上の Parquet を直接読み込む
- PyIceberg で Glue Catalog に登録された Iceberg テーブルへ append
- Lambda レイヤーの容量制約に注意（必要ならコンテナ化も検討）

この方式は軽量データセットでのコスト効率が高い一方で、
Lambda のメモリ/実行時間制限には留意する。

補足:

- 参考実装では S3 へのファイル格納をトリガーに Lambda を起動
- `pyiceberg[glue,duckdb]` を Lambda レイヤーに含めると 250MB 制限を超える可能性があるため、不要なライブラリ削除やコンテナ化が候補

------------------------------------------------------------------------

## 9. 未決事項（要ディスカッション）

-   スタック分割方針（例: DataLake / Ingest / Serving）
-   S3 のバケット構成とライフサイクル（Raw の保存期間、Bronze の保持期間）
-   Glue/Athena の利用範囲（Bronze のみか、Silver も対象か）
-   Serving 層の必要性（DynamoDB を使うか、Athena 直参照で足りるか）
-   Iceberg テーブル構成（namespace / table 名）

------------------------------------------------------------------------

## 10. 決定事項（現時点）

-   CDK 言語: TypeScript
-   取得ジョブ: Lambda
-   Raw 取得: 10分間隔
-   Bronze / Silver 更新: 10分間隔
-   Silver（時系列）: 予測フェーズまで作らない
-   Silver（最新スナップショット）: Bronze から直接抽出し CTAS で保存
-   event_date: GTFS-RT の timestamp を JST に丸めた日付
-   Iceberg パーティション（将来導入時）: 日付カラムの Identity（例: `event_date`）のみ
-   Iceberg 生成ジョブ（将来導入時）: EventBridge による 30分間隔の定期実行

------------------------------------------------------------------------

本ドキュメントは、リアルタイム混雑可視化に焦点を当てた
最小構成のアーキテクチャを示す。
