/**
 * Cipher / JCode Agent Workspace Controller
 * Connected to the real JCode agent runtime via JCode Harness API.
 */
document.addEventListener('DOMContentLoaded', () => {
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];

    const state = {
        status: null,
        sessions: [],
        selectedSession: null,
        models: [],
        currentModel: null,
        workspace: null,
        openFolders: new Set(['.']),
        openFiles: [],
        loadingFiles: new Set(),
        activeFile: null,
        activeTab: 'sessions',
        activeSidebarTab: 'sessions',
        isGenerating: false,
        eventSource: null,
        tools: new Map(), // call_id -> { name, input, output, error, status }
        attachedFiles: [],
        composerMode: 'Ask',
    };

    // DOM Elements
    const tabButtons = $$('.section-tab');
    const sidebarTabButtons = $$('.sidebar-tab');
    const views = $$('.app-view');
    const sidebarViews = $$('.sidebar-view');
    const loadingLine = $('#loading-line');
    const sessionList = $('#session-list');
    const sessionCount = $('#session-count');
    const sessionHeading = $('#sessions-heading');
    const sessionContext = $('#session-context');
    const streamCard = $('#stream-card');
    const streamBadge = $('#stream-badge');
    const streamModel = $('#stream-model');
    const streamText = $('#stream-text');
    const reasoningBlock = $('#reasoning-block');
    const reasoningHeader = $('#reasoning-header');
    const reasoningTitle = $('#reasoning-title');
    const reasoningBadge = $('#reasoning-badge');
    const reasoningDot = $('#reasoning-dot');
    const reasoningMeta = $('#reasoning-meta');
    const reasoningToggle = $('#reasoning-toggle');
    const reasoningContent = $('#reasoning-content');
    const reasoningText = $('#reasoning-text');

    let accumulatedReasoning = '';
    let isThinkingActive = false;
    let thinkingStartTime = null;
    let reasoningInTextDelta = false;

    function toggleReasoningCollapse(force) {
        if (!reasoningBlock) return;
        const shouldCollapse = force !== undefined ? force : !reasoningBlock.classList.contains('collapsed');
        reasoningBlock.classList.toggle('collapsed', shouldCollapse);
    }

    if (reasoningHeader) {
        reasoningHeader.addEventListener('click', () => {
            toggleReasoningCollapse();
        });
        reasoningHeader.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleReasoningCollapse();
            }
        });
    }
    if (reasoningToggle) {
        reasoningToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleReasoningCollapse();
        });
    }
    const toolActivity = $('#tool-activity');
    const toolCount = $('#tool-count');
    const toolActivityList = $('#tool-activity-list');
    const analysisGrid = $('#analysis-grid');
    const metricStrip = $('#metric-strip');
    const mainPlot = $('#main-plot');
    const plotCaption = $('#plot-caption');
    const answerSummary = $('#answer-summary');
    const answerModel = $('#answer-model');
    const planOutput = $('#plan-output');
    const togglePlan = $('#toggle-plan');
    const takeawaysCard = $('#takeaways-card');
    const promptForm = $('#prompt-form');
    const promptInput = $('#prompt-input');
    const promptSendButton = $('#prompt-send-button');
    const cancelButton = $('#cancel-button');
    const settingsButton = $('#settings-button');
    const profileButton = $('#profile-button');
    const settingsMenu = $('#settings-menu');
    const profileMenu = $('#profile-menu');
    const modelSelect = $('#model-select');
    const modelSwitchStatus = $('#model-switch-status');
    const providerInput = $('#provider-input');
    const apiKeyInput = $('#api-key-input');
    const saveApiKeyButton = $('#save-api-key-button');
    const lmStudioStatus = $('#lm-studio-status');
    const checkLmStudioButton = $('#check-lm-studio-button');
    const fileUploadInput = $('#file-upload-input');
    const composerContext = $('#composer-context');
    const attachedFilesPreview = $('#attached-files-preview');
    const starterPrompts = $('#starter-prompts');
    const toastRegion = $('#toast-region');
    const workspaceDiff = $('#workspace-diff');
    const workspaceDiffSummary = $('#workspace-diff-summary');
    const workspaceDiffFiles = $('#workspace-diff-files');
    const workspaceDiffCode = $('#workspace-diff-code');
    const workspaceDiffToggle = $('#workspace-diff-toggle');
    const sessionsView = $('#sessions-view');
    const workspaceEditor = $('#workspace-editor');
    const editorTabstrip = $('#editor-tabstrip');
    const editorPanel = $('#editor-panel');
    const sidebarResizer = $('.sidebar-resizer');
    const sidebarToggle = $('#sidebar-toggle');
    const namiShell = $('.nami-shell');
    const sidecar = $('.sidecar');
    const themeOptions = $$('.theme-option');
    const themeStorageKey = 'cipher-theme';
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    let preferredTheme = 'system';

    // Sidebar resize
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    function initSidebarResize() {
        const storedWidth = localStorage.getItem('cipher-sidebar-width');
        if (storedWidth) {
            document.documentElement.style.setProperty('--sidebar-width', storedWidth + 'px');
        }

        sidebarResizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = sidecar.offsetWidth;
            sidebarResizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const delta = e.clientX - startX;
            const newWidth = Math.max(200, Math.min(600, startWidth + delta));
            document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                sidebarResizer.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem('cipher-sidebar-width', sidecar.offsetWidth);
            }
        });
    }

    function toggleSidebar() {
        const isMinimized = namiShell.classList.toggle('sidebar-minimized');
        localStorage.setItem('cipher-sidebar-minimized', isMinimized ? 'true' : 'false');
        sidebarToggle.setAttribute('aria-label', isMinimized ? 'Show sidebar' : 'Hide sidebar');
    }

    function initSidebarState() {
        if (localStorage.getItem('cipher-sidebar-minimized') === 'true') {
            namiShell.classList.add('sidebar-minimized');
            sidebarToggle.setAttribute('aria-label', 'Show sidebar');
        }
    }

    function storedTheme() {
        try { return localStorage.getItem(themeStorageKey) || 'system'; }
        catch (_) { return 'system'; }
    }

    function applyTheme(theme) {
        preferredTheme = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
        const resolved = preferredTheme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preferredTheme;
        document.documentElement.dataset.theme = resolved;
        themeOptions.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.themeOption === preferredTheme)));
    }

    function saveTheme(theme) {
        try { localStorage.setItem(themeStorageKey, theme); } catch (_) {}
        applyTheme(theme);
    }

    function showLoading() { loadingLine.classList.remove('hidden'); }
    function hideLoading() { loadingLine.classList.add('hidden'); }
    function esc(value) {
        const element = document.createElement('div');
        element.textContent = value == null ? '' : String(value);
        return element.innerHTML;
    }
    function fmt(value) { return value == null ? '-' : typeof value === 'number' ? value.toLocaleString() : String(value); }
    function short(value, length = 44) {
        const text = String(value || '').trim();
        return text.length > length ? `${text.slice(0, length - 1).trimEnd()}...` : text;
    }
    function timeAgo(iso) {
        const timestamp = Date.parse(iso);
        if (Number.isNaN(timestamp)) return 'now';
        const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
        if (minutes < 1) return 'now';
        if (minutes < 60) return `${minutes}m ago`;
        if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
        return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    async function api(method, path, body) {
        const options = { method, headers: {} };
        if (body instanceof FormData) {
            options.body = body;
        } else if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        const response = await fetch(path, options);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(error.error || error.detail || response.statusText);
        }
        return response.json();
    }

    function showToast(message, tone = 'error') {
        if (!toastRegion || !message) return;
        const toast = document.createElement('article');
        toast.className = `toast toast-${tone}`;
        toast.innerHTML = `<span class="toast-icon">${tone === 'error' ? '!' : '✓'}</span><p>${esc(message)}</p><button type="button" aria-label="Dismiss notification">×</button>`;
        toastRegion.append(toast);
        const dismiss = () => {
            toast.classList.add('toast-leaving');
            window.setTimeout(() => toast.remove(), 180);
        };
        toast.querySelector('button').addEventListener('click', dismiss);
        window.setTimeout(dismiss, 6500);
    }

    function setChatStarted(started) {
        if (starterPrompts) starterPrompts.hidden = Boolean(started);
        document.body.classList.toggle('chat-started', Boolean(started));
    }

    function setStatus(text, ready = false) {
        sessionContext.textContent = text;
        sessionContext.hidden = !text;
        if (/\b(error|failed|could not|cancel failed|payload too large)\b/i.test(text || '')) showToast(text);
    }

    function setComposerMode(mode) {
        state.composerMode = mode;
        $$('.composer-mode').forEach(button => {
            const active = button.dataset.composerMode === mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        const placeholders = {
            Ask: 'Ask about this workspace or attach a dataset',
            Analyze: 'Describe the analysis you want to run on the attached dataset',
            Review: 'Ask for a review of the workspace, data, or current result',
        };
        promptInput.placeholder = placeholders[mode] || placeholders.Ask;
        if (composerContext) composerContext.textContent = mode.toUpperCase();
    }

    function switchSidebarTab(tab) {
        state.activeSidebarTab = tab;
        sidebarTabButtons.forEach(button => {
            const selected = button.dataset.sidebarTab === tab;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
        });
        sidebarViews.forEach(view => {
            const active = view.id === `sidebar-${tab}-view`;
            view.classList.toggle('active', active);
            view.hidden = !active;
        });
        if (tab === 'sessions') {
            hideWorkspaceEditor();
            sessionsView.hidden = false;
            sessionsView.classList.add('active');
        }
        if (tab === 'workspace' && !state.workspace) loadWorkspace();
        if (tab === 'agents') renderLibrarySidebar();
    }

    function cleanSessionTitle(raw) {
        if (!raw) return 'New Session';
        if (/^(llama|qwen|gpt|session)_\d+_[a-f0-9]+$/i.test(raw) || raw.startsWith('session_')) {
            return 'New Session';
        }
        return raw;
    }

    function titleFromPrompt(prompt, fallback = 'New Session') {
        const clean = String(prompt || '')
            .replace(/^\[[^\]]+\]\s*/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return clean ? short(clean, 62) : fallback;
    }

    async function renameSessionFromPrompt(prompt, fallback) {
        if (!state.selectedSession) return;
        const selected = state.sessions.find(item => item.id === state.selectedSession);
        
        const currentTitle = cleanSessionTitle(selected?.subject);
        if (currentTitle && currentTitle !== 'New Session' && currentTitle !== 'Untitled' && currentTitle !== 'New Conversation') return;

        const title = titleFromPrompt(prompt, fallback);
        if (title === 'New Session') return;
        sessionHeading.textContent = title;
        state.sessions = state.sessions.map(item => item.id === state.selectedSession ? { ...item, subject: title } : item);
        renderSessions();
        try {
            await api('POST', `/api/sessions/${encodeURIComponent(state.selectedSession)}/title`, { title });
        } catch (_) {
            // The local title remains useful if a remote runtime cannot rename its session.
        }
    }

    async function loadWorkspaceDiff() {
        if (!workspaceDiff) return;
        try {
            const diff = await api('GET', '/api/workspace/diff');
            const files = diff.files || [];
            if (!diff.available || files.length === 0) {
                workspaceDiff.classList.add('hidden');
                return;
            }
            workspaceDiff.classList.remove('hidden');
            workspaceDiffSummary.textContent = `${files.length} changed ${files.length === 1 ? 'file' : 'files'}`;
            workspaceDiffFiles.innerHTML = files.slice(0, 6).map(file => `<span>${esc(file)}</span>`).join('');
            if (files.length > 6) workspaceDiffFiles.innerHTML += `<span>+${files.length - 6} more</span>`;
            workspaceDiffCode.textContent = diff.diff || 'No textual diff is available.';
            workspaceDiffCode.hidden = workspaceDiffToggle.getAttribute('aria-expanded') !== 'true';
            workspaceDiffToggle.textContent = workspaceDiffCode.hidden ? 'SHOW DIFF' : 'HIDE DIFF';
        } catch (_) {
            workspaceDiff.classList.add('hidden');
        }
    }

    function renderAttachedFilesPreview() {
        const previewEl = $('#attached-files-preview');
        if (!previewEl) return;
        if (!state.attachedFiles || state.attachedFiles.length === 0) {
            previewEl.innerHTML = '';
            previewEl.classList.add('hidden');
            return;
        }
        previewEl.classList.remove('hidden');
        previewEl.innerHTML = state.attachedFiles.map((f, idx) => `
            <div class="attached-file-badge attached-file-badge-preview">
                <button type="button" class="attached-file-remove" data-remove-file="${idx}" title="Remove attachment">&times;</button>
                <div class="attached-file-header">
                    <span class="attached-file-name" title="${esc(f.name)}">${esc(f.name)}</span>
                    <span class="attached-file-lines">${esc(f.lines ? `${f.lines} lines` : f.sizeStr)}</span>
                </div>
                <div class="attached-file-ext">${esc(f.ext)}</div>
            </div>
        `).join('');

        previewEl.querySelectorAll('.attached-file-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.removeFile, 10);
                state.attachedFiles.splice(idx, 1);
                renderAttachedFilesPreview();
            });
        });
    }

    function renderSessions() {
        const sessions = [...state.sessions].reverse();
        sessionCount.textContent = sessions.length;
        if (!sessions.length) {
            sessionList.innerHTML = '<p class="session-list-empty">Your Cipher tasks will appear here.</p>';
            return;
        }
        sessionList.innerHTML = sessions.map(item => `
            <div class="session-item-row ${item.id === state.selectedSession ? 'active' : ''}">
                <button type="button" class="session-item" data-session-id="${esc(item.id)}">
                    <span class="session-item-subject">${esc(short(cleanSessionTitle(item.subject || item.id), 30))}</span>
                    <span class="session-item-time">${esc(timeAgo(item.time))}</span>
                </button>
                <button type="button" class="session-delete-btn" data-delete-session-id="${esc(item.id)}" aria-label="Archive session" title="Archive session">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>`).join('');

        $$('.session-item').forEach(item => item.addEventListener('click', () => selectSession(item.dataset.sessionId)));
        $$('.session-delete-btn').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(btn.dataset.deleteSessionId);
        }));
    }

    async function loadSessions() {
        const response = await api('GET', '/api/sessions');
        state.sessions = response.sessions || [];
        renderSessions();
    }

    async function createNewSession() {
        showLoading();
        try {
            const session = await api('POST', '/api/sessions', {});
            await loadSessions();
            selectSession(session.id);
            sessionHeading.textContent = 'New Session';
            setStatus('Ready — ask Cipher a question, inspect the project, or attach a dataset.');
            promptInput.focus();
        } catch (err) {
            showToast(`Could not create session: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    async function deleteSession(id) {
        showLoading();
        try {
            await api('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
            state.sessions = state.sessions.filter(s => String(s.id) !== String(id));
            if (state.selectedSession === id) {
                if (state.sessions.length > 0) {
                    selectSession(state.sessions[state.sessions.length - 1].id);
                } else {
                    resetStage();
                }
            } else {
                renderSessions();
            }
        } catch (error) {
            showToast(`Could not archive session: ${error.message}`);
        } finally {
            hideLoading();
        }
    }

    function resetStage() {
        state.selectedSession = null;
        sessionHeading.textContent = 'What can I help you work on?';
        setStatus('');
        setChatStarted(false);
        clearStreamOutput();
        renderSessions();
    }

    function clearStreamOutput(preserveChat = false) {
        streamCard.classList.add('hidden');
        if (!preserveChat) {
            streamText.textContent = '';
        }
        reasoningBlock.classList.add('hidden');
        reasoningBlock.classList.remove('collapsed');
        reasoningText.textContent = '';
        accumulatedReasoning = '';
        isThinkingActive = false;
        thinkingStartTime = null;
        reasoningInTextDelta = false;
        if (reasoningDot) reasoningDot.className = 'reasoning-dot';
        if (reasoningBadge) {
            reasoningBadge.className = 'reasoning-badge';
            reasoningBadge.textContent = 'STREAMING';
        }
        if (reasoningTitle) reasoningTitle.textContent = 'MODEL THINKING';
        if (reasoningMeta) reasoningMeta.textContent = '';
        toolActivity.classList.add('hidden');
        toolActivityList.replaceChildren();
        toolCount.textContent = '0';
        metricStrip.replaceChildren();
        state.tools.clear();
        setGeneratingState(false);
    }

    function setGeneratingState(isGenerating) {
        state.isGenerating = isGenerating;
        if (isGenerating) {
            cancelButton.classList.remove('hidden');
            promptSendButton.disabled = true;
            streamBadge.textContent = 'GENERATING';
            streamBadge.classList.remove('idle');
            showLoading();
        } else {
            cancelButton.classList.add('hidden');
            promptSendButton.disabled = false;
            streamBadge.textContent = 'READY';
            streamBadge.classList.add('idle');
            hideLoading();
        }
    }

    function connectSessionEvents(sessionId) {
        if (state.eventSource) {
            state.eventSource.close();
            state.eventSource = null;
        }

        const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
        state.eventSource = source;

        source.onmessage = (e) => {
            if (!e.data || e.data.startsWith(':')) return;
            try {
                const event = JSON.parse(e.data);
                handleJcodeEvent(event);
            } catch (err) {
                console.error('[SSE parse error]:', err, e.data);
            }
        };

        source.onerror = () => {
            console.warn('[SSE] Event stream disconnected; attempting reconnect...');
        };
    }

    function formatAgentOutputHtml(agentName, result) {
        if (!result) return `<p><em>No output returned by ${esc(agentName)}.</em></p>`;
        if (result.error) {
            return `
                <div class="agent-output-card" style="padding: 14px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; color: #f87171; font-weight: 600;">
                        <span>⚠️</span> <span>${esc(agentName)} Error</span>
                    </div>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #fca5a5;">${esc(result.error)}</p>
                </div>`;
        }

        const metrics = [];
        let tableData = null;
        let tableTitle = 'Result Telemetry';
        const sqlQuery = result.generated_sql || result.sql || null;
        const strategyNote = result.join_strategy || result.description || null;

        const fmtVal = (v) => {
            if (typeof v === 'number') {
                return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
            }
            return String(v);
        };

        const fmtKey = (k) => k.replace(/_/g, ' ').replace(/\bpct\b/i, '(%)').toUpperCase();

        const sourceObj = result.engineered_features || result;
        for (const [key, val] of Object.entries(sourceObj)) {
            if (key === 'status' || key === 'generated_sql' || key === 'sql' || key === 'join_strategy') continue;
            if (Array.isArray(val) && val.length && typeof val[0] === 'object') {
                tableData = val;
                tableTitle = fmtKey(key);
            } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                for (const [subKey, subVal] of Object.entries(val)) {
                    if (typeof subVal !== 'object') {
                        metrics.push({ label: `${fmtKey(key)}: ${fmtKey(subKey)}`, val: fmtVal(subVal) });
                    }
                }
            } else if (val !== null && typeof val !== 'object') {
                metrics.push({ label: fmtKey(key), val: fmtVal(val) });
            }
        }

        if (!tableData && Array.isArray(result.data) && result.data.length) {
            tableData = result.data;
            tableTitle = 'Telemetry Records';
        } else if (!tableData && Array.isArray(result.summary) && result.summary.length) {
            tableData = result.summary;
            tableTitle = 'Summary Records';
        } else if (!tableData && Array.isArray(result.files) && result.files.length) {
            tableData = result.files;
            tableTitle = 'Inspected Dataset Files';
        }

        let html = `
            <div class="agent-output-wrapper" style="margin-top: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--line); margin-bottom: 14px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 16px;">⚡</span>
                        <strong style="font-size: 14px; color: var(--ink);">JCode Engine: ${esc(agentName)}</strong>
                    </div>
                    <span class="kpi-badge badge-success" style="font-size: 9px; padding: 2px 8px; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);">JCODE PROCESSED</span>
                </div>`;


        if (strategyNote) {
            html += `
                <div style="margin-bottom: 12px; padding: 8px 12px; background: rgba(99, 102, 241, 0.08); border-left: 3px solid #818cf8; border-radius: 4px; font-size: 11px; color: var(--ink);">
                    <strong>Strategy:</strong> ${esc(strategyNote)}
                </div>`;
        }

        if (sqlQuery) {
            html += `
                <div style="margin-bottom: 14px; padding: 10px 12px; background: var(--canvas-dark); border: 1px solid var(--line); border-radius: 6px;">
                    <div style="font-size: 10px; color: #79c0ff; font-weight: 600; margin-bottom: 4px; text-transform: uppercase;">Generated Certified SQL:</div>
                    <code style="font-family: monospace; font-size: 11px; color: #a5d6ff; white-space: pre-wrap; word-break: break-word;">${esc(sqlQuery)}</code>
                </div>`;
        }

        if (metrics.length) {
            html += `
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 14px;">
                    ${metrics.map(m => `
                        <div style="background: var(--canvas-light); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px;">
                            <span style="display: block; font-size: 9px; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 4px;">${esc(m.label)}</span>
                            <strong style="font-size: 16px; color: var(--ink); font-family: monospace;">${esc(m.val)}</strong>
                        </div>
                    `).join('')}
                </div>`;
        }

        if (tableData && tableData.length) {
            const cols = Object.keys(tableData[0]).slice(0, 8);
            const rows = tableData.slice(0, 10);
            html += `
                <div style="margin-bottom: 14px;">
                    <div style="font-size: 11px; font-weight: 600; color: var(--muted); margin-bottom: 6px; display: flex; justify-content: space-between;">
                        <span>${esc(tableTitle)}</span>
                        <span>Showing ${rows.length} of ${tableData.length} records</span>
                    </div>
                    <div style="overflow-x: auto; border: 1px solid var(--line); border-radius: 6px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                            <thead style="background: var(--canvas-light); border-bottom: 1px solid var(--line);">
                                <tr>
                                    ${cols.map(c => `<th style="padding: 6px 10px; color: var(--muted); font-weight: 600;">${esc(fmtKey(c))}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(r => `
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                                        ${cols.map(c => `<td style="padding: 6px 10px; color: var(--ink);">${esc(r[c] != null ? fmtVal(r[c]) : '-')}</td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        }

        html += `
            <details style="margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 8px;">
                <summary style="cursor: pointer; font-size: 10px; color: var(--muted); user-select: none;">Show Raw Telemetry Payload (JSON)</summary>
                <pre style="background: var(--canvas-dark); color: #7ee787; padding: 10px; border-radius: 6px; overflow: auto; font-family: monospace; font-size: 10px; max-height: 200px; margin-top: 6px;">${esc(JSON.stringify(result, null, 2))}</pre>
            </details>
        </div>`;

        return html;
    }

    function handleJcodeEvent(event) {
        const ev = event.ev;
        const activeOutput = () => {
            const outputs = streamText.querySelectorAll('.agent-run-output');
            return outputs.length > 0 ? outputs[outputs.length - 1] : streamText;
        };

        if (ev === 'agent_ready') {
            streamCard.classList.remove('hidden');
            streamBadge.textContent = 'READY';
            streamBadge.classList.add('idle');
            activeOutput().innerHTML = formatAgentOutputHtml(event.name || event.agentId || 'Agent', event.result);
            return;
        }

        if (ev === 'text_delta') {
            streamCard.classList.remove('hidden');
            let rawText = event.text || '';

            // Handle models that stream <think> ... </think> blocks in text_delta
            if (rawText.includes('<think>')) {
                reasoningInTextDelta = true;
                streamCard.classList.remove('hidden');
                reasoningBlock.classList.remove('hidden');
                isThinkingActive = true;
                if (!thinkingStartTime) thinkingStartTime = Date.now();
                if (reasoningDot) reasoningDot.className = 'reasoning-dot';
                if (reasoningBadge) {
                    reasoningBadge.className = 'reasoning-badge';
                    reasoningBadge.textContent = 'STREAMING';
                }
                if (reasoningTitle) reasoningTitle.textContent = 'MODEL THINKING';

                const parts = rawText.split('<think>');
                if (parts[0]) activeOutput().textContent += parts[0];
                rawText = parts[1] || '';
            }

            if (reasoningInTextDelta) {
                if (rawText.includes('</think>')) {
                    const parts = rawText.split('</think>');
                    accumulatedReasoning += parts[0];
                    reasoningText.textContent = accumulatedReasoning;

                    reasoningInTextDelta = false;
                    isThinkingActive = false;
                    const elapsed = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : '0.0';
                    const words = accumulatedReasoning.trim().split(/\s+/).filter(Boolean).length;
                    if (reasoningDot) reasoningDot.className = 'reasoning-dot done';
                    if (reasoningBadge) {
                        reasoningBadge.className = 'reasoning-badge done';
                        reasoningBadge.textContent = 'COMPLETED';
                    }
                    if (reasoningTitle) reasoningTitle.textContent = 'THOUGHT PROCESS';
                    if (reasoningMeta) reasoningMeta.textContent = `${words} words • ${elapsed}s`;

                    if (parts[1]) activeOutput().textContent += parts[1];
                } else {
                    accumulatedReasoning += rawText;
                    reasoningText.textContent = accumulatedReasoning;
                    const words = accumulatedReasoning.trim().split(/\s+/).filter(Boolean).length;
                    const elapsed = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : '0.0';
                    if (reasoningMeta) reasoningMeta.textContent = `${words} words • ${elapsed}s`;
                    if (reasoningContent) reasoningContent.scrollTop = reasoningContent.scrollHeight;
                }
                return;
            }

            activeOutput().textContent += rawText;
            return;
        }

        if (ev === 'reasoning_delta') {
            streamCard.classList.remove('hidden');
            reasoningBlock.classList.remove('hidden');
            if (!isThinkingActive) {
                isThinkingActive = true;
                if (!thinkingStartTime) thinkingStartTime = Date.now();
                if (reasoningDot) reasoningDot.className = 'reasoning-dot';
                if (reasoningBadge) {
                    reasoningBadge.className = 'reasoning-badge';
                    reasoningBadge.textContent = 'STREAMING';
                }
                if (reasoningTitle) reasoningTitle.textContent = 'MODEL THINKING';
            }

            const chunk = event.text || event.delta || '';
            accumulatedReasoning += chunk;
            reasoningText.textContent = accumulatedReasoning;

            const words = accumulatedReasoning.trim().split(/\s+/).filter(Boolean).length;
            const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
            if (reasoningMeta) reasoningMeta.textContent = `${words} words • ${elapsed}s`;

            if (reasoningContent) {
                reasoningContent.scrollTop = reasoningContent.scrollHeight;
            }
            return;
        }

        if (ev === 'reasoning_done') {
            isThinkingActive = false;
            const elapsed = event.duration_secs
                ? event.duration_secs.toFixed(1)
                : (thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : '0.0');
            const words = accumulatedReasoning.trim().split(/\s+/).filter(Boolean).length;

            if (reasoningDot) reasoningDot.className = 'reasoning-dot done';
            if (reasoningBadge) {
                reasoningBadge.className = 'reasoning-badge done';
                reasoningBadge.textContent = 'COMPLETED';
            }
            if (reasoningTitle) reasoningTitle.textContent = 'THOUGHT PROCESS';
            if (reasoningMeta) reasoningMeta.textContent = `${words} words • ${elapsed}s`;
            return;
        }

        if (ev === 'tool_start') {
            toolActivity.classList.remove('hidden');
            state.tools.set(event.call_id, {
                name: event.name,
                input: '',
                output: '',
                status: 'running',
            });
            renderToolCards();
            return;
        }

        if (ev === 'tool_input_delta') {
            const tool = state.tools.get(event.call_id);
            if (tool) {
                tool.input += event.delta;
                renderToolCards();
            }
            return;
        }

        if (ev === 'tool_exec') {
            const tool = state.tools.get(event.call_id);
            if (tool) {
                tool.status = 'executing';
                renderToolCards();
            }
            return;
        }

        if (ev === 'tool_done') {
            const tool = state.tools.get(event.call_id);
            if (tool) {
                tool.status = event.error ? 'error' : 'done';
                tool.output = event.output || '';
                tool.error = event.error || null;
                renderToolCards();
            }
            return;
        }

        if (ev === 'token_usage') {
            metricStrip.innerHTML = `
                <article class="metric"><span class="metric-label">INPUT TOKENS</span><strong class="metric-value">${fmt(event.input)}</strong></article>
                <article class="metric"><span class="metric-label">OUTPUT TOKENS</span><strong class="metric-value">${fmt(event.output)}</strong></article>
                ${event.cache_read_input ? `<article class="metric"><span class="metric-label">CACHE READ</span><strong class="metric-value">${fmt(event.cache_read_input)}</strong></article>` : ''}
            `;
            return;
        }

        if (ev === 'connection_phase') {
            setStatus(`JCode: ${event.phase}`);
            return;
        }

        if (ev === 'session_status') {
            setStatus(`JCode status: ${event.status}`);
            return;
        }

        if (ev === 'turn_done') {
            setGeneratingState(false);
            setStatus('Ready');
            loadSessions();
            loadWorkspaceDiff();
            return;
        }

        if (ev === 'error') {
            setGeneratingState(false);
            setStatus(`Error: ${event.message}`);
            streamCard.classList.remove('hidden');
            activeOutput().innerHTML += `\n<div style="margin-top: 10px; padding: 10px; background: rgba(225, 29, 72, 0.08); border-left: 3px solid #e11d48; border-radius: 4px; color: #e11d48;"><strong>Harness Notice:</strong> ${esc(event.message)}</div>`;
            return;
        }

        if (ev === 'chart_ready') {
            analysisGrid.classList.remove('hidden');
            if (window.Plotly && event.chart) {
                Plotly.newPlot(mainPlot, event.chart.data, event.chart.layout, { responsive: true, displayModeBar: true });
            }
            if (event.query) {
                plotCaption.textContent = event.query;
            }
            if (event.summary) {
                answerSummary.innerHTML = event.summary.replace(/\n/g, '<br>');
            }
            answerModel.textContent = 'Agent-created result';
            return;
        }

        if (ev === 'model_info') {
            if (event.model) {
                state.currentModel = event.model;
                streamModel.textContent = event.model;
                updateModelSelectUI();
            }
            return;
        }
    }

    function renderToolCards() {
        toolCount.textContent = state.tools.size;
        toolActivityList.innerHTML = [...state.tools.entries()].map(([callId, tool]) => `
            <div class="tool-card">
                <div class="tool-header">
                    <span class="tool-name">${esc(tool.name)}</span>
                    <span class="tool-status ${tool.status}">${esc(tool.status.toUpperCase())}</span>
                </div>
                ${tool.input ? `<pre class="tool-body"><strong>Args:</strong> ${esc(tool.input)}</pre>` : ''}
                ${tool.output ? `<pre class="tool-body"><strong>Output:</strong> ${esc(tool.output)}</pre>` : ''}
                ${tool.error ? `<pre class="tool-body" style="color: #e11d48;"><strong>Error:</strong> ${esc(tool.error)}</pre>` : ''}
            </div>
        `).join('');
    }

    async function selectSession(id) {
        hideWorkspaceEditor();
        state.selectedSession = id;
        const selected = state.sessions.find(item => item.id === id);
        renderSessions();

        sessionHeading.textContent = cleanSessionTitle(selected?.subject) || 'New Session';
        setStatus('Ready — attach a dataset and tell the agent what to do with it.');
        clearStreamOutput();

        // Connect real-time event stream
        connectSessionEvents(id);

        // Fetch history and models
        showLoading();
        try {
            const [history, models] = await Promise.all([
                api('GET', `/api/sessions/${encodeURIComponent(id)}/history`).catch(() => ({ messages: [] })),
                api('GET', `/api/sessions/${encodeURIComponent(id)}/models`).catch(() => ({ models: [] })),
            ]);

            if (models && models.models) {
                state.models = models.models;
                state.currentModel = models.current || state.currentModel;
                updateModelSelectUI();
                modelSelect.disabled = models.can_switch === false;
                if (modelSwitchStatus) {
                    modelSwitchStatus.textContent = models.can_switch === false ? models.message : '';
                    modelSwitchStatus.className = `provider-status${models.can_switch === false ? ' warning' : ''}`;
                }
            }

            if (history && history.messages && history.messages.length) {
                renderHistory(history.messages);
                setChatStarted(true);
            } else {
                setStatus('Ready — ask Cipher a question, inspect the project, or attach a dataset.');
                setChatStarted(false);
            }
            loadWorkspaceDiff();
        } catch (err) {
            setStatus(`Could not load session details: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    function renderHistory(messages) {
        streamCard.classList.remove('hidden');
        setChatStarted(messages.length > 0);
        setGeneratingState(false);
        const renderedText = messages.map(msg => {
            const role = String(msg.role || 'assistant').toLowerCase();
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            const isUser = role === 'user';
            return `<article class="transcript-message ${isUser ? 'transcript-message-user' : 'transcript-message-assistant'}">
                <div class="transcript-avatar">${isUser ? 'YOU' : 'CIPHER'}</div>
                <div class="transcript-content">${isUser ? esc(content) : formatAgentOutputHtml('Cipher', content)}</div>
            </article>`;
        }).join('');
        streamText.innerHTML = renderedText;
        setStatus('Ready');
    }

    async function submitPrompt(prompt) {
        const text = prompt.trim();
        const activeFiles = [...(state.attachedFiles || [])];
        if (!text && activeFiles.length === 0) return;
        setChatStarted(true);

        state.attachedFiles = [];
        renderAttachedFilesPreview();

        if (!state.selectedSession) {
            const session = await api('POST', '/api/sessions', {});
            await loadSessions();
            state.selectedSession = session.id;
            connectSessionEvents(session.id);
        }

        sessionHeading.textContent = cleanSessionTitle(text || activeFiles[0]?.name);
        await renameSessionFromPrompt(text, activeFiles[0]?.name);
        clearStreamOutput(true);
        streamCard.classList.remove('hidden');
        streamModel.textContent = state.currentModel || '';
        setGeneratingState(true);
        setStatus('Dispatching to JCode...');

        // Render user message with attached file preview matching Screenshot 1
        let userMessageHtml = '';
        if (activeFiles.length) {
            userMessageHtml += `
                <div class="user-message-container">
                    ${activeFiles.map(f => `
                        <div class="attached-file-badge">
                            <div class="attached-file-header">
                                <span class="attached-file-name" title="${esc(f.name)}">${esc(f.name)}</span>
                                <span class="attached-file-lines">${esc(f.lines ? `${f.lines} lines` : f.sizeStr)}</span>
                            </div>
                            <div class="attached-file-ext">${esc(f.ext)}</div>
                        </div>
                    `).join('')}
                    ${text ? `<div class="user-message-bubble">${esc(text)}</div>` : ''}
                </div>
            `;
        } else {
            userMessageHtml = `<div class="user-message-container"><div class="user-message-bubble">${esc(text)}</div></div>`;
        }

        streamText.insertAdjacentHTML('beforeend', `${userMessageHtml}<div class="agent-run-output" aria-live="polite"></div>`);

        let fullPrompt = text ? `[${state.composerMode} mode] ${text}` : `[${state.composerMode} mode] Review the attached files.`;
        if (activeFiles.length) {
            fullPrompt = `[Attached Files: ${activeFiles.map(f => `data/${f.name}`).join(', ')}]\n${fullPrompt}`;
        }

        try {
            const res = await api('POST', `/api/sessions/${encodeURIComponent(state.selectedSession)}/prompt`, { prompt: fullPrompt });
            if (res && res.chart) {
                handleJcodeEvent({
                    ev: 'chart_ready',
                    chart: res.chart.primary_chart,
                    summary: res.chart.text_summary,
                    query: text,
                });
            } else if (res && res.result) {
                streamBadge.textContent = 'READY';
                streamBadge.classList.add('idle');
                const outputs = streamText.querySelectorAll('.agent-run-output');
                if (outputs.length) outputs[outputs.length - 1].innerHTML = formatAgentOutputHtml(res.agentName || 'Agent Execution', res.result);
                setGeneratingState(false);
                setStatus('Ready');
            }
            loadWorkspaceDiff();
        } catch (error) {
            setGeneratingState(false);
            setStatus(`Dispatch error: ${error.message}`);
            const outputs = streamText.querySelectorAll('.agent-run-output');
            const output = outputs.length ? outputs[outputs.length - 1] : null;
            if (output) output.textContent = `Error sending prompt: ${error.message}`;
            else streamText.insertAdjacentHTML('beforeend', `Error sending prompt: ${error.message}`);
        }
    }

    async function cancelActiveRun() {
        if (!state.selectedSession) return;
        setStatus('Sending cancel to JCode...');
        try {
            await api('POST', `/api/sessions/${encodeURIComponent(state.selectedSession)}/cancel`);
            setGeneratingState(false);
            setStatus('Active run cancelled.');
        } catch (err) {
            setStatus(`Cancel failed: ${err.message}`);
        }
    }

    function updateModelSelectUI() {
        if (!modelSelect) return;
        if (!state.models.length && state.currentModel) {
            modelSelect.innerHTML = `<option value="${esc(state.currentModel)}">${esc(state.currentModel)}</option>`;
            return;
        }
        modelSelect.innerHTML = state.models.map(m => `
            <option value="${esc(m)}" ${m === state.currentModel ? 'selected' : ''}>${esc(m)}</option>
        `).join('');
    }

    async function switchModel(model) {
        if (!state.selectedSession || !model) return;
        showLoading();
        try {
            await api('POST', `/api/sessions/${encodeURIComponent(state.selectedSession)}/model`, { model });
            state.currentModel = model;
            streamModel.textContent = model;
            setStatus(`Model switched to ${model}`);
        } catch (err) {
            modelSelect.value = state.currentModel || model;
            showToast(`Could not switch model: ${err.message || 'The active provider does not offer that model.'}`);
        } finally {
            hideLoading();
        }
    }

    function applyModels(models) {
        state.models = models.models || [];
        state.currentModel = models.current || state.currentModel;
        updateModelSelectUI();
        modelSelect.disabled = models.can_switch === false;
        if (modelSwitchStatus) {
            modelSwitchStatus.textContent = models.message || '';
            modelSwitchStatus.className = `provider-status${models.message ? ' warning' : ''}`;
        }
    }

    async function switchProvider(provider) {
        if (!state.selectedSession) return;
        showLoading();
        try {
            const result = await api('POST', '/api/config/provider', { provider: provider === 'openai-compatible' ? 'lm-studio' : 'groq' });
            state.currentModel = result.model || state.currentModel;
            if (result.models) applyModels({ models: result.models, current: result.model, can_switch: true, message: result.models.length > 1 ? undefined : 'LM Studio has one loaded chat model.' });
            else applyModels(await api('GET', `/api/sessions/${encodeURIComponent(state.selectedSession)}/models`));
            setStatus(`${provider === 'openai-compatible' ? 'LM Studio' : 'Groq'} is active.`);
            await refreshStatus();
        } catch (err) {
            providerInput.value = state.status?.active_provider === 'lm-studio' ? 'openai-compatible' : 'groq';
            showToast(`Could not switch provider: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    async function saveApiKey() {
        const provider = providerInput.value || 'groq';
        const apiKey = apiKeyInput.value.trim();
        if (provider !== 'groq') return showToast('LM Studio uses its local server; no API key is needed.');
        if (!apiKey) return showToast('Please enter an API key.');
        showLoading();
        try {
            await api('POST', '/api/config/api-key', { provider, apiKey });
            apiKeyInput.value = '';
            showToast(`API key saved for ${provider}.`, 'success');
            await refreshStatus();
            if (state.selectedSession) {
                const models = await api('GET', `/api/sessions/${encodeURIComponent(state.selectedSession)}/models`);
                applyModels(models);
            }
        } catch (err) {
            showToast(`Failed saving key: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    async function refreshLmStudioStatus() {
        if (!lmStudioStatus) return;
        lmStudioStatus.textContent = 'Checking local server…';
        try {
            const result = await api('GET', '/api/providers/lm-studio/status');
            if (result.online) {
                lmStudioStatus.textContent = result.models?.length ? `Ready — ${result.models.join(', ')}` : 'Ready — no model listed.';
                lmStudioStatus.className = 'provider-status ready';
            } else {
                lmStudioStatus.textContent = result.message || 'Local server is not running.';
                lmStudioStatus.className = 'provider-status warning';
            }
        } catch (_) {
            lmStudioStatus.textContent = 'Could not check the local server.';
            lmStudioStatus.className = 'provider-status warning';
        }
    }

    // Workspace File Tree & Editor
    function directoryIsOpen(path) { return state.openFolders.has(path); }

    function renderWorkspaceTree(nodes, depth = 0) {
        return (nodes || []).map(node => {
            const isDirectory = node.type === 'directory';
            const isOpen = isDirectory && directoryIsOpen(node.path);
            const depthStyle = `--tree-depth:${depth}`;
            const disclosure = isDirectory ? `<span class="tree-disclosure" aria-hidden="true">${isOpen ? '⌄' : '›'}</span>` : '<span class="tree-disclosure tree-disclosure-empty" aria-hidden="true"></span>';
            return `<div class="workspace-tree-node" style="${depthStyle}">
                <button type="button" class="workspace-tree-item ${isDirectory ? 'workspace-tree-folder' : 'workspace-tree-file'} ${node.path === state.activeFile ? 'active' : ''}" role="treeitem" ${isDirectory ? `aria-expanded="${isOpen}"` : ''} data-path="${esc(node.path)}" data-kind="${esc(node.type)}" title="${esc(node.path)}">
                    ${disclosure}<span class="workspace-tree-label">${esc(node.name)}</span>
                </button>${isDirectory && isOpen ? `<div class="workspace-tree-children" role="group">${renderWorkspaceTree(node.children, depth + 1)}</div>` : ''}
            </div>`;
        }).join('');
    }

    function bindWorkspaceTree(container) {
        container.querySelectorAll('.workspace-tree-item').forEach(button => button.addEventListener('click', async () => {
            const { path, kind } = button.dataset;
            if (kind === 'directory') {
                state.openFolders.has(path) ? state.openFolders.delete(path) : state.openFolders.add(path);
                renderWorkspaceSidebar();
                return;
            }
            await openWorkspaceFile(path);
        }));
    }

    function renderWorkspaceSidebar() {
        if (!state.workspace) return;
        $('#tree-status-sidebar').textContent = 'workspace';
        const sidebarTree = $('#workspace-tree-sidebar');
        sidebarTree.innerHTML = renderWorkspaceTree(state.workspace.tree);
        bindWorkspaceTree(sidebarTree);
    }

    function showWorkspaceEditor() {
        sessionsView.hidden = true;
        sessionsView.classList.remove('active');
        workspaceEditor.hidden = false;
        document.body.classList.add('workspace-editor-open');
    }

    function hideWorkspaceEditor() {
        workspaceEditor.hidden = true;
        sessionsView.hidden = false;
        sessionsView.classList.add('active');
        document.body.classList.remove('workspace-editor-open');
    }

    function renderEditor() {
        const activeFile = state.openFiles.find(file => file.path === state.activeFile);
        editorTabstrip.innerHTML = state.openFiles.map((file, index) => {
            const active = file.path === state.activeFile;
            const tabId = `editor-tab-${index}`;
            return `<div class="editor-tab ${active ? 'active' : ''}">
                <button type="button" class="editor-tab-button" id="${tabId}" role="tab" aria-selected="${active}" aria-controls="editor-panel" tabindex="${active ? '0' : '-1'}" data-path="${esc(file.path)}" title="${esc(file.path)}">${esc(file.name || file.path)}</button>
                <button type="button" class="editor-tab-close" aria-label="Close ${esc(file.name || file.path)}" data-path="${esc(file.path)}">×</button>
            </div>`;
        }).join('');
        editorTabstrip.hidden = !state.openFiles.length;

        if (!activeFile) {
            editorPanel.innerHTML = `<div class="editor-empty-state"><h2>No file open</h2><p>Select a file from the Workspace sidebar to open it here.</p></div>`;
            return;
        }

        const tabIndex = state.openFiles.indexOf(activeFile);
        editorPanel.setAttribute('aria-labelledby', `editor-tab-${tabIndex}`);
        editorPanel.innerHTML = `
            <div class="editor-file-view">
                <div class="editor-file-header">
                    <div><h2>${esc(activeFile.name || activeFile.path)}</h2><p>${esc(activeFile.path)}</p></div>
                    <div class="editor-file-meta"><span>${esc(activeFile.extension || 'FILE')}</span><span>${esc(activeFile.size_formatted)}</span><span>${esc(activeFile.lines_count)} lines</span></div>
                </div>
                <pre class="editor-file-content">${esc(activeFile.content)}</pre>
            </div>`;

        editorTabstrip.querySelectorAll('.editor-tab-button').forEach(button => button.addEventListener('click', () => activateWorkspaceFile(button.dataset.path)));
        editorTabstrip.querySelectorAll('.editor-tab-close').forEach(button => button.addEventListener('click', () => closeWorkspaceFile(button.dataset.path)));
    }

    function activateWorkspaceFile(path) {
        state.activeFile = path;
        renderWorkspaceSidebar();
        renderEditor();
    }

    function closeWorkspaceFile(path) {
        const closingIndex = state.openFiles.findIndex(file => file.path === path);
        if (closingIndex < 0) return;
        const wasActive = state.activeFile === path;
        state.openFiles.splice(closingIndex, 1);
        if (wasActive) state.activeFile = state.openFiles[Math.min(closingIndex, state.openFiles.length - 1)]?.path || null;
        renderWorkspaceSidebar();
        if (state.openFiles.length) renderEditor();
        else hideWorkspaceEditor();
    }

    async function openWorkspaceFile(path) {
        const existing = state.openFiles.find(file => file.path === path);
        if (existing) {
            showWorkspaceEditor();
            activateWorkspaceFile(path);
            return;
        }
        if (state.loadingFiles.has(path)) return;

        state.loadingFiles.add(path);
        showLoading();
        state.activeFile = path;
        showWorkspaceEditor();
        renderWorkspaceSidebar();
        editorPanel.innerHTML = `<div class="editor-empty-state"><h2>Opening file</h2><p>${esc(path)}</p></div>`;
        try {
            const file = await api('GET', `/api/workspace/file?path=${encodeURIComponent(path)}`);
            if (!state.openFiles.some(openFile => openFile.path === path)) state.openFiles.push(file);
            if (state.activeFile === path) activateWorkspaceFile(path);
        } catch (error) {
            editorPanel.innerHTML = `<div class="editor-empty-state"><h2>Could not open file</h2><p>${esc(error.message)}</p></div>`;
            showToast(`Could not open file: ${error.message}`);
        } finally {
            state.loadingFiles.delete(path);
            hideLoading();
        }
    }

    async function loadWorkspace() {
        showLoading();
        try {
            state.workspace = await api('GET', '/api/workspace/tree');
            renderWorkspaceSidebar();
        } catch (error) {
            $('#workspace-tree-sidebar').innerHTML = `<p class="session-list-empty">${esc(error.message)}</p>`;
            showToast(`Could not load workspace: ${error.message}`);
        } finally {
            hideLoading();
        }
    }

    async function renderLibrarySidebar() {
        let roles = [];
        try {
            const res = await api('GET', '/api/agents');
            if (res && res.agents) roles = res.agents;
        } catch (_) {}

        $('#library-list-sidebar').innerHTML = roles.map(role => `
            <div class="sidebar-agent-card" style="border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: var(--canvas-light);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <strong style="font-size: 11px; color: var(--ink);">${esc(role.name || role.title)}</strong>
                    <span class="kpi-badge badge-info" style="font-size: 8px;">WORKFLOW REFERENCE</span>
                </div>
                <p style="font-size: 10px; color: var(--muted); margin: 0 0 6px 0; line-height: 1.3;">${esc(role.description || role.category || '')}</p>
                <div style="display: flex; gap: 4px;">
                    <button type="button" class="plain-button use-agent-btn" data-agent-id="${esc(role.id || '')}" data-agent-name="${esc(role.name || role.title)}" style="font-size: 9px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 3px; flex: 1; text-align: center; background: rgba(99,102,241,0.1); color: #818cf8;">USE WITH JCODE</button>
                </div>
            </div>
        `).join('');

        $$('.use-agent-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.agentName;
                promptInput.value = `Inspect the Agents tab code and use ${name} only if it is the best fit for my attached dataset. Execute my requested analysis and report the actual outputs.`;
                switchSidebarTab('sessions');
                promptInput.focus();
            });
        });

    }

    async function refreshStatus() {
        state.status = await api('GET', '/api/status');
        if (state.status.model) {
            state.currentModel = state.status.model;
            streamModel.textContent = state.currentModel;
        }
        if (state.status.workspace) {
            state.workspaceDir = state.status.workspace;
            const pathElem = $('#project-path');
            if (pathElem) {
                const parts = state.status.workspace.replace(/\\/g, '/').split('/');
                const baseName = parts.filter(Boolean).pop() || 'workspace';
                pathElem.textContent = `~/${baseName}`;
                pathElem.title = state.status.workspace;
            }
            const userElem = $('#profile-user');
            if (userElem) {
                const parts = state.status.workspace.replace(/\\/g, '/').split('/');
                userElem.textContent = parts.filter(Boolean).pop() || 'Workspace';
            }
            const avatarElem = $('#profile-avatar');
            if (avatarElem) {
                const parts = state.status.workspace.replace(/\\/g, '/').split('/');
                const name = parts.filter(Boolean).pop() || 'WS';
                avatarElem.textContent = name.slice(0, 2).toUpperCase();
            }
        }
        const harnessElem = $('#profile-harness');
        if (harnessElem && state.status.provider) {
            harnessElem.textContent = `${state.status.provider} (${state.status.model || 'default'})`;
        }
        if (providerInput && state.status.active_provider === 'lm-studio') {
            providerInput.value = 'openai-compatible';
        }
        if (state.status.lm_studio && lmStudioStatus) {
            const lmStudio = state.status.lm_studio;
            lmStudioStatus.textContent = lmStudio.online
                ? `Ready — ${(lmStudio.models || []).join(', ') || 'model available'}`
                : (lmStudio.message || 'Local server is not running.');
            lmStudioStatus.className = `provider-status ${lmStudio.online ? 'ready' : 'warning'}`;
        }
        renderLibrarySidebar();
    }

    function closeMenus() {
        settingsMenu.hidden = true;
        profileMenu.hidden = true;
        settingsButton.setAttribute('aria-expanded', 'false');
        profileButton.setAttribute('aria-expanded', 'false');
    }

    async function clearSessions() {
        closeMenus();
        showLoading();
        try {
            await api('POST', '/api/reset', {});
            state.sessions = [];
            resetStage();
            setStatus('All sessions cleared.');
        } catch (error) {
            showToast(`Could not clear sessions: ${error.message}`);
        } finally {
            hideLoading();
        }
    }

    // Event Listeners
    themeOptions.forEach(option => option.addEventListener('click', () => saveTheme(option.dataset.themeOption)));
    systemTheme.addEventListener('change', () => { if (preferredTheme === 'system') applyTheme('system'); });
    applyTheme(storedTheme());

    sidebarTabButtons.forEach(button => button.addEventListener('click', () => switchSidebarTab(button.dataset.sidebarTab)));
    sidebarToggle.addEventListener('click', toggleSidebar);

    $('#new-session-button').addEventListener('click', createNewSession);
    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = settingsMenu.hidden;
        closeMenus();
        settingsMenu.hidden = !open;
        settingsButton.setAttribute('aria-expanded', String(open));
    });
    profileButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = profileMenu.hidden;
        closeMenus();
        profileMenu.hidden = !open;
        profileButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.menu-popover') && !e.target.closest('.glass-action-button')) closeMenus();
    });

    $('#reset-button').addEventListener('click', clearSessions);
    cancelButton.addEventListener('click', cancelActiveRun);
    modelSelect.addEventListener('change', (e) => switchModel(e.target.value));
    providerInput.addEventListener('change', (e) => switchProvider(e.target.value));
    saveApiKeyButton.addEventListener('click', saveApiKey);
    checkLmStudioButton.addEventListener('click', refreshLmStudioStatus);

    if (fileUploadInput) {
        fileUploadInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;

            for (const f of files) {
                const ext = (f.name.split('.').pop() || 'FILE').toUpperCase();
                const sizeStr = f.size > 1024 * 1024
                    ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
                    : `${Math.max(1, Math.round(f.size / 1024))} KB`;

                let lines = null;
                if (f.type.startsWith('text/') || /\.(md|txt|py|js|json|csv|sql|env)$/i.test(f.name)) {
                    try {
                        const text = await f.text();
                        lines = text.split('\n').length;
                    } catch (_) {}
                }

                state.attachedFiles.push({
                    name: f.name,
                    sizeStr,
                    lines,
                    ext,
                });
            }
            renderAttachedFilesPreview();
            promptInput.focus();

            // Background ingest datasets if tabular
            const datasets = files.filter(f => /\.(csv|tsv|xlsx|xls|json|parquet)$/i.test(f.name));
            if (datasets.length) {
                showLoading();
                setStatus(`Importing dataset: ${datasets.map(f => f.name).join(', ')}...`);
                try {
                    const formData = new FormData();
                    datasets.forEach(f => formData.append('files', f));
                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    if (res.ok) {
                        const result = await res.json();
                        await loadWorkspace();
                        setStatus('Dataset attached. Tell the agent what you want to analyze, clean, or create.');
                    }
                } catch (err) {
                    console.warn('[Import error]:', err);
                } finally {
                    hideLoading();
                }
            }
            fileUploadInput.value = '';
        });
    }

    promptForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const prompt = promptInput.value;
        promptInput.value = '';
        submitPrompt(prompt);
    });

    $$('.composer-mode').forEach(button => button.addEventListener('click', () => setComposerMode(button.dataset.composerMode)));
    if (workspaceDiffToggle) workspaceDiffToggle.addEventListener('click', () => {
        const expanded = workspaceDiffToggle.getAttribute('aria-expanded') === 'true';
        workspaceDiffToggle.setAttribute('aria-expanded', String(!expanded));
        loadWorkspaceDiff();
    });
    $$('#starter-prompts button').forEach(button => button.addEventListener('click', () => {
        promptInput.value = button.dataset.starterPrompt;
        promptInput.focus();
    }));

    // Boot
    (async function boot() {
        showLoading();
        initSidebarResize();
        initSidebarState();
        setComposerMode(state.composerMode);
        try {
            await Promise.all([refreshStatus(), loadSessions(), loadWorkspace()]);
            if (state.sessions.length > 0) {
                selectSession(state.sessions[state.sessions.length - 1].id);
            } else {
                await createNewSession();
            }
        } catch (error) {
            setStatus(`Initialization error: ${error.message}`);
        } finally {
            hideLoading();
        }
    }());

    window.__cipher = { state, renderAttachedFilesPreview, submitPrompt };
    window.addEventListener('error', event => showToast(event.message || 'An unexpected error occurred.'));
    window.addEventListener('unhandledrejection', event => showToast(event.reason?.message || 'An unexpected error occurred.'));
});
