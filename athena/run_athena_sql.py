#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def run(cmd, check=True):
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def parse_statements(sql_text: str):
    lines = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") or not stripped:
            continue
        lines.append(line)
    joined = "\n".join(lines)
    parts = [p.strip() for p in joined.split(";") if p.strip()]
    return parts


def start_query(query, output, database, workgroup, region):
    cmd = [
        "aws",
        "athena",
        "start-query-execution",
        "--query-string",
        query,
        "--result-configuration",
        f"OutputLocation={output}",
        "--work-group",
        workgroup,
        "--region",
        region,
        "--output",
        "json",
    ]
    if database:
        cmd.extend(["--query-execution-context", f"Database={database}"])
    result = run(cmd)
    payload = json.loads(result.stdout)
    return payload["QueryExecutionId"]


def wait_query(execution_id, workgroup, region):
    while True:
        result = run(
            [
                "aws",
                "athena",
                "get-query-execution",
                "--query-execution-id",
                execution_id,
                "--region",
                region,
                "--output",
                "json",
            ]
        )
        payload = json.loads(result.stdout)
        status = payload["QueryExecution"]["Status"]["State"]
        if status in ("SUCCEEDED", "FAILED", "CANCELLED"):
            return status, payload
        time.sleep(2)


def fetch_results(execution_id, workgroup, region, output_path: Path):
    result = run(
        [
            "aws",
            "athena",
            "get-query-results",
            "--query-execution-id",
            execution_id,
            "--region",
            region,
            "--output",
            "json",
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(result.stdout, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Run Athena SQL statements")
    parser.add_argument(
        "--sql",
        default=str(Path(__file__).with_name("create_daily_delay_table.sql")),
        help="SQL file path",
    )
    parser.add_argument(
        "--output",
        default="s3://agyancast-dev-data/athena-results/",
        help="S3 output location for Athena results",
    )
    parser.add_argument("--database", default="default")
    parser.add_argument("--workgroup", default="primary")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "ap-northeast-1"))
    parser.add_argument("--sample-date", default=None)
    parser.add_argument("--sample-limit", type=int, default=20)
    parser.add_argument(
        "--sample-output",
        default=str(Path(__file__).with_name("outputs") / "sample_results.json"),
    )
    args = parser.parse_args()

    sql_path = Path(args.sql)
    if not sql_path.exists():
        print(f"SQL not found: {sql_path}", file=sys.stderr)
        sys.exit(1)

    sql_text = sql_path.read_text(encoding="utf-8")
    statements = parse_statements(sql_text)
    if not statements:
        print("No SQL statements found.", file=sys.stderr)
        sys.exit(1)

    for stmt in statements:
        print(f"[athena] start: {stmt[:80]}...")
        execution_id = start_query(stmt, args.output, args.database, args.workgroup, args.region)
        status, payload = wait_query(execution_id, args.workgroup, args.region)
        if status != "SUCCEEDED":
            reason = payload["QueryExecution"]["Status"].get("StateChangeReason", "")
            print(f"[athena] failed: {status} {reason}", file=sys.stderr)
            sys.exit(1)
        print(f"[athena] ok: {execution_id}")

    if args.sample_date:
        sample_query = (
            "SELECT * FROM agyancast.daily_delay_hourly "
            f"WHERE dt = '{args.sample_date}' "
            "ORDER BY hour, mall_name "
            f"LIMIT {args.sample_limit}"
        )
        print(f"[athena] sample query: {sample_query}")
        execution_id = start_query(sample_query, args.output, args.database, args.workgroup, args.region)
        status, _ = wait_query(execution_id, args.workgroup, args.region)
        if status != "SUCCEEDED":
            print("[athena] sample query failed", file=sys.stderr)
            sys.exit(1)
        fetch_results(execution_id, args.workgroup, args.region, Path(args.sample_output))
        print(f"[athena] sample results saved: {args.sample_output}")


if __name__ == "__main__":
    main()
