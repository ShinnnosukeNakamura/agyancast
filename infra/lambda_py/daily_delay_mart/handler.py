import csv
import json
import os
from datetime import datetime
from io import BytesIO
from statistics import median

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from zoneinfo import ZoneInfo

s3 = boto3.client("s3")

DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
BRONZE_PREFIX = os.environ.get("BRONZE_PREFIX", "bronze/")
SILVER_PREFIX = os.environ.get("SILVER_PREFIX", "silver/")
MASTER_SPOTS_KEY = os.environ.get("MASTER_SPOTS_KEY", "master/spots.csv")
WEB_BUCKET = os.environ.get("WEB_BUCKET", "")
TIMEZONE = os.environ.get("TIMEZONE", "Asia/Tokyo")
TARGET_DATE = os.environ.get("TARGET_DATE", "")

JST = ZoneInfo(TIMEZONE)


def parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def get_target_date() -> str:
    if TARGET_DATE:
        return TARGET_DATE
    now = datetime.now(tz=JST)
    return now.strftime("%Y-%m-%d")


def list_hour_prefixes(dt: str):
    prefixes = set()
    prefix = f"{BRONZE_PREFIX}dt={dt}/"
    continuation = None
    while True:
        params = {"Bucket": DATA_BUCKET, "Prefix": prefix, "Delimiter": "/"}
        if continuation:
            params["ContinuationToken"] = continuation
        resp = s3.list_objects_v2(**params)
        for cp in resp.get("CommonPrefixes", []):
            prefixes.add(cp.get("Prefix"))
        if not resp.get("IsTruncated"):
            break
        continuation = resp.get("NextContinuationToken")
    return sorted(p for p in prefixes if p)


def list_objects(prefix: str):
    keys = []
    continuation = None
    while True:
        params = {"Bucket": DATA_BUCKET, "Prefix": prefix}
        if continuation:
            params["ContinuationToken"] = continuation
        resp = s3.list_objects_v2(**params)
        for item in resp.get("Contents", []):
            key = item.get("Key")
            if key:
                keys.append(key)
        if not resp.get("IsTruncated"):
            break
        continuation = resp.get("NextContinuationToken")
    return keys


def clear_prefix(prefix: str):
    keys = list_objects(prefix)
    if not keys:
        return
    for i in range(0, len(keys), 1000):
        batch = keys[i : i + 1000]
        s3.delete_objects(
            Bucket=DATA_BUCKET,
            Delete={"Objects": [{"Key": key} for key in batch]},
        )


def load_spots():
    obj = s3.get_object(Bucket=DATA_BUCKET, Key=MASTER_SPOTS_KEY)
    body = obj["Body"].read().decode("utf-8")
    reader = csv.DictReader(body.splitlines())
    stop_to_mall = {}
    mall_names = set()
    for row in reader:
        company = row.get("company")
        stop_id = row.get("stop_id")
        mall_name = row.get("mall_name")
        if not company or not stop_id or not mall_name:
            continue
        key = f"{company}::{stop_id}"
        stop_to_mall[key] = mall_name
        mall_names.add(mall_name)
    return stop_to_mall, sorted(mall_names, key=lambda x: x)


def collect_delays(dt: str, stop_to_mall):
    by_hour = {}
    hour_prefixes = list_hour_prefixes(dt)
    for hour_prefix in hour_prefixes:
        keys = list_objects(hour_prefix)
        for key in keys:
            if not key.endswith(".jsonl"):
                continue
            obj = s3.get_object(Bucket=DATA_BUCKET, Key=key)
            payload = obj["Body"].read().decode("utf-8")
            for line in payload.splitlines():
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
                mall = stop_to_mall.get(f"{company}::{stop_id}")
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
                if event_dt.strftime("%Y-%m-%d") != dt:
                    continue
                hour = event_dt.strftime("%H")
                by_hour.setdefault(hour, {}).setdefault(mall, []).append(float(delay_sec))
    return by_hour


def build_hourly_stats(by_hour):
    stats = {}
    for hour, malls in by_hour.items():
        hour_stats = {}
        for mall, delays in malls.items():
            if not delays:
                continue
            hour_stats[mall] = {
                "median_delay_sec": int(round(median(delays))),
                "sample_count": len(delays),
            }
        if hour_stats:
            stats[hour] = hour_stats
    return stats


def write_parquet_day(dt: str, rows):
    if not rows:
        return
    prefix = f"{SILVER_PREFIX}mart/daily_delay/dt={dt}/"
    clear_prefix(prefix)
    table = pa.Table.from_pylist(
        rows,
        schema=pa.schema(
            [
                ("hour", pa.string()),
                ("mall_name", pa.string()),
                ("median_delay_sec", pa.int64()),
                ("sample_count", pa.int64()),
                ("generated_at", pa.string()),
            ]
        ),
    )
    buf = BytesIO()
    pq.write_table(table, buf, compression="snappy")
    key = f"{prefix}part-{dt}.parquet"
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=key,
        Body=buf.getvalue(),
        ContentType="application/octet-stream",
    )


def build_daily_json(dt: str, mall_names, stats):
    hours = [f"{h:02d}" for h in range(24)]
    series = {}
    for mall in mall_names:
        values = [None] * 24
        for hour, malls in stats.items():
            if mall not in malls:
                continue
            idx = int(hour)
            values[idx] = round(malls[mall]["median_delay_sec"] / 60, 2)
        series[mall] = values
    return {
        "date": dt,
        "timezone": TIMEZONE,
        "hours": hours,
        "series": series,
    }


def handler(event, context):
    if not DATA_BUCKET:
        raise ValueError("DATA_BUCKET is required")

    dt = get_target_date()
    stop_to_mall, mall_names = load_spots()
    by_hour = collect_delays(dt, stop_to_mall)
    stats = build_hourly_stats(by_hour)

    generated_at = datetime.now(tz=JST).isoformat()

    rows = []
    for hour, malls in stats.items():
        for mall, values in malls.items():
            rows.append(
                {
                    "hour": hour,
                    "mall_name": mall,
                    "median_delay_sec": values["median_delay_sec"],
                    "sample_count": values["sample_count"],
                    "generated_at": generated_at,
                }
            )
    write_parquet_day(dt, rows)

    if WEB_BUCKET:
        daily_json = build_daily_json(dt, mall_names, stats)
        s3.put_object(
            Bucket=WEB_BUCKET,
            Key="data/daily_delay.json",
            Body=json.dumps(daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache, no-store, must-revalidate",
        )

    return {
        "date": dt,
        "hours": sorted(stats.keys()),
        "malls": len(mall_names),
    }
