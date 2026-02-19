# フロント設計書（買物 / 通勤 / 来熊）
更新日: 2026-02-18

## 1. 画面構成
- フッター固定タブは3種:
  - `買物`
  - `通勤`
  - `来熊`
- タブ切替はSPA内状態で実施（ページ遷移なし）。

## 2. 各タブの役割

### 2.1 買物タブ
- 既存機能を維持:
  - おすすめカード（今行くなら / 狙い目時間）
  - 並び順基準（モール選択 / 現在地）
  - 一覧（おすすめ順 / 空いてる順 / 近い順）
  - 今日の推移グラフ（05-24時）
  - 補助地図

### 2.2 通勤タブ
- セミコンテクノパーク周辺の混雑を、**1拠点（セミコンテクノパーク）** として表示。
- 方面分割（菊陽/大津）は廃止し、単一ダッシュボード化。
- 対象停留所（GTFS指定）:
  - `県立技術短期大学前`（`dentetsu` / `100880_1`）
  - `県立技術短期大学前`（`sankobus` / `100880_1`）
- 表示要素:
  - エリア全体KPI（現在 / 1時間後 / 3時間後）
  - 区間平均時速（原水駅北口→県立技術短期大学前）
  - 区間渋滞判定（15km/h以下=渋滞、8km/h以下=大渋滞、サンプル3件未満は判定保留）
  - エリア全体の当日推移グラフ（05-24時）
  - 一覧も1行（セミコンテクノパーク）

### 2.3 来熊タブ
- 空港リムジンバス向けダッシュボード。
- 3レイヤ表示:
  1. 全体遅延（阿蘇くまもと空港終点ベース）
  2. 停留所別遅延（桜町BT ↔ 阿蘇くまもと空港、往復）
  3. 停留所別の当日推移グラフ（05-24時）
- 停留所別表示は `空港行き / 市内行き` のトグル切替。
- 停留所別グラフは通常グラフと同様に縦軸/横軸を表示。

## 3. 来熊タブの停留所方針（調査結果）
- GTFS（`sankobus.zip`）AP系を確認し、桜町BT〜空港区間を採用。
- 初期対象停留所:
  - `熊本桜町バスターミナル(6番のりば)`
  - `通町筋`
  - `味噌天神`
  - `水前寺公園前`
  - `熊本県庁前`
  - `自衛隊前`
  - `東町中央`
  - `益城インター口 P`
  - `グランメッセ前`
  - `臨空テクノパーク西`
  - `臨空テクノパーク東`
  - `阿蘇くまもと空港(乗車：4番のりば　※特快バスは3番のりば)`
- 方向:
  - 空港行き
  - 市内行き（復路）

## 4. データ契約（フロント取得）

### 4.1 買物タブ
- `/data/places.json`
- `/data/latest.json`
- `/data/latest_detail.json`
- `/data/daily_delay.json`

### 4.2 通勤タブ（新規）
- `/data/commute_semicon_latest.json`
- `/data/commute_semicon_daily.json`

推奨フォーマット:

`commute_semicon_latest.json`
```json
{
  "updated_at": "2026-02-18T08:30:00+09:00",
  "area_id": "semicon_techno_park",
  "area_name": "セミコンテクノパーク周辺",
  "traffic": {
    "section_name": "原水駅北口→県立技術短期大学前",
    "from_stop_id": "100879_1",
    "to_stop_id": "100880_1",
    "distance_km": 2.4,
    "avg_speed_kmh": 18.4,
    "status": "congested",
    "sample_count": 5
  },
  "stops": [
    {
      "operator": "dentetsu",
      "stop_id": "100880_1",
      "stop_name": "県立技術短期大学前",
      "lat": 32.887573,
      "lon": 130.83466,
      "delay_sec": 240,
      "predictions": { "h1_sec": null, "h3_sec": null }
    }
  ]
}
```

