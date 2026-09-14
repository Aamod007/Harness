#!/usr/bin/env bash
LEARN_BIN="$HOME/.claude/skills/gstack/bin/gstack-learnings-log"
if [ -x "$LEARN_BIN" ]; then
  "$LEARN_BIN" '{"skill":"qa-only","type":"operational","key":"syntax-error-parse-blocking","insight":"Single unclosed literal in client bundle halts V8 parsing and silences all DOM listener registrations","confidence":9,"source":"observed","files":["client/app.js"]}' 2>/dev/null || true
fi

TEL_BIN="$HOME/.claude/skills/gstack/bin/gstack-skill-end"
if [ -x "$TEL_BIN" ]; then
  "$TEL_BIN" --skill "qa-only" --outcome success \
    --session-id "1764-1789384162-f7ecabe1" --tel-start "1789384162" --used-browse yes \
    --error-message "" --failed-step "" 2>/dev/null || true
fi

echo "Learnings and telemetry complete."
