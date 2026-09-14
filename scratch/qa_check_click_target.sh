#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 2

"$B" js '
(() => {
  const tabs = document.querySelectorAll(".sidebar-tab");
  const tabEl = tabs[0];
  const rect = tabEl.getBoundingClientRect();
  const elAtPoint = document.elementFromPoint(rect.x + 5, rect.y + 5);
  return JSON.stringify({
    tabText: tabEl.innerText,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    elAtPoint: elAtPoint ? { tag: elAtPoint.tagName, id: elAtPoint.id, class: elAtPoint.className } : null
  });
})()
'
