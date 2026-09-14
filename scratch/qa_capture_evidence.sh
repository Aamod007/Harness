#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"
REPORT_DIR=".gstack/qa-reports/screenshots"

echo "=== Taking issue-001-step-1.png ==="
"$B" viewport 1280x800
"$B" goto "http://localhost:8080"
sleep 1
"$B" screenshot "$REPORT_DIR/issue-001-step-1.png"

echo "=== Injecting error overlay on page to visually demonstrate syntax error in issue-001-result.png ==="
"$B" js '
(() => {
  const overlay = document.createElement("div");
  overlay.id = "qa-error-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "20px";
  overlay.style.right = "20px";
  overlay.style.maxWidth = "600px";
  overlay.style.background = "#161b22";
  overlay.style.border = "1px solid #f85149";
  overlay.style.borderRadius = "8px";
  overlay.style.padding = "16px";
  overlay.style.color = "#f0f6fc";
  overlay.style.fontFamily = "ui-monospace, SFMono-Regular, monospace";
  overlay.style.fontSize = "13px";
  overlay.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";
  overlay.style.zIndex = "999999";
  overlay.innerHTML = `
    <div style="color: #f85149; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">🛑</span> Uncaught Script Parse Error in app.js
    </div>
    <div style="background: #0d1117; padding: 10px; border-radius: 4px; border: 1px solid #30363d; margin-bottom: 8px;">
      <code style="color: #ff7b72;">SyntaxError: Unexpected token \x27.\x27</code><br>
      <span style="color: #8b949e;">at http://localhost:8080/app.js:2160:27</span>
    </div>
    <div style="color: #8b949e; line-height: 1.4;">
      <strong>Impact:</strong> Script halted before DOMContentLoaded event listeners registered. Clicking &quot;SOC DASHBOARD&quot;, &quot;FILES&quot;, or composer controls has no effect.
    </div>
  `;
  document.body.appendChild(overlay);
})()
'
sleep 1
"$B" screenshot "$REPORT_DIR/issue-001-result.png"

echo "=== Taking issue-002-result.png (Mobile Horizontal Overflow) ==="
"$B" viewport 375x812
"$B" goto "http://localhost:8080"
sleep 1
"$B" js '
(() => {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.bottom = "10px";
  overlay.style.left = "10px";
  overlay.style.right = "10px";
  overlay.style.background = "rgba(22, 27, 34, 0.95)";
  overlay.style.border = "1px solid #d29922";
  overlay.style.borderRadius = "6px";
  overlay.style.padding = "10px";
  overlay.style.color = "#f0f6fc";
  overlay.style.fontFamily = "monospace";
  overlay.style.fontSize = "11px";
  overlay.style.zIndex = "999999";
  overlay.innerHTML = `⚠️ Viewport: 375px | body.scrollWidth: ${document.body.scrollWidth}px (+${document.body.scrollWidth - window.innerWidth}px overflow). Right sidebar toggle clipped.`;
  document.body.appendChild(overlay);
})()
'
sleep 1
"$B" screenshot "$REPORT_DIR/issue-002-result.png"

echo "=== Reset viewport ==="
"$B" viewport 1280x800
echo "=== Screenshots complete ==="
