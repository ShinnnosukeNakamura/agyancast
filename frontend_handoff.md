# フロント引き継ぎ: 日次遅延グラフの組み込み

## 目的
- 地図の下に **モール別の遅延推移（当日分 / 毎時）** を可視化する。
- データは S3 に配置される `web/data/daily_delay.json` を参照する。

## 現在のフロント構成
- `/Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/`
  - `index.html`
  - `styles.css`
  - `app.js`
  - `data/places.json`
  - `data/latest.json`
  - `data/latest_detail.json`

## 追加するデータ（新規）
- `web/data/daily_delay.json`

### データ形式（例）
```json
{
  "date": "2026-02-14",
  "timezone": "Asia/Tokyo",
  "hours": ["00","01",..."23"],
  "series": {
    "ゆめタウン浜線": [0.8, 1.2, null, 3.4, ...],
    "アミュプラザくまもと": [2.1, 2.2, 2.8, ...]
  }
}
```

- `hours` は 24時間固定（ラベル用）
- `series` は **モール名 → 遅延中央値（分）配列**
- データが無い時間帯は `null` を入れる（線がギャップになる）

## 画面側の変更内容
### 1. `index.html`
地図セクションの下にグラフ表示領域を追加する。

例:
```html
<section class="trend" id="trend">
  <div class="trend-header">
    <div class="trend-title">今日の混雑推移</div>
    <div class="trend-meta" id="trend-meta">--</div>
  </div>
  <div class="trend-chart">
    <canvas id="daily-delay-chart" height="140"></canvas>
  </div>
</section>
```

### 2. `styles.css`
グラフ領域のスタイルを追加する。

例:
```css
.trend {
  margin-top: 18px;
  padding: 16px;
  border-radius: 14px;
  background: #ffffff;
  border: 2px solid #d9cfbd;
  box-shadow: 0 12px 22px rgba(0, 0, 0, 0.08);
}

.trend-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.trend-title {
  font-weight: 900;
  font-size: 18px;
}

.trend-meta {
  font-size: 13px;
  opacity: 0.7;
}
```

### 3. `app.js`
- `daily_delay.json` を `fetch` してグラフを描画する。
- Chart.js を CDN で読み込む想定（HTMLに `<script src=...>` を追加）。
- データが無い場合はグラフ領域を非表示にする。

#### 取得するデータ
- `data/daily_delay.json`

#### 描画の考え方
- `hours` を X 軸ラベル
- `series[mall]` を Y 軸（遅延分）
- `null` はギャップ表示

#### 実装の流れ（擬似コード）
```js
const daily = await fetchJson('data/daily_delay.json', null);
if (!daily || !daily.series) { hide trend; return; }

const labels = daily.hours || [];
const datasets = Object.entries(daily.series).map(([mall, values], idx) => ({
  label: mall,
  data: values,
  borderColor: palette[idx % palette.length],
  backgroundColor: palette[idx % palette.length],
  spanGaps: false,
}));

new Chart(ctx, { type: 'line', data: { labels, datasets }, options: {...} });
```

## ローカルでのデバッグ手順
### 1. 当日分のサンプルJSONを作る
```bash
python3 /Users/nakamurashinnosuke/Documents/GitHub/agyancast/scripts/plot_daily_delay.py --date 2026-02-14 --mode hourly
```

### 2. サンプルを `web/data/` に配置
```bash
cp /Users/nakamurashinnosuke/Documents/GitHub/agyancast/samples/daily_delay/daily_delay_2026-02-14_hourly.json \
  /Users/nakamurashinnosuke/Documents/GitHub/agyancast/web/data/daily_delay.json
```

### 3. ローカルサーバを起動
```bash
cd /Users/nakamurashinnosuke/Documents/GitHub/agyancast/web
python3 -m http.server 8000
```

### 4. ブラウザで確認
```
http://localhost:8000
```

## 備考
- `latest.json` / `latest_detail.json` は既存表示で利用中。
- グラフ表示は **当日分のみ** でOK。
- フロントは **静的HTML/JS** のまま維持する方針。
