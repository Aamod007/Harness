#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  const tab = document.querySelector("[data-sidebar-tab=\"workspace\"]");
  tab.click();
  const activeTab = document.querySelector(".sidebar-tab.active")?.innerText;
  const wsDisplay = window.getComputedStyle(document.getElementById("sidebar-workspace-view")).display;
  return JSON.stringify({ activeTab, wsDisplay });
})()
'
