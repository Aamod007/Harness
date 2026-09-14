#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  try {
    const script = document.createElement("script");
    script.src = "/app.js?t=" + Date.now();
    let caughtErr = null;
    window.onerror = function(msg, url, line, col, error) {
      caughtErr = { msg, url, line, col, error: error ? error.stack : null };
    };
    document.head.appendChild(script);
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(JSON.stringify(caughtErr || "No onerror fired"));
      }, 500);
    });
  } catch(e) {
    return e.stack;
  }
})()
'
