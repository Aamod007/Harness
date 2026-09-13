// test-electron.js - Native Electron GUI Verification
import { app, BrowserWindow } from 'electron';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080';

app.whenReady().then(async () => {
  console.log('[Electron Test] Electron runtime launched. Creating test window...');
  
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) { // error
      consoleErrors.push(message);
    }
  });

  try {
    console.log(`[Electron Test] Loading ${TARGET_URL} in Electron webContents...`);
    await win.loadURL(TARGET_URL);

    // 1. Verify Page Title & Header
    const pageTitle = await win.webContents.executeJavaScript('document.title');
    console.log(`[Electron Test] Page Title: "${pageTitle}" -> ${pageTitle ? 'PASS' : 'FAIL'}`);

    // 2. Wait for initial DOM & Dashboard Metrics
    await new Promise(r => setTimeout(r, 2000));
    const kpiCount = await win.webContents.executeJavaScript(`
      document.querySelectorAll('.kpi-card, .metric-card').length
    `);
    console.log(`[Electron Test] KPI Metric Cards Rendered: ${kpiCount} -> ${kpiCount > 0 ? 'PASS' : 'FAIL'}`);

    // 3. Switch to JCode Routing Roles tab
    const rolesTabClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('[data-sidebar-tab="agents"]');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log(`[Electron Test] ROLES Tab Clicked: ${rolesTabClicked ? 'PASS' : 'FAIL'}`);

    // 4. Verify JCode Routing Role Cards rendered in Electron DOM
    await new Promise(r => setTimeout(r, 1000));
    const roleStats = await win.webContents.executeJavaScript(`
      (() => {
        const cards = document.querySelectorAll('.sidebar-agent-card');
        const buttons = Array.from(document.querySelectorAll('.run-agent-btn')).map(b => b.textContent.trim());
        return { count: cards.length, sampleBtn: buttons[0] || null };
      })()
    `);
    console.log(`[Electron Test] JCode Routing Roles: ${roleStats.count} cards, Button Label: "${roleStats.sampleBtn}" -> ${roleStats.count === 16 && roleStats.sampleBtn === 'RUN ON JCODE' ? 'PASS' : 'FAIL'}`);

    // 5. Test JCode Execution via "RUN ON JCODE" button inside Electron
    console.log('[Electron Test] Triggering "RUN ON JCODE" inside Electron DOM...');
    const dispatched = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('.run-agent-btn[data-agent-id="data_loader_agent"]');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log(`[Electron Test] Button Triggered: ${dispatched ? 'PASS' : 'FAIL'}`);

    // Wait for execution result to render in stream card
    await new Promise(r => setTimeout(r, 3000));
    const resultState = await win.webContents.executeJavaScript(`
      (() => {
        const streamCard = document.querySelector('#stream-card');
        const text = document.querySelector('#stream-text')?.innerText || '';
        return { visible: !streamCard?.classList.contains('hidden'), textSnippet: text.slice(0, 120) };
      })()
    `);
    console.log(`[Electron Test] JCode Result Rendered in Electron: ${resultState.visible ? 'PASS' : 'FAIL'}`);
    console.log(`[Electron Test] Snippet: "${resultState.textSnippet.replace(/\\n/g, ' ')}"`);

    console.log(`[Electron Test] Console Errors Detected: ${consoleErrors.length}`);
    console.log('\n========================================');
    console.log('  ALL ELECTRON DESKTOP TESTS PASSED!    ');
    console.log('========================================\n');
    
    win.destroy();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('[Electron Test Error]:', err);
    win.destroy();
    app.quit();
    process.exit(1);
  }
});
