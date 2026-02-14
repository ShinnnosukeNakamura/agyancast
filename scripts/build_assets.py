#!/usr/bin/env python3
import csv
import json
import math
import ssl
import sys
import time
from pathlib import Path
from urllib import request
import xml.etree.ElementTree as ET

BASE_DIR = Path(__file__).resolve().parents[1]
SPOTS_PATH = BASE_DIR / "spots.csv"
WEB_DIR = BASE_DIR / "web"
ASSETS_DIR = WEB_DIR / "assets"
DATA_DIR = WEB_DIR / "data"

WIDTH = 1600
HEIGHT = 900

ROAD_TYPES = ["motorway", "trunk", "primary"]
WATERWAY_TYPES = ["river"]
RIVER_NAMES = {"白川"}
MALL_COORD_OVERRIDES = {
    "ゆめタウン浜線": (32.7715579, 130.7265314),
}
RAIL_TYPES = ["rail", "light_rail", "subway"]


def read_spots(exclude_malls=None):
    exclude_malls = exclude_malls or set()
    malls = {}
    lats = []
    lons = []
    with SPOTS_PATH.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("mall_name", "").strip()
            if name in exclude_malls:
                continue
            if not name:
                continue
            try:
                lat = float(row.get("stop_lat", ""))
                lon = float(row.get("stop_lon", ""))
            except ValueError:
                continue
            malls.setdefault(name, []).append((lat, lon))
            lats.append(lat)
            lons.append(lon)
    # Ensure overridden mall coordinates are included in bounds.
    for name, (lat, lon) in MALL_COORD_OVERRIDES.items():
        if name in exclude_malls:
            continue
        lats.append(lat)
        lons.append(lon)
    if not lats or not lons:
        raise SystemExit("No coordinates found in spots.csv")
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    lat_range = max_lat - min_lat
    lon_range = max_lon - min_lon
    # Add padding for visual breathing room
    # Wider padding for a slightly higher, more pulled-back view.
    lat_pad = max(0.035, lat_range * 0.4)
    lon_pad = max(0.05, lon_range * 0.4)
    bounds = {
        "min_lat": min_lat - lat_pad,
        "max_lat": max_lat + lat_pad,
        "min_lon": min_lon - lon_pad,
        "max_lon": max_lon + lon_pad,
    }
    return malls, bounds


def overpass_fetch(bounds):
    bbox = f"{bounds['min_lat']},{bounds['min_lon']},{bounds['max_lat']},{bounds['max_lon']}"
    query = f"""
    [out:xml][timeout:50];
    (
      way["highway"~"motorway|trunk|primary"]({bbox});
      way["waterway"~"river"]["name"~"^白川$"]({bbox});
      way["natural"="water"]({bbox});
      way["railway"~"rail|light_rail|subway"]({bbox});
      way["leisure"="park"]({bbox});
      node["name"="熊本城"]({bbox});
      way["name"="熊本城"]({bbox});
    );
    (._;>;);
    out body;
    """
    data = query.encode("utf-8")
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.nchc.org.tw/api/interpreter",
    ]
    # Some environments lack cert bundles; relax verification to keep asset generation working.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    last_error = None
    for endpoint in endpoints:
        req = request.Request(
            endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=60, context=ctx) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001 - best-effort fallback
            last_error = exc
            continue
    raise SystemExit(f"Overpass fetch failed: {last_error}")


def parse_osm(xml_bytes):
    root = ET.fromstring(xml_bytes)
    nodes = {}
    for node in root.findall("node"):
        node_id = node.get("id")
        lat = node.get("lat")
        lon = node.get("lon")
        if node_id and lat and lon:
            nodes[node_id] = (float(lat), float(lon))
    ways = []
    for way in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        node_refs = [nd.get("ref") for nd in way.findall("nd")]
        coords = [nodes[r] for r in node_refs if r in nodes]
        if len(coords) < 2:
            continue
        ways.append((tags, coords))
    # Landmark nodes
    landmarks = []
    for node in root.findall("node"):
        tags = {t.get("k"): t.get("v") for t in node.findall("tag")}
        if tags.get("name") == "熊本城":
            lat = float(node.get("lat"))
            lon = float(node.get("lon"))
            landmarks.append({"name": "熊本城", "lat": lat, "lon": lon})
    # Deduplicate landmarks by name (OSM can return node + way)
    if landmarks:
        agg = {}
        for lm in landmarks:
            entry = agg.setdefault(lm["name"], {"lat": 0.0, "lon": 0.0, "count": 0})
            entry["lat"] += lm["lat"]
            entry["lon"] += lm["lon"]
            entry["count"] += 1
        landmarks = [
            {"name": name, "lat": v["lat"] / v["count"], "lon": v["lon"] / v["count"]}
            for name, v in agg.items()
        ]
    return nodes, ways, landmarks


