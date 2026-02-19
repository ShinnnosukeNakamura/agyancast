import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

const STATUS_META = {
  low: { label: "スイスイ", icon: "/assets/status-low.svg", color: "#1db455" },
  medium: { label: "普通", icon: "/assets/status-medium.svg", color: "#f1c842" },
  high: { label: "混雑", icon: "/assets/status-high.svg", color: "#e64a3b" },
  very_high: { label: "大混雑", icon: "/assets/status-very-high.svg", color: "#8f1f14" },
  unknown: { label: "データ不足", icon: "/assets/status-unknown.svg", color: "#9aa0a6" },
};

const VISITOR_STATUS_META = {
  on_time: { label: "平常運行", color: "#1db455" },
  slight_delay: { label: "やや遅れ", color: "#f1c842" },
  delayed: { label: "遅れあり", color: "#e64a3b" },
  suspended: { label: "見合わせ", color: "#8f1f14" },
  unknown: { label: "情報準備中", color: "#8d96a4" },
};

const COMMUTE_TRAFFIC_META = {
  smooth: { label: "順調", color: "#1db455" },
  congested: { label: "渋滞", color: "#e6a23c" },
  very_congested: { label: "大渋滞", color: "#e64a3b" },
  unknown: { label: "情報準備中", color: "#8d96a4" },
};

const NAME_OVERRIDES = {
  "アミュプラザくまもと": "アミュプラザ熊本",
  "サクラマチ": "サクラマチ熊本",
  "鶴屋百貨店": "鶴屋",
};

const MAP_BASE_WIDTH = 1600;
const MAP_BASE_HEIGHT = 900;
const MAP_BASE_SCALE = 0.95;

const MAP_POINT_OVERRIDES = {
  "鶴屋百貨店": { x: 47.2, y: 27.4 },
  "サクラマチ": { x: 41.2, y: 29.5 },
  "アミュプラザくまもと": { x: 33.0, y: 36.8 },
  "サンリブシティくまなん": { x: 41.9, y: 45.8 },
  "ゆめタウン浜線": { x: 56.3, y: 50.3 },
  "イオンモール熊本": { x: 67.1, y: 73.6 },
};

const bubbleLayoutOverrides = {
  "鶴屋百貨店": { side: "left", vertical: "top", anchorYPx: 133, edgeFactor: 1, gapX: 6 },
  "サクラマチ": { side: "left", vertical: "top", anchorYPx: 246, edgeFactor: 1, gapX: 6 },
  "アミュプラザくまもと": {
    side: "left",
    vertical: "bottom",
    layoutMode: "anchor",
    anchorOffsetY: 14,
  },
  "サンリブシティくまなん": {
    side: "left",
    vertical: "bottom",
    layoutMode: "anchor",
    anchorOffsetY: 18,
  },
};

const FALLBACK_PLACES = {
  places: [
    {
      id: "ゆめタウン浜線",
      name: "ゆめタウン浜線",
      lat: 32.7715579,
      lon: 130.7265314,
      x: 56.7,
      y: 49.69,
    },
    {
      id: "アミュプラザくまもと",
      name: "アミュプラザくまもと",
      lat: 32.790502470588244,
      lon: 130.68960294117647,
      x: 32.7,
      y: 35.53,
    },
    {
      id: "イオンモール熊本",
      name: "イオンモール熊本",
      lat: 32.739243,
      lon: 130.74315,
      x: 67.5,
      y: 73.84,
    },
    {
      id: "サクラマチ",
      name: "サクラマチ",
      lat: 32.80034588095238,
      lon: 130.7037511904762,
      x: 41.89,
      y: 28.17,
    },
    {
      id: "サンリブシティくまなん",
      name: "サンリブシティくまなん",
      lat: 32.77768775,
      lon: 130.7038,
      x: 41.92,
      y: 45.11,
    },
    {
      id: "鶴屋百貨店",
      name: "鶴屋百貨店",
      lat: 32.802500464285714,
      lon: 130.71279357142856,
      x: 47.77,
      y: 26.56,
    },
  ],
};

const FALLBACK_LATEST = {
  updated_at: "",
  statuses: {
    "ゆめタウン浜線": "unknown",
    "アミュプラザくまもと": "unknown",
    "イオンモール熊本": "unknown",
    "サクラマチ": "unknown",
    "サンリブシティくまなん": "unknown",
    "鶴屋百貨店": "unknown",
  },
};

const FALLBACK_LATEST_DETAIL = { updated_at: "", malls: {} };

const FALLBACK_VISITOR_LATEST = {
  updated_at: "",
  route_id: "aso_airport_limousine",
  route_name: "阿蘇くまもと空港リムジンバス",
  status: "unknown",
  delay_sec: null,
  note: "来訪向けデータ準備中",
  predictions: {
    h1_sec: null,
    h3_sec: null,
  },
};

const AIRPORT_STOPS_TO_AIRPORT = [
  { stop_id: "100002_6", stop_name: "熊本桜町バスターミナル(6番のりば)" },
  { stop_id: "100003_2", stop_name: "通町筋" },
  { stop_id: "100715_2", stop_name: "味噌天神" },
  { stop_id: "100572_2", stop_name: "水前寺公園前" },
  { stop_id: "100183_2", stop_name: "熊本県庁前" },
  { stop_id: "102664_2", stop_name: "自衛隊前" },
  { stop_id: "103922_2", stop_name: "東町中央" },
  { stop_id: "104244_2", stop_name: "益城インター口 P" },
  { stop_id: "102177_2", stop_name: "グランメッセ前" },
  { stop_id: "103333_2", stop_name: "臨空テクノパーク西" },
  { stop_id: "103319_2", stop_name: "臨空テクノパーク東" },
  { stop_id: "102112_1", stop_name: "阿蘇くまもと空港(乗車：4番のりば　※特快バスは3番のりば)" },
];

const AIRPORT_STOPS_FROM_AIRPORT = [
  { stop_id: "102112_4", stop_name: "阿蘇くまもと空港(降車：4番のりば)" },
  { stop_id: "103319_1", stop_name: "臨空テクノパーク東" },
  { stop_id: "103333_1", stop_name: "臨空テクノパーク西" },
  { stop_id: "102177_1", stop_name: "グランメッセ前" },
  { stop_id: "104244_1", stop_name: "益城インター口 P" },
  { stop_id: "103922_1", stop_name: "東町中央" },
  { stop_id: "102664_1", stop_name: "自衛隊前" },
  { stop_id: "100183_1", stop_name: "熊本県庁前" },
  { stop_id: "100572_1", stop_name: "水前寺公園前" },
  { stop_id: "100715_1", stop_name: "味噌天神" },
  { stop_id: "100003_1", stop_name: "通町筋" },
  { stop_id: "100002_9", stop_name: "熊本桜町バスターミナル(9番のりば)" },
];

const COMMUTE_SEMICON_STOPS = [
  {
    operator: "dentetsu",
    stop_id: "100880_1",
    stop_name: "県立技術短期大学前",
    lat: 32.887573,
    lon: 130.83466,
  },
  {
    operator: "sankobus",
    stop_id: "100880_1",
    stop_name: "県立技術短期大学前",
    lat: 32.887573,
    lon: 130.83466,
  },
];

const FALLBACK_HOURS = [
  "00",
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
];

const buildFallbackStopSeries = (offset = 0) => {
  const base = [
    null,
    null,
    null,
    null,
    null,
    0.4,
    0.7,
    1.4,
    2.2,
    2.9,
    3.4,
    3.9,
    3.7,
    3.3,
    2.9,
    2.5,
    2.9,
    3.4,
    3.7,
    3.1,
    2.6,
    1.9,
    1.4,
    1.0,
  ];
  return base.map((value) => {
    if (value === null) return null;
    return Math.max(0, Number((value + offset).toFixed(1)));
  });
};

const FALLBACK_VISITOR_STOPS_LATEST = {
  updated_at: "",
  route_id: "aso_airport_limousine",
  route_name: "阿蘇くまもと空港リムジンバス",
  directions: {
    to_airport: {
      label: "空港行き",
      stops: AIRPORT_STOPS_TO_AIRPORT.map((stop, idx) => ({
        ...stop,
        delay_sec: 150 + idx * 22,
      })),
    },
    from_airport: {
      label: "市内行き",
      stops: AIRPORT_STOPS_FROM_AIRPORT.map((stop, idx) => ({
        ...stop,
        delay_sec: 190 + idx * 20,
      })),
    },
  },
};

const FALLBACK_VISITOR_STOPS_DAILY = {
  date: "2026-02-18",
  timezone: "Asia/Tokyo",
  hours: FALLBACK_HOURS,
  directions: {
    to_airport: {
      label: "空港行き",
      stops: AIRPORT_STOPS_TO_AIRPORT.map((stop, idx) => ({
        ...stop,
        delay_min: buildFallbackStopSeries(idx * 0.25),
      })),
    },
    from_airport: {
      label: "市内行き",
      stops: AIRPORT_STOPS_FROM_AIRPORT.map((stop, idx) => ({
        ...stop,
        delay_min: buildFallbackStopSeries(idx * 0.23 + 0.2),
      })),
    },
  },
};

const FALLBACK_COMMUTE_LATEST = {
  updated_at: "",
  area_id: "semicon_techno_park",
  area_name: "セミコンテクノパーク周辺",
  stops: COMMUTE_SEMICON_STOPS.map((stop, idx) => ({
    ...stop,
    delay_sec: 210 + idx * 50,
    predictions: {
      h1_sec: null,
      h3_sec: null,
    },
  })),
  traffic: {
    section_name: "原水駅北口→県立技術短期大学前",
    from_stop_id: "100879_1",
    to_stop_id: "100880_1",
    distance_km: 2.4,
    avg_speed_kmh: 18.0,
    status: "smooth",
    sample_count: 5,
  },
};

