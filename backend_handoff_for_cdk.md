# バックエンド申し送り（買物/通勤/来熊タブ対応）

更新日: 2026-02-18

## 1. 変更サマリ
- フロントが `買物` / `通勤` / `来熊` の3タブ構成になりました。
- `買物` は従来のモール混雑・遅延情報を使用します。
- `通勤` はセミコンテクノパーク周辺を1拠点表示するダッシュボードです（方面分割なし）。
- `来熊` は **阿蘇くまもと空港リムジンバス** の遅延ダッシュボードを表示します。

## 2. 配信が必要なJSON

### 2.1 買物タブ（既存）
- `/data/places.json`
- `/data/latest.json`
- `/data/latest_detail.json`
- `/data/daily_delay.json`

### 2.2 通勤タブ（新規）
- `/data/commute_semicon_latest.json`
- `/data/commute_semicon_daily.json`

### 2.3 来熊タブ（新規）
- `/data/visitor_airport_latest.json`
- `/data/visitor_airport_daily.json`
- `/data/visitor_airport_stops_latest.json`
- `/data/visitor_airport_stops_daily.json`

## 3. 買物タブのデータ契約（再確認）

### 3.1 `places.json`
必須フィールド:
- `places[].id`
- `places[].name`
- `places[].lat`
- `places[].lon`
- `places[].x`
- `places[].y`

補足:
- `lat/lon` は「近い順」「おすすめ順」の距離計算で必須。
- `x/y` は地図ピン描画に使用。

### 3.2 ID整合性
同一施設は以下で同一キーにしてください。
- `places.json` の `places[].id`
- `latest.json` の `statuses` キー
- `latest_detail.json` の `malls` キー
- `daily_delay.json` の `series` キー（可能なら）

### 3.3 ステータス語彙（固定）
- `low`
- `medium`
- `high`
- `very_high`
- `unknown`

### 3.4 `daily_delay.json` 形式
```json
{
  "date": "YYYY-MM-DD",
  "timezone": "Asia/Tokyo",
  "hours": ["00","01","...","23"],
  "series": {
    "ゆめタウン浜線": [0.8, 1.2, null, ...]
  }
}
```
- `null` は欠損として許容。
- フロント表示は 05-24時（24は補完扱い）。

## 4. 通勤タブのデータ契約（新規）

### 4.1 `/data/commute_semicon_latest.json`（必須）
セミコンテクノパーク周辺の停留所別・現在値を返します。

推奨形式:
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

補足:
- `predictions.h1_sec` / `predictions.h3_sec` は未対応時 `null` 可。
- `stops[]` の同一停留所でも、`operator` が異なる場合は別レコードで返却。
- フロント表示は stop単位を直接出さず、`stops[]` を代表値に集約して1拠点表示します。
- `traffic.status` は次の語彙で返却:
  - `smooth`（15km/h超）
  - `congested`（15km/h以下）
  - `very_congested`（8km/h以下）
  - `unknown`（サンプル不足: 3件未満）

### 4.2 `/data/commute_semicon_daily.json`（必須）
通勤エリア全体の当日推移（05-24時表示用）を返します。

