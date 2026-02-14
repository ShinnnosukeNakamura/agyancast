#!/usr/bin/env python3
import argparse
import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

try:
    from zoneinfo import ZoneInfo
except ImportError:
    print("Python 3.9+ required for zoneinfo", file=sys.stderr)
    raise

JST = ZoneInfo("Asia/Tokyo")


def run(cmd):
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def ensure_s3_data(bucket: str, date_str: str, work_dir: Path) -> Path:
    spots_path = work_dir / "spots.csv"
    bronze_dir = work_dir / "bronze" / f"dt={date_str}"
    bronze_dir.mkdir(parents=True, exist_ok=True)

    print(f"[info] syncing spots.csv from s3://{bucket}/master/spots.csv")
    run(["aws", "s3", "cp", f"s3://{bucket}/master/spots.csv", str(spots_path)])

    print(f"[info] syncing bronze from s3://{bucket}/bronze/dt={date_str}/")
    run(["aws", "s3", "sync", f"s3://{bucket}/bronze/dt={date_str}/", str(bronze_dir)])

    return spots_path


def load_spots(spots_path: Path):
    mapping = {}
    mall_names = set()
    with spots_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            company = row.get("company")
            stop_id = row.get("stop_id")
            mall_name = row.get("mall_name")
            if not company or not stop_id or not mall_name:
                continue
            key = f"{company}::{stop_id}"
            mapping[key] = mall_name
            mall_names.add(mall_name)
    return mapping, sorted(mall_names, key=lambda x: x)


def aggregate(bronze_dir: Path, date_str: str, stop_to_mall, bucket_minutes: int):
    buckets = {}
    files = list(bronze_dir.rglob("*.jsonl"))
    if not files:
        print(f"[warn] no bronze files under {bronze_dir}")
    for path in files:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                company = row.get("company")
                stop_id = row.get("stop_id")
                if not company or not stop_id:
                    continue
                key = f"{company}::{stop_id}"
                mall = stop_to_mall.get(key)
                if not mall:
                    continue
                event_time = row.get("event_time")
                delay_sec = row.get("delay_sec")
                if event_time is None or delay_sec is None:
                    continue
                try:
                    event_dt = parse_iso(event_time).astimezone(JST)
                except Exception:
                    continue
                if event_dt.strftime("%Y-%m-%d") != date_str:
                    continue
                event_dt = event_dt.replace(second=0, microsecond=0)
                minutes_of_day = event_dt.hour * 60 + event_dt.minute
                bucket_start_minute = (minutes_of_day // bucket_minutes) * bucket_minutes
                bucket_dt = event_dt.replace(hour=0, minute=0) + timedelta(minutes=bucket_start_minute)
                bucket_key = bucket_dt.isoformat()
                mall_bucket = buckets.setdefault(mall, {}).setdefault(bucket_key, [])
                try:
                    mall_bucket.append(float(delay_sec))
                except Exception:
                    continue
    return buckets


def build_rows(mall_names, buckets):
    rows = []
    series = {}
    for mall in mall_names:
        mall_points = []
        time_map = buckets.get(mall, {})
        sorted_times = sorted(time_map.keys())
        for time_key in sorted_times:
            values = time_map[time_key]
            if not values:
                continue
            med = median(values)
            event_dt = parse_iso(time_key).astimezone(JST)
            minutes_of_day = event_dt.hour * 60 + event_dt.minute
            row = {
                "mall_name": mall,
                "bucket_start": event_dt.isoformat(),
                "minute_of_day": minutes_of_day,
                "median_delay_sec": int(round(med)),
                "median_delay_min": round(med / 60, 2),
                "sample_count": len(values),
            }
            rows.append(row)
            mall_points.append({
                "x": minutes_of_day,
                "y": round(med / 60, 2),
                "t": event_dt.strftime("%Y-%m-%d %H:%M"),
            })
        series[mall] = mall_points
    return rows, series


def aggregate_hourly(bronze_dir: Path, date_str: str, stop_to_mall):
    buckets = {}
    files = list(bronze_dir.rglob("*.jsonl"))
    if not files:
        print(f"[warn] no bronze files under {bronze_dir}")
    for path in files:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                company = row.get("company")
                stop_id = row.get("stop_id")
                if not company or not stop_id:
                    continue
                key = f"{company}::{stop_id}"
                mall = stop_to_mall.get(key)
                if not mall:
                    continue
                event_time = row.get("event_time")
                delay_sec = row.get("delay_sec")
                if event_time is None or delay_sec is None:
                    continue
                try:
                    event_dt = parse_iso(event_time).astimezone(JST)
                except Exception:
                    continue
                if event_dt.strftime("%Y-%m-%d") != date_str:
                    continue
                hour = event_dt.strftime("%H")
                mall_bucket = buckets.setdefault(mall, {}).setdefault(hour, [])
                try:
                    mall_bucket.append(float(delay_sec))
                except Exception:
                    continue
    return buckets


def build_rows_hourly(mall_names, buckets):
    hours = [f"{h:02d}" for h in range(24)]
    rows = []
    series = {}
    for mall in mall_names:
        series_values = []
        for hour in hours:
            values = buckets.get(mall, {}).get(hour, [])
            if values:
                med = median(values)
                rows.append({
                    "mall_name": mall,
                    "hour": hour,
                    "median_delay_sec": int(round(med)),
                    "median_delay_min": round(med / 60, 2),
                    "sample_count": len(values),
                })
                series_values.append(round(med / 60, 2))
            else:
                rows.append({
                    "mall_name": mall,
                    "hour": hour,
                    "median_delay_sec": "",
                    "median_delay_min": "",
                    "sample_count": 0,
                })
                series_values.append(None)
        series[mall] = series_values
    return hours, rows, series


def write_csv(output_csv: Path, rows):
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "mall_name",
                "bucket_start",
                "minute_of_day",
                "median_delay_sec",
                "median_delay_min",
                "sample_count",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


def write_csv_hourly(output_csv: Path, rows):
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["mall_name", "hour", "median_delay_sec", "median_delay_min", "sample_count"],
        )
        writer.writeheader()
        writer.writerows(rows)


