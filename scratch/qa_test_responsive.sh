#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"
REPORT_DIR=".gstack/qa-reports"

echo "=== Navigating to http://localhost:8080 ==="
"$B" goto "http://localhost:8080"
sleep 1

echo "=== Mobile viewport (375x812) ==="
"$B" viewport 375x812
sleep 1
"$B" screenshot "$REPORT_DIR/screenshots/page-mobile.png"

echo "=== Check horizontal scroll / overflow at 375px ==="
"$B" js '
(() => {
  return JSON.stringify({
    windowWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth
  });
})()
'

echo "=== Tablet viewport (768x1024) ==="
"$B" viewport 768x1024
sleep 1
"$B" screenshot "$REPORT_DIR/screenshots/page-tablet.png"

echo "=== Reset viewport to standard (1280x800) ==="
"$B" viewport 1280x800
sleep 1
"$B" screenshot "$REPORT_DIR/screenshots/page-desktop.png"
