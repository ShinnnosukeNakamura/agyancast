import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parse as parseCsv } from 'csv-parse/sync';
import { transit_realtime } from 'gtfs-realtime-bindings';
// Note: Bronze output is JSONL for now to keep Lambda stable.

const s3 = new S3Client({});

const dataBucket = process.env.DATA_BUCKET ?? '';
const rawPrefix = process.env.RAW_PREFIX ?? 'raw/';
const bronzePrefix = process.env.BRONZE_PREFIX ?? 'bronze/';
const silverPrefix = process.env.SILVER_PREFIX ?? 'silver/';
const masterSpotsKey = process.env.MASTER_SPOTS_KEY ?? 'master/spots.csv';
const webBucket = process.env.WEB_BUCKET ?? '';
const fillMaxAgeMinutes = Number.parseInt(process.env.FILL_MAX_AGE_MINUTES ?? '180', 10);
const timezone = process.env.TIMEZONE ?? 'Asia/Tokyo';

const VISITOR_AIRPORT_ROUTE_ID = 'aso_airport_limousine';
const VISITOR_AIRPORT_ROUTE_NAME = '阿蘇くまもと空港リムジンバス';
const VISITOR_AIRPORT_COMPANY = 'sankobus';
const VISITOR_AIRPORT_STOP_IDS = new Set(['102112_1', '102112_3', '102112_4', '102112_5']);
const COMMUTE_SEMICON_AREA_ID = 'semicon_techno_park';
const COMMUTE_SEMICON_AREA_NAME = 'セミコンテクノパーク周辺';
const COMMUTE_SECTION_FROM_STOP_ID = '100879_1';
const COMMUTE_SECTION_TO_STOP_ID = '100880_1';
const COMMUTE_SECTION_NAME = '原水駅北口→県立技術短期大学前';
const COMMUTE_SECTION_DISTANCE_KM = 2.4;
const COMMUTE_TRAFFIC_MIN_SAMPLES = 3;
const COMMUTE_TRAFFIC_CONGESTED_KMH = 15;
const COMMUTE_TRAFFIC_VERY_CONGESTED_KMH = 8;
type VisitorDirection = 'to_airport' | 'from_airport';
type VisitorStopDef = { stop_id: string; stop_name: string };
type CommuteStopDef = {
  operator: string;
  stop_id: string;
  stop_name: string;
  lat: number;
  lon: number;
};

const COMMUTE_SEMICON_STOPS: CommuteStopDef[] = [
  {
    operator: 'dentetsu',
    stop_id: '100880_1',
    stop_name: '県立技術短期大学前',
    lat: 32.887573,
    lon: 130.83466,
  },
  {
    operator: 'sankobus',
    stop_id: '100880_1',
    stop_name: '県立技術短期大学前',
    lat: 32.887573,
    lon: 130.83466,
  },
];

const VISITOR_AIRPORT_ROUTE_PATTERNS: Record<VisitorDirection, RegExp[]> = {
  to_airport: [
    /^721_721040_/,
    /^721_721050_/,
    /^721_721060_/,
    /^721_721070_/,
  ],
  from_airport: [
    /^721_721041_/,
    /^721_721051_/,
    /^721_721061_/,
    /^721_721071_/,
  ],
};