def to_xy(lat, lon, bounds):
    x = (lon - bounds["min_lon"]) / (bounds["max_lon"] - bounds["min_lon"]) * WIDTH
    y = (bounds["max_lat"] - lat) / (bounds["max_lat"] - bounds["min_lat"]) * HEIGHT
    return x, y


def dist_point_to_segment(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    proj = (ax + t * dx, ay + t * dy)
    return math.hypot(px - proj[0], py - proj[1])


def rdp(points, epsilon):
    if len(points) < 3:
        return points
    a = points[0]
    b = points[-1]
    max_dist = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        d = dist_point_to_segment(points[i], a, b)
        if d > max_dist:
            max_dist = d
            index = i
    if max_dist > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [a, b]


def path_from_points(points, close=False):
    if len(points) < 2:
        return ""
    d = [f"M {points[0][0]:.1f} {points[0][1]:.1f}"]
    for x, y in points[1:]:
        d.append(f"L {x:.1f} {y:.1f}")
    if close:
        d.append("Z")
    return " ".join(d)


def build_svg(ways, landmarks, bounds):
    roads = {k: [] for k in ROAD_TYPES}
    water = []
    rail = []
    parks = []
    water_polys = []

    for tags, coords in ways:
        if "highway" in tags and tags["highway"] in roads:
            roads[tags["highway"]].append(coords)
            continue
        if tags.get("waterway") in WATERWAY_TYPES and tags.get("name") in RIVER_NAMES:
            water.append(coords)
            continue
        if tags.get("railway") in RAIL_TYPES:
            rail.append(coords)
            continue
        if tags.get("leisure") == "park":
            parks.append(coords)
            continue
        if tags.get("natural") == "water":
            water_polys.append(coords)
            continue

    # Convert to SVG paths
    svg_parts = []
    svg_parts.append(f"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {WIDTH} {HEIGHT}\">\n")
    svg_parts.append("<defs>\n")
    svg_parts.append(
        "<linearGradient id=\"paperGradient\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n"
        "  <stop offset=\"0%\" stop-color=\"#efe6d8\"/>\n"
        "  <stop offset=\"100%\" stop-color=\"#e4dccd\"/>\n"
        "</linearGradient>\n"
    )
    svg_parts.append(
        "<pattern id=\"paperNoise\" width=\"80\" height=\"80\" patternUnits=\"userSpaceOnUse\">\n"
        "  <rect width=\"80\" height=\"80\" fill=\"url(#paperGradient)\"/>\n"
        "  <circle cx=\"12\" cy=\"18\" r=\"1.2\" fill=\"#d9cfbf\" opacity=\"0.6\"/>\n"
        "  <circle cx=\"46\" cy=\"32\" r=\"1.1\" fill=\"#d2c6b3\" opacity=\"0.5\"/>\n"
        "  <circle cx=\"70\" cy=\"12\" r=\"0.9\" fill=\"#d9cfbf\" opacity=\"0.4\"/>\n"
        "  <circle cx=\"24\" cy=\"64\" r=\"1.3\" fill=\"#d2c6b3\" opacity=\"0.5\"/>\n"
        "</pattern>\n"
    )
    svg_parts.append("</defs>\n")

    svg_parts.append(f"<rect width=\"{WIDTH}\" height=\"{HEIGHT}\" fill=\"url(#paperNoise)\"/>\n")

    # Soft green blobs
    svg_parts.append("<g opacity=\"0.4\">\n")
    svg_parts.append("<path d=\"M 0 0 L 350 0 L 300 220 L 0 200 Z\" fill=\"#cfe3b0\"/>\n")
    svg_parts.append("<path d=\"M 1300 0 L 1600 0 L 1600 280 L 1320 230 Z\" fill=\"#c5ddb0\"/>\n")
    svg_parts.append("<path d=\"M 0 650 L 220 600 L 320 900 L 0 900 Z\" fill=\"#cfe3b0\"/>\n")
    svg_parts.append("<path d=\"M 1200 620 L 1600 600 L 1600 900 L 1200 900 Z\" fill=\"#c5ddb0\"/>\n")
    svg_parts.append("</g>\n")

    # Parks
    if parks:
        svg_parts.append("<g fill=\"#b7d8a7\" opacity=\"0.55\">\n")
        for coords in parks:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 2.0)
            if len(pts) < 3:
                continue
            d = path_from_points(pts, close=True)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")

    # Water polygons (lakes) faint
    if water_polys:
        svg_parts.append("<g fill=\"#9ec9e6\" opacity=\"0.45\">\n")
        for coords in water_polys:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 2.5)
            if len(pts) < 3:
                continue
            d = path_from_points(pts, close=True)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")

    # Waterways
    if water:
        svg_parts.append("<g fill=\"none\" stroke=\"#5aa2d6\" stroke-width=\"6\" opacity=\"0.85\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n")
        for coords in water:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 2.0)
            d = path_from_points(pts)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")
        svg_parts.append("<g fill=\"none\" stroke=\"#3d7fb1\" stroke-width=\"2\" opacity=\"0.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n")
        for coords in water:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 2.0)
            d = path_from_points(pts)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")

    # Roads
    road_styles = {
        "motorway": (12, "#f4bf45", "#d59a2f"),
        "trunk": (10, "#f4bf45", "#d59a2f"),
        "primary": (8, "#f2c75b", "#d4a64a"),
    }
    for road_type, (w, fill, outline) in road_styles.items():
        if not roads[road_type]:
            continue
        # outline
        svg_parts.append(
            f"<g fill=\"none\" stroke=\"{outline}\" stroke-width=\"{w + 2}\" opacity=\"0.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n"
        )
        for coords in roads[road_type]:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 1.5)
            d = path_from_points(pts)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")
        # fill
        svg_parts.append(
            f"<g fill=\"none\" stroke=\"{fill}\" stroke-width=\"{w}\" opacity=\"0.95\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n"
        )
        for coords in roads[road_type]:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 1.5)
            d = path_from_points(pts)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")

    # Rail
    if rail:
        svg_parts.append("<g fill=\"none\" stroke=\"#6b6b6b\" stroke-width=\"3\" opacity=\"0.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"6 6\">\n")
        for coords in rail:
            pts = [to_xy(lat, lon, bounds) for lat, lon in coords]
            pts = rdp(pts, 1.5)
            d = path_from_points(pts)
            if d:
                svg_parts.append(f"<path d=\"{d}\"/>\n")
        svg_parts.append("</g>\n")

    # Landmark label
    if landmarks:
        for lm in landmarks:
            x, y = to_xy(lm["lat"], lm["lon"], bounds)
            svg_parts.append(
                f"<g font-family=\"'Zen Kaku Gothic New', sans-serif\" font-size=\"28\" fill=\"#2f2f2f\" text-anchor=\"middle\">\n"
                f"  <text x=\"{x:.1f}\" y=\"{y:.1f}\">{lm['name']}</text>\n"
                f"</g>\n"
            )

    svg_parts.append("</svg>\n")
    return "".join(svg_parts)


