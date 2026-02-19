import csv
import json
import os
import re
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
VISITOR_AIRPORT_ROUTE_ID = "aso_airport_limousine"
VISITOR_AIRPORT_ROUTE_NAME = "阿蘇くまもと空港リムジンバス"
VISITOR_AIRPORT_COMPANY = "sankobus"
VISITOR_AIRPORT_STOP_IDS = {"102112_1", "102112_3", "102112_4", "102112_5"}
VISITOR_AIRPORT_TO_AIRPORT_ROUTE_PATTERNS = [
    re.compile(r"^721_721040_"),
    re.compile(r"^721_721050_"),
    re.compile(r"^721_721060_"),
    re.compile(r"^721_721070_"),
]
VISITOR_AIRPORT_FROM_AIRPORT_ROUTE_PATTERNS = [
    re.compile(r"^721_721041_"),
    re.compile(r"^721_721051_"),
    re.compile(r"^721_721061_"),
    re.compile(r"^721_721071_"),
]
VISITOR_AIRPORT_STOPS_BY_DIRECTION = {
    "to_airport": [
        {"stop_id": "100002_6", "stop_name": "熊本桜町バスターミナル(6番のりば)"},
        {"stop_id": "100003_2", "stop_name": "通町筋"},
        {"stop_id": "100715_2", "stop_name": "味噌天神"},
        {"stop_id": "100572_2", "stop_name": "水前寺公園前"},
        {"stop_id": "100183_2", "stop_name": "熊本県庁前"},
        {"stop_id": "102664_2", "stop_name": "自衛隊前"},
        {"stop_id": "103922_2", "stop_name": "東町中央"},
        {"stop_id": "104244_2", "stop_name": "益城インター口 P"},
        {"stop_id": "102177_2", "stop_name": "グランメッセ前"},
        {"stop_id": "103333_2", "stop_name": "臨空テクノパーク西"},
        {"stop_id": "103319_2", "stop_name": "臨空テクノパーク東"},
        {"stop_id": "102112_1", "stop_name": "阿蘇くまもと空港(乗車：4番のりば　※特快バスは3番のりば)"},
    ],
    "from_airport": [
        {"stop_id": "102112_4", "stop_name": "阿蘇くまもと空港(降車：4番のりば)"},
        {"stop_id": "103319_1", "stop_name": "臨空テクノパーク東"},
        {"stop_id": "103333_1", "stop_name": "臨空テクノパーク西"},
        {"stop_id": "102177_1", "stop_name": "グランメッセ前"},
        {"stop_id": "104244_1", "stop_name": "益城インター口 P"},
        {"stop_id": "103922_1", "stop_name": "東町中央"},
        {"stop_id": "102664_1", "stop_name": "自衛隊前"},
        {"stop_id": "100183_1", "stop_name": "熊本県庁前"},
        {"stop_id": "100572_1", "stop_name": "水前寺公園前"},
        {"stop_id": "100715_1", "stop_name": "味噌天神"},
        {"stop_id": "100003_1", "stop_name": "通町筋"},
        {"stop_id": "100002_9", "stop_name": "熊本桜町バスターミナル(9番のりば)"},
    ],
}
VISITOR_AIRPORT_STOP_ID_SET_BY_DIRECTION = {
    direction: {stop["stop_id"] for stop in stops}
    for direction, stops in VISITOR_AIRPORT_STOPS_BY_DIRECTION.items()
}
COMMUTE_SEMICON_AREA_ID = "semicon_techno_park"
COMMUTE_SEMICON_AREA_NAME = "セミコンテクノパーク周辺"
COMMUTE_SEMICON_STOPS = [
    {
        "operator": "dentetsu",
        "stop_id": "100880_1",
        "stop_name": "県立技術短期大学前",
        "lat": 32.887573,
        "lon": 130.83466,
    },
    {
        "operator": "sankobus",
        "stop_id": "100880_1",
        "stop_name": "県立技術短期大学前",
        "lat": 32.887573,
        "lon": 130.83466,
    },
]
COMMUTE_SEMICON_STOP_KEYS = {
    f"{stop['operator']}::{stop['stop_id']}" for stop in COMMUTE_SEMICON_STOPS
}
COMMUTE_SECTION_NAME = "原水駅北口→県立技術短期大学前"
COMMUTE_SECTION_FROM_STOP_ID = "100879_1"
COMMUTE_SECTION_TO_STOP_ID = "100880_1"
COMMUTE_SECTION_DISTANCE_KM = 2.4
COMMUTE_TRAFFIC_MIN_SAMPLES = 3
COMMUTE_TRAFFIC_CONGESTED_KMH = 15
COMMUTE_TRAFFIC_VERY_CONGESTED_KMH = 8


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
    visitor_by_hour = {}
    visitor_stops_by_hour = {"to_airport": {}, "from_airport": {}}
    commute_by_hour = {}
    commute_speed_by_hour = {}

    def detect_visitor_direction(route_id: str):
        if any(pattern.match(route_id) for pattern in VISITOR_AIRPORT_TO_AIRPORT_ROUTE_PATTERNS):
            return "to_airport"
        if any(pattern.match(route_id) for pattern in VISITOR_AIRPORT_FROM_AIRPORT_ROUTE_PATTERNS):
            return "from_airport"
        return None

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
                event_time = row.get("event_time")
                if not company or event_time is None:
                    continue
                try:
                    event_dt = parse_iso(event_time).astimezone(JST)
                except Exception:
                    continue
                if event_dt.strftime("%Y-%m-%d") != dt:
                    continue
                hour = event_dt.strftime("%H")
                if row.get("feed_type") == "commute_section_speed":
                    try:
                        speed = float(row.get("avg_speed_kmh"))
                    except (TypeError, ValueError):
                        speed = None
                    if speed is not None and speed > 0:
                        commute_speed_by_hour.setdefault(hour, []).append(speed)
                    continue

                stop_id = row.get("stop_id")
                delay_sec = row.get("delay_sec")
                if not stop_id or delay_sec is None:
                    continue
                route_id = row.get("route_id")
                commute_key = f"{company}::{stop_id}"
                if commute_key in COMMUTE_SEMICON_STOP_KEYS:
                    commute_by_hour.setdefault(hour, {}).setdefault(commute_key, []).append(
                        float(delay_sec)
                    )
                if company == VISITOR_AIRPORT_COMPANY and isinstance(route_id, str):
                    direction = detect_visitor_direction(route_id)
                    if direction:
                        if direction == "to_airport" and stop_id in VISITOR_AIRPORT_STOP_IDS:
                            visitor_by_hour.setdefault(hour, []).append(float(delay_sec))
                        if stop_id in VISITOR_AIRPORT_STOP_ID_SET_BY_DIRECTION[direction]:
                            visitor_stops_by_hour.setdefault(direction, {}).setdefault(hour, {}).setdefault(
                                stop_id, []
                            ).append(float(delay_sec))
                mall = stop_to_mall.get(f"{company}::{stop_id}")
                if not mall:
                    continue
                by_hour.setdefault(hour, {}).setdefault(mall, []).append(float(delay_sec))
    return by_hour, visitor_by_hour, visitor_stops_by_hour, commute_by_hour, commute_speed_by_hour


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


