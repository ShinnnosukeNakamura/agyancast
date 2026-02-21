---
title: "MVPの仕様: いま何を作っていて何を作らないか"
---

## MVPで作るもの

このフェーズで実装したのは次です。

- 10分間隔でGTFS-RTを取得
- 遅延データを蓄積（Raw/Bronze/Silver）
- モールごとの混雑ステータス生成
- 当日推移（日次マート）生成
- Web向けJSONを出力

## あえて作らないもの

最初から全部作ると運用不能になるため、以下は後回しです。

- 複雑な予測モデル
- 高度な重複排除テーブル（Icebergなど）
- 経路探索最適化

これは「段階的に価値を出す」ための戦略です。

## このMVPの出力

ユーザー視点では次が出ます。

- 現在の混雑ラベル（`low`/`medium`/`high`/`very_high`）
- モール別の遅延秒
- 日次グラフ（時間帯推移）
- 通勤・来訪向け派生データ

## なぜこの切り方がよいか

- データ取得が不安定でも、履歴再処理で立て直せる
- UIはJSON契約で独立して開発できる
- 予測を追加しても、既存の観測・可視化を壊さない

## 実装の参照先

- 仕様: `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/agyancast_spec.md`
- データ基盤: `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/bus_realtime_data_platform_spec.md`
- スライド原稿: `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/slides/lt_20260307_gyancast.md`