def write_json(output_json: Path, date_str: str, bucket_minutes: int, series):
    payload = {
        "date": date_str,
        "timezone": "Asia/Tokyo",
        "bucket_minutes": bucket_minutes,
        "series": series,
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_json_hourly(output_json: Path, date_str: str, hours, series):
    payload = {
        "date": date_str,
        "timezone": "Asia/Tokyo",
        "hours": hours,
        "series": series,
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_html(output_html: Path, date_str: str, bucket_minutes: int, series):
    datasets = []
    palette = [
        "#1db455",
        "#f1c842",
        "#e64a3b",
        "#0b4aa3",
        "#8f1f14",
        "#1664c8",
    ]
    for idx, (mall, values) in enumerate(series.items()):
        datasets.append({
            "label": mall,
            "data": values,
            "borderColor": palette[idx % len(palette)],
            "backgroundColor": palette[idx % len(palette)],
            "tension": 0.3,
            "spanGaps": True,
            "showLine": True,
            "pointRadius": 2,
            "pointHoverRadius": 4,
        })

    chart_payload = {
        "datasets": datasets,
    }

    html = f"""<!doctype html>
<html lang=\"ja\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>モール毎の遅延推移 ({date_str})</title>
    <script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script>
    <style>
      body {{ font-family: system-ui, sans-serif; margin: 24px; }}
      h1 {{ margin-bottom: 8px; }}
      .meta {{ color: #555; margin-bottom: 20px; }}
      .chart-wrap {{ max-width: 1100px; }}
    </style>
  </head>
  <body>
    <h1>モール毎の遅延推移</h1>
    <div class=\"meta\">対象日: {date_str} (JST) / 集計粒度: {bucket_minutes}分 / 指標: 遅延中央値(分)</div>
    <div class=\"chart-wrap\">
      <canvas id=\"chart\" height=\"120\"></canvas>
    </div>
    <script>
      const payload = {json.dumps(chart_payload, ensure_ascii=False)};
      const ctx = document.getElementById('chart');
      new Chart(ctx, {{
        type: 'scatter',
        data: payload,
        options: {{
          responsive: true,
          interaction: {{ mode: 'nearest', intersect: false }},
          plugins: {{
            tooltip: {{
              callbacks: {{
                title: (items) => items.length ? items[0].raw.t : '',
              }},
            }},
          }},
          scales: {{
            y: {{
              title: {{ display: true, text: '遅延(分)' }},
              beginAtZero: true,
            }},
            x: {{
              type: 'linear',
              title: {{ display: true, text: '時間帯' }},
              ticks: {{
                callback: (value) => {{
                  const hours = Math.floor(value / 60);
                  const minutes = value % 60;
                  return String(hours).padStart(2,'0') + ':' + String(minutes).padStart(2,'0');
                }},
              }},
            }},
          }},
        }},
      }});
    </script>
  </body>
</html>
"""
    output_html.parent.mkdir(parents=True, exist_ok=True)
    output_html.write_text(html, encoding="utf-8")


def write_html_hourly(output_html: Path, date_str: str, hours, series):
    datasets = []
    palette = [
        "#1db455",
        "#f1c842",
        "#e64a3b",
        "#0b4aa3",
        "#8f1f14",
        "#1664c8",
    ]
    for idx, (mall, values) in enumerate(series.items()):
        datasets.append({
            "label": mall,
            "data": values,
            "borderColor": palette[idx % len(palette)],
            "backgroundColor": palette[idx % len(palette)],
            "tension": 0.3,
            "spanGaps": True,
        })

    chart_payload = {
        "labels": hours,
        "datasets": datasets,
    }

    html = f"""<!doctype html>
<html lang=\"ja\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>モール毎の遅延推移 ({date_str})</title>
    <script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script>
    <style>
      body {{ font-family: system-ui, sans-serif; margin: 24px; }}
      h1 {{ margin-bottom: 8px; }}
      .meta {{ color: #555; margin-bottom: 20px; }}
      .chart-wrap {{ max-width: 1100px; }}
    </style>
  </head>
  <body>
    <h1>モール毎の遅延推移</h1>
    <div class=\"meta\">対象日: {date_str} (JST) / 集計粒度: 1時間 / 指標: 遅延中央値(分)</div>
    <div class=\"chart-wrap\">
      <canvas id=\"chart\" height=\"120\"></canvas>
    </div>
    <script>
      const payload = {json.dumps(chart_payload, ensure_ascii=False)};
      const ctx = document.getElementById('chart');
      new Chart(ctx, {{
        type: 'line',
        data: payload,
        options: {{
          responsive: true,
          interaction: {{ mode: 'nearest', intersect: false }},
          scales: {{
            y: {{
              title: {{ display: true, text: '遅延(分)' }},
              beginAtZero: true,
            }},
            x: {{
              title: {{ display: true, text: '時間帯' }},
            }},
          }},
        }},
      }});
    </script>
  </body>
</html>
"""
    output_html.parent.mkdir(parents=True, exist_ok=True)
    output_html.write_text(html, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Plot daily mall delay trend from S3 bronze data")
    parser.add_argument("--date", help="YYYY-MM-DD in JST", required=False)
    parser.add_argument("--bucket", default=os.environ.get("AGYANCAST_DATA_BUCKET", "agyancast-dev-data"))
    parser.add_argument("--work-dir", default="samples/daily_delay")
    parser.add_argument("--bucket-minutes", type=int, default=30)
    parser.add_argument("--mode", choices=["bucket", "hourly"], default="bucket")
    args = parser.parse_args()

    if args.date:
        date_str = args.date
    else:
        now = datetime.now(tz=JST)
        date_str = now.strftime("%Y-%m-%d")

    work_dir = Path(args.work_dir).resolve()
    spots_path = ensure_s3_data(args.bucket, date_str, work_dir)

    stop_to_mall, mall_names = load_spots(spots_path)
    if not mall_names:
        print("[error] no malls found in spots.csv", file=sys.stderr)
        sys.exit(1)

    bronze_dir = work_dir / "bronze" / f"dt={date_str}"
    if args.mode == "hourly":
        buckets = aggregate_hourly(bronze_dir, date_str, stop_to_mall)
        hours, rows, series = build_rows_hourly(mall_names, buckets)
        suffix = "_hourly"
        output_csv = work_dir / f"daily_delay_{date_str}{suffix}.csv"
        output_json = work_dir / f"daily_delay_{date_str}{suffix}.json"
        output_html = work_dir / f"daily_delay_{date_str}{suffix}.html"
        write_csv_hourly(output_csv, rows)
        write_json_hourly(output_json, date_str, hours, series)
        write_html_hourly(output_html, date_str, hours, series)
    else:
        buckets = aggregate(bronze_dir, date_str, stop_to_mall, args.bucket_minutes)
        rows, series = build_rows(mall_names, buckets)
        output_csv = work_dir / f"daily_delay_{date_str}.csv"
        output_json = work_dir / f"daily_delay_{date_str}.json"
        output_html = work_dir / f"daily_delay_{date_str}.html"
        write_csv(output_csv, rows)
        write_json(output_json, date_str, args.bucket_minutes, series)
        write_html(output_html, date_str, args.bucket_minutes, series)

    print(f"[ok] csv: {output_csv}")
    print(f"[ok] json: {output_json}")
    print(f"[ok] html: {output_html}")


if __name__ == "__main__":
    main()