def build_visitor_daily_json(dt: str, visitor_by_hour):
    hours = [f"{h:02d}" for h in range(24)]
    delay_min = [None] * 24
    for hour, delays in visitor_by_hour.items():
        if not delays:
            continue
        idx = int(hour)
        delay_min[idx] = round(median(delays) / 60, 2)
    return {
        "date": dt,
        "timezone": TIMEZONE,
        "route_id": VISITOR_AIRPORT_ROUTE_ID,
        "route_name": VISITOR_AIRPORT_ROUTE_NAME,
        "hours": hours,
        "delay_min": delay_min,
    }


def build_visitor_stops_daily_json(dt: str, visitor_stops_by_hour):
    hours = [f"{h:02d}" for h in range(24)]

    def build_direction_payload(direction_key: str, label: str):
        hour_map = visitor_stops_by_hour.get(direction_key, {})
        stops = []
        for stop in VISITOR_AIRPORT_STOPS_BY_DIRECTION[direction_key]:
            values = [None] * 24
            for hour, by_stop in hour_map.items():
                delays = by_stop.get(stop["stop_id"])
                if not delays:
                    continue
                idx = int(hour)
                values[idx] = round(median(delays) / 60, 2)
            stops.append(
                {
                    "stop_id": stop["stop_id"],
                    "stop_name": stop["stop_name"],
                    "delay_min": values,
                }
            )
        return {"label": label, "stops": stops}

    return {
        "date": dt,
        "timezone": TIMEZONE,
        "route_id": VISITOR_AIRPORT_ROUTE_ID,
        "route_name": VISITOR_AIRPORT_ROUTE_NAME,
        "hours": hours,
        "directions": {
            "to_airport": build_direction_payload("to_airport", "空港行き"),
            "from_airport": build_direction_payload("from_airport", "市内行き"),
        },
    }


def build_commute_traffic_status(speed_kmh: float, sample_count: int):
    if sample_count < COMMUTE_TRAFFIC_MIN_SAMPLES:
        return "unknown"
    if speed_kmh <= COMMUTE_TRAFFIC_VERY_CONGESTED_KMH:
        return "very_congested"
    if speed_kmh <= COMMUTE_TRAFFIC_CONGESTED_KMH:
        return "congested"
    return "smooth"