const VISITOR_AIRPORT_STOPS_BY_DIRECTION: Record<VisitorDirection, VisitorStopDef[]> = {
  to_airport: [
    { stop_id: '100002_6', stop_name: '熊本桜町バスターミナル(6番のりば)' },
    { stop_id: '100003_2', stop_name: '通町筋' },
    { stop_id: '100715_2', stop_name: '味噌天神' },
    { stop_id: '100572_2', stop_name: '水前寺公園前' },
    { stop_id: '100183_2', stop_name: '熊本県庁前' },
    { stop_id: '102664_2', stop_name: '自衛隊前' },
    { stop_id: '103922_2', stop_name: '東町中央' },
    { stop_id: '104244_2', stop_name: '益城インター口 P' },
    { stop_id: '102177_2', stop_name: 'グランメッセ前' },
    { stop_id: '103333_2', stop_name: '臨空テクノパーク西' },
    { stop_id: '103319_2', stop_name: '臨空テクノパーク東' },
    { stop_id: '102112_1', stop_name: '阿蘇くまもと空港(乗車：4番のりば　※特快バスは3番のりば)' },
  ],
  from_airport: [
    { stop_id: '102112_4', stop_name: '阿蘇くまもと空港(降車：4番のりば)' },
    { stop_id: '103319_1', stop_name: '臨空テクノパーク東' },
    { stop_id: '103333_1', stop_name: '臨空テクノパーク西' },
    { stop_id: '102177_1', stop_name: 'グランメッセ前' },
    { stop_id: '104244_1', stop_name: '益城インター口 P' },
    { stop_id: '103922_1', stop_name: '東町中央' },
    { stop_id: '102664_1', stop_name: '自衛隊前' },
    { stop_id: '100183_1', stop_name: '熊本県庁前' },
    { stop_id: '100572_1', stop_name: '水前寺公園前' },
    { stop_id: '100715_1', stop_name: '味噌天神' },
    { stop_id: '100003_1', stop_name: '通町筋' },
    { stop_id: '100002_9', stop_name: '熊本桜町バスターミナル(9番のりば)' },
  ],
};

const VISITOR_AIRPORT_STOP_ID_SET_BY_DIRECTION: Record<VisitorDirection, Set<string>> = {
  to_airport: new Set(VISITOR_AIRPORT_STOPS_BY_DIRECTION.to_airport.map((stop) => stop.stop_id)),
  from_airport: new Set(VISITOR_AIRPORT_STOPS_BY_DIRECTION.from_airport.map((stop) => stop.stop_id)),
};

type SpotRow = {
  mall_name: string;
  company: string;
  stop_id: string;
  stop_lat?: number;
  stop_lon?: number;
  mall_lat?: number;
  mall_lon?: number;
};

type StopState = {
  delay_sec: number;
  observed_at: string;
};

type LastState = {
  updated_at: string;
  stops: Record<string, StopState>;
};

type CommuteTrafficStatus = 'smooth' | 'congested' | 'very_congested' | 'unknown';

type CommuteTraffic = {
  section_name: string;
  from_stop_id: string;
  to_stop_id: string;
  distance_km: number;
  avg_speed_kmh: number | null;
  status: CommuteTrafficStatus;
  sample_count: number;
};

const getJstParts = (date: Date) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const dt = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour;
  const minute = parts.minute;
  const second = parts.second;
  const iso = `${dt}T${hour}:${minute}:${second}+09:00`;
  return { dt, hour, minute, second, iso };
};

const toJstIso = (ms: number) => getJstParts(new Date(ms)).iso;

const streamToBuffer = async (stream: any) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const loadSpots = async (): Promise<SpotRow[]> => {
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: dataBucket,
      Key: masterSpotsKey,
    })
  );
  const body = await streamToBuffer(obj.Body as any);
  const records = parseCsv(body.toString('utf-8'), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  return records.map((r: any) => ({
    mall_name: r.mall_name,
    company: r.company,
    stop_id: r.stop_id,
    stop_lat: r.stop_lat ? Number.parseFloat(r.stop_lat) : undefined,
    stop_lon: r.stop_lon ? Number.parseFloat(r.stop_lon) : undefined,
    mall_lat: r.mall_lat ? Number.parseFloat(r.mall_lat) : undefined,
    mall_lon: r.mall_lon ? Number.parseFloat(r.mall_lon) : undefined,
  }));
};

const MALL_COORD_OVERRIDES: Record<string, [number, number]> = {
  'ゆめタウン浜線': [32.7715579, 130.7265314],
};

