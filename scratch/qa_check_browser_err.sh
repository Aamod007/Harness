#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

echo "=== Navigate and get console ==="
"$B" goto "http://localhost:8080"
sleep 1

"$B" console
"$B" console --errors
