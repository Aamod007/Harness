#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" viewport 375x812
"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  const overflowing = [];
  document.querySelectorAll("*").forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth || el.scrollWidth > window.innerWidth) {
      overflowing.push({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        rectRight: rect.right,
        scrollWidth: el.scrollWidth,
        width: rect.width
      });
    }
  });
  return JSON.stringify(overflowing.slice(0, 10));
})()
'
