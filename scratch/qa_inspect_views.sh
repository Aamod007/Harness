#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  const views = Array.from(document.querySelectorAll(".app-view, [id$=\"view\"]")).map(v => ({
    id: v.id,
    className: v.className,
    display: window.getComputedStyle(v).display
  }));
  const tabs = Array.from(document.querySelectorAll(".sidebar-tab")).map(t => ({
    text: t.innerText.trim(),
    dataset: Object.assign({}, t.dataset),
    active: t.classList.contains("active")
  }));
  return JSON.stringify({ views, tabs });
})()
'
