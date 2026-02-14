# 予報（次の1時間）仕様案 v1

## 目的
- 各モールの「次の1時間後の混雑」を予報として出す
- 低コスト運用を前提とし、必要なら軽量MLを後から導入可能にする

---

## 前提
- 現在は混雑表示（リアルタイム）まで実装済み
- `daily_delay` マート（毎時遅延中央値）が Silver にある
- 予報は「次の1時間」のみを対象とする

---

## 予報対象
- モール別の **次の1時間の遅延中央値（分）** を予測
- 予測値を既存の混雑ラベルに変換

### ラベル変換
- 0〜5分未満: スイスイ
- 5〜10分未満: 普通
- 10〜30分未満: 混雑
- 30分以上: 大混雑

---

## 入力データ
1. **最新状態**
   - `silver/latest.json`
   - `silver/latest_detail.json`

2. **当日分の遅延推移（毎時）**
   - `silver/mart/daily_delay/dt=YYYY-MM-DD/hour=HH/*.parquet`

3. **履歴統計（曜日×時間帯の中央値）**
   - `silver/mart/daily_delay_stats/`（新規）

---

## 予測ロジック（軽量版 / 非ML）

### 直近 + 履歴の加重平均
```
pred_delay = w_recent * recent_median + w_hist * historical_baseline
```

- `recent_median`
  - 直近30〜60分の中央値
  - 取れない場合は「当日同時間帯の中央値」

- `historical_baseline`
  - **曜日 × 時間帯** の中央値

- 推奨初期値
  - `w_recent = 0.6`
  - `w_hist = 0.4`

> 曜日の影響が強いので **曜日×時間帯** を必須で保持する。

---

## 軽量ML（後で追加可能）

- モデル候補: Ridge Regression / LightGBM
- 特徴量:
  - hour
  - day_of_week
  - last_30m_median
  - last_60m_median
  - today_hour_median

- 学習は週1回 or 手動更新で十分
- 推論は Lambda 内で実行

---

## 出力フォーマット（フロント用）

`web/data/forecast.json`
```json
{
  "issued_at": "2026-02-14T21:10:00+09:00",
  "target_start": "2026-02-14T22:00:00+09:00",
  "target_end": "2026-02-14T23:00:00+09:00",
  "timezone": "Asia/Tokyo",
  "malls": {
    "ゆめタウン浜線": {
      "pred_delay_min": 6.2,
      "status": "medium",
      "confidence": 0.68,
      "method": "baseline_v1"
    }
  }
}
```

---

## 保存場所（Silver）

- 予報履歴は JSON で薄く保存
```
s3://<data-bucket>/silver/forecast/next_hour/issued_at=YYYY-MM-DDTHH-MM/forecast.json
```

---

## 更新フロー案

1. **日次/週次**: `daily_delay_stats` を更新
   - 例: 過去28日分の「曜日×時間帯」の中央値を集計

2. **10分おき**: `ForecastNextHour` Lambda
   - 最新状態 + 履歴統計から予報を計算
   - `web/data/forecast.json` を更新

---

## Athenaでの閲覧
- `daily_delay_stats` をParquet/Hiveで置くと、Athenaから即参照可能

---

## 今後決めること
- 履歴期間（28日 or 56日）
- w_recent / w_hist の初期係数
- confidence の算出方法（サンプル数 or 分散）
