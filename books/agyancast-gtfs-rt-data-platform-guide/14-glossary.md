---
title: "用語集"
---

## GTFS static

公共交通の予定情報（停留所、路線、時刻表）を表す仕様。通常はzip内のCSV系テキストで配布される。

## GTFS-RT

GTFS staticを補うリアルタイム仕様。protobufバイナリ（`.bin`）で遅延や車両位置を配信する。

## Protocol Buffers

スキーマ駆動のバイナリシリアライズ形式。今回の `*_trip_update.bin` の実体。

## FeedMessage

GTFS-RTのルートメッセージ。`header` と `entity[]` を持つ。

## TripUpdate

便の進捗・遅延を表すGTFS-RTメッセージ。今回の混雑判定の主入力。

## stop_time_update / stopTimeUpdate

TripUpdate内の停留所単位更新。`stop_id` と `arrival/departure delay` を持つ。
実装言語によっては `stopTimeUpdate`（キャメルケース）として見える。

## delay

予定との差分秒。今回のMVPでは負値を0に丸めて混雑代理指標に使う。

## Raw / Bronze / Silver

データを段階的に整えるための“層”の呼び方。本書では次の意味で使う。

- Raw: 変換前の元データ（GTFS-RTのBIN）をそのまま保管
- Bronze: 必要項目を抜き出したイベントログ（JSONL）
- Silver: 画面向け/分析向けのデータプロダクト（latest JSON、Parquet martなど）

## メダリオンアーキテクチャ

Raw/Bronze/Silver（時にGoldも）という段階でデータを整えていく設計パターン。
目的は「最初から完璧にしない」ことではなく、運用しながら理解が更新されても**作り直せる**状態を作ること。

## JSONL

JSON Lines。1行が1つのJSONになっているファイル形式。ログの蓄積や追記と相性が良い。

## Parquet

列指向の分析用ファイル形式。圧縮が効き、Athenaなどでスキャンコストを抑えやすい。

## Athena

S3上のデータに対してSQLでクエリできるサービス。Parquetと相性が良い。

## パーティション（dt=..., hour=...）

S3のパスに `dt=YYYY-MM-DD/hour=HH` のような階層を作り、日付や時間で絞り込めるようにする設計。
分析時のスキャン量削減や、再処理の範囲指定がしやすくなる。

## event_time / ingest_time / updated_at

時刻は似ているが役割が違うので、分けて持つ。

- `event_time`: GTFS-RTが指している観測時刻に近いもの（timestamp由来）
- `ingest_time`: `agyancast` が取得・保存した時刻
- `updated_at`: 出力（latestなど）を生成した時刻

## スナップショット（latest）

「いまの状態」を1つにまとめたファイル。更新のたびに上書きされる。履歴は別（Bronze/Parquet）で持つ。

## 再処理（backfill）

過去のRawを読み直して、Bronze/Silverを作り直すこと。しきい値変更やバグ修正、仕様理解の更新に対応するために重要。

## spots.csv

モールと停留所を結ぶマスタ。`(company, stop_id)` をキーに集計対象を定義する。

## median（中央値）

外れ値に強い代表値。モール単位遅延の集約に使用。

## nowcast

短時間先（例: 1時間先）の予測。将来フェーズで追加予定。