const FALLBACK_COMMUTE_DAILY = {
  date: "2026-02-18",
  timezone: "Asia/Tokyo",
  hours: FALLBACK_HOURS,
  area_id: "semicon_techno_park",
  area_name: "セミコンテクノパーク周辺",
  delay_points: [
    { hour: "06", delay_min: 0.6, sample_count: 2 },
    { hour: "07", delay_min: 1.5, sample_count: 4 },
    { hour: "08", delay_min: 2.8, sample_count: 6 },
    { hour: "09", delay_min: 3.6, sample_count: 6 },
    { hour: "10", delay_min: 3.2, sample_count: 5 },
    { hour: "11", delay_min: 2.7, sample_count: 5 },
    { hour: "12", delay_min: 2.3, sample_count: 4 },
    { hour: "13", delay_min: 2.0, sample_count: 4 },
    { hour: "14", delay_min: 2.2, sample_count: 4 },
    { hour: "15", delay_min: 2.6, sample_count: 5 },
    { hour: "16", delay_min: 3.1, sample_count: 6 },
    { hour: "17", delay_min: 3.8, sample_count: 7 },
    { hour: "18", delay_min: 4.0, sample_count: 7 },
    { hour: "19", delay_min: 3.2, sample_count: 6 },
    { hour: "20", delay_min: 2.5, sample_count: 5 },
    { hour: "21", delay_min: 1.9, sample_count: 4 },
    { hour: "22", delay_min: 1.3, sample_count: 3 },
  ],
  traffic: {
    section_name: "原水駅北口→県立技術短期大学前",
    from_stop_id: "100879_1",
    to_stop_id: "100880_1",
    distance_km: 2.4,
    thresholds: {
      congested_kmh: 15,
      very_congested_kmh: 8,
      min_samples: 3,
    },
    speed_points: [
      { hour: "06", avg_speed_kmh: 20.1, status: "smooth", sample_count: 2 },
      { hour: "07", avg_speed_kmh: 16.2, status: "smooth", sample_count: 4 },
      { hour: "08", avg_speed_kmh: 13.4, status: "congested", sample_count: 6 },
      { hour: "09", avg_speed_kmh: 12.6, status: "congested", sample_count: 6 },
      { hour: "10", avg_speed_kmh: 14.0, status: "congested", sample_count: 5 },
      { hour: "11", avg_speed_kmh: 15.8, status: "smooth", sample_count: 5 },
      { hour: "12", avg_speed_kmh: 16.9, status: "smooth", sample_count: 4 },
      { hour: "13", avg_speed_kmh: 17.6, status: "smooth", sample_count: 4 },
      { hour: "14", avg_speed_kmh: 16.8, status: "smooth", sample_count: 4 },
      { hour: "15", avg_speed_kmh: 15.2, status: "smooth", sample_count: 5 },
      { hour: "16", avg_speed_kmh: 13.8, status: "congested", sample_count: 6 },
      { hour: "17", avg_speed_kmh: 12.7, status: "congested", sample_count: 7 },
      { hour: "18", avg_speed_kmh: 11.9, status: "congested", sample_count: 7 },
      { hour: "19", avg_speed_kmh: 13.6, status: "congested", sample_count: 6 },
      { hour: "20", avg_speed_kmh: 15.1, status: "smooth", sample_count: 5 },
      { hour: "21", avg_speed_kmh: 16.2, status: "smooth", sample_count: 4 },
      { hour: "22", avg_speed_kmh: 17.0, status: "smooth", sample_count: 3 },
    ],
  },
  stops: COMMUTE_SEMICON_STOPS.map((stop, idx) => ({
    ...stop,
    delay_min: buildFallbackStopSeries(idx * 0.35 + 0.25),
  })),
};

const FAVORITES_STORAGE_KEY = "agyancast.favorite_malls";
const UI_SETTINGS_STORAGE_KEY = "agyancast.ui_settings_v1";

const readUISettings = () => {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.activeTab === "living") parsed.activeTab = "shopping";
    return parsed;
  } catch (error) {
    console.warn("failed to read ui settings", error);
    return null;
  }
};

const SORT_MODES = [
  { key: "recommend", label: "おすすめ順" },
  { key: "crowd", label: "空いてる順" },
  { key: "distance", label: "近い順" },
];

const FAVORABLE_PRIORITY = {
  low: 0,
  medium: 1,
  high: 2,
  very_high: 3,
  unknown: 4,
};

const fetchJson = async (url, fallback) => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return await res.json();
  } catch (error) {
    console.warn(`failed to load ${url}`, error);
    return fallback;
  }
};

