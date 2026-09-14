#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

echo "=== Extracting links ==="
"$B" links

echo "=== Checking any other <a> tags or navigation targets ==="
"$B" js '
(() => {
  const links = Array.from(document.querySelectorAll("a")).map(a => ({
    href: a.href,
    text: a.innerText.trim()
  }));
  return JSON.stringify(links);
})()
'
