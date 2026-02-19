import io
import os
import re
from datetime import date
from typing import List

import altair as alt
import boto3
import pandas as pd
import pyarrow.parquet as pq
import streamlit as st
from botocore.exceptions import ClientError, NoCredentialsError

HOURS = [f"{h:02d}" for h in range(24)]
OUTLIER_MODES = ["なし", "上限で丸める", "除外する"]


def default_bucket() -> str:
    return (
        os.environ.get("AGYANCAST_DATA_BUCKET")
        or os.environ.get("DATA_BUCKET")
        or "agyancast-dev-data"
    )


def default_prefix() -> str:
    return os.environ.get("AGYANCAST_SILVER_PREFIX") or "silver/mart/daily_delay/"

def normalize_prefix(prefix: str) -> str:
    cleaned = prefix.strip()
    if cleaned and not cleaned.endswith("/"):
        cleaned += "/"
    return cleaned


def normalize_date_range(selected, min_date: date, max_date: date) -> tuple[date, date]:
    if isinstance(selected, (tuple, list)) and len(selected) == 2:
        start_date = selected[0] or min_date
        end_date = selected[1] or max_date
    elif isinstance(selected, date):
        start_date = selected
        end_date = selected
    else:
        start_date = min_date
        end_date = max_date
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    return start_date, end_date


def apply_outlier_mode(data: pd.DataFrame, mode: str, threshold_min: float) -> pd.DataFrame:
    out = data.copy()
    out["median_delay_min_plot"] = out["median_delay_min"]
    if mode == "上限で丸める":
        out["median_delay_min_plot"] = out["median_delay_min_plot"].clip(upper=threshold_min)
    elif mode == "除外する":
        out.loc[out["median_delay_min_plot"] > threshold_min, "median_delay_min_plot"] = pd.NA
    return out


def y_scale_for_mode(mode: str, threshold_min: float) -> alt.Scale:
    if mode in {"上限で丸める", "除外する"}:
        return alt.Scale(domain=[0, float(threshold_min)])
    return alt.Scale(zero=True)


@st.cache_data(ttl=300, show_spinner=False)
def list_partition_dates(bucket: str, prefix: str) -> List[str]:
    s3 = boto3.client("s3")
    pattern = re.compile(r"dt=(\d{4}-\d{2}-\d{2})/")
    dates = set()
    continuation = None

    while True:
        params = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if continuation:
            params["ContinuationToken"] = continuation
        resp = s3.list_objects_v2(**params)

        for cp in resp.get("CommonPrefixes", []):
            match = pattern.search(cp.get("Prefix", ""))
            if match:
                dates.add(match.group(1))

        for item in resp.get("Contents", []):
            match = pattern.search(item.get("Key", ""))
            if match:
                dates.add(match.group(1))

        if not resp.get("IsTruncated"):
            break
        continuation = resp.get("NextContinuationToken")

    return sorted(dates)


@st.cache_data(ttl=300, show_spinner=False)
def list_parquet_keys(bucket: str, prefix: str, dt: str) -> List[str]:
    s3 = boto3.client("s3")
    keys = []
    continuation = None
    dt_prefix = f"{prefix}dt={dt}/"

    while True:
        params = {"Bucket": bucket, "Prefix": dt_prefix}
        if continuation:
            params["ContinuationToken"] = continuation
        resp = s3.list_objects_v2(**params)

        for item in resp.get("Contents", []):
            key = item.get("Key", "")
            if key.endswith(".parquet"):
                keys.append(key)

        if not resp.get("IsTruncated"):
            break
        continuation = resp.get("NextContinuationToken")

    return sorted(keys)


@st.cache_data(ttl=300, show_spinner=False)
def load_day(bucket: str, prefix: str, dt: str) -> pd.DataFrame:
    s3 = boto3.client("s3")
    keys = list_parquet_keys(bucket, prefix, dt)
    frames = []

    for key in keys:
        obj = s3.get_object(Bucket=bucket, Key=key)
        body = obj["Body"].read()
        table = pq.read_table(io.BytesIO(body))
        frames.append(table.to_pandas())

    if not frames:
        return pd.DataFrame()

    df = pd.concat(frames, ignore_index=True)
    df["dt"] = dt
    if "generated_at" not in df.columns:
        df["generated_at"] = None
    if "hour" in df.columns:
        df["hour"] = df["hour"].astype(str).str.zfill(2)
    if "median_delay_sec" in df.columns:
        df["median_delay_sec"] = pd.to_numeric(df["median_delay_sec"], errors="coerce")
        df["median_delay_min"] = df["median_delay_sec"] / 60
    if "sample_count" in df.columns:
        df["sample_count"] = pd.to_numeric(df["sample_count"], errors="coerce")
    return df


