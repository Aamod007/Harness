#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  const scripts = Array.from(document.querySelectorAll("script")).map(s => ({
    src: s.src,
    type: s.type,
    inline: s.innerText.slice(0, 100)
  }));
  return JSON.stringify(scripts);
})()
'