const buildPlaces = (spots: SpotRow[], generatedAt: string) => {
  const mallMap = new Map<string, { latSum: number; lonSum: number; count: number }>();
  const mallCoords = new Map<string, { lat: number; lon: number }>();
  const lats: number[] = [];
  const lons: number[] = [];

  for (const spot of spots) {
    const mallLat = spot.mall_lat;
    const mallLon = spot.mall_lon;
    if (mallLat !== undefined && !Number.isNaN(mallLat) && mallLon !== undefined && !Number.isNaN(mallLon)) {
      if (!mallCoords.has(spot.mall_name)) {
        mallCoords.set(spot.mall_name, { lat: mallLat, lon: mallLon });
      }
    }

    const lat = spot.stop_lat;
    const lon = spot.stop_lon;
    if (lat === undefined || Number.isNaN(lat)) continue;
    if (lon === undefined || Number.isNaN(lon)) continue;
    const entry = mallMap.get(spot.mall_name) ?? { latSum: 0, lonSum: 0, count: 0 };
    entry.latSum += lat;
    entry.lonSum += lon;
    entry.count += 1;
    mallMap.set(spot.mall_name, entry);
    lats.push(lat);
    lons.push(lon);
  }

  mallCoords.forEach((coord, name) => {
    lats.push(coord.lat);
    lons.push(coord.lon);
    if (!mallMap.has(name)) {
      mallMap.set(name, { latSum: coord.lat, lonSum: coord.lon, count: 1 });
    }
  });

  Object.entries(MALL_COORD_OVERRIDES).forEach(([name, [lat, lon]]) => {
    lats.push(lat);
    lons.push(lon);
    if (!mallMap.has(name)) {
      mallMap.set(name, { latSum: lat, lonSum: lon, count: 1 });
    }
  });

  if (lats.length === 0 || lons.length === 0) {
    return null;
  }

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = maxLat - minLat;
  const lonRange = maxLon - minLon;
  const latPad = Math.max(0.035, latRange * 0.4);
  const lonPad = Math.max(0.05, lonRange * 0.4);

  const bounds = {
    min_lat: minLat - latPad,
    max_lat: maxLat + latPad,
    min_lon: minLon - lonPad,
    max_lon: maxLon + lonPad,
  };

  const places = Array.from(mallMap.entries()).map(([name, entry]) => {
    const explicit = mallCoords.get(name);
    const override = MALL_COORD_OVERRIDES[name];
    const lat = explicit?.lat ?? override?.[0] ?? entry.latSum / entry.count;
    const lon = explicit?.lon ?? override?.[1] ?? entry.lonSum / entry.count;
    const x = ((lon - bounds.min_lon) / (bounds.max_lon - bounds.min_lon)) * 100;
    const y = ((bounds.max_lat - lat) / (bounds.max_lat - bounds.min_lat)) * 100;
    return {
      id: name,
      name,
      lat,
      lon,
      x: Number.parseFloat(x.toFixed(2)),
      y: Number.parseFloat(y.toFixed(2)),
    };
  });

  places.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return {
    generated_at: generatedAt,
    bounds,
    places,
  };
};

const loadLastState = async (): Promise<LastState> => {
  const key = `${silverPrefix}state/last_stop_delay.json`;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: dataBucket, Key: key }));
    const body = await streamToBuffer(obj.Body as any);
    return JSON.parse(body.toString('utf-8')) as LastState;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') {
      return { updated_at: '', stops: {} };
    }
    console.warn('loadLastState failed, using empty', err);
    return { updated_at: '', stops: {} };
  }
};

