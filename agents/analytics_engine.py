"""
AgentIQ Track 2: Certified Analytics Engine for Zero-Trust Telemetry.
Provides real-time DuckDB queries for the Live Interactive SOC Dashboard (Gate 3).
Surfaces exact metric formulas, interactive Plotly specs, and filtered threat telemetry records.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional

import duckdb
import pandas as pd

# ponytail: Centralized configuration and path resolution with environment variable overrides
WORKSPACE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("CYBER_DB_PATH", str(WORKSPACE_DIR / "data" / "cyber_metrics.duckdb")))

# Default query thresholds and limits
DEFAULT_RECORD_LIMIT = int(os.getenv("DEFAULT_RECORD_LIMIT", "50"))
HIGH_RISK_THRESHOLD = float(os.getenv("HIGH_RISK_THRESHOLD", "60.0"))
FAIL_RATE_DANGER_THRESHOLD = float(os.getenv("FAIL_RATE_DANGER_THRESHOLD", "25.0"))
THREAT_RISK_DANGER_THRESHOLD = float(os.getenv("THREAT_RISK_DANGER_THRESHOLD", "50.0"))

def _build_parameterized_filters(
    department: Optional[str] = None,
    host: Optional[str] = None,
    severity: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Build parameterized WHERE clauses for each data domain.

    Returns a dict with keys 'iam', 'fw', 'edr', 'unif', each containing:
      - 'clause': the SQL WHERE clause string with ? placeholders
      - 'params': list of parameter values
    """
    iam_conds: List[str] = []
    iam_params: List[Any] = []
    fw_conds: List[str] = []
    fw_params: List[Any] = []
    edr_conds: List[str] = []
    edr_params: List[Any] = []
    unif_conds: List[str] = []
    unif_params: List[Any] = []

    if department and department.lower() != "all":
        iam_conds.append("department = ?")
        iam_params.append(department)
        unif_conds.append("department = ?")
        unif_params.append(department)

    if host and host.strip():
        host_pattern = "%" + host.strip().upper() + "%"
        iam_conds.append("hostname LIKE ?")
        iam_params.append(host_pattern)
        fw_conds.append("hostname LIKE ?")
        fw_params.append(host_pattern)
        edr_conds.append("hostname LIKE ?")
        edr_params.append(host_pattern)
        unif_conds.append("hostname LIKE ?")
        unif_params.append(host_pattern)

    if severity and severity.lower() != "all":
        edr_conds.append("severity = ?")
        edr_params.append(severity.strip().upper())

    if start_date and start_date.strip():
        sd = start_date.strip()
        iam_conds.append("date >= ?")
        iam_params.append(sd)
        fw_conds.append("date >= ?")
        fw_params.append(sd)
        edr_conds.append("date >= ?")
        edr_params.append(sd)

    if end_date and end_date.strip():
        ed = end_date.strip()
        iam_conds.append("date <= ?")
        iam_params.append(ed)
        fw_conds.append("date <= ?")
        fw_params.append(ed)
        edr_conds.append("date <= ?")
        edr_params.append(ed)

    def _make(conds: List[str], params: List[Any]) -> Dict[str, Any]:
        clause = ("WHERE " + " AND ".join(conds)) if conds else ""
        return {"clause": clause, "params": list(params)}

    return {
        "iam": _make(iam_conds, iam_params),
        "fw": _make(fw_conds, fw_params),
        "edr": _make(edr_conds, edr_params),
        "unif": _make(unif_conds, unif_params),
    }