const formatDateTime = (iso) => {
  if (!iso) return "----";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "----";
  const text = date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${text} JST`;
};

const formatDelay = (delaySec) => {
  if (delaySec === null || delaySec === undefined) return "遅延情報なし";
  const value = Number(delaySec);
  if (Number.isNaN(value)) return "遅延情報なし";
  const minutes = Math.max(0, Math.floor(value / 60));
  return `遅延 ${minutes}分`;
};

const formatDelayShort = (delaySec, fallback = "準備中") => {
  if (delaySec === null || delaySec === undefined) return fallback;
  const value = Number(delaySec);
  if (Number.isNaN(value)) return fallback;
  return `${Math.max(0, Math.floor(value / 60))}分`;
};

const formatSpeedKmh = (speedKmh, fallback = "-") => {
  if (speedKmh === null || speedKmh === undefined) return fallback;
  const value = Number(speedKmh);
  if (!Number.isFinite(value)) return fallback;
  return `${value.toFixed(1)}km/h`;
};

const toMinutes = (delaySec) => {
  const value = Number(delaySec);
  if (Number.isNaN(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(value / 60));
};

const medianFinite = (values) => {
  const numbers = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!numbers.length) return null;
  const mid = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) return numbers[mid];
  return (numbers[mid - 1] + numbers[mid]) / 2;
};

const normalizeHourKey = (value) => {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return null;
  if (hour < 0 || hour > 23) return null;
  return String(Math.floor(hour)).padStart(2, "0");
};

const formatHourLabel = (hourText) => {
  if (hourText === null || hourText === undefined) return "--";
  const hour = Number(hourText);
  if (Number.isNaN(hour)) return "--";
  return `${String(hour).padStart(2, "0")}時台`;
};

const formatDistance = (distanceKm) => {
  if (!Number.isFinite(distanceKm)) return "-";
  if (distanceKm < 10) return `${distanceKm.toFixed(1)}km`;
  return `${distanceKm.toFixed(0)}km`;
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => Number.isNaN(value))) return null;
  const [aLat, aLon, bLat, bLon] = values;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const p1 = toRad(aLat);
  const p2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return 6371 * y;
};

const clampPercent = (value) => Math.max(0, Math.min(100, value));

const resolveMapPoint = (place) => {
  const override = MAP_POINT_OVERRIDES[place.id] || MAP_POINT_OVERRIDES[place.name];
  const rawX = override?.x ?? place.x;
  const rawY = override?.y ?? place.y;
  const x = Number(rawX);
  const y = Number(rawY);
  return {
    x: clampPercent(Number.isNaN(x) ? 50 : x),
    y: clampPercent(Number.isNaN(y) ? 50 : y),
  };
};

const pickBestHourOverall = (daily, itemIds) => {
  if (!daily?.hours || !daily?.series) return null;
  const idSet = new Set(itemIds);
  const hourValues = new Map();
  Object.entries(daily.series).forEach(([mallId, values]) => {
    if (!idSet.has(mallId) || !Array.isArray(values)) return;
    values.forEach((value, idx) => {
      const hourText = daily.hours[idx];
      const hour = Number(hourText);
      if (hour < 5 || hour > 23 || value === null || value === undefined) return;
      if (!hourValues.has(hourText)) hourValues.set(hourText, []);
      hourValues.get(hourText).push(Number(value));
    });
  });
  let bestHour = null;
  let bestScore = Number.POSITIVE_INFINITY;
  hourValues.forEach((values, hourText) => {
    if (!values.length) return;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (avg < bestScore) {
      bestScore = avg;
      bestHour = hourText;
    }
  });
  return bestHour;
};

const buildHourLabels = (startHour, endHour) => {
  const labels = [];
  for (let h = startHour; h <= endHour; h += 1) {
    labels.push(String(h).padStart(2, "0"));
  }
  return labels;
};

const buildSeriesForHours = (labels, hours, values) => {
  const map = new Map();
  if (Array.isArray(hours) && Array.isArray(values)) {
    hours.forEach((h, idx) => {
      map.set(String(h).padStart(2, "0"), values[idx]);
    });
  }
  return labels.map((label) => (label === "24" ? null : map.get(label) ?? null));
};

const normalizeVisitorLatest = (raw) => {
  if (!raw || typeof raw !== "object") return FALLBACK_VISITOR_LATEST;
  if (Array.isArray(raw.services) && raw.services.length > 0) {
    const top = raw.services[0];
    return {
      ...FALLBACK_VISITOR_LATEST,
      ...top,
      updated_at: raw.updated_at ?? top.updated_at ?? "",
      predictions: {
        ...FALLBACK_VISITOR_LATEST.predictions,
        ...(top?.predictions ?? {}),
      },
    };
  }
  return {
    ...FALLBACK_VISITOR_LATEST,
    ...raw,
    predictions: {
      ...FALLBACK_VISITOR_LATEST.predictions,
      ...(raw?.predictions ?? {}),
    },
  };
};

const extractVisitorDailySeries = (daily) => {
  if (!daily) return null;
  if (Array.isArray(daily.delay_min)) return daily.delay_min;
  if (daily.series && typeof daily.series === "object") {
    const first = Object.values(daily.series)[0];
    if (Array.isArray(first)) return first;
  }
  return null;
};

const getVisitorDelayStatus = (delaySec) => {
  const value = Number(delaySec);
  if (!Number.isFinite(value)) return "unknown";
  if (value < 300) return "on_time";
  if (value < 600) return "slight_delay";
  return "delayed";
};

const normalizeDirectionStops = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.stops)) return value.stops;
  if (value.stops && typeof value.stops === "object") {
    return Object.entries(value.stops).map(([stopId, item]) => ({
      stop_id: stopId,
      ...(item ?? {}),
    }));
  }
  return [];
};

const normalizeVisitorStopsLatest = (raw) => {
  const source = raw && typeof raw === "object" ? raw : FALLBACK_VISITOR_STOPS_LATEST;
  const directions = source.directions && typeof source.directions === "object" ? source.directions : {};

  const buildDirection = (key, fallbackLabel) => {
    const dir = directions[key];
    const stops = normalizeDirectionStops(dir).map((stop) => ({
      stop_id: stop.stop_id ?? "",
      stop_name: stop.stop_name ?? "停留所",
      delay_sec: stop.delay_sec ?? null,
    }));
    return {
      label: dir?.label ?? fallbackLabel,
      stops,
    };
  };

  return {
    updated_at: source.updated_at ?? "",
    route_id: source.route_id ?? FALLBACK_VISITOR_STOPS_LATEST.route_id,
    route_name: source.route_name ?? FALLBACK_VISITOR_STOPS_LATEST.route_name,
    directions: {
      to_airport: buildDirection("to_airport", "空港行き"),
      from_airport: buildDirection("from_airport", "市内行き"),
    },
  };
};

const normalizeVisitorStopsDaily = (raw) => {
  const source = raw && typeof raw === "object" ? raw : FALLBACK_VISITOR_STOPS_DAILY;
  const directions = source.directions && typeof source.directions === "object" ? source.directions : {};

  const buildDirection = (key, fallbackLabel) => {
    const dir = directions[key];
    const stops = normalizeDirectionStops(dir).map((stop) => ({
      stop_id: stop.stop_id ?? "",
      stop_name: stop.stop_name ?? "停留所",
      delay_min: Array.isArray(stop.delay_min) ? stop.delay_min : [],
    }));
    return {
      label: dir?.label ?? fallbackLabel,
      stops,
    };
  };

  return {
    date: source.date ?? "",
    timezone: source.timezone ?? "Asia/Tokyo",
    hours: Array.isArray(source.hours) ? source.hours : [],
    directions: {
      to_airport: buildDirection("to_airport", "空港行き"),
      from_airport: buildDirection("from_airport", "市内行き"),
    },
  };
};

const normalizeCommuteLatest = (raw) => {
  const source = raw && typeof raw === "object" ? raw : FALLBACK_COMMUTE_LATEST;
  const traffic = source.traffic && typeof source.traffic === "object" ? source.traffic : {};
  const avgSpeedValue = Number(traffic.avg_speed_kmh);
  const sampleCountValue = Number(traffic.sample_count);
  const stops = Array.isArray(source.stops)
    ? source.stops
    : source.delay_sec !== undefined
      ? [
          {
            operator: source.operator ?? "",
            stop_id: source.stop_id ?? "semicon_area",
            stop_name: source.stop_name ?? "セミコンテクノパーク",
            delay_sec: source.delay_sec,
            predictions: source.predictions ?? {},
          },
        ]
      : [];
  return {
    updated_at: source.updated_at ?? "",
    area_id: source.area_id ?? "semicon_techno_park",
    area_name: source.area_name ?? "セミコンテクノパーク周辺",
    stops: stops.map((stop) => ({
      operator: stop.operator ?? "",
      stop_id: stop.stop_id ?? "",
      stop_name: stop.stop_name ?? "停留所",
      lat: stop.lat ?? null,
      lon: stop.lon ?? null,
      delay_sec: stop.delay_sec ?? null,
      predictions: {
        h1_sec: stop?.predictions?.h1_sec ?? null,
        h3_sec: stop?.predictions?.h3_sec ?? null,
      },
    })),
    traffic: {
      section_name: traffic.section_name ?? "原水駅北口→県立技術短期大学前",
      from_stop_id: traffic.from_stop_id ?? "100879_1",
      to_stop_id: traffic.to_stop_id ?? "100880_1",
      distance_km: Number.isFinite(Number(traffic.distance_km)) ? Number(traffic.distance_km) : 2.4,
      avg_speed_kmh: Number.isFinite(avgSpeedValue) ? Number(avgSpeedValue) : null,
      status: traffic.status ?? "unknown",
      sample_count: Number.isFinite(sampleCountValue) ? Number(sampleCountValue) : 0,
    },
  };
};

const normalizeCommuteDaily = (raw) => {
  const source = raw && typeof raw === "object" ? raw : FALLBACK_COMMUTE_DAILY;
  const traffic = source.traffic && typeof source.traffic === "object" ? source.traffic : {};
  const thresholds = traffic.thresholds && typeof traffic.thresholds === "object" ? traffic.thresholds : {};
  const stops = Array.isArray(source.stops)
    ? source.stops
    : Array.isArray(source.delay_min)
      ? [
          {
            operator: source.operator ?? "",
            stop_id: source.stop_id ?? "semicon_area",
            stop_name: source.stop_name ?? "セミコンテクノパーク",
            delay_min: source.delay_min,
          },
        ]
      : [];
  const delayPointMap = new Map();
  if (Array.isArray(source.delay_points)) {
    source.delay_points.forEach((point) => {
      const hour = normalizeHourKey(point?.hour);
      const delayValue = Number(point?.delay_min);
      if (!hour || !Number.isFinite(delayValue)) return;
      const sampleCount = Number(point?.sample_count);
      delayPointMap.set(hour, {
        hour,
        delay_min: Number(delayValue.toFixed(1)),
        sample_count: Number.isFinite(sampleCount) ? Math.max(0, Math.floor(sampleCount)) : null,
      });
    });
  }
  const speedPointMap = new Map();
  if (Array.isArray(traffic.speed_points)) {
    traffic.speed_points.forEach((point) => {
      const hour = normalizeHourKey(point?.hour);
      const speedValue = Number(point?.avg_speed_kmh);
      if (!hour || !Number.isFinite(speedValue)) return;
      const sampleCount = Number(point?.sample_count);
      speedPointMap.set(hour, {
        hour,
        avg_speed_kmh: Number(speedValue.toFixed(1)),
        status: point?.status ?? "unknown",
        sample_count: Number.isFinite(sampleCount) ? Math.max(0, Math.floor(sampleCount)) : null,
      });
    });
  }
  return {
    date: source.date ?? "",
    timezone: source.timezone ?? "Asia/Tokyo",
    area_id: source.area_id ?? "semicon_techno_park",
    area_name: source.area_name ?? "セミコンテクノパーク周辺",
    hours: Array.isArray(source.hours) ? source.hours : [],
    stops: stops.map((stop) => ({
      operator: stop.operator ?? "",
      stop_id: stop.stop_id ?? "",
      stop_name: stop.stop_name ?? "停留所",
      delay_min: Array.isArray(stop.delay_min) ? stop.delay_min : [],
    })),
    delay_points: Array.from(delayPointMap.values()).sort((a, b) => a.hour.localeCompare(b.hour)),
    traffic: {
      section_name: traffic.section_name ?? "原水駅北口→県立技術短期大学前",
      from_stop_id: traffic.from_stop_id ?? "100879_1",
      to_stop_id: traffic.to_stop_id ?? "100880_1",
      distance_km: Number.isFinite(Number(traffic.distance_km)) ? Number(traffic.distance_km) : 2.4,
      thresholds: {
        congested_kmh: Number.isFinite(Number(thresholds.congested_kmh))
          ? Number(thresholds.congested_kmh)
          : 15,
        very_congested_kmh: Number.isFinite(Number(thresholds.very_congested_kmh))
          ? Number(thresholds.very_congested_kmh)
          : 8,
        min_samples: Number.isFinite(Number(thresholds.min_samples)) ? Number(thresholds.min_samples) : 3,
      },
      speed_points: Array.from(speedPointMap.values()).sort((a, b) => a.hour.localeCompare(b.hour)),
    },
  };
};

const extractCommutePointSeries = (points, valueKey) => {
  if (!Array.isArray(points) || points.length === 0) return null;
  const valid = points
    .filter((point) => {
      const hour = normalizeHourKey(point?.hour);
      const value = Number(point?.[valueKey]);
      return Boolean(hour) && Number.isFinite(value);
    })
    .map((point) => ({
      ...point,
      hour: normalizeHourKey(point.hour),
      [valueKey]: Number(Number(point[valueKey]).toFixed(1)),
    }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
  if (!valid.length) return null;
  return {
    labels: valid.map((point) => point.hour),
    data: valid.map((point) => point[valueKey]),
    points: valid,
  };
};

const layoutBubbles = (overlay, items) => {
  const overlayHeight = overlay.offsetHeight || overlay.getBoundingClientRect().height || 1;
  const overlayWidth = overlay.offsetWidth || overlay.getBoundingClientRect().width || 1;
  const margin = 18;
  const gap = 12;
  const horizontalGap = 12;
  const edgeFactorDefault = 0.1;
  const groups = {
    "left-top": [],
    "left-bottom": [],
    "right-top": [],
    "right-bottom": [],
  };

  items.forEach((item) => {
    const bubble = item.element;
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    const bubbleHeight = rect.height || 0;
    const bubbleWidth = rect.width || 0;

    if (item.layoutMode === "anchor") {
      const anchorX = (item.mapX / 100) * overlayWidth;
      const anchorY = (item.mapY / 100) * overlayHeight;
      const offsetY = item.layoutAnchorOffsetY ?? 12;
      const left = Math.min(
        Math.max(margin, anchorX - bubbleWidth / 2),
        overlayWidth - margin - bubbleWidth
      );
      const top = Math.min(
        Math.max(margin, anchorY + offsetY),
        overlayHeight - margin - bubbleHeight
      );
      bubble.style.left = `${Math.round(left)}px`;
      bubble.style.top = `${Math.round(top)}px`;
      return;
    }

    const anchorY = item.layoutAnchorYPx ?? (item.mapY / 100) * overlayHeight;
    const key = `${item.side}-${item.vertical}`;
    if (!groups[key]) return;
    groups[key].push({ ...item, bubbleHeight, bubbleWidth, anchorY });
  });

  const setHorizontal = (item) => {
    const anchorX = (item.mapX / 100) * overlayWidth;
    const gapX = item.layoutGapX ?? horizontalGap;
    const maxLeft = Math.max(margin, overlayWidth - item.bubbleWidth - margin);
    const closeLeft =
      item.side === "left"
        ? Math.min(maxLeft, Math.max(margin, anchorX - item.bubbleWidth - gapX))
        : Math.min(maxLeft, Math.max(margin, anchorX + gapX));
    const edgeFactor = item.layoutEdgeFactor ?? edgeFactorDefault;
    const left =
      item.side === "left"
        ? margin + (closeLeft - margin) * edgeFactor
        : closeLeft + (maxLeft - closeLeft) * edgeFactor;
    item.element.style.left = `${Math.round(left)}px`;
  };

  const placeTopGroup = (group) => {
    group.sort((a, b) => a.anchorY - b.anchorY);
    let cursor = margin;
    group.forEach((item) => {
      const desired = item.anchorY - item.bubbleHeight / 2;
      const top = Math.max(desired, cursor);
      item.top = top;
      cursor = top + item.bubbleHeight + gap;
    });

    const overflow = cursor - gap - (overlayHeight - margin);
    if (overflow > 0) {
      group.forEach((item) => {
        item.top = Math.max(margin, item.top - overflow);
      });
    }

    group.forEach((item) => {
      item.element.style.top = `${Math.round(item.top)}px`;
      setHorizontal(item);
    });
  };

  const placeBottomGroup = (group) => {
    group.sort((a, b) => b.anchorY - a.anchorY);
    let cursor = overlayHeight - margin;
    group.forEach((item) => {
      const desired = item.anchorY - item.bubbleHeight / 2;
      const top = Math.min(desired, cursor - item.bubbleHeight);
      item.top = top;
      cursor = top - gap;
    });

    if (group.length) {
      const minTop = Math.min(...group.map((item) => item.top));
      const underflow = margin - minTop;
      if (underflow > 0) {
        group.forEach((item) => {
          item.top += underflow;
        });
      }
    }

    group.forEach((item) => {
      item.element.style.top = `${Math.round(item.top)}px`;
      setHorizontal(item);
    });
  };

  placeTopGroup(groups["left-top"]);
  placeTopGroup(groups["right-top"]);
  placeBottomGroup(groups["left-bottom"]);
  placeBottomGroup(groups["right-bottom"]);
};

const drawPointers = (overlay, pointerLayer, items) => {
  const rect = overlay.getBoundingClientRect();
  const width = overlay.offsetWidth || rect.width || 1;
  const height = overlay.offsetHeight || rect.height || 1;
  if (!width || !height) return;

  const scaleX = rect.width / width;
  const scaleY = rect.height / height;
  pointerLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  pointerLayer.innerHTML = "";

  items.forEach((item) => {
    const bubble = item.element;
    if (!bubble) return;
    const anchorX = (item.mapX / 100) * width;
    const anchorY = (item.mapY / 100) * height;
    const bubbleRect = bubble.getBoundingClientRect();
    const localLeft = (bubbleRect.left - rect.left) / scaleX;
    const localTop = (bubbleRect.top - rect.top) / scaleY;
    const localRight = localLeft + bubbleRect.width / scaleX;
    const localBottom = localTop + bubbleRect.height / scaleY;
    const targetX = Math.min(Math.max(anchorX, localLeft), localRight);
    const targetY = Math.min(Math.max(anchorY, localTop), localBottom);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", anchorX);
    line.setAttribute("y1", anchorY);
    line.setAttribute("x2", targetX);
    line.setAttribute("y2", targetY);
    pointerLayer.appendChild(line);

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", anchorX);
    dot.setAttribute("cy", anchorY);
    dot.setAttribute("r", "4");
    pointerLayer.appendChild(dot);
  });
};

const MapView = ({ items }) => {
  const mapRef = useRef(null);
  const viewportRef = useRef(null);
  const overlayRef = useRef(null);
  const pointerRef = useRef(null);

  useEffect(() => {
    const map = mapRef.current;
    const viewport = viewportRef.current;
    if (!map || !viewport) return;

    let panX = 0;
    let panY = 0;
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let scale = MAP_BASE_SCALE;

    const applyTransform = () => {
      const rect = map.getBoundingClientRect();
      const viewWidth = MAP_BASE_WIDTH * scale;
      const viewHeight = MAP_BASE_HEIGHT * scale;
      const maxX = Math.max(0, (viewWidth - rect.width) / 2);
      const maxY = Math.max(0, (viewHeight - rect.height) / 2);
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
      viewport.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${scale})`;
    };

    const updateScale = () => {
      scale = MAP_BASE_SCALE;
      applyTransform();
    };

    const onPointerDown = (event) => {
      isDragging = true;
      map.classList.add("dragging");
      map.setPointerCapture(event.pointerId);
      startX = event.clientX - panX;
      startY = event.clientY - panY;
    };

    const onPointerMove = (event) => {
      if (!isDragging) return;
      panX = event.clientX - startX;
      panY = event.clientY - startY;
      applyTransform();
    };

    const onPointerUp = () => {
      isDragging = false;
      map.classList.remove("dragging");
    };

    map.addEventListener("pointerdown", onPointerDown);
    map.addEventListener("pointermove", onPointerMove);
    map.addEventListener("pointerup", onPointerUp);
    map.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", updateScale);

    updateScale();

    return () => {
      map.removeEventListener("pointerdown", onPointerDown);
      map.removeEventListener("pointermove", onPointerMove);
      map.removeEventListener("pointerup", onPointerUp);
      map.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const pointerLayer = pointerRef.current;
    if (!overlay || !pointerLayer) return;

    const update = () => {
      const layoutItems = items
        .map((item) => {
          const place = item.place;
          const element = overlay.querySelector(`[data-id="${place.id}"]`);
          if (!element) return null;
          const override = bubbleLayoutOverrides[place.id] || bubbleLayoutOverrides[place.name];
          const side = override?.side ?? (item.mapX < 50 ? "left" : "right");
          const vertical = override?.vertical ?? (item.mapY < 50 ? "top" : "bottom");
          return {
            place,
            mapX: item.mapX,
            mapY: item.mapY,
            element,
            side,
            vertical,
            layoutAnchorYPx: override?.anchorYPx ?? null,
            layoutEdgeFactor: override?.edgeFactor ?? null,
            layoutGapX: override?.gapX ?? null,
            layoutMode: override?.layoutMode ?? null,
            layoutAnchorOffsetY: override?.anchorOffsetY ?? null,
          };
        })
        .filter(Boolean);

      layoutBubbles(overlay, layoutItems);
      drawPointers(overlay, pointerLayer, layoutItems);
    };

    let raf = requestAnimationFrame(update);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    window.addEventListener("resize", onResize);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(onResize).catch(() => {});
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [items]);

  return (
    <section className="panel map-panel" id="map-section">
      <div className="panel-header">
        <div>
          <div className="panel-title">補助マップ</div>
          <div className="panel-sub">位置確認用（地図をドラッグして確認）</div>
        </div>
        <span className="panel-chip muted">生活タブのみ</span>
      </div>
      <div
        className="map"
        ref={mapRef}
        style={{
          "--map-base-width": `${MAP_BASE_WIDTH}px`,
          "--map-base-height": `${MAP_BASE_HEIGHT}px`,
        }}
      >
        <div className="map-viewport" ref={viewportRef}>
          <div className="map-bg" />
          <div className="map-overlay" ref={overlayRef}>
            <svg className="pointer-layer" ref={pointerRef} width="100%" height="100%" preserveAspectRatio="none" />
            {items.map((item) => {
              const place = item.place;
              return (
                <div key={item.id} className={`bubble status-${item.statusKey}`} data-id={place.id}>
                  <div className="bubble-icon">
                    <img src={item.meta.icon} alt={item.meta.label} />
                  </div>
                  <div className="bubble-body">
                    <div className="bubble-title">{item.displayName}</div>
                    <div className="bubble-status">{item.meta.label}</div>
                    <div className="bubble-delay">{item.delayLabel}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

const MallList = ({
  items,
  favoritesSet,
  onToggleFavorite,
  sortMode,
  onSortModeChange,
  anchorLabel,
}) => (
  <section className="panel list-panel" id="list-section">
    <div className="panel-header">
      <div>
        <div className="panel-title">おすすめ一覧</div>
        <div className="panel-sub">{anchorLabel}を基準に、買い物先を比較できます</div>
      </div>
      <span className="panel-chip">予測は準備中</span>
    </div>

    <div className="sort-tabs" role="tablist" aria-label="sort mode">
      {SORT_MODES.map((mode) => (
        <button
          type="button"
          key={mode.key}
          className={`sort-btn ${sortMode === mode.key ? "active" : ""}`}
          onClick={() => onSortModeChange(mode.key)}
          role="tab"
          aria-selected={sortMode === mode.key}
        >
          {mode.label}
        </button>
      ))}
    </div>

    <div className="list-table">
      <div className="list-row list-header">
        <div className="list-cell">順位</div>
        <div className="list-cell">施設</div>
        <div className="list-cell">混雑度</div>
        <div className="list-cell">遅延</div>
        <div className="list-cell">距離</div>
        <div className="list-cell">1時間後</div>
      </div>
      {items.map((item, index) => {
        const isFavorite = favoritesSet.has(item.id);
        return (
          <div className="list-row" data-status={item.statusKey} key={item.id}>
            <div className="list-cell list-rank">
              <span className="rank-badge">{index + 1}</span>
            </div>
            <div className="list-cell list-name">
              <button
                type="button"
                className={`favorite-btn ${isFavorite ? "active" : ""}`}
                onClick={() => onToggleFavorite(item.id)}
                aria-label={`${item.displayName}をお気に入り`}
              >
                {isFavorite ? "★" : "☆"}
              </button>
              <span className="list-dot" style={{ background: item.meta.color }} />
              <span className="list-name-text">{item.displayName}</span>
            </div>
            <div className="list-cell list-status">
              <span className="list-pill">{item.meta.label}</span>
            </div>
            <div className="list-cell list-delay">{item.delayLabel}</div>
            <div className="list-cell list-distance">{formatDistance(item.distanceKm)}</div>
            <div className="list-cell list-forecast">Coming Soon</div>
          </div>
        );
      })}
    </div>
  </section>
);

const TrendChart = ({ daily }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!daily || !canvasRef.current) return;
    const labels = buildHourLabels(5, 24);
    const palette = ["#1db455", "#f1c842", "#e64a3b", "#0b4aa3", "#8f1f14", "#1664c8", "#2f87e0", "#6a7076"];
    const datasets = Object.entries(daily.series ?? {}).map(([mall, values], idx) => {
      const color = palette[idx % palette.length];
      return {
        label: mall,
        data: buildSeriesForHours(labels, daily.hours, values),
        borderColor: color,
        backgroundColor: color,
        tension: 0.35,
        spanGaps: false,
        pointRadius: 2,
        pointHoverRadius: 4,
      };
    });

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) return `${context.dataset.label}: -`;
                return `${context.dataset.label}: ${value}分`;
              },
            },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "遅延(分)" },
            beginAtZero: true,
          },
          x: {
            title: { display: true, text: "時間帯" },
            ticks: { maxTicksLimit: 12 },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [daily]);

  if (!daily) return null;

  return (
    <section className="panel trend-panel" id="trend-section">
      <div className="panel-header">
        <div>
          <div className="panel-title">今日の混雑推移</div>
          <div className="panel-sub">
            {daily.date ?? "--"} ({daily.timezone ?? "JST"}) / 05-24時 / 遅延中央値(分)
          </div>
        </div>
      </div>
      <div className="trend-chart">
        <div className="trend-scroll">
          <canvas ref={canvasRef} height="200" />
        </div>
      </div>
    </section>
  );
};