const saveLastState = async (state: LastState) => {
  const key = `${silverPrefix}state/last_stop_delay.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: key,
      Body: JSON.stringify(state, null, 2),
      ContentType: 'application/json',
    })
  );
};

const listLatestTripUpdate = async (company: string, dates: string[]) => {
  const candidates: { key: string; dt: string; hour: string; minute: string }[] = [];
  for (const dt of dates) {
    const prefix = `${rawPrefix}company=${company}/dt=${dt}/`;
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: dataBucket,
        Prefix: prefix,
      })
    );
    for (const item of listed.Contents ?? []) {
      if (!item.Key || !item.Key.endsWith('trip_update.bin')) continue;
      const match = item.Key.match(/dt=(\d{4}-\d{2}-\d{2})\/hour=(\d{2})\/minute=(\d{2})\//);
      if (!match) continue;
      candidates.push({ key: item.Key, dt: match[1], hour: match[2], minute: match[3] });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aKey = `${a.dt}-${a.hour}-${a.minute}`;
    const bKey = `${b.dt}-${b.hour}-${b.minute}`;
    return aKey.localeCompare(bKey);
  });
  return candidates[candidates.length - 1];
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const toEpochMillis = (seconds: any) => {
  if (seconds === null || seconds === undefined) return null;
  if (typeof seconds === 'number') return seconds * 1000;
  return Number(seconds) * 1000;
};

const toEpochSeconds = (seconds: any) => {
  if (seconds === null || seconds === undefined) return null;
  const value = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(value)) return null;
  return value;
};

const statusFromDelay = (delaySec: number) => {
  if (delaySec < 300) return 'low';
  if (delaySec < 600) return 'medium';
  if (delaySec < 1800) return 'high';
  return 'very_high';
};

const detectVisitorAirportDirection = (routeId: string | null): VisitorDirection | null => {
  if (!routeId) return null;
  if (VISITOR_AIRPORT_ROUTE_PATTERNS.to_airport.some((pattern) => pattern.test(routeId))) {
    return 'to_airport';
  }
  if (VISITOR_AIRPORT_ROUTE_PATTERNS.from_airport.some((pattern) => pattern.test(routeId))) {
    return 'from_airport';
  }
  return null;
};

const buildVisitorAirportLatest = (updatedAt: string, delays: number[]) => {
  const med = median(delays);
  if (med === null) {
    return {
      updated_at: updatedAt,
      route_id: VISITOR_AIRPORT_ROUTE_ID,
      route_name: VISITOR_AIRPORT_ROUTE_NAME,
      status: 'unknown',
      delay_sec: null,
      note: '対象便のデータが不足しています',
      predictions: {
        h1_sec: null,
        h3_sec: null,
      },
    };
  }

  let status = 'delayed';
  let note = '10分以上の遅れが発生しています';
  if (med < 300) {
    status = 'on_time';
    note = '概ね定刻で運行しています';
  } else if (med < 600) {
    status = 'slight_delay';
    note = '最大10分程度の遅れが見込まれます';
  }

  return {
    updated_at: updatedAt,
    route_id: VISITOR_AIRPORT_ROUTE_ID,
    route_name: VISITOR_AIRPORT_ROUTE_NAME,
    status,
    delay_sec: Math.round(med),
    note,
    predictions: {
      h1_sec: null,
      h3_sec: null,
    },
  };
};

const buildVisitorAirportStopsLatest = (
  updatedAt: string,
  delaysByDirection: Record<VisitorDirection, Record<string, number[]>>
) => {
  const buildDirection = (direction: VisitorDirection, label: string) => ({
    label,
    stops: VISITOR_AIRPORT_STOPS_BY_DIRECTION[direction].map((stop) => {
      const med = median(delaysByDirection[direction][stop.stop_id] ?? []);
      return {
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        delay_sec: med === null ? null : Math.round(med),
      };
    }),
  });

  return {
    updated_at: updatedAt,
    route_id: VISITOR_AIRPORT_ROUTE_ID,
    route_name: VISITOR_AIRPORT_ROUTE_NAME,
    directions: {
      to_airport: buildDirection('to_airport', '空港行き'),
      from_airport: buildDirection('from_airport', '市内行き'),
    },
  };
};

const getFreshDelaySec = (state: LastState, key: string, nowMs: number, maxAgeMs: number): number | null => {
  const item = state.stops[key];
  if (!item) return null;
  const observedAtMs = Date.parse(item.observed_at);
  if (Number.isNaN(observedAtMs)) return null;
  if (nowMs - observedAtMs > maxAgeMs) return null;
  return Math.max(0, Number(item.delay_sec));
};

const statusFromSpeed = (speedKmh: number | null, sampleCount: number): CommuteTrafficStatus => {
  if (speedKmh === null) return 'unknown';
  if (sampleCount < COMMUTE_TRAFFIC_MIN_SAMPLES) return 'unknown';
  if (speedKmh <= COMMUTE_TRAFFIC_VERY_CONGESTED_KMH) return 'very_congested';
  if (speedKmh <= COMMUTE_TRAFFIC_CONGESTED_KMH) return 'congested';
  return 'smooth';
};

const extractCommuteSectionSpeed = (stopTimeUpdates: any[]): number | null => {
  if (!Array.isArray(stopTimeUpdates) || stopTimeUpdates.length === 0) return null;

  let fromTimeSec: number | null = null;
  let toTimeSec: number | null = null;
  let fromSeq: number | null = null;
  let toSeq: number | null = null;

  for (const stu of stopTimeUpdates) {
    const stopId = stu?.stopId;
    if (!stopId) continue;
    const eventTimeSec = toEpochSeconds(stu?.arrival?.time ?? stu?.departure?.time ?? null);
    if (eventTimeSec === null) continue;
    if (stopId === COMMUTE_SECTION_FROM_STOP_ID) {
      fromTimeSec = eventTimeSec;
      fromSeq = stu?.stopSequence ?? null;
    } else if (stopId === COMMUTE_SECTION_TO_STOP_ID) {
      toTimeSec = eventTimeSec;
      toSeq = stu?.stopSequence ?? null;
    }
  }

  if (fromTimeSec === null || toTimeSec === null) return null;
  if (fromSeq !== null && toSeq !== null && Number(toSeq) <= Number(fromSeq)) return null;

  const travelSec = toTimeSec - fromTimeSec;
  if (!(travelSec > 0 && travelSec <= 2 * 60 * 60)) return null;

  return (COMMUTE_SECTION_DISTANCE_KM * 3600) / travelSec;
};

const buildCommuteSemiconLatest = (
  updatedAt: string,
  state: LastState,
  nowMs: number,
  maxAgeMs: number,
  sectionSpeedSamples: number[]
) => ({
  updated_at: updatedAt,
  area_id: COMMUTE_SEMICON_AREA_ID,
  area_name: COMMUTE_SEMICON_AREA_NAME,
  stops: COMMUTE_SEMICON_STOPS.map((stop) => {
    const key = `${stop.operator}::${stop.stop_id}`;
    const delaySec = getFreshDelaySec(state, key, nowMs, maxAgeMs);
    return {
      ...stop,
      delay_sec: delaySec === null ? null : Math.round(delaySec),
      predictions: {
        h1_sec: null,
        h3_sec: null,
      },
    };
  }),
  traffic: (() => {
    const sampleCount = sectionSpeedSamples.length;
    const avgSpeed = median(sectionSpeedSamples);
    const roundedSpeed = avgSpeed === null ? null : Number(avgSpeed.toFixed(1));
    return {
      section_name: COMMUTE_SECTION_NAME,
      from_stop_id: COMMUTE_SECTION_FROM_STOP_ID,
      to_stop_id: COMMUTE_SECTION_TO_STOP_ID,
      distance_km: COMMUTE_SECTION_DISTANCE_KM,
      avg_speed_kmh: roundedSpeed,
      status: statusFromSpeed(roundedSpeed, sampleCount),
      sample_count: sampleCount,
    } satisfies CommuteTraffic;
  })(),
});

const latestJsonKey = `${silverPrefix}latest.json`;
const latestDetailKey = `${silverPrefix}latest_detail.json`;
const visitorAirportLatestKey = `${silverPrefix}visitor/airport_latest.json`;
const visitorAirportStopsLatestKey = `${silverPrefix}visitor/airport_stops_latest.json`;
const commuteSemiconLatestKey = `${silverPrefix}commute/semicon_latest.json`;

export const handler = async () => {
  if (!dataBucket) {
    throw new Error('DATA_BUCKET is required');
  }

  const now = new Date();
  const { dt, hour, minute, iso } = getJstParts(now);
  const dates = [dt];
  const previousDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { dt: prevDt } = getJstParts(previousDate);
  if (prevDt !== dt) dates.push(prevDt);

  const spots = await loadSpots();
  const companies = Array.from(new Set(spots.map((s) => s.company)));
  const lastState = await loadLastState();
  const maxAgeMs = fillMaxAgeMinutes * 60 * 1000;
  const nowMs = now.getTime();

  const delayByStop: Record<string, StopState> = {};
  const bronzeRows: any[] = [];
  const visitorAirportDelays: number[] = [];
  const visitorAirportStopDelaySamples: Record<VisitorDirection, Record<string, number[]>> = {
    to_airport: {},
    from_airport: {},
  };
  const commuteSectionSpeedSamples: number[] = [];

  for (const company of companies) {
    const latest = await listLatestTripUpdate(company, dates);
    if (!latest) {
      console.warn(`no trip_update for ${company}`);
      continue;
    }

    const obj = await s3.send(new GetObjectCommand({ Bucket: dataBucket, Key: latest.key }));
    const buffer = await streamToBuffer(obj.Body as any);
    const feed = transit_realtime.FeedMessage.decode(buffer);

    const feedTimestampMs = toEpochMillis(feed.header?.timestamp ?? null);

    feed.entity.forEach((entity: any) => {
      if (!entity.tripUpdate) return;
      const tripUpdate = entity.tripUpdate;
      const tripId = tripUpdate.trip?.tripId ?? null;
      const routeId = tripUpdate.trip?.routeId ?? null;
      const eventTimeMs =
        toEpochMillis(tripUpdate.timestamp ?? null) ?? feedTimestampMs ?? nowMs;
      const commuteSectionSpeed = extractCommuteSectionSpeed(tripUpdate.stopTimeUpdate ?? []);
      if (commuteSectionSpeed !== null) {
        commuteSectionSpeedSamples.push(commuteSectionSpeed);
        bronzeRows.push({
          event_time: new Date(eventTimeMs),
          ingest_time: now,
          company,
          feed_type: 'commute_section_speed',
          trip_id: tripId,
          route_id: routeId,
          stop_id: COMMUTE_SECTION_TO_STOP_ID,
          stop_sequence: null,
          delay_sec: null,
          section_from_stop_id: COMMUTE_SECTION_FROM_STOP_ID,
          section_to_stop_id: COMMUTE_SECTION_TO_STOP_ID,
          section_distance_km: COMMUTE_SECTION_DISTANCE_KM,
          avg_speed_kmh: Number(commuteSectionSpeed.toFixed(3)),
        });
      }

      tripUpdate.stopTimeUpdate?.forEach((stu: any) => {
        const stopId = stu.stopId;
        if (!stopId) return;

        const delay =
          stu.arrival?.delay ??
          stu.departure?.delay ??
          null;
        if (delay === null || delay === undefined) return;

        const delaySec = Math.max(0, Number(delay));
        const key = `${company}::${stopId}`;
        delayByStop[key] = {
          delay_sec: delaySec,
          observed_at: toJstIso(eventTimeMs),
        };

        if (company === VISITOR_AIRPORT_COMPANY) {
          const visitorDirection = detectVisitorAirportDirection(routeId);
          if (visitorDirection) {
            if (visitorDirection === 'to_airport' && VISITOR_AIRPORT_STOP_IDS.has(stopId)) {
              visitorAirportDelays.push(delaySec);
            }
            if (VISITOR_AIRPORT_STOP_ID_SET_BY_DIRECTION[visitorDirection].has(stopId)) {
              const samples = visitorAirportStopDelaySamples[visitorDirection][stopId] ?? [];
              samples.push(delaySec);
              visitorAirportStopDelaySamples[visitorDirection][stopId] = samples;
            }
          }
        }

        bronzeRows.push({
          event_time: new Date(eventTimeMs),
          ingest_time: now,
          company,
          feed_type: 'trip_update',
          trip_id: tripId,
          route_id: routeId,
          stop_id: stopId,
          stop_sequence: stu.stopSequence ?? null,
          delay_sec: delaySec,
        });
      });
    });
  }

  const updatedState: LastState = {
    updated_at: iso,
    stops: { ...lastState.stops },
  };

  Object.entries(delayByStop).forEach(([key, value]) => {
    updatedState.stops[key] = value;
  });

  const mallGroups = new Map<string, SpotRow[]>();
  spots.forEach((spot) => {
    const list = mallGroups.get(spot.mall_name) ?? [];
    list.push(spot);
    mallGroups.set(spot.mall_name, list);
  });

  const statuses: Record<string, string> = {};
  const detail: Record<string, any> = {};

  for (const [mall, entries] of mallGroups.entries()) {
    const delays: number[] = [];
    let filledCount = 0;

    for (const entry of entries) {
      const key = `${entry.company}::${entry.stop_id}`;
      const current = delayByStop[key];
      if (current) {
        delays.push(current.delay_sec);
        continue;
      }
      const fallback = updatedState.stops[key];
      if (!fallback) continue;
      const observedAt = Date.parse(fallback.observed_at);
      if (Number.isNaN(observedAt)) continue;
      if (nowMs - observedAt > maxAgeMs) continue;
      delays.push(fallback.delay_sec);
      filledCount += 1;
    }

    const med = median(delays);
    if (med === null) {
      statuses[mall] = 'unknown';
      detail[mall] = {
        status: 'unknown',
        delay_sec: null,
        sample_count: delays.length,
        filled_count: filledCount,
      };
      continue;
    }

    const status = statusFromDelay(med);
    statuses[mall] = status;
    detail[mall] = {
      status,
      delay_sec: Math.round(med),
      sample_count: delays.length,
      filled_count: filledCount,
    };
  }

  const latestPayload = {
    updated_at: iso,
    statuses,
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: latestJsonKey,
      Body: JSON.stringify(latestPayload, null, 2),
      ContentType: 'application/json',
    })
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: latestDetailKey,
      Body: JSON.stringify({ updated_at: iso, malls: detail }, null, 2),
      ContentType: 'application/json',
    })
  );

  const visitorAirportLatest = buildVisitorAirportLatest(iso, visitorAirportDelays);
  const visitorAirportStopsLatest = buildVisitorAirportStopsLatest(iso, visitorAirportStopDelaySamples);
  const commuteSemiconLatest = buildCommuteSemiconLatest(
    iso,
    updatedState,
    nowMs,
    maxAgeMs,
    commuteSectionSpeedSamples
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: visitorAirportLatestKey,
      Body: JSON.stringify(visitorAirportLatest, null, 2),
      ContentType: 'application/json',
    })
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: visitorAirportStopsLatestKey,
      Body: JSON.stringify(visitorAirportStopsLatest, null, 2),
      ContentType: 'application/json',
    })
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: commuteSemiconLatestKey,
      Body: JSON.stringify(commuteSemiconLatest, null, 2),
      ContentType: 'application/json',
    })
  );

  if (webBucket) {
    await s3.send(
      new PutObjectCommand({
        Bucket: webBucket,
        Key: 'data/latest.json',
        Body: JSON.stringify(latestPayload, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      })
    );
  }

  if (webBucket) {
    await s3.send(
      new PutObjectCommand({
        Bucket: webBucket,
        Key: 'data/latest_detail.json',
        Body: JSON.stringify({ updated_at: iso, malls: detail }, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      })
    );
  }

  if (webBucket) {
    await s3.send(
      new PutObjectCommand({
        Bucket: webBucket,
        Key: 'data/visitor_airport_latest.json',
        Body: JSON.stringify(visitorAirportLatest, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      })
    );
  }

  if (webBucket) {
    await s3.send(
      new PutObjectCommand({
        Bucket: webBucket,
        Key: 'data/visitor_airport_stops_latest.json',
        Body: JSON.stringify(visitorAirportStopsLatest, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      })
    );
  }

  if (webBucket) {
    await s3.send(
      new PutObjectCommand({
        Bucket: webBucket,
        Key: 'data/commute_semicon_latest.json',
        Body: JSON.stringify(commuteSemiconLatest, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      })
    );
  }

  if (webBucket) {
    const placesPayload = buildPlaces(spots, iso);
    if (placesPayload) {
      await s3.send(
        new PutObjectCommand({
          Bucket: webBucket,
          Key: 'data/places.json',
          Body: JSON.stringify(placesPayload, null, 2),
          ContentType: 'application/json',
          CacheControl: 'no-cache, no-store, must-revalidate',
        })
      );
    }
  }

  await saveLastState(updatedState);

  if (bronzeRows.length > 0) {
    const fileName = `part-${dt}-${hour}${minute}.jsonl`;
    const key = `${bronzePrefix}dt=${dt}/hour=${hour}/${fileName}`;
    const body = bronzeRows
      .map((row) =>
        JSON.stringify({
          ...row,
          event_time: row.event_time.toISOString(),
          ingest_time: row.ingest_time.toISOString(),
        })
      )
      .join('\n');

    await s3.send(
      new PutObjectCommand({
        Bucket: dataBucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      })
    );
  }

  return {
    dt,
    hour,
    minute,
    companies: companies.length,
    malls: mallGroups.size,
  };
};
