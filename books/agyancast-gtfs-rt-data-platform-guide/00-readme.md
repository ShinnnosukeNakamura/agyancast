---
title: "はじめに: この本で何を作るか"
---

この本は、公共交通のオープンデータを使って「街の混雑を可視化する」仕組みを、初学者向けに順番に説明する本です。

対象は、次のような方です。

- GTFSやGTFS-RTという言葉を最近知った
- データを集めるところからWeb表示まで、全体像をつかみたい
- ただの理論ではなく、実際のプロジェクトで使っている形を知りたい

この本で扱うプロジェクトは、熊本のバスデータを使った `agyancast` です。リポジトリは次です。

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast`

## この本で到達するゴール

読み終えたら、次がわかる状態を目指します。

- GTFS（静的時刻表データ）の基本
- GTFS-RT（リアルタイムデータ）の基本
- `TripUpdate.stop_time_update.delay` を使った混雑可視化MVPの作り方
- Raw/Bronze/Silverでデータを育てる実装の流れ
- Zenn本として継続的に技術記録を公開する方法

## 先に結論（このMVPの考え方）

このプロジェクトは、いきなり「高精度な予測AI」を作るのではなく、まず次を作っています。

1. 安定して取れるデータを継続取得する
2. 見える化できる形に整える
3. 履歴をためる
4. その上で予測（nowcast）へ進む

つまり、先に「予報可能な土台」を作るアプローチです。

## 公式仕様へのリンク（最初に押さえる）

本の中でも何度か参照しますが、最も重要なのは公式仕様です。

- GTFS Schedule Reference: [https://gtfs.org/documentation/schedule/reference/](https://gtfs.org/documentation/schedule/reference/)
- GTFS Realtime Reference: [https://gtfs.org/documentation/realtime/reference/](https://gtfs.org/documentation/realtime/reference/)

この本は、上記仕様を前提に、`agyancast` 実装での解釈と手順を補足する形で進めます。
