#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"
REPORT_DIR=".gstack/qa-reports/screenshots"
mkdir -p "$REPORT_DIR"

echo "=== 1. Navigate to http://localhost:8080 ==="
"$B" viewport 1280x800
"$B" goto "http://localhost:8080"
sleep 2

echo "=== 2. Check Console Errors ==="
"$B" console --errors

echo "=== 3. Check window.__cipher presence ==="
"$B" js '
(() => {
  return JSON.stringify({
    hasCipher: typeof window.__cipher !== "undefined",
    activeTab: window.__cipher ? window.__cipher.state.activeTab : null
  });
})()
'

echo "=== 4. Click SOC DASHBOARD tab ==="
"$B" js 'document.querySelector("[data-sidebar-tab=\"soc\"]").click()'
sleep 2

echo "=== 5. Check SOC Dashboard visibility ==="
"$B" js '
(() => {
  const socView = document.getElementById("soc-dashboard-view");
  return JSON.stringify({
    hidden: socView.hidden,
    display: window.getComputedStyle(socView).display,
    active: socView.classList.contains("active")
  });
})()
'
"$B" screenshot "$REPORT_DIR/soc-dashboard-active.png"

echo "=== 6. Test Data Rescue Inspector Modal ==="
"$B" js 'document.getElementById("soc-open-rescue-modal-btn").click()'
sleep 1
"$B" screenshot "$REPORT_DIR/soc-rescue-modal-active.png"
"$B" js 'document.getElementById("soc-rescue-modal-close-btn").click()'
sleep 1

echo "=== 7. Test Threat Drawer Interaction ==="
"$B" js '
(() => {
  const firstRow = document.querySelector("#soc-threat-tbody tr");
  if (firstRow) firstRow.click();
})()
'
sleep 1
"$B" screenshot "$REPORT_DIR/soc-threat-drawer-active.png"
"$B" js 'document.getElementById("threat-drawer-close-btn").click()'
sleep 1

echo "=== 8. Test Evaluator Tour ==="
"$B" js 'document.getElementById("soc-run-tour-btn").click()'
sleep 4
"$B" screenshot "$REPORT_DIR/soc-tour-success.png"

echo "=== 9. Verify Mobile Viewport (375x812) ==="
"$B" viewport 375x812
sleep 1
"$B" js '
(() => {
  return JSON.stringify({
    viewportWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth
  });
})()
'
"$B" screenshot "$REPORT_DIR/page-mobile-verified.png"

echo "=== 10. Verify Accessibility Labels ==="
"$B" viewport 1280x800
"$B" js '
(() => {
  const input = document.getElementById("soc-copilot-input");
  return JSON.stringify({
    id: input.id,
    ariaLabel: input.getAttribute("aria-label"),
    placeholder: input.placeholder
  });
})()
'

echo "=== 11. Final Console Error Check ==="
"$B" console --errors

echo "=== ALL CHECKS COMPLETED ==="
