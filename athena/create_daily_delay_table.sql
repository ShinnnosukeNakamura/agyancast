-- Athena (Hive) table for Silver daily delay mart
-- Target: s3://agyancast-dev-data/silver/mart/daily_delay/
-- If you use a different bucket, replace the LOCATION below.

CREATE DATABASE IF NOT EXISTS agyancast;

CREATE EXTERNAL TABLE IF NOT EXISTS agyancast.daily_delay_hourly (
  mall_name string,
  median_delay_sec bigint,
  sample_count bigint,
  generated_at string
)
PARTITIONED BY (dt string, hour string)
STORED AS PARQUET
LOCATION 's3://agyancast-dev-data/silver/mart/daily_delay/'
TBLPROPERTIES (
  'parquet.compression' = 'SNAPPY'
);

-- Load partitions (run after first creation, and when new hours are added)
MSCK REPAIR TABLE agyancast.daily_delay_hourly;

-- Example query
-- SELECT *
-- FROM agyancast.daily_delay_hourly
-- WHERE dt = '2026-02-14'
-- ORDER BY hour, mall_name;