const StopMiniChart = ({ hours, values }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !Array.isArray(values)) return;
    const labels = buildHourLabels(5, 24);
    const data = buildSeriesForHours(labels, hours, values);

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "遅延",
            data,
            borderColor: "#3f86e0",
            backgroundColor: "#3f86e0",
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) return "遅延: -";
                return `遅延: ${value}分`;
              },
            },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "遅延(分)" },
            beginAtZero: true,
            ticks: { maxTicksLimit: 5 },
          },
          x: {
            title: { display: true, text: "時間帯" },
            ticks: { maxTicksLimit: 10 },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [hours, values]);

  return (
    <div className="mini-chart">
      <div className="mini-chart-scroll">
        <canvas ref={canvasRef} height="160" />
      </div>
    </div>
  );
};

const VisitorStopDirectionPanel = ({ directionKey, direction, dailyDirection, hours }) => {
  const dailyStopMap = useMemo(() => {
    const map = new Map();
    (dailyDirection?.stops ?? []).forEach((stop) => {
      map.set(stop.stop_id, stop);
    });
    return map;
  }, [dailyDirection]);

  return (
    <section className="panel visitor-stop-panel" id={`visitor-direction-${directionKey}`}>
      <div className="panel-header">
        <div>
          <div className="panel-title">{direction.label}</div>
          <div className="panel-sub">桜町BT ↔ 阿蘇くまもと空港 停留所別</div>
        </div>
      </div>
      <div className="visitor-stop-list">
        {(direction.stops ?? []).length === 0 ? (
          <div className="visitor-empty">停留所データを準備中です。</div>
        ) : (
          (direction.stops ?? []).map((stop) => {
          const delayStatus = getVisitorDelayStatus(stop.delay_sec);
          const meta = VISITOR_STATUS_META[delayStatus] || VISITOR_STATUS_META.unknown;
          const dailyStop = dailyStopMap.get(stop.stop_id);
          return (
            <div className="visitor-stop-card" key={`${directionKey}-${stop.stop_id}`}>
              <div className="visitor-stop-head">
                <strong className="visitor-stop-name">{stop.stop_name}</strong>
                <div className="visitor-stop-kpi">
                  <span className="visitor-stop-delay">{formatDelayShort(stop.delay_sec, "-")}</span>
                  <span className="visitor-stop-status" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                </div>
              </div>
              <StopMiniChart hours={hours} values={dailyStop?.delay_min ?? []} />
            </div>
          );
          })
        )}
      </div>
    </section>
  );
};

