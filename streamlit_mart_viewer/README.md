# Streamlit viewer for Silver mart

This app visualizes the last 2 daily partitions from the Silver mart parquet data.

## Requirements
- AWS credentials with read access to the data bucket
- Python 3.10+

## Run
```bash
cd /Users/nakamurashinnosuke/Documents/GitHub/agyancast/streamlit_mart_viewer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

## Configuration
- `AGYANCAST_DATA_BUCKET` or `DATA_BUCKET` to set the default bucket
- `AGYANCAST_SILVER_PREFIX` to override the default prefix (`silver/mart/daily_delay/`)
