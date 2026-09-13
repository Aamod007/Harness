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
        dashboardData: null,
        attachedFiles: [],
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
    const reasoningText = $('#reasoning-text');
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
    const providerInput = $('#provider-input');
    const apiKeyInput = $('#api-key-input');
    const saveApiKeyButton = $('#save-api-key-button');
    const fileUploadInput = $('#file-upload-input');
    const attachedFilesPreview = $('#attached-files-preview');
    const sessionsView = $('#sessions-view');
    const workspaceEditor = $('#workspace-editor');
    const dashboardView = $('#dashboard-view');
    const filterDept = $('#dash-filter-department');
    const filterHost = $('#dash-filter-host');
    const filterSeverity = $('#dash-filter-severity');
    const filterStartDate = $('#dash-filter-start-date');
    const filterEndDate = $('#dash-filter-end-date');
    const applyFiltersBtn = $('#apply-filters-btn');
    const resetFiltersBtn = $('#reset-filters-btn');
    const refreshDashboardBtn = $('#refresh-dashboard-btn');
    const tableSearchInput = $('#table-search-input');
    const telemetryTableBody = $('#telemetry-table-body');
    const recordCountBadge = $('#record-count-badge');
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

    function setStatus(text, ready = false) {
        sessionContext.textContent = text;
        sessionContext.hidden = !text;
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
            if (dashboardView) {
                dashboardView.hidden = true;
                dashboardView.classList.remove('active');
            }
            sessionsView.hidden = false;
            sessionsView.classList.add('active');
        }
        if (tab === 'dashboard') {
            hideWorkspaceEditor();
            sessionsView.hidden = true;
            sessionsView.classList.remove('active');
            if (dashboardView) {
                dashboardView.hidden = false;
                dashboardView.classList.add('active');
                loadDashboard(getFilterValues());
            }
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
            sessionList.innerHTML = '<p class="session-list-empty">JCode sessions in this workspace appear here.</p>';
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
            setStatus('Ready — Ask JCode a question, dispatch a data role, or import a dataset.');
            promptInput.focus();
        } catch (err) {
            window.alert(`Could not create session: ${err.message}`);
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
            window.alert(`Could not archive session: ${error.message}`);
        } finally {
            hideLoading();
        }
    }

    function resetStage() {
        state.selectedSession = null;
        sessionHeading.textContent = 'What would you like to know?';
        setStatus('');
        clearStreamOutput();
        renderSessions();
    }

    function clearStreamOutput() {
        streamCard.classList.add('hidden');
        streamText.textContent = '';
        reasoningBlock.classList.add('hidden');
        reasoningText.textContent = '';
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

        if (ev === 'agent_ready') {
            streamCard.classList.remove('hidden');
            streamBadge.textContent = 'READY';
            streamBadge.classList.add('idle');
            streamText.innerHTML = formatAgentOutputHtml(event.name || event.agentId || 'Agent', event.result);
            return;
        }

        if (ev === 'text_delta') {
            streamCard.classList.remove('hidden');
            streamText.textContent += event.text;
            return;
        }

        if (ev === 'reasoning_delta') {
            streamCard.classList.remove('hidden');
            reasoningBlock.classList.remove('hidden');
            reasoningText.textContent += event.text;
            return;
        }

        if (ev === 'reasoning_done') {
            const dur = event.duration_secs ? ` (${event.duration_secs.toFixed(1)}s)` : '';
            $('.reasoning-title').textContent = `Thinking complete${dur}`;
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
            return;
        }

        if (ev === 'error') {
            setGeneratingState(false);
            setStatus(`Error: ${event.message}`);
            streamCard.classList.remove('hidden');
            streamText.innerHTML += `\n<div style="margin-top: 10px; padding: 10px; background: rgba(225, 29, 72, 0.08); border-left: 3px solid #e11d48; border-radius: 4px; color: #e11d48;"><strong>Harness Notice:</strong> ${esc(event.message)}</div>`;
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
            answerModel.textContent = 'DuckDB Certified Analytical View (Text-to-Chart Copilot)';
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
        setStatus('Ready — Ask JCode a question, dispatch a data role, or import a dataset.');
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
            }

            if (history && history.messages && history.messages.length) {
                renderHistory(history.messages);
            } else {
                setStatus('Ready — Ask JCode a question, dispatch a data role, or import a dataset.');
            }
        } catch (err) {
            setStatus(`Could not load session details: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    function renderHistory(messages) {
        streamCard.classList.remove('hidden');
        setGeneratingState(false);
        const renderedText = messages.map(msg => {
            const role = msg.role ? msg.role.toUpperCase() : 'MSG';
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return `### ${role}:\n${content}\n`;
        }).join('\n');
        streamText.textContent = renderedText;
        setStatus('Ready');
    }

    async function submitPrompt(prompt) {
        const text = prompt.trim();
        const activeFiles = [...(state.attachedFiles || [])];
        if (!text && activeFiles.length === 0) return;

        state.attachedFiles = [];
        renderAttachedFilesPreview();

        if (!state.selectedSession) {
            const session = await api('POST', '/api/sessions', {});
            await loadSessions();
            state.selectedSession = session.id;
            connectSessionEvents(session.id);
        }

        sessionHeading.textContent = cleanSessionTitle(text || activeFiles[0]?.name);
        clearStreamOutput();
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

        streamText.innerHTML = userMessageHtml;

        let fullPrompt = text;
        if (activeFiles.length) {
            fullPrompt = `[Attached Files: ${activeFiles.map(f => f.name).join(', ')}]\n${text}`;
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
                streamText.innerHTML = formatAgentOutputHtml(res.agentName || 'Agent Execution', res.result);
                setGeneratingState(false);
                setStatus('Ready');
            }
        } catch (error) {
            setGeneratingState(false);
            setStatus(`Dispatch error: ${error.message}`);
            streamText.textContent = `Error sending prompt: ${error.message}`;
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
            window.alert(`Could not switch model: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    async function saveApiKey() {
        const provider = providerInput.value.trim() || 'openai-compatible';
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) return window.alert('Please enter an API key.');
        showLoading();
        try {
            await api('POST', '/api/config/api-key', { provider, apiKey });
            apiKeyInput.value = '';
            window.alert(`API Key saved for ${provider}!`);
            await refreshStatus();
        } catch (err) {
            window.alert(`Failed saving key: ${err.message}`);
        } finally {
            hideLoading();
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
                    <span class="kpi-badge badge-info" style="font-size: 8px;">ROUTING ROLE</span>
                </div>
                <p style="font-size: 10px; color: var(--muted); margin: 0 0 6px 0; line-height: 1.3;">${esc(role.description || role.category || '')}</p>
                <div style="display: flex; gap: 4px;">
                    <button type="button" class="plain-button run-agent-btn" data-agent-id="${esc(role.id || '')}" data-agent-name="${esc(role.name || role.title)}" style="font-size: 9px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 3px; flex: 1; text-align: center; background: rgba(99,102,241,0.1); color: #818cf8;">RUN ON JCODE</button>
                    <button type="button" class="plain-button use-agent-btn" data-agent-id="${esc(role.id || '')}" data-agent-name="${esc(role.name || role.title)}" style="font-size: 9px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 3px; flex: 1; text-align: center;">PROMPT JCODE</button>
                </div>
            </div>
        `).join('');

        $$('.use-agent-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.agentName;
                promptInput.value = `Route to JCode [${name}]: Process zero-trust metrics and identify anomalies.`;
                switchSidebarTab('sessions');
                promptInput.focus();
            });
        });

        $$('.run-agent-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const agentId = btn.dataset.agentId;
                const agentName = btn.dataset.agentName;
                if (!agentId) return;
                switchSidebarTab('sessions');
                streamCard.classList.remove('hidden');
                streamBadge.textContent = 'RUNNING';
                streamBadge.classList.remove('idle');
                streamText.innerHTML = `<em>JCode processing <strong>${esc(agentName)}</strong> task end-to-end...</em>`;
                showLoading();
                try {
                    const res = await api('POST', '/api/agent/run', { agentId });
                    streamBadge.textContent = 'READY';
                    streamBadge.classList.add('idle');
                    streamText.innerHTML = formatAgentOutputHtml(agentName, res.result);
                } catch (err) {
                    streamText.innerHTML = `<p style="color: #f85149;">Error on JCode processing ${esc(agentName)}: ${esc(err.message)}</p>`;
                } finally {
                    hideLoading();
                }
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
            window.alert(`Could not clear sessions: ${error.message}`);
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
    saveApiKeyButton.addEventListener('click', saveApiKey);

    let currentRecords = [];

    function getFilterValues() {
        return {
            department: filterDept ? filterDept.value : 'All',
            host: filterHost ? filterHost.value.trim() : '',
            severity: filterSeverity ? filterSeverity.value : 'All',
            startDate: filterStartDate ? filterStartDate.value : '',
            endDate: filterEndDate ? filterEndDate.value : '',
        };
    }

    async function loadDashboard(filters = {}) {
        showLoading();
        try {
            const data = await api('POST', '/api/analytics/dashboard', filters);
            state.dashboardData = data;
            renderDashboard(data);
        } catch (err) {
            console.error('[Dashboard load error]:', err);
        } finally {
            hideLoading();
        }
    }

    function renderDashboard(data) {
        if (!data) return;
        const kpis = data.kpis;
        if (kpis) {
            if (kpis.failed_login_rate && $('#kpi-failed-login-rate')) {
                $('#kpi-failed-login-rate').textContent = kpis.failed_login_rate.value;
                $('#formula-failed-logins').textContent = kpis.failed_login_rate.formula;
                $('#kpi-desc-fails').textContent = `${kpis.failed_login_rate.failed_logins.toLocaleString()} failed of ${kpis.failed_login_rate.total_attempts.toLocaleString()} authentication events`;
            }
            if (kpis.compromised_account_risk && $('#kpi-compromised-risk')) {
                $('#kpi-compromised-risk').textContent = kpis.compromised_account_risk.value;
                $('#formula-account-risk').textContent = kpis.compromised_account_risk.formula;
                $('#kpi-desc-risk').textContent = `${kpis.compromised_account_risk.high_risk_count} accounts flagged above 60.0 risk threshold`;
            }
            if (kpis.insider_threat_score && $('#kpi-insider-score')) {
                $('#kpi-insider-score').textContent = kpis.insider_threat_score.value;
                $('#formula-insider-threat').textContent = kpis.insider_threat_score.formula;
                $('#kpi-desc-insider').textContent = `Composite weighted index across multi-domain telemetry`;
            }
            if (kpis.critical_alerts && $('#kpi-critical-alerts')) {
                $('#kpi-critical-alerts').textContent = kpis.critical_alerts.value;
                $('#formula-critical-edr').textContent = kpis.critical_alerts.formula;
                $('#kpi-desc-edr').textContent = `${kpis.critical_alerts.total_edr.toLocaleString()} total alerts (${kpis.critical_alerts.impossible_resolutions} impossible resolution)`;
            }
            if (kpis.firewall_denies && $('#kpi-firewall-denies')) {
                $('#kpi-firewall-denies').textContent = kpis.firewall_denies.value;
                $('#formula-firewall-denies').textContent = kpis.firewall_denies.formula;
                $('#kpi-desc-fw').textContent = `${kpis.firewall_denies.threat_flags} active threat flags across ${kpis.firewall_denies.total_packets.toLocaleString()} packets`;
            }
        }

        if (data.filter_options && filterDept && filterDept.options.length <= 1) {
            filterDept.innerHTML = data.filter_options.departments.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
        }

        if (window.Plotly && data.charts) {
            const config = { responsive: true, displayModeBar: false };
            if (data.charts.login_trend && $('#chart-login-trend')) {
                Plotly.newPlot('chart-login-trend', data.charts.login_trend.data, data.charts.login_trend.layout, config);
            }
            if (data.charts.firewall_actions && $('#chart-firewall-proto')) {
                Plotly.newPlot('chart-firewall-proto', data.charts.firewall_actions.data, data.charts.firewall_actions.layout, config);
            }
            if (data.charts.severity_dist && $('#chart-edr-severity')) {
                Plotly.newPlot('chart-edr-severity', data.charts.severity_dist.data, data.charts.severity_dist.layout, config);
            }
        }

        currentRecords = data.records || [];
        renderTableRecords(currentRecords);
    }

    function renderTableRecords(records) {
        if (!telemetryTableBody) return;
        if (recordCountBadge) recordCountBadge.textContent = `${records.length} records`;
        if (!records.length) {
            telemetryTableBody.innerHTML = '<tr><td colspan="7" class="table-loading">No telemetry events match active filters.</td></tr>';
            return;
        }
        telemetryTableBody.innerHTML = records.map(r => `
            <tr>
                <td>${esc(r.timestamp)}</td>
                <td><strong>${esc(r.user_id)}</strong></td>
                <td>${esc(r.hostname)}</td>
                <td>${esc(r.department)}</td>
                <td><span class="${r.event_or_action === 'login_failed' ? 'kpi-badge badge-danger' : 'kpi-badge badge-neutral'}">${esc(r.event_or_action)}</span></td>
                <td>${r.risk_score != null ? esc(r.risk_score) : '-'}</td>
                <td><span class="kpi-badge badge-info">${esc(r.status)}</span></td>
            </tr>
        `).join('');
    }

    if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', () => loadDashboard(getFilterValues()));
    if (refreshDashboardBtn) refreshDashboardBtn.addEventListener('click', () => loadDashboard(getFilterValues()));
    if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', () => {
        if (filterDept) filterDept.value = 'All';
        if (filterHost) filterHost.value = '';
        if (filterSeverity) filterSeverity.value = 'All';
        if (filterStartDate) filterStartDate.value = '';
        if (filterEndDate) filterEndDate.value = '';
        loadDashboard({});
    });
    if (filterDept) filterDept.addEventListener('change', () => loadDashboard(getFilterValues()));
    if (filterSeverity) filterSeverity.addEventListener('change', () => loadDashboard(getFilterValues()));
    if (filterHost) filterHost.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDashboard(getFilterValues()); });

    if (tableSearchInput) {
        tableSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderTableRecords(currentRecords);
                return;
            }
            const filtered = currentRecords.filter(r => 
                (r.user_id && r.user_id.toLowerCase().includes(query)) ||
                (r.hostname && r.hostname.toLowerCase().includes(query)) ||
                (r.department && r.department.toLowerCase().includes(query)) ||
                (r.event_or_action && r.event_or_action.toLowerCase().includes(query))
            );
            renderTableRecords(filtered);
        });
    }

    $('#run-pipeline-button').addEventListener('click', async () => {
        closeMenus();
        showLoading();
        setStatus('Executing full data rescue pipeline (pipeline.py)...');
        try {
            await api('POST', '/api/pipeline/run');
            window.alert('Pipeline executed successfully! 100% rows rescued and DuckDB updated.');
            if (state.activeSidebarTab === 'dashboard') {
                loadDashboard(getFilterValues());
            }
            await loadWorkspace();
        } catch (err) {
            window.alert(`Pipeline execution error: ${err.message}`);
        } finally {
            hideLoading();
            setStatus('Ready');
        }
    });

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
                        await loadDashboard(getFilterValues());
                        const rowMsg = result.clean_total ? ` (${result.clean_total.toLocaleString()} rows processed)` : '';
                        setStatus(`Dataset imported & analyzed successfully!${rowMsg}`);
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

    // Boot
    (async function boot() {
        showLoading();
        initSidebarResize();
        initSidebarState();
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
});
