#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 1

"$B" js '
(() => {
  const issues = [];
  
  // Check buttons without text or aria-label
  const buttons = Array.from(document.querySelectorAll("button"));
  buttons.forEach((b, i) => {
    const text = b.innerText.trim();
    const aria = b.getAttribute("aria-label");
    const title = b.getAttribute("title");
    if (!text && !aria && !title) {
      issues.push({ type: "missing-button-name", html: b.outerHTML.slice(0, 100), id: b.id, class: b.className });
    }
  });

  // Check heading hierarchy
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(h => ({
    tag: h.tagName,
    text: h.innerText.trim().slice(0, 50),
    visible: h.offsetParent !== null
  }));

  // Check inputs without labels
  const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
  const inputIssues = [];
  inputs.forEach(inp => {
    const id = inp.id;
    const label = id ? document.querySelector(`label[for="${id}"]`) : null;
    const ariaLabel = inp.getAttribute("aria-label");
    const ariaLabelledBy = inp.getAttribute("aria-labelledby");
    if (!label && !ariaLabel && !ariaLabelledBy) {
      inputIssues.push({ id: inp.id, type: inp.type || inp.tagName, class: inp.className });
    }
  });

  return JSON.stringify({ issues, headings, inputIssues }, null, 2);
})()
'
