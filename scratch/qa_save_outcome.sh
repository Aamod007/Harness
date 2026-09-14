#!/usr/bin/env bash
eval "$(~/.claude/skills/gstack/bin/gstack-slug 2>/dev/null)" || true
SLUG=${SLUG:-data-harness}
USER_NAME="aamod"
BRANCH="main"
DT=$(date -u +"%Y%m%d-%H%M%S")
PROJ_DIR="$HOME/.gstack/projects/$SLUG"
mkdir -p "$PROJ_DIR"
OUT_FILE="$PROJ_DIR/${USER_NAME}-${BRANCH}-test-outcome-${DT}.md"
cp .gstack/qa-reports/qa-report-localhost-8080-2026-09-14.md "$OUT_FILE"
echo "Project test outcome written to: $OUT_FILE"
