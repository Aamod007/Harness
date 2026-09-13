"""Threat Intelligence & Alert NLP Agent.

Parses freeform antivirus/EDR alert strings using regex and semantic keyword clustering,
maps them to standard MITRE ATT&CK tactics, and assigns calibrated severity scores.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
import pandas as pd


@dataclass
class ThreatAgentReport:
    """Audit metrics produced by ThreatAgent."""
    alerts_classified: int = 0
    mitre_tactics_assigned: int = 0
    critical_severities_assigned: int = 0
    high_severities_assigned: int = 0


MITRE_TACTIC_PATTERNS = {
    "Credential Access": [
        r"mimikatz", r"credential\s*dump", r"brute\s*force", r"hash", r"kerberoast",
        r"password\s*spray", r"failed\s*login", r"ntds\.dit", r"lsass"
    ],
    "Lateral Movement": [
        r"psexec", r"remote\s*desktop", r"rdp", r"smb\s*exec", r"wmi\s*exec",
        r"pass-the-hash", r"lateral", r"ssh\s*tunnel"
    ],
    "Defense Evasion": [
        r"tamper", r"disable\s*firewall", r"obfuscat", r"clear\s*logs", r"bypass",
        r"process\s*inject", r"masquerad"
    ],
    "Discovery": [
        r"port\s*scan", r"network\s*recon", r"nmap", r"whoami", r"enum",
        r"ldap\s*query", r"subnet\s*scan"
    ],
    "Execution": [
        r"powershell", r"cmd\.exe", r"bash", r"script\s*exec", r"rundll32", r"process\s*spawn"
    ],
    "Initial Access": [
        r"spearphish", r"phish", r"exploit", r"public\s*facing", r"external\s*remote"
    ],
    "Command and Control": [
        r"c2", r"beacon", r"cobalt\s*strike", r"reverse\s*shell", r"command\s*and\s*control",
        r"dns\s*tunnel", r"tor\s*exit"
    ],
    "Exfiltration": [
        r"data\s*exfil", r"exfiltrat", r"large\s*upload", r"mega\s*upload", r"archive\s*transfer", r"rar\s*archive"
    ],
}


class ThreatAgent:
    """Specialized worker for unstructured alert text and threat severity scoring."""

    def __init__(self) -> None:
        self.report = ThreatAgentReport()

    def clean(self, df: pd.DataFrame) -> tuple[pd.DataFrame, ThreatAgentReport]:
        out = df.copy()

        alert_col = next((c for c in ["alert_text", "alert_description", "antivirus_text", "antivirus_alert", "alert", "threat", "message", "event_description"] if c in out.columns), None)
        
        mitre_tactics = []
        severity_labels = []
        severity_scores = []

        # If no explicit alert column, create baseline from event_type / action
        source_series = out[alert_col] if alert_col else out.get("action", out.get("event_type", pd.Series([""] * len(out))))

        for idx, val in enumerate(source_series):
            s = str(val).lower() if pd.notna(val) else ""

            # Classify MITRE Tactic
            detected_tactic = "Informational / Baseline"
            for tactic, patterns in MITRE_TACTIC_PATTERNS.items():
                if any(re.search(p, s) for p in patterns):
                    detected_tactic = tactic
                    self.report.mitre_tactics_assigned += 1
                    break

            mitre_tactics.append(detected_tactic)

            # Assign Severity
            if detected_tactic in ["Credential Access", "Command and Control", "Exfiltration"] or "critical" in s or "ransom" in s:
                severity_labels.append("CRITICAL")
                severity_scores.append(90.0)
                self.report.critical_severities_assigned += 1
            elif detected_tactic in ["Lateral Movement", "Defense Evasion"] or "high" in s:
                severity_labels.append("HIGH")
                severity_scores.append(70.0)
                self.report.high_severities_assigned += 1
            elif detected_tactic in ["Discovery"] or "warning" in s or "medium" in s:
                severity_labels.append("MEDIUM")
                severity_scores.append(40.0)
            else:
                severity_labels.append("LOW")
                severity_scores.append(15.0)

            self.report.alerts_classified += 1

        out["mitre_tactic"] = mitre_tactics
        technique_map = {
            "Initial Access": "T1078 (Valid Accounts)",
            "Execution": "T1059 (Command and Scripting)",
            "Defense Evasion": "T1070 (Indicator Removal)",
            "Credential Access": "T1110 (Brute Force)",
            "Discovery": "T1087 (Account Discovery)",
            "Lateral Movement": "T1021 (Remote Services)",
            "Command and Control": "T1071 (Application Protocol)",
            "Exfiltration": "T1048 (Exfiltration Protocol)",
            "Informational / Baseline": "T0000 (Baseline Activity)",
        }
        out["mitre_technique"] = [technique_map.get(t, "T0000 (Baseline Activity)") for t in mitre_tactics]
        out["threat_severity"] = severity_labels
        out["threat_score"] = severity_scores

        # Explicit Severity Column Normalization (e.g. from endpoint alerts)
        sev_col = next((c for c in ["severity", "alert_severity", "priority"] if c in out.columns), None)
        if sev_col:
            def _clean_sev(val: object) -> str:
                if pd.isna(val): return "MEDIUM"
                s = str(val).strip().lower()
                if any(k in s for k in ["crit", "severe", "p1"]): return "CRITICAL"
                if any(k in s for k in ["high", "major", "p2", "h"]): return "HIGH"
                if any(k in s for k in ["med", "moderate", "p3", "m"]): return "MEDIUM"
                if any(k in s for k in ["low", "minor", "p4", "l"]): return "LOW"
                return "MEDIUM"

            out["severity_normalized"] = out[sev_col].apply(_clean_sev)
            out[sev_col] = out["severity_normalized"]
            out["threat_severity"] = out["severity_normalized"]

        # Explicit Status Column Normalization (e.g. OPEN, IN_PROGRESS, RESOLVED, FALSE_POSITIVE)
        status_col = next((c for c in ["status", "alert_status", "incident_status"] if c in out.columns and c != "auth_status"), None)
        if status_col:
            def _clean_status(val: object) -> str:
                if pd.isna(val): return "OPEN"
                s = str(val).strip().lower()
                if any(k in s for k in ["not malic", "false_pos", "false pos", "fp"]): return "FALSE_POSITIVE"
                if any(k in s for k in ["resolv", "close", "r"]): return "RESOLVED"
                if any(k in s for k in ["progress", "wip", "investig"]): return "IN_PROGRESS"
                if any(k in s for k in ["open", "new", "active", "o", "n", "unassign"]): return "OPEN"
                return s.upper()

            out["status_normalized"] = out[status_col].apply(_clean_status)
            out[status_col] = out["status_normalized"]

        # Calculate composite zero-trust risk score:
        # min(100, 0.35 * AuthRisk + 0.35 * ThreatScore + 0.30 * BehavioralAnomaly)
        auth_status_series = out.get("auth_status", pd.Series(["SUCCESS"] * len(out)))
        auth_multiplier = auth_status_series.apply(lambda x: 85.0 if str(x).upper() in ["FAILED", "DENIED", "BLOCKED"] else 15.0)
        
        composite_risk = (0.35 * auth_multiplier) + (0.40 * pd.Series(severity_scores)) + (0.25 * (out.get("is_tor_exit", pd.Series([False]*len(out))).astype(int) * 60.0 + 20.0))
        out["risk_score"] = composite_risk.clip(lower=5.0, upper=99.9).round(1)

        return out, self.report
