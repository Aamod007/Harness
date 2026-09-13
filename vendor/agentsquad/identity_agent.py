"""Identity, IAM Audit & Temporal Rescue Agent.

Unpacks nested/unclosed JSON audit payloads, normalizes timestamps to strict UTC ISO-8601,
and classifies service accounts versus human privileged identities.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
import pandas as pd


@dataclass
class IdentityAgentReport:
    """Audit metrics produced by IdentityAgent."""
    json_sessions_unpacked: int = 0
    timestamps_standardized: int = 0
    service_accounts_classified: int = 0
    privileged_users_tagged: int = 0


class IdentityAgent:
    """Specialized worker for IAM logs, authentication sessions, and temporal grains."""

    def __init__(self) -> None:
        self.report = IdentityAgentReport()

    def clean(self, df: pd.DataFrame) -> tuple[pd.DataFrame, IdentityAgentReport]:
        out = df.copy()

        # 1. Unpack JSON session strings if present
        json_cols = [c for c in out.columns if any(k in c.lower() for k in ["session", "payload", "audit_data", "raw_json"])]
        for col in json_cols:
            if not pd.api.types.is_string_dtype(out[col]) and not pd.api.types.is_object_dtype(out[col]):
                continue

            parsed_records: list[dict[str, Any]] = []
            all_keys: set[str] = set()

            for val in out[col]:
                if pd.isna(val) or not str(val).strip():
                    parsed_records.append({})
                    continue

                raw = str(val).strip()
                if raw.startswith("{") and not raw.endswith("}"):
                    raw += "}"

                d: dict[str, Any] = {}
                try:
                    loaded = json.loads(raw)
                    if isinstance(loaded, dict):
                        d = loaded
                        self.report.json_sessions_unpacked += 1
                except Exception:
                    # Regex fallback for key: value pairs
                    pairs = re.findall(r'["\']?([a-zA-Z0-9_\-]+)["\']?\s*[:=]\s*["\']?([^,\'"}]+)["\']?', raw)
                    if pairs:
                        d = {k.strip(): v.strip() for k, v in pairs}
                        self.report.json_sessions_unpacked += 1

                parsed_records.append(d)
                all_keys.update(d.keys())

            # Unpack dynamically discovered keys into dataframe
            for k in all_keys:
                clean_k = k.lower().replace(" ", "_").replace("-", "_")
                if clean_k not in out.columns:
                    col_vals = [rec.get(k) for rec in parsed_records]
                    out[clean_k] = col_vals

            # Guarantee standard identity columns
            if "session_id" not in out.columns:
                out["session_id"] = [rec.get("session_id") or rec.get("id") or "SESSION_ANON" for rec in parsed_records]
            if "mfa_status" not in out.columns:
                out["mfa_status"] = [
                    "MFA_ENABLED" if rec.get("mfa") in [True, "true", "True", "enabled", 1] or rec.get("mfa_used") in [True, "true", "True", 1] else "NO_MFA"
                    for rec in parsed_records
                ]
            if "auth_status" not in out.columns:
                unpacked_statuses = [
                    rec.get("status") or rec.get("auth_status") or rec.get("auth")
                    for rec in parsed_records
                ]
                if any(s is not None for s in unpacked_statuses):
                    out["auth_status"] = [str(s or "SUCCESS").upper() for s in unpacked_statuses]

        # 2. Timestamp Normalization
        time_cols = [c for c in out.columns if any(k in c.lower() for k in ["time", "date", "created", "timestamp"])]
        for col in time_cols:
            try:
                # Handle numeric epoch seconds/milliseconds
                if pd.api.types.is_numeric_dtype(out[col]):
                    is_ms = (out[col].dropna() > 1e11).any()
                    unit = "ms" if is_ms else "s"
                    dt_series = pd.to_datetime(out[col], unit=unit, errors="coerce", utc=True)
                else:
                    dt_series = pd.to_datetime(out[col], errors="coerce", utc=True)

                if dt_series.isna().any():
                    median_dt = dt_series.dropna().median() if not dt_series.dropna().empty else pd.Timestamp.now(tz="UTC")
                    dt_series = dt_series.fillna(median_dt)

                out[col] = dt_series
                self.report.timestamps_standardized += len(out)

                if "timestamp_day" not in out.columns:
                    out["timestamp_day"] = dt_series.dt.strftime("%Y-%m-%d")
                    out["date_iso"] = dt_series.dt.strftime("%Y-%m-%d")
                    out["hour_of_day"] = dt_series.dt.hour
            except Exception:
                continue

        # 3. Standardize User IDs to Canonical EMP-XXXXX
        user_cols = [c for c in out.columns if any(k in c.lower() for k in ["user_id", "userid", "emp_id", "employee_id"])]
        for ucol in user_cols:
            def _clean_uid(val: object) -> str:
                if pd.isna(val) or not str(val).strip():
                    return "EMP-UNKNOWN"
                s = str(val).strip()
                m = re.search(r"(\d+)", s)
                if m:
                    return f"EMP-{m.group(1)}"
                return s.upper()

            out[ucol] = out[ucol].apply(_clean_uid)

        # 4. Standardize Department Names
        dept_cols = [c for c in out.columns if any(k in c.lower() for k in ["dept", "department", "team", "division"])]
        for dcol in dept_cols:
            def _clean_dept(val: object) -> str:
                if pd.isna(val) or not str(val).strip():
                    return "Unassigned"
                s = str(val).strip().lower()
                if any(k in s for k in ["oper", "ops"]): return "Operations"
                if "legal" in s: return "Legal"
                if any(k in s for k in ["hr", "human", "people"]): return "Human Resources"
                if "sales" in s: return "Sales"
                if any(k in s for k in ["purch", "procur", "supply"]): return "Supply Chain"
                if any(k in s for k in ["r&d", "rd", "rnd", "research", "innov"]): return "R&D"
                if any(k in s for k in ["support", "care", "center", "cs"]): return "Customer Support"
                if "complian" in s: return "Compliance"
                if any(k in s for k in ["it", "tech", "comput"]): return "Information Technology"
                if any(k in s for k in ["fin", "account"]): return "Finance"
                if any(k in s for k in ["mkt", "market", "brand"]): return "Marketing"
                return s.title()

            out[dcol] = out[dcol].apply(_clean_dept)

        # 5. Standardize Event Types & Auth Status
        if "event_type" in out.columns:
            def _clean_event_type(val: object) -> tuple[str, str]:
                if pd.isna(val) or not str(val).strip():
                    return "other", "UNKNOWN"
                s = str(val).strip().lower()
                if any(k in s for k in ["fail", "invalid", "bad", "denied", "blocked"]):
                    return "login_failed", "FAILED"
                if any(k in s for k in ["success", "logon_success", "sso_success", "auth_success", "login_success"]):
                    return "login_success", "SUCCESS"
                return "other", "SUCCESS"

            parsed_events = out["event_type"].apply(_clean_event_type)
            out["event_category"] = [p[0] for p in parsed_events]
            inferred_status = [p[1] for p in parsed_events]

            if "auth_status" not in out.columns:
                out["auth_status"] = [s if s != "UNKNOWN" else "SUCCESS" for s in inferred_status]
            else:
                for idx in range(len(out)):
                    curr = str(out.iat[idx, out.columns.get_loc("auth_status")]).upper()
                    inf = inferred_status[idx]
                    if inf == "FAILED" or curr in ["UNKNOWN", "NAN", "NONE", ""]:
                        out.iat[idx, out.columns.get_loc("auth_status")] = inf if inf != "UNKNOWN" else curr

        # Also inspect failure_reason if present
        if "failure_reason" in out.columns:
            has_fail_reason = (
                out["failure_reason"].notna()
                & ~out["failure_reason"].astype(str).str.strip().str.upper().isin(["NA", "N/A", "NONE", "", "NAN", "NULL"])
            )
            if "auth_status" not in out.columns:
                out["auth_status"] = "SUCCESS"
            out.loc[has_fail_reason, "auth_status"] = "FAILED"

        # Guarantee auth_status column exists across all outputs
        if "auth_status" not in out.columns:
            out["auth_status"] = "SUCCESS"

        # 6. Clean Risk Scores (normalize fractions, labels, out of bounds)
        if "risk_score" in out.columns:
            def _clean_risk(val: object) -> float:
                if pd.isna(val):
                    return 35.0
                s = str(val).strip().lower()
                if "/" in s:
                    try:
                        num = float(s.split("/")[0])
                        return float(min(100.0, max(0.0, num)))
                    except Exception:
                        pass
                if "crit" in s: return 90.0
                if "high" in s: return 75.0
                if "med" in s: return 50.0
                if "low" in s: return 20.0
                try:
                    num = float(s)
                    return float(min(100.0, max(0.0, abs(num))))
                except Exception:
                    return 35.0

            out["risk_score"] = out["risk_score"].apply(_clean_risk)

        # 7. Standardize Hostnames
        host_cols = [c for c in out.columns if any(k in c.lower() for k in ["host", "hostname", "device_name"])]
        for hcol in host_cols:
            def _clean_host(h: object) -> str:
                if pd.isna(h) or not str(h).strip():
                    return "UNKNOWN"
                s = str(h).strip().lower()
                s = re.sub(r"\.corp\.local$", "", s)
                s = s.replace("_", "-")
                return s.upper()

            out[hcol] = out[hcol].apply(_clean_host)

        # 8. User & Role Classification
        user_col = next((c for c in ["user", "username", "user_id", "actor", "account"] if c in out.columns), None)
        if user_col:
            def _classify_user(val: object) -> str:
                s = str(val).lower()
                if any(k in s for k in ["svc", "service", "system", "bot", "daemon", "backup", "cron"]):
                    self.report.service_accounts_classified += 1
                    return "SERVICE_ACCOUNT"
                if any(k in s for k in ["admin", "root", "secops", "ciso", "director"]):
                    self.report.privileged_users_tagged += 1
                    return "PRIVILEGED_USER"
                return "STANDARD_USER"

            out["identity_tier"] = out[user_col].apply(_classify_user)

        return out, self.report
