import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const FEEDS = [
  'https://km.bus-vision.jp/realtime/sankobus_trip_update.bin',
  'https://km.bus-vision.jp/realtime/sankobus_vpos_update.bin',
  'https://km.bus-vision.jp/realtime/sankobus_alrt_update.bin',
  'https://km.bus-vision.jp/realtime/dentetsu_trip_update.bin',
  'https://km.bus-vision.jp/realtime/dentetsu_vpos_update.bin',
  'https://km.bus-vision.jp/realtime/dentetsu_alrt_update.bin',
  'https://km.bus-vision.jp/realtime/kumabus_trip_update.bin',
  'https://km.bus-vision.jp/realtime/kumabus_vpos_update.bin',
  'https://km.bus-vision.jp/realtime/kumabus_alrt_update.bin',
  'https://km.bus-vision.jp/realtime/toshibus_trip_update.bin',
  'https://km.bus-vision.jp/realtime/toshibus_vpos_update.bin',
  'https://km.bus-vision.jp/realtime/toshibus_alrt_update.bin',
];

const s3 = new S3Client({});

const dataBucket = process.env.DATA_BUCKET ?? '';
const rawPrefix = process.env.RAW_PREFIX ?? 'raw/';
const timezone = process.env.TIMEZONE ?? 'Asia/Tokyo';

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
  return { dt, hour, minute, iso };
};

const parseCompany = (fileName: string) => fileName.split('_')[0];

export const handler = async () => {
  if (!dataBucket) {
    throw new Error('DATA_BUCKET is required');
  }

  const now = new Date();
  const { dt, hour, minute, iso } = getJstParts(now);

  const results = await Promise.allSettled(
    FEEDS.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`fetch_failed ${url} status=${response.status}`);
      }
      const data = new Uint8Array(await response.arrayBuffer());
      const fileName = url.split('/').pop() ?? 'feed.bin';
      const company = parseCompany(fileName);
      const key = `${rawPrefix}company=${company}/dt=${dt}/hour=${hour}/minute=${minute}/${fileName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: dataBucket,
          Key: key,
          Body: data,
          ContentType: 'application/octet-stream',
          Metadata: {
            ingest_time: iso,
            source_url: url,
          },
        })
      );

      return { url, key, bytes: data.length };
    })
  );

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  if (failed > 0) {
    results.forEach((r) => {
      if (r.status === 'rejected') {
        console.error(r.reason);
      }
    });
  }

  return {
    dt,
    hour,
    minute,
    ingested: ok,
    failed,
  };
};
