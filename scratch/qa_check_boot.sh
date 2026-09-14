#!/usr/bin/env bash
set -e
B="/c/Users/aamod/.claude/skills/gstack/browse/dist/browse"

"$B" goto "http://localhost:8080"
sleep 2

"$B" js '
(() => {
  return JSON.stringify({
    hasCipher: typeof window.__cipher !== "undefined",
    cipherState: window.__cipher ? {
      activeTab: window.__cipher.state.activeTab,
      activeSidebarTab: window.__cipher.state.activeSidebarTab,
      sessionsCount: window.__cipher.state.sessions.length,
      selectedSession: window.__cipher.state.selectedSession,
      hasWorkspace: !!window.__cipher.state.workspace
    } : null
  });
})()
'