推奨形式:
```json
{
  "date": "2026-02-18",
  "timezone": "Asia/Tokyo",
  "hours": ["00","01","...","23"],
  "delay_points": [
    { "hour": "06", "delay_min": 0.4, "sample_count": 9 }
  ],
  "traffic": {
    "section_name": "原水駅北口→県立技術短期大学前",
    "from_stop_id": "100879_1",
    "to_stop_id": "100880_1",
    "distance_km": 2.4,
    "thresholds": { "congested_kmh": 15, "very_congested_kmh": 8, "min_samples": 3 },
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
- フロントは `delay_points` / `traffic.speed_points` を使い、**取得できた時刻のみ点を描画**する。
- `stops[].delay_min` は互換のため保持（従来処理向け）。

### 4.3 対象停留所（GTFS）
- `dentetsu` / `100880_1` / 県立技術短期大学前
- `sankobus` / `100880_1` / 県立技術短期大学前

## 5. 来熊タブのデータ契約（新規）

### 5.1 `/data/visitor_airport_latest.json`（必須）
推奨形式:
```json
{
  "updated_at": "2026-02-17T08:30:00+09:00",
  "route_id": "aso_airport_limousine",
  "route_name": "阿蘇くまもと空港リムジンバス",
  "status": "slight_delay",
  "delay_sec": 360,
  "note": "交通集中により最大10分程度の遅れ",
  "predictions": {
    "h1_sec": null,
    "h3_sec": null
  }
}
```

`status` 語彙:
- `on_time`
- `slight_delay`
- `delayed`
- `suspended`
- `unknown`

補足:
- `predictions.h1_sec` / `predictions.h3_sec` は未対応時 `null` で可。
- 将来、複数路線化する場合は `services[]` 配列形式でもフロントは受理可能（先頭要素を表示）。

### 5.2 `/data/visitor_airport_daily.json`（推奨）
推奨形式:
```json
{
  "date": "2026-02-17",
  "timezone": "Asia/Tokyo",
  "hours": ["00","01","...","23"],
  "delay_min": [null, null, 2.0, ...]
}
```

補足:
- 代替として `series` 形式でも可（先頭系列を表示）。
- 欠損は `null` を許容。

### 5.3 `/data/visitor_airport_stops_latest.json`（新規）
停留所別の現在遅延（往復）を返します。

対象停留所（空港行き）:
- 熊本桜町バスターミナル(6番のりば)
- 通町筋
- 味噌天神
- 水前寺公園前
- 熊本県庁前
- 自衛隊前
- 東町中央
- 益城インター口 P
- グランメッセ前
- 臨空テクノパーク西
- 臨空テクノパーク東
- 阿蘇くまもと空港(乗車：4番のりば　※特快バスは3番のりば)

形式:
```json
{
  "updated_at": "2026-02-18T08:30:00+09:00",
  "route_id": "aso_airport_limousine",
  "route_name": "阿蘇くまもと空港リムジンバス",
  "directions": {
    "to_airport": { "label": "空港行き", "stops": [ { "stop_id": "...", "stop_name": "...", "delay_sec": 180 } ] },
    "from_airport": { "label": "市内行き", "stops": [ { "stop_id": "...", "stop_name": "...", "delay_sec": 240 } ] }
  }
}
```

### 5.4 `/data/visitor_airport_stops_daily.json`（新規）
停留所別の当日推移（05-24時表示用）を返します。

形式:
```json
{
  "date": "2026-02-18",
  "timezone": "Asia/Tokyo",
  "hours": ["00","01","...","23"],
  "directions": {
    "to_airport": {
      "label": "空港行き",
      "stops": [ { "stop_id": "...", "stop_name": "...", "delay_min": [null, 1.2, ...] } ]
    },
    "from_airport": {
      "label": "市内行き",
      "stops": [ { "stop_id": "...", "stop_name": "...", "delay_min": [null, 1.5, ...] } ]
    }
  }
}
```

## 6. バックエンド実装タスク
1. GTFS-RT から空港リムジン対象便を抽出（`route_id` または停留所セットで定義）。
2. 最新時点の代表遅延 `delay_sec` を算出して `visitor_airport_latest.json` を生成。
3. 当日時間帯別の遅延中央値（分）を算出して `visitor_airport_daily.json` を生成。
4. 空港リムジン停留所別の `visitor_airport_stops_latest.json` を生成。
5. 空港リムジン停留所別の `visitor_airport_stops_daily.json` を生成。
6. 通勤向け対象停留所（県立技術短期大学前）の `commute_semicon_latest.json` を生成。
7. 通勤向け対象停留所の `commute_semicon_daily.json` を生成。
8. `原水駅北口(100879_1)→県立技術短期大学前(100880_1)` の区間平均時速を算出し、`traffic.avg_speed_kmh` と `traffic.status` を生成。
9. 全JSONを30分間隔更新に統合し、未計算時は `null` / `unknown` を返却。

## 7. 地図位置ずれについて
- フロント側で座標補正を入れて暫定対応済み。
- 根本対応として、`places.json` の `x/y` と `kumamoto_map.svg` の生成ロジック（同一bounds/投影）を継続的に一致させることを推奨。

## 8. 配信・キャッシュ運用（CDK）
- 配信対象: `web/dist` + `data/*.json`
- `/data/*` は短TTL推奨（60〜300秒）
- `index.html` は長期キャッシュしない
- CloudFront運用時は `index.html` をデプロイ時にInvalidation

## 9. 追加であると良い項目
1. 買物タブ一覧の `1時間後` 予測データ（現在 `Coming Soon`）
2. 来熊タブ `h1/h3` 予測値の実値化
3. 通勤タブ（セミコンテクノパーク周辺）の予測値精度向上
