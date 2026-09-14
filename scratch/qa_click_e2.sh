#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"
REPORT_DIR=".gstack/qa-reports"

echo "=== Navigating to http://localhost:8080 ==="
"$B" goto "http://localhost:8080"
sleep 1

echo "=== Taking snapshot ==="
"$B" snapshot -i

echo "=== Clicking @e2 ==="
"$B" click @e2
sleep 2

echo "=== Taking screenshot soc-overview.png ==="
"$B" screenshot "$REPORT_DIR/screenshots/soc-overview.png"

echo "=== Fresh snapshot after click ==="
"$B" snapshot -i | head -n 80
