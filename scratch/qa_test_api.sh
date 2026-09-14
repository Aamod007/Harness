#!/usr/bin/env bash
for ep in "/api/status" "/api/sessions" "/api/workspace" "/api/telemetry/soc-metrics" "/api/telemetry/rescue-audit" "/api/telemetry/threat-leaderboard" "/api/telemetry/export-evidence"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080$ep")
  echo "$ep -> $STATUS"
done
