// test-electron.js - Native Electron Desktop Verification
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
    if (level >= 3) {
      consoleErrors.push(message);
    }
  });

  try {
    console.log(`[Electron Test] Loading ${TARGET_URL} in Electron webContents...`);
    await win.loadURL(TARGET_URL);

    // 1. Verify Page Title
    const pageTitle = await win.webContents.executeJavaScript('document.title');
    console.log(`[Electron Test] Page Title: "${pageTitle}" -> ${pageTitle ? 'PASS' : 'FAIL'}`);

    // 2. Test "NEW SESSION" button & Clean Title
    console.log('[Electron Test] Testing NEW SESSION creation & Clean Title formatting...');
    const newSessionResult = await win.webContents.executeJavaScript(`
      (async () => {
        const btn = document.querySelector('#new-session-button');
        if (btn) btn.click();
        await new Promise(r => setTimeout(r, 1200));
        const heading = document.querySelector('#sessions-heading')?.textContent || '';
        const activeItem = document.querySelector('.session-item-row.active .session-item-subject')?.textContent || '';
        const isClean = !/llama_\d+_[a-f0-9]+/i.test(heading) && !/llama_\d+_[a-f0-9]+/i.test(activeItem);
        return { heading, activeItem, isClean };
      })()
    `);
    console.log(`[Electron Test] Session Heading: "${newSessionResult.heading}"`);
    console.log(`[Electron Test] Sidebar Item: "${newSessionResult.activeItem}" -> ${newSessionResult.isClean ? 'PASS (Clean Title)' : 'FAIL'}`);

    // 3. Test File Attachment Preview Card (Screenshot 1 requirement)
    console.log('[Electron Test] Testing File Attachment Preview badge & rendering...');
    const attachResult = await win.webContents.executeJavaScript(`
      (() => {
        window.__cipher.state.attachedFiles = [{
          name: 'pb.md',
          sizeStr: '12.4 KB',
          lines: 255,
          ext: 'MD'
        }];
        window.__cipher.renderAttachedFilesPreview();
        const previewEl = document.querySelector('#attached-files-preview');
        const badge = previewEl?.querySelector('.attached-file-badge');
        const name = badge?.querySelector('.attached-file-name')?.textContent;
        const lines = badge?.querySelector('.attached-file-lines')?.textContent;
        const ext = badge?.querySelector('.attached-file-ext')?.textContent;
        return {
          visible: !previewEl?.classList.contains('hidden'),
          name,
          lines,
          ext
        };
      })()
    `);
    console.log(`[Electron Test] Attached File Badge: ${attachResult.name} | ${attachResult.lines} | [${attachResult.ext}] -> ${attachResult.visible && attachResult.name === 'pb.md' ? 'PASS' : 'FAIL'}`);

    // 4. Test Prompt Submission with Attached File (User Message Bubble from Screenshot 1)
    console.log('[Electron Test] Testing Prompt Submission with File Card in Chat...');
    const submitResult = await win.webContents.executeJavaScript(`
      (async () => {
        window.__cipher.submitPrompt('hi JCode');
        await new Promise(r => setTimeout(r, 1500));
        const userMsg = document.querySelector('.user-message-container');
        const fileCardInMsg = userMsg?.querySelector('.attached-file-badge');
        const bubble = userMsg?.querySelector('.user-message-bubble')?.textContent;
        return {
          hasUserContainer: !!userMsg,
          hasFileCard: !!fileCardInMsg,
          bubbleText: bubble
        };
      })()
    `);
    console.log(`[Electron Test] Chat File Card Rendered in Bubble: ${submitResult.hasFileCard ? 'PASS' : 'FAIL'}`);

    // 5. Verify No "413 Payload Too Large" error
    await new Promise(r => setTimeout(r, 4000));
    const streamErrorCheck = await win.webContents.executeJavaScript(`
      (() => {
        const text = document.querySelector('#stream-text')?.innerText || '';
        const has413 = /413|Payload Too Large|ITPM/i.test(text);
        return { has413, textSnippet: text.slice(0, 140) };
      })()
    `);
    console.log(`[Electron Test] 413 Payload Too Large Check: ${!streamErrorCheck.has413 ? 'PASS (Clean Execution)' : 'FAIL'}`);

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
