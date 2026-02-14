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

type SpotRow = {
  mall_name: string;
  company: string;
  stop_id: string;
  stop_lat?: number;
  stop_lon?: number;
};

type StopState = {
  delay_sec: number;
  observed_at: string;
};

type LastState = {
  updated_at: string;
  stops: Record<string, StopState>;
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
  }));
};

const MALL_COORD_OVERRIDES: Record<string, [number, number]> = {
  'ゆめタウン浜線': [32.7715579, 130.7265314],
};

const buildPlaces = (spots: SpotRow[], generatedAt: string) => {
  const mallMap = new Map<string, { latSum: number; lonSum: number; count: number }>();
  const lats: number[] = [];
  const lons: number[] = [];

  for (const spot of spots) {
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
    const override = MALL_COORD_OVERRIDES[name];
    const lat = override ? override[0] : entry.latSum / entry.count;
    const lon = override ? override[1] : entry.lonSum / entry.count;
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

const statusFromDelay = (delaySec: number) => {
  if (delaySec < 300) return 'low';
  if (delaySec < 600) return 'medium';
  if (delaySec < 1800) return 'high';
  return 'very_high';
};

const latestJsonKey = `${silverPrefix}latest.json`;
const latestDetailKey = `${silverPrefix}latest_detail.json`;

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
