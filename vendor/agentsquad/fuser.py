"""Multi-Table Security Telemetry Fuser.

Fuses Track 2 heterogeneous security sources:
1. IAM Audit Trail (JSON, 20,500 rows)
2. Identity Asset Master (CSV, 3,090 rows)
3. Endpoint Alerts (Excel .xlsx, 8,240 rows)
4. Firewall Telemetry (CSV, 30,600 rows)

Into a clean, relational zero-trust master warehouse dataset with 100% row survival.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import pandas as pd

from .coordinator import AgentSquadCoordinator, AgentSquadResult


class MultiTableFuser:
    """Orchestrates cross-table cleaning, standardization, and zero-trust fusion."""

    def __init__(self, coordinator: AgentSquadCoordinator | None = None) -> None:
        self.coordinator = coordinator or AgentSquadCoordinator()

    def fuse_track2_directory(self, data_dir: str | Path) -> pd.DataFrame:
        """Loads and fuses all 4 Track 2 dataset files from the target directory."""
        p = Path(data_dir)
        iam_path = p / "track2_iam_audit_trail.json"
        master_path = p / "track2_identity_asset_master.csv"
        alerts_path = p / "track2_endpoint_alerts.xlsx"
        fw_path = p / "track2_firewall_logs.csv"

        # 1. Clean IAM Audit Trail
        print("[*] Fuser: Processing IAM Audit Trail...")
        with open(iam_path, encoding="utf-8") as f:
            iam_raw = json.load(f)
        df_iam_raw = pd.DataFrame(iam_raw)
        res_iam = self.coordinator.process(df_iam_raw)
        df_iam = res_iam.clean_df

        # 2. Clean Identity Asset Master
        print("[*] Fuser: Processing Identity Asset Master...")
        df_master_raw = pd.read_csv(master_path)
        res_master = self.coordinator.process(df_master_raw)
        df_master = res_master.clean_df

        # 3. Clean Endpoint Alerts
        print("[*] Fuser: Processing Endpoint Alerts...")
        df_alerts_raw = pd.read_excel(alerts_path)
        res_alerts = self.coordinator.process(df_alerts_raw)
        df_alerts = res_alerts.clean_df

        # 4. Clean Firewall Logs
        print("[*] Fuser: Processing Firewall Logs...")
        df_fw_raw = pd.read_csv(fw_path)
        res_fw = self.coordinator.process(df_fw_raw)
        df_fw = res_fw.clean_df

        # 5. Build Aggregated Asset & Threat Contexts
        # Endpoint alerts aggregated by user_id and hostname
        alert_summary = df_alerts.groupby(["user_id"]).agg(
            total_endpoint_alerts=("alert_id", "count"),
            critical_endpoint_alerts=("threat_severity", lambda s: int((s == "CRITICAL").sum())),
            latest_alert_name=("alert_name", "first"),
        ).reset_index()

        # Firewall logs aggregated by hostname
        fw_summary = df_fw.groupby(["hostname"]).agg(
            firewall_events=("log_id", "count"),
            firewall_denies=("action", lambda s: int((s == "DENY").sum())),
            firewall_threat_flags=("threat_flag", lambda s: int((s == 1).sum() if pd.api.types.is_numeric_dtype(s) else (s.astype(str).str.upper() == "TRUE").sum())),
            bytes_transferred=("bytes_sent", "sum"),
        ).reset_index()

        # 6. Master Asset Join
        master_subset = df_master[["user_id", "role", "location", "device_id", "hire_date", "manager_username"]].drop_duplicates(subset=["user_id"])

        # 7. Relational Fusion on IAM Core
        fused = df_iam.merge(master_subset, on="user_id", how="left")
        fused = fused.merge(alert_summary, on="user_id", how="left")
        fused = fused.merge(fw_summary, on="hostname", how="left")

        # Fill missing values from outer joins
        fused["total_endpoint_alerts"] = pd.to_numeric(fused["total_endpoint_alerts"], errors="coerce").fillna(0).astype("int64")
        fused["critical_endpoint_alerts"] = pd.to_numeric(fused["critical_endpoint_alerts"], errors="coerce").fillna(0).astype("int64")
        fused["latest_alert_name"] = fused["latest_alert_name"].fillna("None")
        fused["firewall_events"] = pd.to_numeric(fused["firewall_events"], errors="coerce").fillna(0).astype("int64")
        fused["firewall_denies"] = pd.to_numeric(fused["firewall_denies"], errors="coerce").fillna(0).astype("int64")
        fused["firewall_threat_flags"] = pd.to_numeric(fused["firewall_threat_flags"], errors="coerce").fillna(0).astype("int64")
        fused["bytes_transferred"] = pd.to_numeric(fused["bytes_transferred"], errors="coerce").fillna(0).astype("int64")
        fused["role"] = fused["role"].fillna("Analyst")
        fused["location"] = fused["location"].fillna("Remote")

        # Composite zero-trust insider risk score calculation
        # Risk = 0.35 * base_risk + 0.25 * (auth == FAILED) + 0.20 * (critical_alerts > 0) + 0.20 * (firewall_denies > 5)
        failed_boost = (fused["auth_status"].str.upper() == "FAILED").astype(int) * 35.0
        alert_boost = (fused["critical_endpoint_alerts"] > 0).astype(int) * 30.0
        fw_boost = (fused["firewall_denies"] > 5).astype(int) * 25.0
        calculated_risk = (0.40 * fused["risk_score"]) + failed_boost + alert_boost + fw_boost
        fused["risk_score"] = calculated_risk.clip(lower=5.0, upper=99.9).round(1)

        print(f"[*] Fuser: Successfully synthesized {len(fused):,} unified zero-trust records.")
        return fused
