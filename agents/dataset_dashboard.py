"""Build a truthful dashboard from files explicitly uploaded by the user."""
from __future__ import annotations

import json
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
REGISTRY = DATA_DIR / ".user-datasets.json"

def load_frame(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv": return pd.read_csv(path)
    if suffix == ".tsv": return pd.read_csv(path, sep="\t")
    if suffix in {".xlsx", ".xls"}: return pd.read_excel(path)
    if suffix == ".json": return pd.read_json(path)
    if suffix == ".parquet": return pd.read_parquet(path)
    raise ValueError(f"Unsupported dataset type: {suffix}")

def main() -> None:
    request = json.loads(sys.stdin.read() or "{}")
    names = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else []
    requested = request.get("dataset")
    if requested in names:
        names = [requested]
    paths = [DATA_DIR / name for name in names if (DATA_DIR / name).is_file()]
    if not paths:
        print(json.dumps({"status": "empty", "message": "Upload a dataset to populate the dashboard."}))
        return
    frames = []
    for path in paths:
        try:
            frame = load_frame(path)
            frame["__source_file"] = path.name
            frames.append(frame)
        except Exception:
            continue
    if not frames:
        print(json.dumps({"status": "empty", "message": "The uploaded dataset could not be read."}))
        return
    # Each dashboard view profiles one source file. This avoids fabricating a
    # combined schema (and inflated null counts) from unrelated uploads.
    df = frames[0]
    df = df.where(pd.notna(df), None)
    numeric = df.select_dtypes(include="number").columns.tolist()
    categorical = [c for c in df.columns if c not in numeric and c != "__source_file"]
    missing = int(df.isna().sum().sum())
    chart_numeric = {"data": [], "layout": {"paper_bgcolor": "rgba(0,0,0,0)", "plot_bgcolor": "rgba(0,0,0,0)", "font": {"color": "#8b949e"}}}
    if numeric:
        col = numeric[0]
        values = pd.to_numeric(df[col], errors="coerce").dropna().head(5000).tolist()
        chart_numeric["data"] = [{"x": values, "type": "histogram", "marker": {"color": "#58a6ff"}, "name": col}]
        chart_numeric["layout"]["title"] = {"text": f"Distribution of {col}"}
    chart_category = {"data": [], "layout": {"paper_bgcolor": "rgba(0,0,0,0)", "plot_bgcolor": "rgba(0,0,0,0)", "font": {"color": "#8b949e"}}}
    if categorical:
        col = categorical[0]
        counts = df[col].fillna("(blank)").astype(str).value_counts().head(10)
        chart_category["data"] = [{"x": counts.index.tolist(), "y": counts.tolist(), "type": "bar", "marker": {"color": "#39d353"}, "name": col}]
        chart_category["layout"]["title"] = {"text": f"Most common {col} values"}
    preview = df.head(100).astype(object).where(pd.notna(df.head(100)), None).to_dict(orient="records")
    print(json.dumps({"status": "success", "dataset_names": [p.name for p in paths], "available_datasets": [p.name for p in paths] if requested else json.loads(REGISTRY.read_text(encoding="utf-8")), "rows": int(len(df)), "columns": list(df.columns), "missing": missing, "numeric_columns": len(numeric), "records": preview, "charts": {"numeric": chart_numeric, "category": chart_category}}, default=str))

if __name__ == "__main__": main()
