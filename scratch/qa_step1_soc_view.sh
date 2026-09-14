#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"
REPORT_DIR=".gstack/qa-reports"
mkdir -p "$REPORT_DIR/screenshots"

echo "=== Navigating to http://localhost:8080 ==="
"$B" goto "http://localhost:8080"
sleep 1

echo "=== Finding SOC DASHBOARD button and clicking ==="
"$B" js 'document.querySelector("[data-sidebar-tab=\"soc\"]")?.click()'
sleep 2

echo "=== Checking console errors ==="
"$B" console --errors || true

echo "=== Taking screenshot soc-overview.png ==="
"$B" screenshot "$REPORT_DIR/screenshots/soc-overview.png"

echo "=== Interactive snapshot ==="
"$B" snapshot -i | head -n 80