`commute_semicon_daily.json`
```json
{
  "date": "2026-02-18",
  "timezone": "Asia/Tokyo",
  "area_id": "semicon_techno_park",
  "area_name": "セミコンテクノパーク周辺",
  "hours": ["00","01","...","23"],
  "delay_points": [
    { "hour": "06", "delay_min": 0.5, "sample_count": 2 }
  ],
  "traffic": {
    "section_name": "原水駅北口→県立技術短期大学前",
    "from_stop_id": "100879_1",
    "to_stop_id": "100880_1",
    "distance_km": 2.4,
    "thresholds": {
      "congested_kmh": 15,
      "very_congested_kmh": 8,
      "min_samples": 3
    },
    "speed_points": [
      { "hour": "06", "avg_speed_kmh": 18.5, "status": "unknown", "sample_count": 1 }
    ]
  },
  "stops": [
    {
      "operator": "dentetsu",
      "stop_id": "100880_1",
      "stop_name": "県立技術短期大学前",
      "delay_min": [null, 1.2, 2.0, ...]
    }
  ]
}
```
- 遅延グラフは `delay_points` をそのまま描画（`stops` 再集計はしない）。
- 速度グラフは `traffic.speed_points` をそのまま描画。
- どちらも `points` に含まれる `hour` のみ表示（未計測時間に0点を出さない）。

### 4.3 来熊タブ（全体）
- `/data/visitor_airport_latest.json`
- `/data/visitor_airport_daily.json`

### 4.4 来熊タブ（停留所別・新規）
- `/data/visitor_airport_stops_latest.json`
- `/data/visitor_airport_stops_daily.json`

推奨フォーマット:

`visitor_airport_stops_latest.json`
```json
{
  "updated_at": "2026-02-18T08:30:00+09:00",
  "route_id": "aso_airport_limousine",
  "route_name": "阿蘇くまもと空港リムジンバス",
  "directions": {
    "to_airport": {
      "label": "空港行き",
      "stops": [
        { "stop_id": "100002_3", "stop_name": "桜町バスターミナル", "delay_sec": 180 }
      ]
    },
    "from_airport": {
      "label": "市内行き",
      "stops": [
        { "stop_id": "102112_1", "stop_name": "阿蘇くまもと空港", "delay_sec": 240 }
      ]
    }
  }
}
```

`visitor_airport_stops_daily.json`
```json
{
  "date": "2026-02-18",
  "timezone": "Asia/Tokyo",
  "hours": ["00","01","...","23"],
  "directions": {
    "to_airport": {
      "stops": [
        {
          "stop_id": "100002_3",
          "stop_name": "桜町バスターミナル",
          "delay_min": [null, 1.2, 2.1, ...]
        }
      ]
    },
    "from_airport": {
      "stops": [
        {
          "stop_id": "102112_1",
          "stop_name": "阿蘇くまもと空港",
          "delay_min": [null, 2.0, 2.8, ...]
        }
      ]
    }
  }
}
```

## 5. 状態保存（ローカル）
- `agyancast.favorite_malls`
- `agyancast.ui_settings_v1`
  - 現在タブ
  - 並び順
  - お気に入りのみ表示
  - 基準モール
  - 現在地モード/最終位置

## 6. モバイル挙動
- 下に引いて更新（Pull to refresh）対応。
- 明示更新ボタンも併設。
- `現在地を使う` は失敗理由を画面表示:
  - HTTPS要件
  - 権限拒否
  - タイムアウト
  - 端末非対応

## 7. 実装対象ファイル
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/src/App.jsx`
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/src/styles.css`
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/public/data/commute_semicon_*.json`
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/public/data/visitor_airport_*.json`

## 8. 完了条件
- フッタータブが `買物 / 通勤 / 来熊` の3つで動作。
- 来熊タブで全体遅延 + 停留所別（往復）遅延 + 停留所別グラフが表示。
- 通勤タブでセミコンテクノパークを1拠点として表示。
- 買物タブの既存機能が崩れない。