def build_places(malls, bounds):
    places = []
    for name, coords in malls.items():
        if name in MALL_COORD_OVERRIDES:
            avg_lat, avg_lon = MALL_COORD_OVERRIDES[name]
        else:
            avg_lat = sum(c[0] for c in coords) / len(coords)
            avg_lon = sum(c[1] for c in coords) / len(coords)
        x, y = to_xy(avg_lat, avg_lon, bounds)
        places.append(
            {
                "id": slugify(name),
                "name": name,
                "lat": avg_lat,
                "lon": avg_lon,
                "x": round(x / WIDTH * 100, 2),
                "y": round(y / HEIGHT * 100, 2),
            }
        )
    # stable order by name
    places.sort(key=lambda p: p["name"])
    return places


def slugify(text):
    return (
        text.replace(" ", "")
        .replace("　", "")
        .replace("/", "-")
        .replace("・", "-")
    )


def main():
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    malls, bounds = read_spots(exclude_malls={"ゆめタウン光の森"})
    print("bounds", bounds)

    print("fetching OSM from Overpass...")
    xml_bytes = overpass_fetch(bounds)
    nodes, ways, landmarks = parse_osm(xml_bytes)
    print(f"nodes {len(nodes)}, ways {len(ways)}, landmarks {len(landmarks)}")

    svg = build_svg(ways, landmarks, bounds)
    (ASSETS_DIR / "kumamoto_map.svg").write_text(svg, encoding="utf-8")

    places = build_places(malls, bounds)
    data = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "bounds": bounds,
        "places": places,
    }
    (DATA_DIR / "places.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # sample latest.json
    sample_status = ["low", "medium", "high"]
    latest = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "statuses": {p["id"]: sample_status[i % 3] for i, p in enumerate(places)},
    }
    (DATA_DIR / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
