---
title: "GTFSとは何か: 全体像をつかむ"
---

## GTFSを一言でいうと

GTFS（General Transit Feed Specification）は、公共交通の時刻表と路線情報を機械可読で配布するための標準形式です。

- 形式は主にCSV（`.txt`）
- 配布はzipが一般的
- 静的（予定）情報を扱う

公式仕様:

- [https://gtfs.org/documentation/schedule/reference/](https://gtfs.org/documentation/schedule/reference/)

## なぜGTFSが重要か

アプリ側は、交通事業者ごとに異なる独自形式を読む必要がなくなります。

- `stops.txt` を見れば停留所がわかる
- `trips.txt` と `stop_times.txt` を見れば便の時系列がわかる
- `routes.txt` で路線のまとまりがわかる

つまり「最低限同じ読み方ができる」ことが価値です。

## GTFSは「静的」データ

ここで大事なのは、GTFS単体ではリアルタイム遅延は直接わからない点です。

- GTFS: 予定時刻・路線・停留所などの土台
- GTFS-RT: 現在の遅延や車両位置などのリアルタイム

今回のMVPでは、この2つを組み合わせます。

## 本プロジェクトでの位置づけ

`agyancast` では、GTFSを次の用途で使っています。

- 停留所や路線の基準データ
- GTFS-RT `stop_id` を人間向け地名へ解釈するための土台
- `spots.csv`（モール関連停留所マスタ）との整合確認

## GTFSで最初に覚えるべき5ファイル

初学者は、まず次の5つだけ押さえると全体が見えます。

- `agency.txt`: 事業者
- `stops.txt`: 停留所
- `routes.txt`: 路線
- `trips.txt`: 便（ある日のある走行）
- `stop_times.txt`: 便ごとの停車時刻列

次章では、これらの関係を `agyancast` の実データを使って具体的に見ます。
