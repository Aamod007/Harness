#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"
REPORT_DIR=".gstack/qa-reports"

"$B" goto "http://localhost:8080"
sleep 1

echo "=== Triggering click on data-sidebar-tab=soc ==="
"$B" js '
(() => {
  const btn = document.querySelector("[data-sidebar-tab=\"soc\"]");
  if (!btn) return "NOT_FOUND";
  btn.click();
  return "CLICKED";
})()
'
sleep 2

echo "=== Checking console errors ==="
"$B" console --errors || true

echo "=== Taking screenshot soc-overview.png ==="
"$B" screenshot "$REPORT_DIR/screenshots/soc-overview.png"

echo "=== Checking visibility of soc-dashboard-view ==="
"$B" js '
(() => {
  const view = document.getElementById("soc-dashboard-view");
  const comp = document.getElementById("composer-container");
  const taskView = document.getElementById("task-view");
  return JSON.stringify({
    socViewDisplay: view ? window.getComputedStyle(view).display : null,
    socViewClass: view ? view.className : null,
    taskViewDisplay: taskView ? window.getComputedStyle(taskView).display : null
  });
})()
'

echo "=== Snapshot of active elements ==="
"$B" snapshot -i | head -n 80
