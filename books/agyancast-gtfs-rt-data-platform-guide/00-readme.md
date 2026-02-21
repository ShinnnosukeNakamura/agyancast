---
title: "この本の狙いと読み方"
---

この本は、`agyancast` という実プロジェクトを題材に、次を順番に理解するための本です。

- どんな問題意識で作り始めたか
- GTFS / GTFS-RT をどう読むか
- BIN（protobuf）をどう扱ってJSONに落とすか
- どんな設計判断でMVPを組んだか

ここでの主眼は「汎用的な売り方」ではなく、**これまで作ってきたものの設計意図と実装詳細を言語化すること**です。

## 先に結論

このプロジェクトで一番重要だった判断は、次の3つです。

1. 予測モデルより先に、継続取得できるデータ基盤を作る
2. GTFS-RTの `delay` を混雑の代理指標としてまず成立させる
3. Raw/Bronze/Silver を分けて、作り直せる形にする

つまり、「いきなり最適解を目指す」のではなく「壊れにくい土台から積む」方針です。

## 本の読み順

- `01` 〜 `02`: 問題設定と設計思想
- `03` 〜 `06`: GTFS/GTFS-RTの仕様理解とBIN処理
- `07` 〜 `10`: 今回のMVP実装詳細
- `11` 〜 `13`: 運用・学び・今後
- `14`: 用語集

## この本で扱う実体

リポジトリ:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast`

中心となるコード:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/infra/lambda/ingest.ts`
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/infra/lambda/transform.ts`
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/infra/lambda_py/daily_delay_mart/handler.py`

仕様メモ:

- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/agyancast_spec.md`
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/bus_realtime_data_platform_spec.md`

## 読み終えた時のゴール

読み終えた時に、次を説明できれば成功です。

- GTFS static と GTFS-RT の違い
- 今回の仕様で「どのファイルのどの列」を使っているか
- BINデータをどう取り込み、どうJSONL化しているか
- なぜこのしきい値・補完ルールを採用したか

