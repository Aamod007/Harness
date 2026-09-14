#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  const btns = Array.from(document.querySelectorAll("button")).map(b => ({
    text: b.innerText.trim(),
    id: b.id,
    className: b.className,
    dataset: Object.assign({}, b.dataset),
    visible: b.offsetParent !== null
  }));
  return JSON.stringify(btns);
})()
'