def build_day_grid(df_day: pd.DataFrame, malls: List[str]) -> pd.DataFrame:
    grid = pd.MultiIndex.from_product([malls, HOURS], names=["mall_name", "hour"]).to_frame(index=False)
    merged = grid.merge(
        df_day[["mall_name", "hour", "median_delay_min", "sample_count"]],
        on=["mall_name", "hour"],
        how="left",
    )
    merged["sample_count"] = merged["sample_count"].fillna(0).astype(int)
    return merged


def build_continuous_grid(dates: List[str], malls: List[str], df: pd.DataFrame) -> pd.DataFrame:
    grid = pd.MultiIndex.from_product(
        [dates, malls, HOURS], names=["dt", "mall_name", "hour"]
    ).to_frame(index=False)
    merged = grid.merge(
        df[["dt", "mall_name", "hour", "median_delay_min", "sample_count"]],
        on=["dt", "mall_name", "hour"],
        how="left",
    )
    merged["sample_count"] = merged["sample_count"].fillna(0).astype(int)
    merged["timestamp"] = pd.to_datetime(merged["dt"] + " " + merged["hour"] + ":00")
    return merged


def render_chart(
    df_day: pd.DataFrame,
    malls: List[str],
    day: str,
    outlier_mode: str,
    outlier_threshold_min: float,
) -> None:
    data = build_day_grid(df_day, malls)
    data = apply_outlier_mode(data, outlier_mode, outlier_threshold_min)
    chart = (
        alt.Chart(data)
        .mark_line(point=alt.OverlayMarkDef(size=30, filled=True))
        .encode(
            x=alt.X("hour:N", sort=HOURS, title="Hour (JST)"),
            y=alt.Y(
                "median_delay_min_plot:Q",
                title="Median delay (min)",
                scale=y_scale_for_mode(outlier_mode, outlier_threshold_min),
            ),
            color=alt.Color("mall_name:N", title="Mall"),
            tooltip=[
                alt.Tooltip("mall_name:N", title="Mall"),
                alt.Tooltip("hour:N", title="Hour"),
                alt.Tooltip("median_delay_min:Q", title="Median delay (min)", format=".2f"),
                alt.Tooltip("median_delay_min_plot:Q", title="Plotted value", format=".2f"),
                alt.Tooltip("sample_count:Q", title="Samples"),
            ],
        )
        .properties(height=320, title=f"Daily delay trend ({day})")
    )
    st.altair_chart(chart, use_container_width=True)


def render_continuous_chart(
    df: pd.DataFrame,
    malls: List[str],
    dates: List[str],
    outlier_mode: str,
    outlier_threshold_min: float,
) -> None:
    data = build_continuous_grid(dates, malls, df)
    data = apply_outlier_mode(data, outlier_mode, outlier_threshold_min)
    title = f"Continuous trend ({dates[0]} → {dates[-1]})"
    chart = (
        alt.Chart(data)
        .mark_line(point=alt.OverlayMarkDef(size=30, filled=True))
        .encode(
            x=alt.X("timestamp:T", title="Time (JST)"),
            y=alt.Y(
                "median_delay_min_plot:Q",
                title="Median delay (min)",
                scale=y_scale_for_mode(outlier_mode, outlier_threshold_min),
            ),
            color=alt.Color("mall_name:N", title="Mall"),
            tooltip=[
                alt.Tooltip("mall_name:N", title="Mall"),
                alt.Tooltip("dt:N", title="Date"),
                alt.Tooltip("hour:N", title="Hour"),
                alt.Tooltip("median_delay_min:Q", title="Median delay (min)", format=".2f"),
                alt.Tooltip("median_delay_min_plot:Q", title="Plotted value", format=".2f"),
                alt.Tooltip("sample_count:Q", title="Samples"),
            ],
        )
        .properties(height=320, title=title)
    )
    st.altair_chart(chart, use_container_width=True)