def get_dashboard_metrics(
    department: Optional[str] = None,
    host: Optional[str] = None,
    severity: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = DEFAULT_RECORD_LIMIT
) -> Dict[str, Any]:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"DuckDB database not found at {DB_PATH}. Run `python pipeline.py` first.")

    con = duckdb.connect(str(DB_PATH), read_only=True)

    # CSO-001 fix: Build parameterized WHERE clauses — no string interpolation of user input
    filters = _build_parameterized_filters(department, host, severity, start_date, end_date)
    iam = filters["iam"]
    fw = filters["fw"]
    edr = filters["edr"]
    unif = filters["unif"]

    # =========================================================================
    # 1. KPI Cards Computation (with Surfaced Formulas)
    # =========================================================================

    # IAM Logins & Failed Login Rate
    iam_stats = con.execute(f"""
        SELECT
            COUNT(*) AS total_logins,
            SUM(failed_logins) AS failed_logins,
            ROUND(AVG(risk_score), 1) AS mean_risk
        FROM logins {iam["clause"]}
    """, iam["params"]).fetchone()

    total_logins = int(iam_stats[0] or 0)
    failed_logins = int(iam_stats[1] or 0)
    fail_rate = round((failed_logins * 100.0 / total_logins), 2) if total_logins > 0 else 0.0

    # Firewall Stats
    fw_stats = con.execute(f"""
        SELECT
            COUNT(*) AS total_packets,
            SUM(CASE WHEN action = 'DENY' THEN 1 ELSE 0 END) AS denies,
            SUM(threat_flag) AS threat_flags,
            ROUND(SUM(bytes_transferred) / (1024.0 * 1024.0), 2) AS total_mb
        FROM firewall_logs {fw["clause"]}
    """, fw["params"]).fetchone()

    total_packets = int(fw_stats[0] or 0)
    firewall_denies = int(fw_stats[1] or 0)
    threat_flags = int(fw_stats[2] or 0)

    # EDR Alerts Stats
    edr_stats = con.execute(f"""
        SELECT
            COUNT(*) AS total_alerts,
            SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_alerts,
            SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) AS high_alerts,
            SUM(impossible_resolution) AS impossible_resolutions
        FROM endpoint_alerts {edr["clause"]}
    """, edr["params"]).fetchone()

    total_alerts = int(edr_stats[0] or 0)
    critical_alerts = int(edr_stats[1] or 0)
    impossible_res = int(edr_stats[3] or 0)

    # Unified Threat & Insider Risk Scores
    unif_stats = con.execute(f"""
        SELECT
            ROUND(AVG(composite_threat_risk), 1) AS mean_threat_risk,
            ROUND(AVG(insider_threat_score), 1) AS mean_insider_score,
            COUNT(DISTINCT CASE WHEN composite_threat_risk > ? THEN user_id ELSE NULL END) AS high_risk_accounts,
            COUNT(DISTINCT user_id) AS total_users
        FROM unified_telemetry {unif["clause"]}
    """, [HIGH_RISK_THRESHOLD] + unif["params"]).fetchone()

    mean_threat_risk = float(unif_stats[0] or 0.0)
    mean_insider_score = float(unif_stats[1] or 0.0)
    high_risk_accounts = int(unif_stats[2] or 0)

    kpis = {
        "failed_login_rate": {
            "title": "Failed-Login Rate",
            "value": f"{fail_rate}%",
            "raw_value": fail_rate,
            "failed_logins": failed_logins,
            "total_attempts": total_logins,
            "formula": "(failed_logins / total_attempts) * 100%",
            "formula_expanded": f"({failed_logins:,} / {total_logins:,}) * 100% = {fail_rate}%",
            "badge_type": "danger" if fail_rate > FAIL_RATE_DANGER_THRESHOLD else "warning",
            "description": "Zero-trust authentication failure metric tracking credential stuffing & brute-force intensity."
        },
        "compromised_account_risk": {
            "title": "Compromised-Account Risk",
            "value": f"{mean_threat_risk}",
            "raw_value": mean_threat_risk,
            "high_risk_count": high_risk_accounts,
            "formula": "min(100, base_risk + (failed_logins * 15) + (critical_alerts * 10) + (threat_flags * 20))",
            "formula_expanded": f"Base Risk + (Fails * 15) + (EDR * 10) + (Threats * 20) -> Avg {mean_threat_risk}",
            "badge_type": "danger" if mean_threat_risk > THREAT_RISK_DANGER_THRESHOLD else "warning",
            "description": "Multi-domain composite risk scoring individual user account exposure across IAM, EDR, and perimeter."
        },
        "insider_threat_score": {
            "title": "Insider-Threat Score",
            "value": f"{mean_insider_score}",
            "raw_value": mean_insider_score,
            "flagged_users": high_risk_accounts,
            "formula": "0.40 * (normalized_fails) + 0.35 * (edr_criticality) + 0.25 * (firewall_anomalies)",
            "formula_expanded": f"0.40*(Fails) + 0.35*(EDR) + 0.25*(FW Threats) -> Avg {mean_insider_score}",
            "badge_type": "warning",
            "description": "Weighted behavioural insider threat index quantifying anomalous privilege escalation and exfiltration."
        },
        "critical_alerts": {
            "title": "Critical EDR Alerts",
            "value": f"{critical_alerts:,}",
            "raw_value": critical_alerts,
            "total_edr": total_alerts,
            "impossible_resolutions": impossible_res,
            "formula": "COUNT(*) WHERE severity = 'CRITICAL'",
            "formula_expanded": f"{critical_alerts:,} of {total_alerts:,} endpoint alerts classified as Critical P1 incidents",
            "badge_type": "danger",
            "description": "Severe active malware, lateral movement, or credential dumping detections requiring immediate SOC containment."
        },
        "firewall_denies": {
            "title": "Perimeter Policy Denies",
            "value": f"{firewall_denies:,}",
            "raw_value": firewall_denies,
            "total_packets": total_packets,
            "threat_flags": threat_flags,
            "formula": "COUNT(*) WHERE action = 'DENY'",
            "formula_expanded": f"{firewall_denies:,} of {total_packets:,} network sessions denied by perimeter rules",
            "badge_type": "info",
            "description": "Blocked network connections highlighting external port scanning and unauthorized egress attempts."
        }
    }

    # =========================================================================
    # 2. Interactive Charts (Plotly Specifications)
    # =========================================================================

    # Chart 1: Daily Department Login Failure Trend
    trend_df = con.execute(f"""
        SELECT
            date,
            department,
            COUNT(*) AS total_attempts,
            SUM(failed_logins) AS failed_attempts
        FROM logins
        {iam["clause"]}
        GROUP BY date, department
        ORDER BY date ASC, department ASC
    """, iam["params"]).df()

    trend_traces = []
    palette = [
        "#f85149", "#ff7b72", "#e3b341", "#d29922", "#58a6ff",
        "#388bfd", "#bc8cff", "#d2a8ff", "#39d353", "#2ea043"
    ]
    departments_in_data = sorted(trend_df["department"].unique()) if len(trend_df) > 0 else []
    for idx, dept in enumerate(departments_in_data):
        sub = trend_df[trend_df["department"] == dept]
        trend_traces.append({
            "x": sub["date"].tolist(),
            "y": sub["failed_attempts"].tolist(),
            "name": dept,
            "type": "scatter",
            "mode": "lines+markers",
            "line": {"color": palette[idx % len(palette)], "width": 2},
            "marker": {"size": 5},
            "hovertemplate": f"<b>{dept}</b><br>Date: %{{x}}<br>Failed Logins: %{{y:,}}<extra></extra>"
        })

    chart_trend = {
        "data": trend_traces,
        "layout": {
            "title": {"text": "Daily Failed Login Attempts by Department", "font": {"size": 15, "color": "#e6edf3"}},
            "xaxis": {"title": "Date", "gridcolor": "#21262d", "color": "#8b949e"},
            "yaxis": {"title": "Failed Attempts", "gridcolor": "#21262d", "color": "#8b949e"},
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
            "legend": {"font": {"color": "#8b949e", "size": 11}, "orientation": "h", "y": -0.25},
            "margin": {"l": 45, "r": 20, "t": 40, "b": 70}
        }
    }

    # Chart 2: Firewall Policy Actions by Protocol
    fw_proto_df = con.execute(f"""
        SELECT protocol, action, COUNT(*) AS packet_count
        FROM firewall_logs
        {fw["clause"]}
        GROUP BY protocol, action
        ORDER BY protocol, action
    """, fw["params"]).df()

    fw_traces = []
    for act, color in [("ALLOW", "#39d353"), ("DENY", "#f85149")]:
        sub = fw_proto_df[fw_proto_df["action"] == act]
        fw_traces.append({
            "x": sub["protocol"].tolist(),
            "y": sub["packet_count"].tolist(),
            "name": act,
            "type": "bar",
            "marker": {"color": color},
            "hovertemplate": f"<b>{act}</b><br>Protocol: %{{x}}<br>Packets: %{{y:,}}<extra></extra>"
        })

    chart_firewall = {
        "data": fw_traces,
        "layout": {
            "title": {"text": "Firewall Policy Enforcement by Protocol", "font": {"size": 15, "color": "#e6edf3"}},
            "barmode": "group",
            "xaxis": {"title": "Protocol", "gridcolor": "#21262d", "color": "#8b949e"},
            "yaxis": {"title": "Packet Count", "gridcolor": "#21262d", "color": "#8b949e"},
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
            "legend": {"font": {"color": "#8b949e"}},
            "margin": {"l": 45, "r": 20, "t": 40, "b": 40}
        }
    }

    # Chart 3: EDR Alert Severity Distribution
    edr_sev_df = con.execute(f"""
        SELECT severity, COUNT(*) AS count
        FROM endpoint_alerts
        {edr["clause"]}
        GROUP BY severity
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END
    """, edr["params"]).df()

    sev_colors = {"CRITICAL": "#f85149", "HIGH": "#ff7b72", "MEDIUM": "#d29922", "LOW": "#58a6ff"}
    chart_severity = {
        "data": [{
            "labels": edr_sev_df["severity"].tolist(),
            "values": edr_sev_df["count"].tolist(),
            "type": "pie",
            "hole": 0.55,
            "marker": {"colors": [sev_colors.get(s, "#58a6ff") for s in edr_sev_df["severity"]]},
            "hovertemplate": "<b>%{label} Severity</b><br>Alerts: %{value:,} (%{percent})<extra></extra>",
            "textinfo": "label+percent"
        }],
        "layout": {
            "title": {"text": "EDR Alert Severity Distribution", "font": {"size": 15, "color": "#e6edf3"}},
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
            "legend": {"font": {"color": "#8b949e"}},
            "margin": {"l": 20, "r": 20, "t": 40, "b": 30}
        }
    }

    # =========================================================================
    # 3. Filter Options Metadata
    # =========================================================================
    dept_rows = con.execute("SELECT DISTINCT department FROM users ORDER BY department").fetchall()
    all_departments = [r[0] for r in dept_rows if r[0]]

    # =========================================================================
    # 4. Filtered Telemetry Records (Detail Table)
    # =========================================================================
    records_df = con.execute(f"""
        SELECT
            timestamp,
            user_id,
            hostname,
            department,
            event_type AS event_or_action,
            'N/A' AS severity,
            risk_score,
            'LOGGED' AS status
        FROM logins
        {iam["clause"]}
        ORDER BY timestamp DESC
        LIMIT ?
    """, iam["params"] + [limit]).df()

    records = records_df.to_dict(orient="records")

    con.close()

    return {
        "status": "success",
        "kpis": kpis,
        "charts": {
            "login_trend": chart_trend,
            "firewall_actions": chart_firewall,
            "severity_dist": chart_severity,
        },
        "filter_options": {
            "departments": ["All"] + all_departments,
            "severities": ["All", "CRITICAL", "HIGH", "MEDIUM", "LOW"],
        },
        "records": records,
        "records_count": len(records),
    }


def main():
    payload = sys.stdin.read().strip()
    filters = json.loads(payload) if payload else {}
    res = get_dashboard_metrics(
        department=filters.get("department"),
        host=filters.get("host"),
        severity=filters.get("severity"),
        start_date=filters.get("startDate"),
        end_date=filters.get("endDate"),
        limit=int(filters.get("limit", DEFAULT_RECORD_LIMIT))
    )
    print(json.dumps(res))


if __name__ == "__main__":
    main()
