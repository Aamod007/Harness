#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 2

echo "=== All Console entries ==="
"$B" console || true

echo "=== Check window state ==="
"$B" js '
(() => {
  return JSON.stringify({
    readyState: document.readyState,
    hasPlotly: typeof Plotly !== "undefined",
    hasChart: typeof Chart !== "undefined",
    windowKeys: Object.keys(window).filter(k => !k.startsWith("webkit") && !k.startsWith("on") && k.length > 3).slice(0, 30)
  });
})()
'