def render_summary(df: pd.DataFrame) -> None:
    summary = (
        df.groupby("dt")
        .agg(
            rows=("mall_name", "count"),
            malls=("mall_name", "nunique"),
            latest_generated_at=("generated_at", "max"),
        )
        .reset_index()
        .sort_values("dt")
    )
    st.dataframe(summary, use_container_width=True, hide_index=True)


def main() -> None:
    st.set_page_config(page_title="Agyancast Silver Mart Viewer", layout="wide")
    st.title("Silver mart daily delay (all available days)")
    st.caption("Source: s3://<bucket>/silver/mart/daily_delay/ dt=YYYY-MM-DD")

    with st.sidebar:
        bucket = st.text_input("S3 bucket", value=default_bucket())
        prefix = st.text_input("Silver mart prefix", value=default_prefix())
        st.caption("AWS credentials are required to access S3.")

    if not bucket:
        st.warning("Set an S3 bucket name to continue.")
        st.stop()

    prefix = normalize_prefix(prefix)

    try:
        available_dates = list_partition_dates(bucket, prefix)
    except NoCredentialsError:
        st.error("AWS credentials not found. Configure credentials to access S3.")
        st.stop()
    except ClientError as exc:
        st.error(f"S3 access failed: {exc}")
        st.stop()

    if not available_dates:
        st.warning("No partitions found under the prefix.")
        st.stop()

    all_date_values = [date.fromisoformat(dt) for dt in available_dates]
    min_date = min(all_date_values)
    max_date = max(all_date_values)
    with st.sidebar:
        selected_range = st.date_input(
            "取得期間 (JST)",
            value=(min_date, max_date),
            min_value=min_date,
            max_value=max_date,
        )
        outlier_mode = st.selectbox("飛び値処理", OUTLIER_MODES, index=1)
        outlier_threshold_min = st.number_input(
            "飛び値しきい値 (分)",
            min_value=1.0,
            max_value=180.0,
            value=20.0,
            step=1.0,
        )

    start_date, end_date = normalize_date_range(selected_range, min_date, max_date)
    start_str = start_date.isoformat()
    end_str = end_date.isoformat()
    target_dates = [dt for dt in available_dates if start_str <= dt <= end_str]
    if not target_dates:
        st.warning("指定期間にパーティションがありません。")
        st.stop()

    st.info(f"Using partitions: {target_dates[0]} to {target_dates[-1]} ({len(target_dates)} days)")
    st.caption(f"Outlier mode: {outlier_mode} / threshold: {outlier_threshold_min:.0f} min")

    frames = []
    for dt in target_dates:
        df_day = load_day(bucket, prefix, dt)
        if df_day.empty:
            st.warning(f"No parquet files found for {dt}.")
            continue
        frames.append(df_day)

    if not frames:
        st.warning("No data loaded. Check the bucket/prefix or the partitions.")
        st.stop()

    data = pd.concat(frames, ignore_index=True)
    data = (
        data.groupby(["dt", "mall_name", "hour"], as_index=False)
        .agg(
            median_delay_min=("median_delay_min", "median"),
            sample_count=("sample_count", "sum"),
            generated_at=("generated_at", "max"),
        )
    )
    mall_names = sorted(data["mall_name"].dropna().unique().tolist())
    st.caption(f"Plotting all malls: {len(mall_names)}")

    st.subheader("Summary")
    render_summary(data)

    st.subheader("Continuous view (all days)")
    continuous_df = data[data["dt"].isin(target_dates)].copy()
    render_continuous_chart(
        continuous_df,
        mall_names,
        target_dates,
        outlier_mode,
        outlier_threshold_min,
    )

    st.subheader("Daily view (stacked)")
    for dt in target_dates:
        st.markdown(f"### {dt}")
        day_df = data[data["dt"] == dt].copy()
        if day_df.empty:
            st.warning(f"No rows for {dt}.")
            continue
        render_chart(
            day_df,
            mall_names,
            dt,
            outlier_mode,
            outlier_threshold_min,
        )
        with st.expander(f"Show data table: {dt}"):
            st.dataframe(
                day_df.sort_values(["hour", "mall_name"]),
                use_container_width=True,
                hide_index=True,
            )


if __name__ == "__main__":
    main()
