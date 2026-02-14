# フロント対応要件: サンリブシティくまなん追加

## 目的
- 新モール **「サンリブシティくまなん」** をフロント表示・グラフ表示に反映する。

## 背景
- `spots.csv` に以下の停留所を追加済み
  - 足原橋（toshibus: 100334_1 / 100334_2）
  - 平成町（toshibus: 100335_1 / 100335_2）
- これにより、バックエンド側の `places.json / latest.json / daily_delay.json` に新モールが出力される。

---

## フロント側で必要な対応

### 1. Fallbackデータの更新
`web/app.js` の fallback に新モールを追加する。

- `fallbackPlaces.places` に 1件追加
  - id/name: `サンリブシティくまなん`
  - x/y は仮値でOK（実データは `places.json` が上書きする）
- `fallbackLatest.statuses` に `サンリブシティくまなん: "unknown"` を追加
- `fallbackLatestDetail.malls` は空でも動作するが、必要ならキー追加可

### 2. 表示名（必要なら）
表示名を短くしたい場合は `nameOverrides` に追加する。
- 例: `"サンリブシティくまなん": "サンリブくまなん"`

### 3. グラフ表示
- `daily_delay.json` の `series` に新モールが入るので、
  **既存ロジックで自動的に線が追加される**想定。
- 線が増えるため、凡例や色パレットの視認性を確認。

### 4. レイアウト確認
- モール数が増えるため、吹き出し同士の干渉が起きる可能性あり。
- 必要なら以下の調整を検討:
  - `styles.css` の bubble 幅/間隔
  - `app.js` の `minGap` 値

---

## データ連携仕様（参考）

### Places
`web/data/places.json`
- `places[].id` に `サンリブシティくまなん` が追加される

### 混雑ステータス
`web/data/latest.json`
- `statuses["サンリブシティくまなん"]` が付与される

### 遅延詳細
`web/data/latest_detail.json`
- `malls["サンリブシティくまなん"].delay_sec` が付与される

### 日次推移
`web/data/daily_delay.json`
- `series["サンリブシティくまなん"]` が追加される

---

## ローカル確認手順

1. 最新データをS3から取得
```bash
aws s3 cp s3://agyancast-dev-web/data/places.json \
  web/data/places.json
aws s3 cp s3://agyancast-dev-web/data/latest.json \
  web/data/latest.json
aws s3 cp s3://agyancast-dev-web/data/latest_detail.json \
  web/data/latest_detail.json
aws s3 cp s3://agyancast-dev-web/data/daily_delay.json \
  web/data/daily_delay.json
```

2. ローカルサーバ起動
```bash
cd web
python3 -m http.server 8000
```

3. ブラウザで確認
```
http://localhost:8000
```

---

## 完了条件
- 地図上に「サンリブシティくまなん」の吹き出しが表示される
- 遅延表示が出る（`latest_detail.json` 由来）
- 日次グラフに新しい線が出る（`daily_delay.json` 由来）
