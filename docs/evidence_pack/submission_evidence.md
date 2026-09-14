# Zero-Trust Telemetry SOC Workbench — Submission Evidence Pack

**Generated:** 2026-09-14 11:21:49 UTC  
**Track:** Datathon Track 2 (Enterprise Analytics & Autonomous Graph AI)  
**Database:** `data/cyber_metrics.duckdb` (SHA-256: `d82b77156584b64fecfa654b163a2f52e20b124464d61752d0173099b4cafb83`)  
**Survival Rate:** **100.0%** (62,430 / 62,430 rows clean)  

## 1. Raw Dataset Ingestion Audit

| Dataset | File Name | Size (MB) | SHA-256 Integrity Hash |
|---|---|---|---|
| `firewall_logs` | `track2_firewall_logs.csv` | 3.76 MB | `1a2833a93832d53dd6c5e1204769bf1a72b0d5069d7ba17508fa6f11e381608c` |
| `iam_audit` | `track2_iam_audit_trail.json` | 8.84 MB | `316acf81d46734caa9fc8d9fe3c9794d9ae5aa6bc29782e2028a655b344fc687` |
| `endpoint_alerts` | `track2_endpoint_alerts.xlsx` | 0.99 MB | `cd43513e3e6d3ed7ada3e6db884aaf5e2167668041e5d492ace799fa2a5e9f92` |
| `identity_master` | `track2_identity_asset_master.csv` | 0.36 MB | `b5a70c3d4936857d8210fe098adcda78819d9e7465bdf8e635c5475ce1fab117` |

## 2. Row Survival Audit (Gate 2 Compliance: Zero Data Loss)

| Canonical Table | Ingested Rows | Rescued Rows | Survival Rate | Integrity Status |
|---|---|---|---|---|
| `firewall_logs` | 30,600 | 30,600 | 100.0% | **VERIFIED CLEAN** |
| `logins` | 20,500 | 20,500 | 100.0% | **VERIFIED CLEAN** |
| `endpoint_alerts` | 8,240 | 8,240 | 100.0% | **VERIFIED CLEAN** |
| `users` | 3,090 | 3,090 | 100.0% | **VERIFIED CLEAN** |
| **TOTAL** | **62,430** | **62,430** | **100.0%** | **100.0% PRESERVED** |

## 3. Certified Security Views Verification (Gate 3 SLA <5ms)

| View Name | Records | Columns | Verification Status |
|---|---|---|---|
| `v_dept_login_failure_trend` | 570 | `date, department, total_attempts, failed_attempts, failure_rate_pct` | **PASS** |
| `v_failed_login_rate` | 10 | `department, total_logins, total_failures, failure_rate_pct` | **PASS** |
| `v_insider_risk_score` | 5,056 | `user_id, full_name, department, role, avg_insider_score, max_threat_risk, total_failed_logins, critical_edr_alerts` | **PASS** |
| `v_firewall_action_by_protocol` | 6 | `protocol, action, packet_count, total_mb` | **PASS** |
| `v_endpoint_alerts_by_severity` | 16 | `severity, status, alert_count, impossible_resolution_count` | **PASS** |

## 4. Key Performance Indicators (KPIs)

- **Failed Login Rate:** `34.59%` (Formula: `COUNT(status='FAILED') / COUNT(*) * 100`)
- **Critical EDR Alerts:** `790` alerts (Formula: `COUNT(severity='CRITICAL')`)
- **Top Attacked Protocol:** `TCP` with `22,031` events
- **High-Risk Insiders (Score ≥ 80):** `61` employees flagged for investigation

## 5. Offline & Air-Gap Resiliency Certification

- **Local Plotly Vendoring:** `client/vendor/plotly.min.js` (4.35 MB) — **VERIFIED**
- **In-Memory Query Cache:** Pre-warmed for instant sub-2ms response times under zero-network conditions.
- **SQL Injection Sanitization:** AST-guarded against destructive statements (`DROP`, `DELETE`, `TRUNCATE`, `ALTER`).
