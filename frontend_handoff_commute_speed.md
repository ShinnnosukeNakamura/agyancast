# フロント申し送り（通勤グラフ改修: 遅延+平均時速）

更新日: 2026-02-19

## 背景
- 通勤タブで「遅延の時系列」に加えて「区間平均時速の時系列」を表示したい。
- 未計測時間帯に 0 分の点が表示される不具合があるため、**取得できた時刻だけ点を打つ**実装に切り替える。

## 対象API
- `/data/commute_semicon_latest.json`
- `/data/commute_semicon_daily.json`

## バックエンド変更点
- `commute_semicon_daily.json` に以下を追加。
  - `delay_points`: 遅延の実測ポイント（時刻ごと）
  - `traffic.speed_points`: 平均時速の実測ポイント（時刻ごと）
- `commute_semicon_latest.json` は既存どおり `traffic.avg_speed_kmh`, `traffic.status`, `traffic.sample_count` を返却。

## 新しいデータ契約（通勤日次）
```json
{
  "date": "2026-02-19",
  "timezone": "Asia/Tokyo",
  "area_id": "semicon_techno_park",
  "area_name": "セミコンテクノパーク周辺",
  "hours": ["00","01","...","23"],
  "stops": [
    {
      "operator": "dentetsu",
      "stop_id": "100880_1",
      "stop_name": "県立技術短期大学前",
      "delay_min": [null, null, ..., 0.5, ...]
    }
  ],
  "delay_points": [
    { "hour": "06", "delay_min": 0.5, "sample_count": 2 },
    { "hour": "07", "delay_min": 1.2, "sample_count": 3 }
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
      { "hour": "06", "avg_speed_kmh": 18.5, "status": "unknown", "sample_count": 1 },
      { "hour": "07", "avg_speed_kmh": 14.2, "status": "congested", "sample_count": 4 }
    ]
  }
}
```

## フロント実装修正指示
1. 遅延グラフは `delay_points` をそのまま使う（`hours`/`stops[].delay_min` から再計算しない）。
2. 速度グラフは `traffic.speed_points` を使う。
3. どちらも **points配列に存在する hour のみ** を描画する（未計測時刻は点を打たない）。
4. `status` 表示ルール:
   - `smooth`: 順調
   - `congested`: 渋滞
   - `very_congested`: 大渋滞
   - `unknown`: 情報準備中
5. KPI表示:
   - 現在平均時速: `latest.traffic.avg_speed_kmh`
   - 判定: `latest.traffic.status`
   - サンプル数: `latest.traffic.sample_count`

## 不具合の原因メモ
- 既存実装で `null` を `Number(null)` してしまうと `0` 扱いになる。
- そのため、未計測時間帯にも 0 分点が出ることがある。
- 今回はバックエンド側で `delay_points` / `speed_points` を追加したので、フロントはこの配列を直接描画して回避する。