const CommuteDashboard = ({ latest, daily }) => {
  const delayChartRef = useRef(null);
  const speedChartRef = useRef(null);
  const delayCanvasRef = useRef(null);
  const speedCanvasRef = useRef(null);
  const latestNormalized = useMemo(() => normalizeCommuteLatest(latest), [latest]);
  const dailyNormalized = useMemo(() => normalizeCommuteDaily(daily), [daily]);
  const delayPointSeries = useMemo(
    () => extractCommutePointSeries(dailyNormalized.delay_points, "delay_min"),
    [dailyNormalized.delay_points]
  );
  const speedPointSeries = useMemo(
    () => extractCommutePointSeries(dailyNormalized.traffic?.speed_points, "avg_speed_kmh"),
    [dailyNormalized.traffic]
  );

  const currentDelaySec = useMemo(
    () => {
      const fromStops = medianFinite((latestNormalized.stops ?? []).map((stop) => stop.delay_sec));
      if (fromStops !== null) return fromStops;
      if (Array.isArray(dailyNormalized.delay_points) && dailyNormalized.delay_points.length > 0) {
        const latestPoint = [...dailyNormalized.delay_points].sort((a, b) => a.hour.localeCompare(b.hour)).at(-1);
        const delayMin = Number(latestPoint?.delay_min);
        if (Number.isFinite(delayMin)) return delayMin * 60;
      }
      return null;
    },
    [latestNormalized, dailyNormalized.delay_points]
  );
  const h1DelaySec = useMemo(
    () => medianFinite((latestNormalized.stops ?? []).map((stop) => stop?.predictions?.h1_sec)),
    [latestNormalized]
  );
  const h3DelaySec = useMemo(
    () => medianFinite((latestNormalized.stops ?? []).map((stop) => stop?.predictions?.h3_sec)),
    [latestNormalized]
  );
  const statusMeta = VISITOR_STATUS_META[getVisitorDelayStatus(currentDelaySec)] || VISITOR_STATUS_META.unknown;
  const trafficMeta =
    COMMUTE_TRAFFIC_META[latestNormalized.traffic?.status] || COMMUTE_TRAFFIC_META.unknown;
  const avgSpeedKmh = latestNormalized.traffic?.avg_speed_kmh ?? null;
  const trafficSampleCount = latestNormalized.traffic?.sample_count ?? 0;
  const trafficSectionName =
    latestNormalized.traffic?.section_name ||
    dailyNormalized.traffic?.section_name ||
    "原水駅北口→県立技術短期大学前";
  const trafficDistanceKm = latestNormalized.traffic?.distance_km ?? dailyNormalized.traffic?.distance_km ?? null;
  const trafficThresholds = dailyNormalized.traffic?.thresholds ?? {
    congested_kmh: 15,
    very_congested_kmh: 8,
    min_samples: 3,
  };

  useEffect(() => {
    if (!delayCanvasRef.current || !delayPointSeries) return;
    if (delayChartRef.current) delayChartRef.current.destroy();
    delayChartRef.current = new Chart(delayCanvasRef.current, {
      type: "line",
      data: {
        labels: delayPointSeries.labels,
        datasets: [
          {
            label: "遅延(分)",
            data: delayPointSeries.data,
            borderColor: "#3f86e0",
            backgroundColor: "#3f86e0",
            tension: 0.32,
            spanGaps: false,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) return "遅延: -";
                const point = delayPointSeries.points[context.dataIndex];
                const sampleSuffix =
                  point?.sample_count === null || point?.sample_count === undefined
                    ? ""
                    : ` / サンプル ${point.sample_count}`;
                return `遅延: ${value}分${sampleSuffix}`;
              },
            },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "遅延(分)" },
            beginAtZero: true,
          },
          x: {
            title: { display: true, text: "時刻" },
          },
        },
      },
    });

    return () => {
      if (delayChartRef.current) delayChartRef.current.destroy();
    };
  }, [delayPointSeries]);

  useEffect(() => {
    if (!speedCanvasRef.current || !speedPointSeries) return;
    if (speedChartRef.current) speedChartRef.current.destroy();
    speedChartRef.current = new Chart(speedCanvasRef.current, {
      type: "line",
      data: {
        labels: speedPointSeries.labels,
        datasets: [
          {
            label: "平均時速(km/h)",
            data: speedPointSeries.data,
            borderColor: "#8f62ef",
            backgroundColor: "#8f62ef",
            tension: 0.32,
            spanGaps: false,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) return "平均時速: -";
                const point = speedPointSeries.points[context.dataIndex];
                const status = COMMUTE_TRAFFIC_META[point?.status] || COMMUTE_TRAFFIC_META.unknown;
                const sampleSuffix =
                  point?.sample_count === null || point?.sample_count === undefined
                    ? ""
                    : ` / サンプル ${point.sample_count}`;
                return `平均時速: ${value}km/h / ${status.label}${sampleSuffix}`;
              },
            },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "平均時速(km/h)" },
            beginAtZero: true,
          },
          x: {
            title: { display: true, text: "時刻" },
          },
        },
      },
    });

    return () => {
      if (speedChartRef.current) speedChartRef.current.destroy();
    };
  }, [speedPointSeries]);

  return (
    <div className="commute-content">
      <section className="panel commute-panel" id="commute-overview-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">{latestNormalized.area_name}</div>
            <div className="panel-sub">通勤向け / GTFS停留所ベースで遅延集約</div>
          </div>
          <span className="panel-chip">{formatDateTime(latestNormalized.updated_at)}</span>
        </div>

        <div className="visitor-route-row">
          <strong className="visitor-route-name">セミコンテクノパーク</strong>
          <span className="visitor-status-pill" style={{ color: statusMeta.color }}>
            {statusMeta.label}
          </span>
        </div>

        <div className="visitor-kpi-grid">
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">現在</span>
            <strong className="visitor-kpi-value">{formatDelayShort(currentDelaySec)}</strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">1時間後</span>
            <strong className="visitor-kpi-value">{formatDelayShort(h1DelaySec)}</strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">3時間後</span>
            <strong className="visitor-kpi-value">{formatDelayShort(h3DelaySec)}</strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">平均時速</span>
            <strong className="visitor-kpi-value">{formatSpeedKmh(avgSpeedKmh)}</strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">区間渋滞</span>
            <strong className="visitor-kpi-value" style={{ color: trafficMeta.color }}>
              {trafficMeta.label}
            </strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">速度サンプル</span>
            <strong className="visitor-kpi-value">{trafficSampleCount}件</strong>
          </div>
        </div>

        <div className="visitor-note-row">
          <span className="visitor-note-label">表示単位</span>
          <span className="visitor-note-text">
            {trafficSectionName}
            {Number.isFinite(trafficDistanceKm) ? `（${trafficDistanceKm}km）` : ""}
            {` / 判定しきい値: ${trafficThresholds.congested_kmh}km/h以下=渋滞, ${trafficThresholds.very_congested_kmh}km/h以下=大渋滞（サンプル${trafficThresholds.min_samples}件未満は判定保留）`}
          </span>
        </div>
      </section>

      <section className="panel commute-single-panel" id="commute-single-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">通勤状況一覧</div>
            <div className="panel-sub">
              {dailyNormalized.date || "--"} ({dailyNormalized.timezone || "JST"}) / 05-24時
            </div>
          </div>
          <span className="panel-chip muted">セミコンテクノパーク 1拠点表示</span>
        </div>
        <div className="commute-single-table">
          <div className="commute-single-row header">
            <span>拠点</span>
            <span>現在</span>
            <span>1時間後</span>
            <span>3時間後</span>
            <span>平均時速</span>
            <span>区間渋滞</span>
            <span>速度サンプル</span>
          </div>
          <div className="commute-single-row">
            <strong>セミコンテクノパーク</strong>
            <span>{formatDelayShort(currentDelaySec)}</span>
            <span>{formatDelayShort(h1DelaySec)}</span>
            <span>{formatDelayShort(h3DelaySec)}</span>
            <span>{formatSpeedKmh(avgSpeedKmh)}</span>
            <span style={{ color: trafficMeta.color }}>{trafficMeta.label}</span>
            <span>{trafficSampleCount}件</span>
          </div>
        </div>

        <div className="commute-charts">
          <div className="commute-chart-card">
            <div className="panel-sub commute-chart-title">遅延推移（実測のみ）</div>
            {delayPointSeries ? (
              <div className="trend-chart commute-trend-chart">
                <div className="trend-scroll">
                  <canvas ref={delayCanvasRef} height="200" />
                </div>
              </div>
            ) : (
              <div className="visitor-empty">遅延推移データを準備中です。</div>
            )}
          </div>

          <div className="commute-chart-card">
            <div className="panel-sub commute-chart-title">平均時速推移（実測のみ）</div>
            {speedPointSeries ? (
              <div className="trend-chart commute-trend-chart">
                <div className="trend-scroll">
                  <canvas ref={speedCanvasRef} height="200" />
                </div>
              </div>
            ) : (
              <div className="visitor-empty">平均時速データを準備中です。</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

const VisitorDashboard = ({ latest, daily, stopsLatest, stopsDaily }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);
  const [activeDirection, setActiveDirection] = useState("to_airport");

  const meta = VISITOR_STATUS_META[latest.status] || VISITOR_STATUS_META.unknown;
  const h1 = latest.predictions?.h1_sec;
  const h3 = latest.predictions?.h3_sec;
  const dailySeries = extractVisitorDailySeries(daily);
  const stopsLatestNormalized = useMemo(
    () => normalizeVisitorStopsLatest(stopsLatest),
    [stopsLatest]
  );
  const stopsDailyNormalized = useMemo(
    () => normalizeVisitorStopsDaily(stopsDaily),
    [stopsDaily]
  );
  const directionOptions = useMemo(
    () => [
      { key: "to_airport", label: stopsLatestNormalized.directions.to_airport?.label ?? "空港行き" },
      { key: "from_airport", label: stopsLatestNormalized.directions.from_airport?.label ?? "市内行き" },
    ],
    [stopsLatestNormalized]
  );
  const selectedLatestDirection = stopsLatestNormalized.directions[activeDirection] ?? {
    label: activeDirection === "from_airport" ? "市内行き" : "空港行き",
    stops: [],
  };
  const selectedDailyDirection = stopsDailyNormalized.directions[activeDirection] ?? {
    label: activeDirection === "from_airport" ? "市内行き" : "空港行き",
    stops: [],
  };

  useEffect(() => {
    if (!daily || !canvasRef.current || !Array.isArray(dailySeries)) return;
    const labels = buildHourLabels(5, 24);
    const series = buildSeriesForHours(labels, daily.hours, dailySeries);

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: latest.route_name || "阿蘇くまもと空港リムジンバス",
            data: series,
            borderColor: "#3f86e0",
            backgroundColor: "#3f86e0",
            tension: 0.32,
            spanGaps: false,
            pointRadius: 2,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) return "遅延: -";
                return `遅延: ${value}分`;
              },
            },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "遅延(分)" },
            beginAtZero: true,
          },
          x: {
            title: { display: true, text: "時間帯" },
            ticks: { maxTicksLimit: 12 },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [daily, dailySeries, latest.route_name]);

  return (
    <div className="visit-content">
      <section className="panel visitor-panel" id="visitor-current-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">阿蘇くまもと空港アクセス</div>
            <div className="panel-sub">県外来訪者向け / リムジンバス運行状況</div>
          </div>
          <span className="panel-chip">{formatDateTime(latest.updated_at)}</span>
        </div>

        <div className="visitor-route-row">
          <strong className="visitor-route-name">{latest.route_name}</strong>
          <span className="visitor-status-pill" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>

        <div className="visitor-kpi-grid">
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">現在</span>
            <strong className="visitor-kpi-value">{formatDelayShort(latest.delay_sec)}</strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">1時間後</span>
            <strong className="visitor-kpi-value">{formatDelayShort(h1)}</strong>
          </div>
          <div className="visitor-kpi">
            <span className="visitor-kpi-label">3時間後</span>
            <strong className="visitor-kpi-value">{formatDelayShort(h3)}</strong>
          </div>
        </div>

        <div className="visitor-note-row">
          <span className="visitor-note-label">補足</span>
          <span className="visitor-note-text">{latest.note || "予測モデルは準備中です"}</span>
        </div>
      </section>

      <section className="panel visitor-trend-panel" id="visitor-trend-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">今日の遅延推移</div>
            <div className="panel-sub">
              {daily?.date ?? "--"} ({daily?.timezone ?? "JST"}) / 05-24時
            </div>
          </div>
          <span className="panel-chip muted">データ蓄積後に精度向上</span>
        </div>
        {Array.isArray(dailySeries) ? (
          <div className="trend-chart">
            <div className="trend-scroll">
              <canvas ref={canvasRef} height="200" />
            </div>
          </div>
        ) : (
          <div className="visitor-empty">当日推移データを準備中です。</div>
        )}
      </section>

      <section className="panel visitor-stop-overview">
        <div className="panel-header">
          <div>
            <div className="panel-title">停留所別遅延</div>
            <div className="panel-sub">
              桜町バスターミナル ↔ 阿蘇くまもと空港（往復） / 05-24時
            </div>
          </div>
          <span className="panel-chip">{formatDateTime(stopsLatestNormalized.updated_at)}</span>
        </div>
        <div className="visitor-stop-overview-note">
          空港行き・市内行きそれぞれで、停留所ごとの現在遅延と当日推移を表示します。
        </div>
        <div className="direction-switch" role="tablist" aria-label="direction switch">
          {directionOptions.map((option) => (
            <button
              type="button"
              key={option.key}
              className={`direction-btn ${activeDirection === option.key ? "active" : ""}`}
              onClick={() => setActiveDirection(option.key)}
              role="tab"
              aria-selected={activeDirection === option.key}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <VisitorStopDirectionPanel
        directionKey={activeDirection}
        direction={selectedLatestDirection}
        dailyDirection={selectedDailyDirection}
        hours={stopsDailyNormalized.hours}
      />
    </div>
  );
};

const App = () => {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = readUISettings();
    if (saved?.activeTab === "visit") return "visit";
    if (saved?.activeTab === "commute") return "commute";
    return "shopping";
  });
  const [places, setPlaces] = useState(FALLBACK_PLACES.places);
  const [latest, setLatest] = useState(FALLBACK_LATEST);
  const [latestDetail, setLatestDetail] = useState(FALLBACK_LATEST_DETAIL);
  const [daily, setDaily] = useState(null);
  const [visitorLatest, setVisitorLatest] = useState(FALLBACK_VISITOR_LATEST);
  const [visitorDaily, setVisitorDaily] = useState(null);
  const [visitorStopsLatest, setVisitorStopsLatest] = useState(FALLBACK_VISITOR_STOPS_LATEST);
  const [visitorStopsDaily, setVisitorStopsDaily] = useState(FALLBACK_VISITOR_STOPS_DAILY);
  const [commuteLatest, setCommuteLatest] = useState(FALLBACK_COMMUTE_LATEST);
  const [commuteDaily, setCommuteDaily] = useState(FALLBACK_COMMUTE_DAILY);
  const [favorites, setFavorites] = useState([]);
  const [favoriteOnly, setFavoriteOnly] = useState(() => {
    const saved = readUISettings();
    return Boolean(saved?.favoriteOnly);
  });
  const [sortMode, setSortMode] = useState(() => {
    const saved = readUISettings();
    const mode = saved?.sortMode;
    if (mode === "recommend" || mode === "crowd" || mode === "distance") return mode;
    return "recommend";
  });
  const [selectedBaseId, setSelectedBaseId] = useState(() => {
    const saved = readUISettings();
    return typeof saved?.selectedBaseId === "string" ? saved.selectedBaseId : null;
  });
  const [useCurrentLocation, setUseCurrentLocation] = useState(() => {
    const saved = readUISettings();
    return saved?.baseMode === "current";
  });
  const [currentLocation, setCurrentLocation] = useState(() => {
    const saved = readUISettings();
    if (saved?.currentLocation && Number.isFinite(saved.currentLocation.lat) && Number.isFinite(saved.currentLocation.lon)) {
      return saved.currentLocation;
    }
    return null;
  });
  const [locationState, setLocationState] = useState("idle");
  const [locationFeedback, setLocationFeedback] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullReady, setPullReady] = useState(false);
  const pullStartYRef = useRef(0);
  const pullingRef = useRef(false);
  const pullReadyRef = useRef(false);

  const loadAllData = useCallback(async () => {
    const [
      placesData,
      latestData,
      latestDetailData,
      dailyData,
      commuteLatestData,
      commuteDailyData,
      airportLatestData,
      airportDailyData,
      airportStopsLatestData,
      airportStopsDailyData,
    ] =
      await Promise.all([
        fetchJson("/data/places.json", FALLBACK_PLACES),
        fetchJson("/data/latest.json", FALLBACK_LATEST),
        fetchJson("/data/latest_detail.json", FALLBACK_LATEST_DETAIL),
        fetchJson("/data/daily_delay.json", null),
        fetchJson("/data/commute_semicon_latest.json", FALLBACK_COMMUTE_LATEST),
        fetchJson("/data/commute_semicon_daily.json", FALLBACK_COMMUTE_DAILY),
        fetchJson("/data/visitor_airport_latest.json", FALLBACK_VISITOR_LATEST),
        fetchJson("/data/visitor_airport_daily.json", null),
        fetchJson("/data/visitor_airport_stops_latest.json", FALLBACK_VISITOR_STOPS_LATEST),
        fetchJson("/data/visitor_airport_stops_daily.json", FALLBACK_VISITOR_STOPS_DAILY),
      ]);

    const loadedPlaces = placesData?.places ?? FALLBACK_PLACES.places;
    setPlaces(loadedPlaces);
    setLatest(latestData ?? FALLBACK_LATEST);
    setLatestDetail(latestDetailData ?? FALLBACK_LATEST_DETAIL);
    setDaily(dailyData);
    setCommuteLatest(normalizeCommuteLatest(commuteLatestData));
    setCommuteDaily(normalizeCommuteDaily(commuteDailyData));
    setVisitorLatest(normalizeVisitorLatest(airportLatestData));
    setVisitorDaily(airportDailyData);
    setVisitorStopsLatest(normalizeVisitorStopsLatest(airportStopsLatestData));
    setVisitorStopsDaily(normalizeVisitorStopsDaily(airportStopsDailyData));
    setSelectedBaseId((prev) => {
      if (prev && loadedPlaces.some((place) => place.id === prev)) return prev;
      return loadedPlaces.length ? loadedPlaces[0].id : null;
    });
  }, []);

  const refreshAllData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadAllData();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAllData]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await loadAllData();
      if (!active) return;
      setIsRefreshing(false);
    };
    init();
    return () => {
      active = false;
    };
  }, [loadAllData]);

  useEffect(() => {
    if (!places.length) return;
    setSelectedBaseId((prev) => {
      if (prev && places.some((place) => place.id === prev)) return prev;
      return places[0].id;
    });
  }, [places]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setFavorites(parsed);
    } catch (error) {
      console.warn("failed to load favorites", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch (error) {
      console.warn("failed to save favorites", error);
    }
  }, [favorites]);

  useEffect(() => {
    try {
      const payload = {
        activeTab,
        sortMode,
        favoriteOnly,
        selectedBaseId,
        baseMode: useCurrentLocation ? "current" : "mall",
        currentLocation:
          currentLocation && Number.isFinite(currentLocation.lat) && Number.isFinite(currentLocation.lon)
            ? currentLocation
            : null,
      };
      localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("failed to save ui settings", error);
    }
  }, [activeTab, sortMode, favoriteOnly, selectedBaseId, useCurrentLocation, currentLocation]);

  useEffect(() => {
    const threshold = 74;

    const resetPull = () => {
      setPullDistance(0);
      setPullReady(false);
      pullReadyRef.current = false;
      pullingRef.current = false;
    };

    const onTouchStart = (event) => {
      if (isRefreshing) return;
      if (window.scrollY > 0) return;
      if (!event.touches || event.touches.length !== 1) return;
      if (event.target instanceof Element && event.target.closest(".map")) return;
      pullStartYRef.current = event.touches[0].clientY;
      pullingRef.current = true;
      pullReadyRef.current = false;
    };

    const onTouchMove = (event) => {
      if (!pullingRef.current) return;
      if (!event.touches || event.touches.length !== 1) return;
      const delta = event.touches[0].clientY - pullStartYRef.current;
      if (delta <= 0) {
        setPullDistance(0);
        setPullReady(false);
        pullReadyRef.current = false;
        return;
      }
      const eased = Math.min(118, delta * 0.58);
      const ready = eased >= threshold;
      setPullDistance(eased);
      setPullReady(ready);
      pullReadyRef.current = ready;
    };

    const onTouchEnd = async () => {
      if (!pullingRef.current) return;
      const shouldRefresh = pullReadyRef.current && !isRefreshing;
      resetPull();
      if (!shouldRefresh) return;
      await refreshAllData();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isRefreshing, refreshAllData]);

  const updatedAt = latest.updated_at || latestDetail.updated_at || "";
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  const selectedBasePlace = useMemo(() => {
    return places.find((place) => place.id === selectedBaseId) ?? null;
  }, [places, selectedBaseId]);

  const anchorPoint = useMemo(() => {
    if (useCurrentLocation && currentLocation) {
      return { lat: currentLocation.lat, lon: currentLocation.lon, label: "現在地" };
    }
    if (!selectedBasePlace) return null;
    const lat = Number(selectedBasePlace.lat);
    const lon = Number(selectedBasePlace.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return {
      lat,
      lon,
      label: NAME_OVERRIDES[selectedBasePlace.name] || selectedBasePlace.name,
    };
  }, [useCurrentLocation, currentLocation, selectedBasePlace]);

  const anchorLabel = anchorPoint?.label ?? "基準未設定";

  const mallItems = useMemo(() => {
    return places.map((place) => {
      const detail = latestDetail.malls?.[place.id] ?? null;
      const statusKey = latest.statuses[place.id] || detail?.status || "unknown";
      const meta = STATUS_META[statusKey] || STATUS_META.unknown;
      const distanceKm = anchorPoint
        ? haversineKm(anchorPoint.lat, anchorPoint.lon, place.lat, place.lon)
        : null;
      const mapPoint = resolveMapPoint(place);
      return {
        id: place.id,
        place,
        displayName: NAME_OVERRIDES[place.name] || place.name,
        statusKey,
        meta,
        delayLabel: formatDelay(detail?.delay_sec),
        delayMinutes: toMinutes(detail?.delay_sec),
        distanceKm,
        mapX: mapPoint.x,
        mapY: mapPoint.y,
      };
    });
  }, [places, latest, latestDetail, anchorPoint]);

  const filteredItems = useMemo(() => {
    if (!favoriteOnly) return mallItems;
    return mallItems.filter((item) => favoritesSet.has(item.id));
  }, [mallItems, favoriteOnly, favoritesSet]);

  const recommendedItems = useMemo(() => {
    if (!filteredItems.length) return [];
    const distances = filteredItems
      .map((item) => item.distanceKm)
      .filter((value) => Number.isFinite(value));
    const maxDistance = distances.length ? Math.max(1, ...distances) : 1;
    const enriched = filteredItems.map((item) => {
      const crowdRank = (FAVORABLE_PRIORITY[item.statusKey] ?? 4) / 4;
      const distanceRank = Number.isFinite(item.distanceKm) ? item.distanceKm / maxDistance : 1;
      return {
        ...item,
        recommendationScore: crowdRank * 0.65 + distanceRank * 0.35,
      };
    });
    return enriched.sort((a, b) => {
      if (a.recommendationScore !== b.recommendationScore) {
        return a.recommendationScore - b.recommendationScore;
      }
      if (a.delayMinutes !== b.delayMinutes) return a.delayMinutes - b.delayMinutes;
      return a.displayName.localeCompare(b.displayName, "ja");
    });
  }, [filteredItems]);

  const listItems = useMemo(() => {
    if (sortMode === "recommend") return recommendedItems;
    if (sortMode === "crowd") {
      return [...filteredItems].sort((a, b) => {
        const left = FAVORABLE_PRIORITY[a.statusKey] ?? 99;
        const right = FAVORABLE_PRIORITY[b.statusKey] ?? 99;
        if (left !== right) return left - right;
        const d1 = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY;
        const d2 = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY;
        if (d1 !== d2) return d1 - d2;
        return a.displayName.localeCompare(b.displayName, "ja");
      });
    }
    return [...filteredItems].sort((a, b) => {
      const d1 = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY;
      const d2 = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY;
      if (d1 !== d2) return d1 - d2;
      const left = FAVORABLE_PRIORITY[a.statusKey] ?? 99;
      const right = FAVORABLE_PRIORITY[b.statusKey] ?? 99;
      if (left !== right) return left - right;
      return a.displayName.localeCompare(b.displayName, "ja");
    });
  }, [filteredItems, recommendedItems, sortMode]);

  const crowdedCount = useMemo(() => {
    return filteredItems.filter((item) => item.statusKey === "high" || item.statusKey === "very_high")
      .length;
  }, [filteredItems]);

  const recommendedNow = recommendedItems.slice(0, 2);

  const bestHourOverall = useMemo(() => {
    const ids = filteredItems.map((item) => item.id);
    return pickBestHourOverall(daily, ids);
  }, [daily, filteredItems]);

  const toggleFavorite = (id) => {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const selectBaseMall = (id) => {
    setSelectedBaseId(id);
    setUseCurrentLocation(false);
    setLocationState("idle");
    setLocationFeedback("");
  };

  const requestCurrentLocation = useCallback((options = {}) => {
    const silent = Boolean(options.silent);
    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setLocationState("insecure");
      setUseCurrentLocation(false);
      if (!silent) {
        setLocationFeedback("位置情報はHTTPS配信でのみ利用できます。");
      }
      return;
    }

    if (!navigator.geolocation) {
      setLocationState("unsupported");
      setUseCurrentLocation(false);
      if (!silent) {
        setLocationFeedback("この端末では位置情報を利用できません。");
      }
      return;
    }

    setLocationState("loading");
    if (!silent) {
      setLocationFeedback("現在地を取得しています...");
    }

    let completed = false;
    const guardTimer = window.setTimeout(() => {
      if (completed) return;
      completed = true;
      setLocationState("timeout");
      setUseCurrentLocation(false);
      setLocationFeedback("位置情報の取得がタイムアウトしました。電波の良い場所で再度お試しください。");
    }, 17000);

    const finalize = () => {
      window.clearTimeout(guardTimer);
      completed = true;
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (completed) return;
        finalize();
        setCurrentLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
        setUseCurrentLocation(true);
        setLocationState("granted");
        setLocationFeedback(
          `現在地を基準に更新しました（精度: ${Math.round(position.coords.accuracy || 0)}m）`
        );
      },
      (error) => {
        if (completed) return;
        finalize();
        const code = Number(error?.code);
        if (code === 1) {
          setLocationState("denied");
          setLocationFeedback(
            "位置情報が拒否されています。iPhoneは設定 > Safari > 位置情報 から許可してください。"
          );
        } else if (code === 3) {
          setLocationState("timeout");
          setLocationFeedback("位置情報の取得がタイムアウトしました。");
        } else {
          setLocationState("error");
          setLocationFeedback("位置情報の取得に失敗しました。しばらくして再度お試しください。");
        }
        setUseCurrentLocation(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000,
      }
    );
  }, []);

  useEffect(() => {
    if (!useCurrentLocation) return;
    if (currentLocation) return;
    requestCurrentLocation({ silent: true });
  }, [useCurrentLocation, currentLocation, requestCurrentLocation]);

  const locationHint = useMemo(() => {
    if (useCurrentLocation && locationState === "granted") return "現在地を基準に並べています";
    if (locationState === "denied") {
      return "位置情報が使えないため、選択した施設を基準にしています";
    }
    if (locationState === "insecure") {
      return "位置情報はHTTPS配信時のみ利用できます";
    }
    if (locationState === "timeout") {
      return "位置情報の取得が遅いため、施設基準で表示しています";
    }
    if (locationState === "error") {
      return "位置情報の取得エラーにより、施設基準で表示しています";
    }
    if (locationState === "unsupported") return "このブラウザでは位置情報を利用できません";
    return "位置情報は任意です。使わない場合は施設選択基準で表示します";
  }, [useCurrentLocation, locationState]);

  const shareCurrentStatus = async () => {
    const url = window.location.href;
    let text = "";
    if (activeTab === "shopping") {
      const topName = recommendedNow[0]?.displayName ?? "各モール";
      const secondName = recommendedNow[1]?.displayName ?? "-";
      text = `熊本市混雑ナビ: ${anchorLabel}基準で今行くなら ${topName} / 次点 ${secondName} / 狙い目 ${formatHourLabel(bestHourOverall)} (${formatDateTime(updatedAt)})`;
    } else if (activeTab === "visit") {
      const meta = VISITOR_STATUS_META[visitorLatest.status] || VISITOR_STATUS_META.unknown;
      text = `熊本来熊バス情報: ${visitorLatest.route_name} ${meta.label} / 現在遅延 ${formatDelayShort(visitorLatest.delay_sec)} (${formatDateTime(visitorLatest.updated_at)})`;
    } else {
      const current = medianFinite((commuteLatest.stops ?? []).map((stop) => stop.delay_sec));
      const h1 = medianFinite((commuteLatest.stops ?? []).map((stop) => stop?.predictions?.h1_sec));
      text = `熊本通勤ナビ: セミコンテクノパーク周辺 / 現在遅延 ${formatDelayShort(current)} / 1時間後 ${formatDelayShort(h1)} (${formatDateTime(commuteLatest.updated_at)})`;
    }

    if (navigator.share) {
      try {
        await navigator.share({ title: "熊本市 混雑ナビ", text, url });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app-shell">
      <div className="sky-layer sky-layer-one" />
      <div className="sky-layer sky-layer-two" />

      <div className="app">
        <header className="weather-hero">
          <div className="hero-top">
            <div className="header-title">
              <span className="header-city">熊本市</span>
              <span className="header-sub">
                {activeTab === "shopping"
                  ? "買物 混雑ナビ"
                  : activeTab === "commute"
                    ? "通勤 混雑ナビ"
                    : "来熊 バス遅延ナビ"}
              </span>
            </div>
            <div className="hero-time-card">
              <span className="meta-label">最終更新</span>
              <span className="meta-value">
                {activeTab === "shopping"
                  ? formatDateTime(updatedAt)
                  : activeTab === "commute"
                    ? formatDateTime(commuteLatest.updated_at)
                    : formatDateTime(visitorLatest.updated_at)}
              </span>
            </div>
          </div>
          <div className="hero-caption">
            {activeTab === "shopping"
              ? "空いている順に、近くのモールをすばやく比較できます"
              : activeTab === "commute"
                ? "セミコンテクノパーク周辺停留所の遅延をまとめて確認できます"
                : "阿蘇くまもと空港アクセスの遅延を把握できます"}
          </div>
        </header>

        <div
          className={`pull-refresh-indicator ${pullDistance > 0 || isRefreshing ? "visible" : ""}`}
          style={{
            transform: `translate(-50%, ${-46 + pullDistance}px)`,
          }}
          aria-live="polite"
        >
          {isRefreshing ? "更新中..." : pullReady ? "離して更新" : "下に引いて更新"}
        </div>

        {activeTab === "shopping" ? (
          <>
            <section className="decision-strip" aria-label="recommendation">
              <div className="decision-card now">
                <span className="decision-label">今行くなら（{anchorLabel}基準）</span>
                <strong className="decision-value">
                  {recommendedNow.length ? recommendedNow[0].displayName : "データ準備中"}
                </strong>
                <span className="decision-note">
                  {recommendedNow[1] ? `次点: ${recommendedNow[1].displayName}` : "候補データ不足"}
                </span>
                <span className="decision-trial">※試験表示（参考値）</span>
              </div>
              <div className="decision-card time">
                <span className="decision-label">狙い目時間</span>
                <strong className="decision-value">{formatHourLabel(bestHourOverall)}</strong>
                <span className="decision-note">
                  {crowdedCount > 0 ? `現在混雑スポット ${crowdedCount}件` : "比較的おだやかです"}
                </span>
                <span className="decision-trial">※試験表示（参考値）</span>
              </div>
            </section>

            <section className="hero-actions living" aria-label="shopping actions">
              <button
                type="button"
                className={`action-btn ${favoriteOnly ? "active" : ""}`}
                onClick={() => setFavoriteOnly((prev) => !prev)}
              >
                {favoriteOnly ? "お気に入りのみ表示中" : "お気に入りのみ表示"}
              </button>
              <button type="button" className="action-btn secondary" onClick={shareCurrentStatus}>
                共有
              </button>
              <button
                type="button"
                className="action-btn tertiary"
                onClick={refreshAllData}
                disabled={isRefreshing}
              >
                {isRefreshing ? "更新中..." : "更新"}
              </button>
            </section>

            <section className="base-selector" aria-label="base selection">
              <div className="base-header">
                <span className="base-label">並び順の基準</span>
                <button
                  type="button"
                  className={`base-current-btn ${useCurrentLocation ? "active" : ""}`}
                  onClick={requestCurrentLocation}
                  disabled={locationState === "loading"}
                >
                  {locationState === "loading" ? "現在地を取得中..." : "現在地を使う"}
                </button>
              </div>
              <div className="base-chip-row">
                {places.map((place) => {
                  const isActive = !useCurrentLocation && selectedBaseId === place.id;
                  return (
                    <button
                      type="button"
                      key={place.id}
                      className={`base-chip ${isActive ? "active" : ""}`}
                      onClick={() => selectBaseMall(place.id)}
                    >
                      {NAME_OVERRIDES[place.name] || place.name}
                    </button>
                  );
                })}
              </div>
              <div className="base-note">{locationHint}</div>
              {locationFeedback ? <div className="base-feedback">{locationFeedback}</div> : null}
            </section>

            <main className="content">
              <MallList
                items={listItems}
                favoritesSet={favoritesSet}
                onToggleFavorite={toggleFavorite}
                sortMode={sortMode}
                onSortModeChange={setSortMode}
                anchorLabel={anchorLabel}
              />
              <TrendChart daily={daily} />
              <MapView items={filteredItems} />
            </main>
          </>
        ) : activeTab === "commute" ? (
          <>
            <section className="hero-actions single" aria-label="commute actions">
              <div className="visitor-actions-row">
                <button type="button" className="action-btn secondary full" onClick={shareCurrentStatus}>
                  通勤向け情報を共有
                </button>
                <button
                  type="button"
                  className="action-btn tertiary"
                  onClick={refreshAllData}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "更新中..." : "更新"}
                </button>
              </div>
            </section>
            <CommuteDashboard latest={commuteLatest} daily={commuteDaily} />
          </>
        ) : (
          <>
            <section className="hero-actions single" aria-label="visit actions">
              <div className="visitor-actions-row">
                <button type="button" className="action-btn secondary full" onClick={shareCurrentStatus}>
                  来熊向け情報を共有
                </button>
                <button
                  type="button"
                  className="action-btn tertiary"
                  onClick={refreshAllData}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "更新中..." : "更新"}
                </button>
              </div>
            </section>
            <VisitorDashboard
              latest={visitorLatest}
              daily={visitorDaily}
              stopsLatest={visitorStopsLatest}
              stopsDaily={visitorStopsDaily}
            />
          </>
        )}

        <nav className="page-tabs" aria-label="page tabs">
          <button
            type="button"
            className={`page-tab ${activeTab === "shopping" ? "active" : ""}`}
            onClick={() => setActiveTab("shopping")}
          >
            買物
          </button>
          <button
            type="button"
            className={`page-tab ${activeTab === "commute" ? "active" : ""}`}
            onClick={() => setActiveTab("commute")}
          >
            通勤
          </button>
          <button
            type="button"
            className={`page-tab ${activeTab === "visit" ? "active" : ""}`}
            onClick={() => setActiveTab("visit")}
          >
            来熊
          </button>
        </nav>
      </div>
    </div>
  );
};

export default App;