def build_commute_daily_json(dt: str, commute_by_hour, commute_speed_by_hour):
    hours = [f"{h:02d}" for h in range(24)]
    stops = []
    for stop in COMMUTE_SEMICON_STOPS:
        values = [None] * 24
        stop_key = f"{stop['operator']}::{stop['stop_id']}"
        for hour, by_stop in commute_by_hour.items():
            delays = by_stop.get(stop_key)
            if not delays:
                continue
            idx = int(hour)
            values[idx] = round(median(delays) / 60, 2)
        stops.append(
            {
                "operator": stop["operator"],
                "stop_id": stop["stop_id"],
                "stop_name": stop["stop_name"],
                "lat": stop["lat"],
                "lon": stop["lon"],
                "delay_min": values,
            }
        )

    delay_points = []
    for hour in sorted(commute_by_hour.keys()):
        hour_delays = []
        for delays in commute_by_hour.get(hour, {}).values():
            hour_delays.extend(delays)
        if not hour_delays:
            continue
        delay_points.append(
            {
                "hour": hour,
                "delay_min": round(median(hour_delays) / 60, 2),
                "sample_count": len(hour_delays),
            }
        )

    speed_points = []
    for hour in sorted(commute_speed_by_hour.keys()):
        hour_speeds = commute_speed_by_hour.get(hour, [])
        if not hour_speeds:
            continue
        speed_kmh = round(median(hour_speeds), 1)
        sample_count = len(hour_speeds)
        speed_points.append(
            {
                "hour": hour,
                "avg_speed_kmh": speed_kmh,
                "status": build_commute_traffic_status(speed_kmh, sample_count),
                "sample_count": sample_count,
            }
        )

    return {
        "date": dt,
        "timezone": TIMEZONE,
        "area_id": COMMUTE_SEMICON_AREA_ID,
        "area_name": COMMUTE_SEMICON_AREA_NAME,
        "hours": hours,
        "stops": stops,
        "delay_points": delay_points,
        "traffic": {
            "section_name": COMMUTE_SECTION_NAME,
            "from_stop_id": COMMUTE_SECTION_FROM_STOP_ID,
            "to_stop_id": COMMUTE_SECTION_TO_STOP_ID,
            "distance_km": COMMUTE_SECTION_DISTANCE_KM,
            "thresholds": {
                "congested_kmh": COMMUTE_TRAFFIC_CONGESTED_KMH,
                "very_congested_kmh": COMMUTE_TRAFFIC_VERY_CONGESTED_KMH,
                "min_samples": COMMUTE_TRAFFIC_MIN_SAMPLES,
            },
            "speed_points": speed_points,
        },
    }


def handler(event, context):
    if not DATA_BUCKET:
        raise ValueError("DATA_BUCKET is required")

    dt = get_target_date()
    stop_to_mall, mall_names = load_spots()
    by_hour, visitor_by_hour, visitor_stops_by_hour, commute_by_hour, commute_speed_by_hour = collect_delays(
        dt, stop_to_mall
    )
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
    visitor_daily_json = build_visitor_daily_json(dt, visitor_by_hour)
    visitor_stops_daily_json = build_visitor_stops_daily_json(dt, visitor_stops_by_hour)
    commute_daily_json = build_commute_daily_json(dt, commute_by_hour, commute_speed_by_hour)
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=f"{SILVER_PREFIX}visitor/airport_daily.json",
        Body=json.dumps(visitor_daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=f"{SILVER_PREFIX}visitor/airport_stops_daily.json",
        Body=json.dumps(visitor_stops_daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=f"{SILVER_PREFIX}commute/semicon_daily.json",
        Body=json.dumps(commute_daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
        ContentType="application/json",
    )

    if WEB_BUCKET:
        daily_json = build_daily_json(dt, mall_names, stats)
        s3.put_object(
            Bucket=WEB_BUCKET,
            Key="data/daily_delay.json",
            Body=json.dumps(daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache, no-store, must-revalidate",
        )
        s3.put_object(
            Bucket=WEB_BUCKET,
            Key="data/visitor_airport_daily.json",
            Body=json.dumps(visitor_daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache, no-store, must-revalidate",
        )
        s3.put_object(
            Bucket=WEB_BUCKET,
            Key="data/visitor_airport_stops_daily.json",
            Body=json.dumps(visitor_stops_daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache, no-store, must-revalidate",
        )
        s3.put_object(
            Bucket=WEB_BUCKET,
            Key="data/commute_semicon_daily.json",
            Body=json.dumps(commute_daily_json, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType="application/json",
            CacheControl="no-cache, no-store, must-revalidate",
        )

    return {
        "date": dt,
        "hours": sorted(stats.keys()),
        "malls": len(mall_names),
    }
