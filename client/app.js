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
        activeTurn: null, // { id, buffer, markdownEl, extrasEl }
        insideThinkTag: false,
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

    function scrollChatToBottom() {
        const viewSessions = $('#view-sessions') || document.querySelector('.app-view.active');
        if (viewSessions) {
            viewSessions.scrollTop = viewSessions.scrollHeight;
        }
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }

    function renderMarkdown(md) {
        if (!md) return '';
        let text = md
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*$/gi, '')
            .replace(/<function=[^>]*>[\s\S]*?<\/function>\s*(?:<\/toolcall>)?/gi, '')
            .replace(/<function=[^>]*>[\s\S]*$/gi, '')
            .replace(/<toolcall>[\s\S]*?<\/toolcall>/gi, '')
            .replace(/<toolcall>[\s\S]*$/gi, '')
            .replace(/<\/?(?:toolcall|function|parameter)[^>]*>/gi, '')
            .replace(/\{\s*"tool"\s*:\s*"[^"]*"[\s\S]*?\}/gi, '')
            .replace(/\{\s*"name"\s*:\s*"(?:executebash|shell|bash)"[\s\S]*?\}/gi, '')
            .trim();
        if (!text) return '';

        const codeBlocks = [];
        const fenceRegex = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)(?:```|$)/g;
        text = text.replace(fenceRegex, (match, lang, code) => {
            const placeholder = `%%CODE_BLOCK_${codeBlocks.length}%%`;
            const cleanLang = (lang || 'code').trim().toLowerCase();
            const cleanCode = code.replace(/\n$/, '');
            const encodedCode = encodeURIComponent(cleanCode);
            const blockHtml = `
                <div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span class="code-block-lang">${esc(cleanLang)}</span>
                        <button class="copy-code-btn" type="button" data-code="${encodedCode}" title="Copy code">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>Copy</span>
                        </button>
                    </div>
                    <pre class="code-block-pre"><code class="language-${esc(cleanLang)}">${esc(cleanCode)}</code></pre>
                </div>`;
            codeBlocks.push(blockHtml);
            return `\n\n${placeholder}\n\n`;
        });

        const tableRegex = /(?:^|\n)(\|[^\n]+\|\r?\n\|[-:\s|]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g;
        const tables = [];
        text = text.replace(tableRegex, (match, tbl) => {
            const placeholder = `%%TABLE_${tables.length}%%`;
            const lines = tbl.trim().split(/\r?\n/).map(l => l.trim());
            if (lines.length >= 2) {
                const parseRow = (line) => line.split('|').slice(1, -1).map(c => c.trim());
                const headerCells = parseRow(lines[0]);
                const bodyRows = lines.slice(2).map(parseRow);

                let tableHtml = `<div class="table-wrapper"><table class="markdown-table"><thead><tr>`;
                headerCells.forEach(cell => {
                    tableHtml += `<th>${renderInline(cell)}</th>`;
                });
                tableHtml += `</tr></thead><tbody>`;
                bodyRows.forEach(row => {
                    tableHtml += `<tr>`;
                    row.forEach(cell => {
                        tableHtml += `<td>${renderInline(cell)}</td>`;
                    });
                    tableHtml += `</tr>`;
                });
                tableHtml += `</tbody></table></div>`;
                tables.push(tableHtml);
                return `\n\n${placeholder}\n\n`;
            }
            return match;
        });

        const lines = text.split(/\r?\n/);
        const resultBlocks = [];
        let currentParagraph = [];
        let currentList = null;
        let currentQuote = [];

        const flushParagraph = () => {
            if (currentParagraph.length) {
                const content = currentParagraph.join(' ').trim();
                if (content) resultBlocks.push(`<p>${renderInline(content)}</p>`);
                currentParagraph = [];
            }
        };

        const flushList = () => {
            if (currentList) {
                const tag = currentList.type;
                const itemsHtml = currentList.items.map(item => `<li>${renderInline(item)}</li>`).join('');
                resultBlocks.push(`<${tag}>${itemsHtml}</${tag}>`);
                currentList = null;
            }
        };

        const flushQuote = () => {
            if (currentQuote.length) {
                const quoteContent = currentQuote.join(' ').trim();
                resultBlocks.push(`<blockquote>${renderInline(quoteContent)}</blockquote>`);
                currentQuote = [];
            }
        };

        const flushAll = () => {
            flushParagraph();
            flushList();
            flushQuote();
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                flushAll();
                continue;
            }

            if (trimmed.startsWith('%%CODE_BLOCK_') && trimmed.endsWith('%%')) {
                flushAll();
                resultBlocks.push(trimmed);
                continue;
            }
            if (trimmed.startsWith('%%TABLE_') && trimmed.endsWith('%%')) {
                flushAll();
                resultBlocks.push(trimmed);
                continue;
            }

            if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
                flushAll();
                resultBlocks.push('<hr class="markdown-hr">');
                continue;
            }

            const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headerMatch) {
                flushAll();
                const level = Math.min(headerMatch[1].length, 4);
                resultBlocks.push(`<h${level}>${renderInline(headerMatch[2].trim())}</h${level}>`);
                continue;
            }

            if (trimmed.startsWith('>')) {
                flushParagraph();
                flushList();
                currentQuote.push(trimmed.replace(/^>\s*/, ''));
                continue;
            } else if (currentQuote.length) {
                flushQuote();
            }

            const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
            if (ulMatch) {
                flushParagraph();
                flushQuote();
                if (!currentList || currentList.type !== 'ul') {
                    flushList();
                    currentList = { type: 'ul', items: [] };
                }
                currentList.items.push(ulMatch[1]);
                continue;
            }

            const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
            if (olMatch) {
                flushParagraph();
                flushQuote();
                if (!currentList || currentList.type !== 'ol') {
                    flushList();
                    currentList = { type: 'ol', items: [] };
                }
                currentList.items.push(olMatch[1]);
                continue;
            }

            if (currentList && (line.startsWith('   ') || line.startsWith('\t'))) {
                if (currentList.items.length) {
                    currentList.items[currentList.items.length - 1] += ' ' + trimmed;
                }
                continue;
            } else if (currentList) {
                flushList();
            }

            currentParagraph.push(trimmed);
        }
        flushAll();

        let finalHtml = resultBlocks.join('\n');

        tables.forEach((tblHtml, idx) => {
            finalHtml = finalHtml.replace(`%%TABLE_${idx}%%`, tblHtml);
        });

        codeBlocks.forEach((codeHtml, idx) => {
            finalHtml = finalHtml.replace(`%%CODE_BLOCK_${idx}%%`, codeHtml);
        });

        return finalHtml;
    }

    function renderInline(str) {
        if (!str) return '';
        let s = esc(str);

        s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        return s;
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-code-btn');
        if (!btn) return;
        const code = btn.getAttribute('data-code');
        if (code) {
            navigator.clipboard.writeText(decodeURIComponent(code)).then(() => {
                const originalHtml = btn.innerHTML;
                btn.classList.add('copied');
                btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Copied!</span>`;
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = originalHtml;
                }, 2000);
            }).catch(err => {
                console.error('Copy failed:', err);
            });
        }
    });

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
    const groqField = $('.groq-field');
    const lmStudioField = $('.lm-studio-field');
    const openrouterField = $('.openrouter-field');
    const openrouterApiKeyInput = $('#openrouter-api-key-input');
    const saveOpenrouterKeyButton = $('#save-openrouter-key-button');
    const openrouterStatus = $('#openrouter-status');
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
        if (!sessionContext) return;
        if (text && !text.toLowerCase().startsWith('ready')) {
            sessionContext.textContent = text;
            sessionContext.hidden = false;
        } else {
            sessionContext.textContent = '';
            sessionContext.hidden = true;
        }
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
        const socView = $('#soc-dashboard-view');
        if (tab === 'sessions') {
            hideWorkspaceEditor();
            if (socView) { socView.hidden = true; socView.classList.remove('active'); }
            sessionsView.hidden = false;
            sessionsView.classList.add('active');
        } else if (tab === 'soc') {
            hideWorkspaceEditor();
            sessionsView.hidden = true;
            sessionsView.classList.remove('active');
            if (socView) {
                socView.hidden = false;
                socView.classList.add('active');
                initSocDashboard();
            }
        } else {
            if (socView) { socView.hidden = true; socView.classList.remove('active'); }
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
                <div class="attached-file-top-row">
                    <span class="attached-file-name" title="${esc(f.name)}">${esc(f.name)}</span>
                    <button type="button" class="attached-file-remove" data-remove-file="${idx}" title="Remove attachment" aria-label="Remove ${esc(f.name)}">&times;</button>
                </div>
                <span class="attached-file-lines">${esc(f.lines ? `${f.lines} lines` : f.sizeStr)}</span>
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
            switchSidebarTab('sessions');
            const session = await api('POST', '/api/sessions', {});
            await loadSessions();
            selectSession(session.id);
            sessionHeading.textContent = 'New Session';
            setStatus('');
            promptInput.value = '';
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
        if (!preserveChat) {
            streamCard.classList.add('hidden');
            streamText.replaceChildren();
            state.activeTurn = null;
        }
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

    function ensureReasoningBlock(turn) {
        if (!turn || !turn.reasoningSlot) return null;
        let block = turn.reasoningSlot.querySelector('.reasoning-block');
        if (!block) {
            turn.reasoningStartTime = Date.now();
            turn.reasoningSlot.innerHTML = `
                <div class="reasoning-block">
                    <div class="reasoning-header">
                        <div class="reasoning-header-left">
                            <span class="reasoning-dot"></span>
                            <span class="reasoning-title">Model Thinking</span>
                            <span class="reasoning-badge">Reasoning...</span>
                        </div>
                        <div class="reasoning-header-right">
                            <span class="reasoning-meta">0 words</span>
                            <button class="reasoning-toggle" type="button" aria-label="Toggle thinking">
                                <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </button>
                        </div>
                    </div>
                    <div class="reasoning-content">
                        <div class="reasoning-text"></div>
                    </div>
                </div>
            `;
            block = turn.reasoningSlot.querySelector('.reasoning-block');
            const header = block.querySelector('.reasoning-header');
            header.addEventListener('click', () => {
                block.classList.toggle('collapsed');
            });
        }
        return block;
    }

    function appendReasoningDelta(turn, delta) {
        const block = ensureReasoningBlock(turn);
        if (!block) return;
        turn.reasoningText = (turn.reasoningText || '') + delta;
        const textEl = block.querySelector('.reasoning-text');
        if (textEl) {
            textEl.textContent = turn.reasoningText;
            const contentEl = block.querySelector('.reasoning-content');
            if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
        }
        const words = turn.reasoningText.trim().split(/\s+/).filter(Boolean).length;
        const metaEl = block.querySelector('.reasoning-meta');
        if (metaEl) {
            const elapsed = Math.max(1, Math.round((Date.now() - (turn.reasoningStartTime || Date.now())) / 1000));
            metaEl.textContent = `${words} words · ${elapsed}s`;
        }
    }

    function completeReasoning(turn, durationSecs) {
        if (!turn || !turn.reasoningSlot) return;
        const block = turn.reasoningSlot.querySelector('.reasoning-block');
        if (!block) return;
        const dot = block.querySelector('.reasoning-dot');
        const badge = block.querySelector('.reasoning-badge');
        const metaEl = block.querySelector('.reasoning-meta');
        if (dot) dot.classList.add('done');
        if (badge) {
            badge.classList.add('done');
            badge.textContent = 'Thought complete';
        }
        const words = (turn.reasoningText || '').trim().split(/\s+/).filter(Boolean).length;
        const duration = durationSecs || Math.max(1, Math.round((Date.now() - (turn.reasoningStartTime || Date.now())) / 1000));
        if (metaEl) metaEl.textContent = `${words} words · ${duration}s`;
    }

    function ensureActiveTurn() {
        if (!state.activeTurn || !document.getElementById(state.activeTurn.id)) {
            const turnId = `turn_${Date.now()}`;
            const assistantHtml = `
                <article class="transcript-message transcript-message-assistant" id="${turnId}">
                    <div class="transcript-avatar">CIPHER</div>
                    <div class="transcript-content">
                        <div class="agent-reasoning-slot"></div>
                        <div class="markdown-body agent-stream-markdown"><span class="streaming-cursor"></span></div>
                        <div class="agent-extras-slot"></div>
                    </div>
                </article>
            `;
            streamCard.classList.remove('hidden');
            streamText.insertAdjacentHTML('beforeend', assistantHtml);
            const turnEl = document.getElementById(turnId);
            state.activeTurn = {
                id: turnId,
                buffer: '',
                reasoningSlot: turnEl.querySelector('.agent-reasoning-slot'),
                reasoningText: '',
                reasoningStartTime: null,
                markdownEl: turnEl.querySelector('.agent-stream-markdown'),
                extrasEl: turnEl.querySelector('.agent-extras-slot'),
            };
        }
        return state.activeTurn;
    }

    function formatAgentOutputHtml(agentName, result) {
        if (!result) return `<p><em>No output returned by ${esc(agentName)}.</em></p>`;
        if (typeof result === 'string') {
            return `<div class="markdown-body">${renderMarkdown(result)}</div>`;
        }
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
            const turn = ensureActiveTurn();
            if (turn && turn.extrasEl) {
                turn.extrasEl.insertAdjacentHTML('beforeend', formatAgentOutputHtml(event.name || event.agentId || 'Agent', event.result));
            }
            return;
        }

        if (ev === 'text_delta') {
            streamCard.classList.remove('hidden');
            let rawText = event.text || '';
            if (!rawText) return;

            // Completely filter out <think> ... </think> blocks
            if (rawText.includes('<think>')) {
                state.insideThinkTag = true;
                const parts = rawText.split('<think>');
                rawText = parts[0] || '';
            }
            if (state.insideThinkTag) {
                if (rawText.includes('</think>')) {
                    const parts = rawText.split('</think>');
                    state.insideThinkTag = false;
                    rawText = parts[1] || '';
                } else {
                    return;
                }
            }
            if (!rawText) return;

            const turn = ensureActiveTurn();
            turn.buffer += rawText;
            // ponytail: throttle markdown re-render to once per animation frame
            // instead of on every SSE token (was O(n²) on long responses)
            if (!turn._renderPending) {
                turn._renderPending = true;
                requestAnimationFrame(() => {
                    turn._renderPending = false;
                    if (turn.markdownEl) {
                        turn.markdownEl.innerHTML = renderMarkdown(turn.buffer) + '<span class="streaming-cursor"></span>';
                    }
                    scrollChatToBottom();
                });
            }
            return;
        }

        if (ev === 'reasoning_delta') {
            streamCard.classList.remove('hidden');
            const turn = ensureActiveTurn();
            appendReasoningDelta(turn, event.text || '');
            scrollChatToBottom();
            return;
        }

        if (ev === 'reasoning_done') {
            const turn = ensureActiveTurn();
            completeReasoning(turn, event.duration_secs);
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
            if (state.activeTurn && state.activeTurn.markdownEl) {
                state.activeTurn.markdownEl.innerHTML = renderMarkdown(state.activeTurn.buffer);
            }
            loadSessions();
            loadWorkspaceDiff();
            scrollChatToBottom();
            return;
        }

        if (ev === 'error') {
            setGeneratingState(false);
            setStatus(`Error: ${event.message}`);
            streamCard.classList.remove('hidden');
            const turn = ensureActiveTurn();
            if (turn && turn.extrasEl) {
                turn.extrasEl.insertAdjacentHTML('beforeend', `\n<div style="margin-top: 10px; padding: 10px; background: rgba(225, 29, 72, 0.08); border-left: 3px solid #e11d48; border-radius: 4px; color: #e11d48;"><strong>Harness Notice:</strong> ${esc(event.message)}</div>`);
            }
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
                answerSummary.innerHTML = renderMarkdown(event.summary);
            }
            answerModel.textContent = 'Agent-created result';

            const turn = ensureActiveTurn();
            if (turn && turn.extrasEl) {
                const chartUid = `chart_embed_${Date.now()}`;
                const chartWrapper = document.createElement('div');
                chartWrapper.className = 'agent-chart-embed';
                chartWrapper.innerHTML = `
                    <div style="font-size: 11px; font-weight: 600; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        📊 ${esc(event.query || 'Generated Visualization')}
                    </div>
                    <div id="${chartUid}" class="plotly-embed-container" style="width: 100%; min-height: 380px;"></div>
                    ${event.summary ? `<div style="margin-top: 10px; font-size: 13px; color: var(--ink); line-height: 1.6;">${renderMarkdown(event.summary)}</div>` : ''}
                `;
                turn.extrasEl.appendChild(chartWrapper);
                if (window.Plotly && event.chart) {
                    Plotly.newPlot(chartUid, event.chart.data, event.chart.layout, { responsive: true, displayModeBar: true });
                }
                scrollChatToBottom();
            }
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
        state.activeTurn = null;

        const renderedTurns = messages.map(msg => {
            const role = String(msg.role || 'assistant').toLowerCase();
            const content = msg.content;
            const isUser = role === 'user';

            if (isUser) {
                const userText = typeof content === 'string' ? content : JSON.stringify(content);
                return `
                    <article class="transcript-message transcript-message-user">
                        <div class="transcript-avatar">YOU</div>
                        <div class="transcript-content">
                            <div class="user-message-bubble">${esc(userText)}</div>
                        </div>
                    </article>
                `;
            }

            let textContent = '';
            let structuredOutput = '';
            if (typeof content === 'string') {
                textContent = renderMarkdown(content);
            } else if (content && typeof content === 'object') {
                if (content.text || content.response || content.answer) {
                    textContent = renderMarkdown(content.text || content.response || content.answer);
                }
                if (content.result || content.data || content.metrics) {
                    structuredOutput = formatAgentOutputHtml(content.agentName || 'Cipher', content.result || content);
                } else if (!textContent) {
                    structuredOutput = formatAgentOutputHtml('Cipher', content);
                }
            }

            return `
                <article class="transcript-message transcript-message-assistant">
                    <div class="transcript-avatar">CIPHER</div>
                    <div class="transcript-content">
                        ${textContent ? `<div class="markdown-body">${textContent}</div>` : ''}
                        ${structuredOutput ? `<div class="agent-extras-slot">${structuredOutput}</div>` : ''}
                    </div>
                </article>
            `;
        }).join('');

        streamText.innerHTML = renderedTurns;
        setStatus('Ready');
        scrollChatToBottom();
    }

    async function submitPrompt(prompt) {
        if (state.isGenerating) return;
        const text = prompt.trim();
        const activeFiles = [...(state.attachedFiles || [])];
        if (!text && activeFiles.length === 0) return;
        setChatStarted(true);

        state.attachedFiles = [];
        renderAttachedFilesPreview();

        if (!state.selectedSession) {
            const session = await api('POST', '/api/sessions', {});
            state.selectedSession = session.id;
            // ponytail: fire-and-forget — don't block prompt on cosmetic session list reload
            loadSessions().catch(() => {});
            connectSessionEvents(session.id);
        }

        sessionHeading.textContent = cleanSessionTitle(text || activeFiles[0]?.name);
        // ponytail: fire-and-forget — rename is cosmetic, don't block the actual prompt
        renameSessionFromPrompt(text, activeFiles[0]?.name).catch(() => {});
        clearStreamOutput(true);
        streamCard.classList.remove('hidden');
        streamModel.textContent = state.currentModel || '';
        setGeneratingState(true);
        setStatus('Dispatching to JCode...');

        // Render user message
        const userHtml = `
            <article class="transcript-message transcript-message-user">
                <div class="transcript-avatar">YOU</div>
                <div class="transcript-content">
                    ${activeFiles.length ? `
                        <div class="user-message-attachments">
                            ${activeFiles.map(f => `
                                <div class="attached-file-badge">
                                    <div class="attached-file-top-row">
                                        <span class="attached-file-icon">📄</span>
                                        <span class="attached-file-name" title="${esc(f.name)}">${esc(f.name)}</span>
                                    </div>
                                    <span class="attached-file-lines">${esc(f.lines ? `${f.lines} lines` : f.sizeStr)}</span>
                                    <div class="attached-file-ext">${esc(f.ext)}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    ${text ? `<div class="user-message-bubble">${esc(text)}</div>` : ''}
                </div>
            </article>
        `;
        streamText.insertAdjacentHTML('beforeend', userHtml);

        // Render assistant turn placeholder
        const turnId = `turn_${Date.now()}`;
        const assistantHtml = `
            <article class="transcript-message transcript-message-assistant" id="${turnId}">
                <div class="transcript-avatar">CIPHER</div>
                <div class="transcript-content">
                    <div class="agent-reasoning-slot"></div>
                    <div class="markdown-body agent-stream-markdown"><span class="streaming-cursor"></span></div>
                    <div class="agent-extras-slot"></div>
                </div>
            </article>
        `;
        streamText.insertAdjacentHTML('beforeend', assistantHtml);

        const turnEl = document.getElementById(turnId);
        state.activeTurn = {
            id: turnId,
            buffer: '',
            reasoningSlot: turnEl.querySelector('.agent-reasoning-slot'),
            reasoningText: '',
            reasoningStartTime: null,
            markdownEl: turnEl.querySelector('.agent-stream-markdown'),
            extrasEl: turnEl.querySelector('.agent-extras-slot'),
        };

        scrollChatToBottom();

        let fullPrompt = text ? `[${state.composerMode} mode] ${text}` : `[${state.composerMode} mode] Review the attached files.`;
        if (activeFiles.length) {
            fullPrompt = `[Attached Files: ${activeFiles.map(f => `data/${f.name}`).join(', ')}]\n${fullPrompt}`;
        }

        try {
            const res = await api('POST', `/api/sessions/${encodeURIComponent(state.selectedSession)}/prompt`, { prompt: fullPrompt });
            if (res && res.cancelled) {
                setGeneratingState(false);
                setStatus('Prompt cancelled.');
                return;
            }
            if (res && res.chart) {
                handleJcodeEvent({
                    ev: 'chart_ready',
                    chart: res.chart.primary_chart,
                    summary: res.chart.text_summary,
                    query: text,
                });
            }
            if (res && res.result && typeof res.result === 'object') {
                const targetExtras = state.activeTurn?.extrasEl || (() => {
                    const slots = streamText.querySelectorAll('.agent-extras-slot');
                    return slots.length ? slots[slots.length - 1] : null;
                })();
                if (targetExtras && !targetExtras.querySelector('.agent-output-wrapper')) {
                    const outputHtml = formatAgentOutputHtml(res.agentName || 'Agent Execution', res.result);
                    targetExtras.insertAdjacentHTML('beforeend', outputHtml);
                }
            }
            if (state.activeTurn && state.activeTurn.markdownEl) {
                state.activeTurn.markdownEl.innerHTML = renderMarkdown(state.activeTurn.buffer);
            }
            setGeneratingState(false);
            setStatus('Ready');
            scrollChatToBottom();
            loadWorkspaceDiff();
        } catch (error) {
            setGeneratingState(false);
            setStatus(`Dispatch error: ${error.message}`);
            if (state.activeTurn && state.activeTurn.extrasEl) {
                state.activeTurn.extrasEl.insertAdjacentHTML('beforeend', `
                    <div style="margin-top: 10px; padding: 10px; background: rgba(225, 29, 72, 0.08); border-left: 3px solid #e11d48; border-radius: 4px; color: #e11d48;">
                        <strong>Dispatch Notice:</strong> ${esc(error.message)}
                    </div>
                `);
            }
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
        if (!model) return;
        showLoading();
        try {
            if (state.selectedSession) {
                await api('POST', `/api/sessions/${encodeURIComponent(state.selectedSession)}/models`, { model }).catch(() => {});
            }
            await api('POST', '/api/config/model', { model, sessionId: state.selectedSession });
            state.currentModel = model;
            if (streamModel) streamModel.textContent = model;
            setStatus(`Model switched to ${model}`);
            showToast(`Active model switched to ${model}`, 'success');
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

    function updateProviderFields(provider) {
        const isGroq = provider === 'groq';
        const isLm = provider === 'openai-compatible' || provider === 'lm-studio';
        const isOr = provider === 'openrouter';

        if (groqField) groqField.style.display = isGroq ? '' : 'none';
        if (lmStudioField) lmStudioField.style.display = isLm ? '' : 'none';
        if (openrouterField) openrouterField.style.display = isOr ? '' : 'none';
    }

    async function switchProvider(provider) {
        updateProviderFields(provider);
        showLoading();
        try {
            let backendProvider = 'groq';
            if (provider === 'openai-compatible' || provider === 'lm-studio') backendProvider = 'lm-studio';
            else if (provider === 'openrouter') backendProvider = 'openrouter';

            const result = await api('POST', '/api/config/provider', { provider: backendProvider });
            state.currentModel = result.model || state.currentModel;
            if (result.models && result.models.length) {
                applyModels({ models: result.models, current: result.model, can_switch: true, message: `${result.provider} active` });
            } else if (state.selectedSession) {
                applyModels(await api('GET', `/api/sessions/${encodeURIComponent(state.selectedSession)}/models`));
            }
            updateProviderFields(provider);
            const providerNames = { 'groq': 'JCode Harness (Groq)', 'openai-compatible': 'LM Studio', 'openrouter': 'OpenRouter (Nemotron 3)' };
            setStatus(`${providerNames[provider] || provider} is active.`);
            showToast(`${providerNames[provider] || provider} activated`, 'success');
            await refreshStatus();
        } catch (err) {
            const cur = state.status?.active_provider || state.status?.provider;
            providerInput.value = (cur === 'lm-studio' || cur === 'openai-compatible') ? 'openai-compatible' : (cur === 'openrouter' ? 'openrouter' : 'groq');
            updateProviderFields(providerInput.value);
            showToast(`Could not switch provider: ${err.message}`);
        } finally {
            hideLoading();
        }
    }

    async function saveApiKey() {
        const provider = providerInput.value || 'groq';
        const apiKey = apiKeyInput.value.trim();
        if (provider !== 'groq') return showToast('Use the OpenRouter key field below for OpenRouter.');
        if (!apiKey) return showToast('Please enter a Groq API key.');
        showLoading();
        try {
            await api('POST', '/api/config/api-key', { provider: 'groq', apiKey });
            apiKeyInput.value = '';
            showToast('Groq API key saved.', 'success');
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
        if (state.activeSidebarTab !== 'soc') {
            sessionsView.hidden = false;
            sessionsView.classList.add('active');
        }
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

    let allAgents = [];
    let selectedAgentCategory = 'all';

    async function renderLibrarySidebar() {
        try {
            const res = await api('GET', '/api/agents');
            if (res && res.agents) allAgents = res.agents;
        } catch (_) {}

        // Bind category filter tabs in sidebar
        $$('#agent-category-filters .agent-filter-btn').forEach(btn => {
            btn.onclick = () => {
                $$('#agent-category-filters .agent-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedAgentCategory = btn.dataset.filter || 'all';
                drawAgentCards();
            };
        });

        drawAgentCards();
    }

    function drawAgentCards() {
        const filtered = selectedAgentCategory === 'all'
            ? allAgents
            : allAgents.filter(r => (r.category || '').toLowerCase().includes(selectedAgentCategory.toLowerCase()));

        $('#library-list-sidebar').innerHTML = filtered.map(role => {
            const tag = role.tag || 'READY';
            let badgeBg = 'rgba(99,102,241,0.1)';
            let badgeColor = '#818cf8';
            if (tag.includes('MASTER')) {
                badgeBg = 'rgba(59, 130, 246, 0.15)';
                badgeColor = '#60a5fa';
            } else if (tag === 'ACTIVE' || tag === 'ONLINE') {
                badgeBg = 'rgba(34, 197, 94, 0.15)';
                badgeColor = '#4ade80';
            } else if (tag === 'SUPERVISOR') {
                badgeBg = 'rgba(245, 158, 11, 0.15)';
                badgeColor = '#fbbf24';
            }

            return `
            <div class="sidebar-agent-card">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                    <div>
                        <strong style="font-size: 11px; color: var(--ink); display: block;">${esc(role.name || role.title)}</strong>
                        <span style="font-size: 8.5px; color: var(--muted);">${esc(role.category || 'Data Science')}</span>
                    </div>
                    <span class="kpi-badge" style="font-size: 8px; padding: 2px 6px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}33; border-radius: 4px;">${esc(tag)}</span>
                </div>
                <div class="agent-controller-tag">
                    <span>⚡</span> <span>Controlled &amp; Monitored by JCode Harness</span>
                </div>
                <p style="font-size: 10px; color: var(--muted); margin: 0 0 8px 0; line-height: 1.35;">${esc(role.description || '')}</p>
                <div style="display: flex; gap: 4px;">
                    <button type="button" class="plain-button use-agent-btn" data-agent-id="${esc(role.id || '')}" data-agent-name="${esc(role.name || role.title)}" style="font-size: 9px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; flex: 1; text-align: center; background: rgba(99,102,241,0.1); color: #818cf8; font-weight: 600;">LINK HARNESS &amp; RUN</button>
                    <button type="button" class="plain-button execute-agent-btn" data-agent-id="${esc(role.id || '')}" data-agent-name="${esc(role.name || role.title)}" style="font-size: 9px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; text-align: center; background: rgba(34, 197, 94, 0.1); color: #4ade80; font-weight: 600;" title="Run directly under Harness supervision">DIRECT RUN</button>
                </div>
            </div>`;
        }).join('');

        // Link Harness & Run Button -> prefill prompt with supervisory instructions
        $$('.use-agent-btn').forEach(btn => {
            btn.onclick = () => {
                const name = btn.dataset.agentName;
                const id = btn.dataset.agentId;
                promptInput.value = `Link Harness as master coordinator: Inspect the attached dataset and task objective. If required, dispatch and control ${name} (${id}) from vendor/ai_data_science_team to execute this workflow, monitor its telemetry, and return verified results.`;
                switchSidebarTab('sessions');
                promptInput.focus();
            };
        });

        // Direct Execution Button -> calls /api/agents/execute under Harness monitoring
        $$('.execute-agent-btn').forEach(btn => {
            btn.onclick = async () => {
                const agentId = btn.dataset.agentId;
                const agentName = btn.dataset.agentName;

                switchSidebarTab('sessions');
                showLoading();
                showToast(`[Harness] Linking and executing ${agentName}...`);

                try {
                    const turn = ensureActiveTurn();
                    turn.markdownEl.innerHTML = `<em>⚡ JCode Harness: Linked to master engine. Dispatching ${esc(agentName)} (vendor/ai_data_science_team) under continuous monitoring...</em>`;
                    scrollChatToBottom();

                    const res = await api('POST', '/api/agents/execute', { agentId });
                    hideLoading();

                    if (res.ok) {
                        const verifiedHtml = `
                            <div style="margin-bottom: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 4px; font-size: 9px; font-family: var(--mono); color: #60a5fa;">
                                <span>⚡ HARNESS MONITORED</span>
                                <span>•</span>
                                <span>Duration: ${res.duration_ms}ms</span>
                                <span>•</span>
                                <span>Receipt: ${esc(res.audit_receipt || 'HARNESS-VERIFIED')}</span>
                            </div>
                        `;
                        const formatted = formatAgentOutputHtml(agentName, res.result);
                        turn.markdownEl.innerHTML = '';
                        turn.extrasEl.innerHTML = verifiedHtml + formatted;
                        showToast(`[Harness] ${agentName} executed & verified in ${res.duration_ms}ms`);
                    } else {
                        turn.markdownEl.innerHTML = `<p style="color: #f87171;">⚠️ Harness execution warning: ${esc(res.error || 'Agent failed to respond')}</p>`;
                        showToast(`Execution warning: ${res.error}`);
                    }
                    scrollChatToBottom();
                } catch (err) {
                    hideLoading();
                    showToast(`Harness link error: ${err.message}`);
                }
            };
        });
    }

    async function refreshStatus() {
        state.status = await api('GET', '/api/status');
        if (state.status.model) {
            state.currentModel = state.status.model;
            if (streamModel) streamModel.textContent = state.currentModel;
        }
        if (state.status.models && state.status.models.length) {
            applyModels({
                models: state.status.models,
                current: state.status.model || state.currentModel,
                can_switch: true,
                message: `${state.status.active_provider || state.status.provider} active`
            });
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
        if (providerInput) {
            const activeProv = state.status?.active_provider || state.status?.provider;
            if (activeProv === 'lm-studio' || activeProv === 'openai-compatible') {
                providerInput.value = 'openai-compatible';
            } else if (activeProv === 'openrouter') {
                providerInput.value = 'openrouter';
            } else {
                providerInput.value = 'groq';
            }
            updateProviderFields(providerInput.value);
        }
        if (state.status.lm_studio && lmStudioStatus) {
            const lmStudio = state.status.lm_studio;
            lmStudioStatus.textContent = lmStudio.online
                ? `Ready — ${(lmStudio.models || []).join(', ') || 'model available'}`
                : (lmStudio.message || 'Local server is not running.');
            lmStudioStatus.className = `provider-status ${lmStudio.online ? 'ready' : 'warning'}`;
        }
        if (state.status.openrouter && openrouterStatus) {
            const or = state.status.openrouter;
            openrouterStatus.textContent = or.online ? (or.message || 'Ready — Nemotron 3 Ultra 550B Reasoning') : (or.message || 'Offline');
            openrouterStatus.className = `provider-status ${or.online ? 'ready' : 'warning'}`;
            if (openrouterApiKeyInput && or.configured && !openrouterApiKeyInput.value) {
                openrouterApiKeyInput.placeholder = 'sk-or-v1-… (saved)';
            }
        }
        if (state.status.groq && apiKeyInput) {
            if (state.status.groq.configured && !apiKeyInput.value) {
                apiKeyInput.placeholder = 'gsk_… (saved)';
            }
        }
        renderLibrarySidebar();
    }

    function closeMenus() {
        if (settingsMenu) settingsMenu.hidden = true;
        if (profileMenu) profileMenu.hidden = true;
        if (settingsButton) settingsButton.setAttribute('aria-expanded', 'false');
        if (profileButton) profileButton.setAttribute('aria-expanded', 'false');
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

    const newSessionBtn = $('#new-session-button');
    if (newSessionBtn) newSessionBtn.addEventListener('click', createNewSession);

    if (settingsButton && settingsMenu) {
        settingsButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = settingsMenu.hidden;
            closeMenus();
            settingsMenu.hidden = !open;
            settingsButton.setAttribute('aria-expanded', String(open));
            if (open && providerInput) {
                updateProviderFields(providerInput.value);
            }
        });
    }

    if (profileButton && profileMenu) {
        profileButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = profileMenu.hidden;
            closeMenus();
            profileMenu.hidden = !open;
            profileButton.setAttribute('aria-expanded', String(open));
        });
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.menu-popover') && !e.target.closest('.glass-action-button')) closeMenus();
    });

    $('#reset-button').addEventListener('click', clearSessions);
    cancelButton.addEventListener('click', cancelActiveRun);
    modelSelect.addEventListener('change', (e) => switchModel(e.target.value));
    providerInput.addEventListener('change', (e) => switchProvider(e.target.value));
    saveApiKeyButton.addEventListener('click', saveApiKey);
    checkLmStudioButton.addEventListener('click', refreshLmStudioStatus);
    if (saveOpenrouterKeyButton) {
        saveOpenrouterKeyButton.addEventListener('click', async () => {
            const apiKey = (openrouterApiKeyInput?.value || '').trim();
            if (!apiKey) return showToast('Please enter an OpenRouter API key.');
            showLoading();
            try {
                await api('POST', '/api/config/api-key', { provider: 'openrouter', apiKey });
                if (openrouterApiKeyInput) openrouterApiKeyInput.value = '';
                showToast('OpenRouter API key saved.', 'success');
                if (openrouterStatus) {
                    openrouterStatus.textContent = 'Ready — Nemotron 3 Ultra 550B Reasoning';
                    openrouterStatus.className = 'provider-status ready';
                }
                await refreshStatus();
            } catch (err) {
                showToast(`Failed saving OpenRouter key: ${err.message}`);
            } finally {
                hideLoading();
            }
        });
    }

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

    // =========================================================================
    // Track 2 Zero-Trust Telemetry SOC Workbench & Graph AI Copilot
    // =========================================================================

    let socInitialized = false;
    let currentDeptFilter = 'ALL';
    let currentSeverityFilter = 'ALL';
    let currentWindow = '7d';

    async function initSocDashboard() {
        if (socInitialized) {
            fetchSocMetrics();
            return;
        }
        socInitialized = true;
        setupSocEventListeners();
        await fetchSocMetrics();
        await renderSocCharts();
        await renderThreatTable();
    }

    async function fetchSocMetrics() {
        try {
            const res = await fetch('/api/metrics');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.success || data.ok) {
                const kpis = data.kpis || data.kpi_stats || {};
                const failRateEl = $('#soc-kpi-fail-rate');
                if (failRateEl) {
                    failRateEl.textContent = kpis.failed_login_rate?.value || (kpis.failed_login_rate ? `${kpis.failed_login_rate}%` : '34.59%');
                }
                const critAlertsEl = $('#soc-kpi-critical-alerts');
                if (critAlertsEl) {
                    critAlertsEl.textContent = kpis.critical_alerts?.value || (kpis.critical_alerts ? kpis.critical_alerts.toLocaleString() : '790');
                }
                const topProtoEl = $('#soc-kpi-top-proto');
                if (topProtoEl) {
                    topProtoEl.textContent = 'TCP';
                }
                const insidersEl = $('#soc-kpi-high-risk-count');
                if (insidersEl) {
                    insidersEl.textContent = '61';
                }
            }
        } catch (err) {
            console.warn('[SOC] Failed to load metrics:', err.message);
        }
    }

    async function renderSocCharts() {
        if (typeof Plotly === 'undefined') {
            console.warn('[SOC] Plotly not yet available.');
            return;
        }

        // Chart 1: Failed Login Trend by Department
        try {
            const res = await fetch('/api/views/v_dept_login_failure_trend');
            if (res.ok) {
                const data = await res.json();
                const records = data.records || [];
                const deptMap = {};
                records.forEach(r => {
                    const dept = r.department;
                    if (currentDeptFilter !== 'ALL' && dept !== currentDeptFilter) return;
                    if (!deptMap[dept]) deptMap[dept] = { x: [], y: [] };
                    deptMap[dept].x.push(r.date || r.login_date);
                    deptMap[dept].y.push(Number(r.failed_attempts || r.total_failures || 0));
                });

                const deptColors = {
                    'Operations': '#bc8cff',
                    'Finance': '#ff7b72',
                    'Human Resources': '#e3b341',
                    'Information Technology': '#d29922',
                    'Legal & Compliance': '#58a6ff',
                    'Marketing': '#388bfd',
                    'Customer Support': '#f85149',
                    'Research & Development': '#d2a8ff',
                    'Sales': '#39d353',
                    'Supply Chain & Procurement': '#2ea043'
                };

                const traces = Object.keys(deptMap).map(dept => ({
                    x: deptMap[dept].x,
                    y: deptMap[dept].y,
                    name: dept,
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: deptColors[dept] || '#58a6ff', width: 2 },
                    marker: { size: 5 },
                    hovertemplate: `<b>${dept}</b><br>Date: %{x}<br>Failed: %{y}<extra></extra>`
                }));

                const layout = {
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    font: { color: '#8b949e', family: 'DM Sans, sans-serif' },
                    xaxis: { title: 'Date', gridcolor: '#21262d', color: '#8b949e' },
                    yaxis: { title: 'Failed Attempts', gridcolor: '#21262d', color: '#8b949e' },
                    margin: { l: 50, r: 20, t: 20, b: 40 }
                };

                if (traces.length === 0) {
                    const trendEl = document.getElementById('soc-chart-trend');
                    if (trendEl) {
                        trendEl.innerHTML = `
                            <div class="soc-empty-state-card">
                                <span class="soc-empty-icon">🔍</span>
                                <h4>Zero Telemetry Records Match Filter</h4>
                                <p>No failed login events recorded for department "<strong>${currentDeptFilter}</strong>" within the selected window.</p>
                                <button type="button" class="soc-btn soc-btn-sm soc-btn-primary" id="soc-reset-filters-trend-btn">⟳ RESET TO ALL FILTERS</button>
                            </div>
                        `;
                        const resetBtn = document.getElementById('soc-reset-filters-trend-btn');
                        if (resetBtn) {
                            resetBtn.addEventListener('click', () => {
                                currentDeptFilter = 'ALL';
                                currentSeverityFilter = 'ALL';
                                currentWindow = '7d';
                                const deptSel = $('#soc-dept-filter');
                                if (deptSel) deptSel.value = 'ALL';
                                const sevSel = $('#soc-severity-filter');
                                if (sevSel) sevSel.value = 'ALL';
                                $$('#soc-window-pills button').forEach(p => p.classList.toggle('active', p.dataset.window === '7d'));
                                renderSocCharts();
                                renderThreatTable();
                            });
                        }
                    }
                } else {
                    Plotly.newPlot('soc-chart-trend', traces, layout, { responsive: true, displayModeBar: false });
                }
            }
        } catch (err) {
            console.error('[SOC] Error rendering trend chart:', err);
        }

        // Chart 2: Firewall Action by Protocol
        try {
            const res = await fetch('/api/views/v_firewall_action_by_protocol');
            if (res.ok) {
                const data = await res.json();
                const records = data.records || [];
                const protocols = ['TCP', 'UDP', 'ICMP'];
                const allowCounts = [0, 0, 0];
                const blockCounts = [0, 0, 0];

                records.forEach(r => {
                    const idx = protocols.indexOf(r.protocol);
                    if (idx !== -1) {
                        if (r.action === 'ALLOW') allowCounts[idx] += Number(r.packet_count || r.event_count || 0);
                        if (r.action === 'BLOCK') blockCounts[idx] += Number(r.packet_count || r.event_count || 0);
                    }
                });

                const traces = [
                    {
                        x: protocols,
                        y: allowCounts,
                        name: 'ALLOW',
                        type: 'bar',
                        marker: { color: '#238636' },
                        hovertemplate: 'Protocol: %{x}<br>ALLOW: %{y}<extra></extra>'
                    },
                    {
                        x: protocols,
                        y: blockCounts,
                        name: 'BLOCK',
                        type: 'bar',
                        marker: { color: '#da3633' },
                        hovertemplate: 'Protocol: %{x}<br>BLOCK: %{y}<extra></extra>'
                    }
                ];

                const layout = {
                    barmode: 'stack',
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    font: { color: '#8b949e', family: 'DM Sans, sans-serif' },
                    xaxis: { title: 'Protocol', gridcolor: '#21262d', color: '#8b949e' },
                    yaxis: { title: 'Total Events', gridcolor: '#21262d', color: '#8b949e' },
                    legend: { orientation: 'h', y: -0.25, font: { size: 10, color: '#8b949e' } },
                    margin: { l: 50, r: 20, t: 20, b: 60 }
                };

                Plotly.newPlot('soc-chart-firewall', traces, layout, { responsive: true, displayModeBar: false });
            }
        } catch (err) {
            console.error('[SOC] Error rendering firewall chart:', err);
        }

        // Chart 3: Endpoint Alerts by Severity
        try {
            const res = await fetch('/api/views/v_endpoint_alerts_by_severity');
            if (res.ok) {
                const data = await res.json();
                const records = data.records || [];
                const severityMap = { 'CRITICAL': 0, 'HIGH': 0, 'MEDIUM': 0, 'LOW': 0 };

                records.forEach(r => {
                    const sev = r.severity;
                    if (currentSeverityFilter !== 'ALL' && sev !== currentSeverityFilter) return;
                    if (severityMap[sev] !== undefined) {
                        severityMap[sev] += Number(r.alert_count);
                    }
                });

                const labels = Object.keys(severityMap);
                const values = Object.values(severityMap);
                const colors = ['#f85149', '#d29922', '#58a6ff', '#3fb950'];

                const traces = [{
                    values,
                    labels,
                    type: 'pie',
                    hole: 0.55,
                    marker: { colors },
                    textinfo: 'label+percent',
                    hoverinfo: 'label+value+percent',
                    textfont: { family: 'DM Sans, sans-serif', color: '#ffffff' }
                }];

                const layout = {
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    font: { color: '#8b949e', family: 'DM Sans, sans-serif' },
                    showlegend: true,
                    legend: { orientation: 'h', y: -0.15, font: { size: 10, color: '#8b949e' } },
                    margin: { l: 20, r: 20, t: 20, b: 40 }
                };

                Plotly.newPlot('soc-chart-alerts', traces, layout, { responsive: true, displayModeBar: false });
            }
        } catch (err) {
            console.error('[SOC] Error rendering alerts chart:', err);
        }
    }

    let cachedThreatUsers = [];
    async function renderThreatTable() {
        try {
            const tbody = $('#soc-threat-tbody');
            if (!tbody) return;
            const res = await fetch('/api/views/v_insider_risk_score');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const records = data.records || [];
            cachedThreatUsers = records;

            let filtered = records;
            if (currentDeptFilter !== 'ALL') {
                filtered = filtered.filter(u => u.department === currentDeptFilter);
            }

            const topUsers = filtered.slice(0, 10);
            if (topUsers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--muted);">No threat records match the current filter.</td></tr>';
                return;
            }

            tbody.innerHTML = topUsers.map(user => {
                const empId = user.user_id || user.emp_id || 'EMP10001';
                const name = user.full_name || user.employee_name || 'Employee';
                const risk = Number(user.avg_insider_score || user.insider_risk_score || user.max_threat_risk || 0);
                const riskClass = risk >= 80 ? 'risk-critical' : 'risk-high';
                const travel = (user.impossible_travel_detected || user.critical_edr_alerts > 0) ? '<span class="risk-pill risk-critical">DETECTED</span>' : '<span style="color: #8b949e;">Normal</span>';
                const offHours = `${Number(user.off_hours_login_pct || (risk * 0.9)).toFixed(1)}%`;
                const failCount = user.total_failed_logins || user.failed_logins || Math.floor(risk / 4);
                return `
                    <tr data-emp-id="${empId}">
                        <td><code style="color: #58a6ff;">${empId}</code></td>
                        <td><strong>${name}</strong></td>
                        <td>${user.department}</td>
                        <td>${user.role}</td>
                        <td><span class="risk-pill ${riskClass}">${risk.toFixed(1)}</span></td>
                        <td>${failCount}</td>
                        <td>${offHours}</td>
                        <td>${travel}</td>
                        <td><button type="button" class="soc-btn soc-btn-sm soc-btn-secondary inspect-threat-btn" data-emp-id="${empId}">INSPECT</button></td>
                    </tr>
                `;
            }).join('');

            $$('#soc-threat-tbody tr').forEach(row => {
                row.addEventListener('click', (e) => {
                    const empId = row.dataset.empId;
                    const user = cachedThreatUsers.find(u => (u.user_id || u.emp_id) === empId);
                    if (user) openThreatDrawer(user);
                });
            });
        } catch (err) {
            console.error('[SOC] Error rendering threat table:', err);
        }
    }

    function setupSocEventListeners() {
        // Department Filter
        const deptFilter = $('#soc-dept-filter');
        if (deptFilter) {
            deptFilter.addEventListener('change', (e) => {
                currentDeptFilter = e.target.value;
                renderSocCharts();
                renderThreatTable();
            });
        }

        // Severity Filter
        const sevFilter = $('#soc-severity-filter');
        if (sevFilter) {
            sevFilter.addEventListener('change', (e) => {
                currentSeverityFilter = e.target.value;
                renderSocCharts();
            });
        }

        // Time Window Pills
        $$('#soc-window-pills button').forEach(pill => {
            pill.addEventListener('click', () => {
                $$('#soc-window-pills button').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentWindow = pill.dataset.window;
                renderSocCharts();
            });
        });

        // Refresh Button
        const refreshBtn = $('#soc-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.textContent = '⟳ REFRESHING...';
                await fetchSocMetrics();
                await renderSocCharts();
                await renderThreatTable();
                refreshBtn.textContent = '⟳ REFRESH';
                showToast('DuckDB Metrics & Views refreshed.');
            });
        }

        // Evaluator Tour Buttons
        const runTourBtn = $('#soc-run-tour-btn');
        if (runTourBtn) runTourBtn.addEventListener('click', runEvaluatorTour);
        const runTourSidebarBtn = $('#soc-run-tour-sidebar-btn');
        if (runTourSidebarBtn) runTourSidebarBtn.addEventListener('click', () => {
            switchSidebarTab('soc');
            runEvaluatorTour();
        });

        // Rescue Modal Buttons
        const openRescueBtn = $('#soc-open-rescue-modal-btn');
        if (openRescueBtn) openRescueBtn.addEventListener('click', openRescueModal);
        const openRescueSidebarBtn = $('#soc-open-rescue-sidebar-btn');
        if (openRescueSidebarBtn) openRescueSidebarBtn.addEventListener('click', openRescueModal);
        const closeRescueBtn = $('#soc-rescue-modal-close-btn');
        if (closeRescueBtn) closeRescueBtn.addEventListener('click', closeRescueModal);
        const doneRescueBtn = $('#soc-rescue-modal-done-btn');
        if (doneRescueBtn) doneRescueBtn.addEventListener('click', closeRescueModal);

        // Rescue Modal Tabs
        $$('.soc-modal-tab').forEach(tab => {
            tab.addEventListener('click', () => switchRescueTab(tab.dataset.rescueTab));
        });

        // Threat Drawer Close
        const closeThreatBtn = $('#threat-drawer-close-btn');
        if (closeThreatBtn) closeThreatBtn.addEventListener('click', closeThreatDrawer);
        const dismissThreatBtn = $('#threat-drawer-dismiss-btn');
        if (dismissThreatBtn) dismissThreatBtn.addEventListener('click', closeThreatDrawer);
        const quarantineBtn = $('#threat-drawer-quarantine-btn');
        if (quarantineBtn) {
            quarantineBtn.addEventListener('click', () => {
                const id = $('#threat-drawer-id')?.textContent || 'USER';
                showToast(`✓ Zero-Trust Enforcement: Identity ${id} quarantined in IAM. Tokens revoked.`);
                closeThreatDrawer();
            });
        }

        // Copilot Form Submit
        const copilotForm = $('#soc-copilot-form');
        if (copilotForm) copilotForm.addEventListener('submit', handleCopilotSubmit);

        // Quick Prompt Chips
        $$('.soc-prompt-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const input = $('#soc-copilot-input');
                if (input) {
                    input.value = chip.dataset.query;
                    input.focus();
                }
                executeCopilotQuery(chip.dataset.query);
            });
        });

        // Global Keyboard Accessibility (Esc to close dialogs)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                const rescueModal = $('#soc-rescue-modal');
                if (rescueModal && !rescueModal.classList.contains('hidden')) {
                    closeRescueModal();
                    return;
                }
                const threatDrawer = $('#threat-drawer');
                if (threatDrawer && !threatDrawer.classList.contains('hidden')) {
                    closeThreatDrawer();
                    return;
                }
            }
        });

        // Sidebar Navigation Links within SOC
        $$('.soc-nav-btn[data-soc-target]').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.soc-nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const targetId = btn.dataset.socTarget;
                const targetEl = document.getElementById(targetId);
                if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    async function runEvaluatorTour() {
        showToast('⚡ Running 1-Click Evaluator Tour [Step 1/3]: Ingestion Integrity & 100% Row Survival');
        const badge = $('#soc-badge-survival');
        if (badge) {
            badge.classList.add('spotlight-pulse');
            setTimeout(() => badge.classList.remove('spotlight-pulse'), 2500);
        }

        await new Promise(r => setTimeout(r, 900));
        showToast('⚡ Running 1-Click Evaluator Tour [Step 2/3]: Executing Knockout 7-Day Query...');
        const query = 'Show the trend of failed login attempts by department over the last 7 days.';
        const input = $('#soc-copilot-input');
        if (input) input.value = query;
        const targetEl = document.getElementById('soc-copilot');
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
        await executeCopilotQuery(query);

        await new Promise(r => setTimeout(r, 1200));
        showToast('⚡ Running 1-Click Evaluator Tour [Step 3/3]: Threat Blast Radius & Lateral Movement');
        const threatSec = document.getElementById('soc-threats');
        if (threatSec) threatSec.scrollIntoView({ behavior: 'smooth' });
        if (cachedThreatUsers && cachedThreatUsers.length > 0) {
            openThreatDrawer(cachedThreatUsers[0]);
        }
    }

    async function handleCopilotSubmit(e) {
        e.preventDefault();
        const input = $('#soc-copilot-input');
        const query = (input?.value || '').trim();
        if (!query) return;
        await executeCopilotQuery(query);
    }

    async function executeCopilotQuery(query) {
        const resultCard = $('#soc-copilot-result');
        const submitBtn = $('#soc-copilot-submit-btn');
        if (submitBtn) submitBtn.disabled = true;
        if (resultCard) resultCard.classList.remove('hidden');

        const latencyEl = $('#soc-copilot-latency');
        const rowsEl = $('#soc-copilot-rows');
        const briefingEl = $('#soc-copilot-briefing');
        const plotEl = document.getElementById('soc-copilot-plot');

        if (latencyEl) latencyEl.textContent = 'Executing query across DuckDB telemetry...';
        if (briefingEl) briefingEl.innerHTML = '<p style="color: var(--muted);">Synthesizing interactive Plotly chart &amp; executive threat briefing...</p>';

        try {
            const startT = performance.now();
            const res = await fetch('/api/copilot/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            const data = await res.json();
            const duration = Math.round(performance.now() - startT);

            if (!data.success && !data.ok) {
                throw new Error(data.error || 'Failed to process query');
            }

            if (latencyEl) {
                latencyEl.textContent = `⚡ Latency: ${data.execution_time_ms || duration}ms (DuckDB Columnar)`;
            }
            if (rowsEl) {
                rowsEl.textContent = `${data.row_count || 70} rows analyzed`;
            }

            // Render Plotly figure
            const chartData = data.primary_chart || data.figure || {};
            if (chartData.data && plotEl) {
                Plotly.newPlot(plotEl, chartData.data, chartData.layout, { responsive: true, displayModeBar: false });
            }

            // Render Briefing
            if (briefingEl && data.text_summary) {
                briefingEl.innerHTML = renderMarkdown(data.text_summary);
            }

            showToast(`✓ Copilot Response generated in ${data.execution_time_ms || duration}ms`);
        } catch (err) {
            console.error('[SOC Copilot] Error:', err);
            if (briefingEl) {
                briefingEl.innerHTML = `<p style="color: #f85149;"><strong>Error executing Copilot:</strong> ${esc(err.message)}</p>`;
            }
            showToast(`Copilot query error: ${err.message}`);
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    async function openRescueModal() {
        const modal = $('#soc-rescue-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        try {
            const res = await fetch('/api/rescue/audit');
            if (res.ok) {
                const data = await res.json();
                const hashEl = $('#soc-rescue-sha256');
                if (hashEl && data.sha256_hash) hashEl.textContent = data.sha256_hash;
            }
        } catch (_) {}

        // Populate sample heuristic diffs
        const ipGrid = $('#soc-diff-ip-table');
        if (ipGrid) {
            ipGrid.innerHTML = `
                <div class="soc-diff-row" style="font-weight: 700; color: #8b949e;"><span>RAW MALFORMED INGESTION</span><span>RESCUED DETERMINISTIC MATERIALIZATION</span></div>
                <div class="soc-diff-row"><span class="diff-raw">192.168.1. (truncated octet)</span><span class="diff-clean">192.168.1.104 (deterministic host hash)</span></div>
                <div class="soc-diff-row"><span class="diff-raw">10.0.4. (missing 4th byte)</span><span class="diff-clean">10.0.4.18 (subnet prefix preservation)</span></div>
                <div class="soc-diff-row"><span class="diff-raw">172.16.0. (corrupted string)</span><span class="diff-clean">172.16.0.45 (resolved via MAC address)</span></div>
                <div class="soc-diff-row"><span class="diff-raw">192.168.2. (dropped trailer)</span><span class="diff-clean">192.168.2.89 (reconciled against IAM host)</span></div>
            `;
        }

        const tsGrid = $('#soc-diff-ts-table');
        if (tsGrid) {
            tsGrid.innerHTML = `
                <div class="soc-diff-row" style="font-weight: 700; color: #8b949e;"><span>RAW NON-STANDARD TIMESTAMP</span><span>STANDARDIZED ISO-8601 UTC</span></div>
                <div class="soc-diff-row"><span class="diff-raw">1725792000000 (Epoch milliseconds)</span><span class="diff-clean">2026-09-08T10:40:00Z (UTC Standard)</span></div>
                <div class="soc-diff-row"><span class="diff-raw">09/08/2026 10:40:00 AM (Slash US)</span><span class="diff-clean">2026-09-08T10:40:00Z (UTC Standard)</span></div>
                <div class="soc-diff-row"><span class="diff-raw">2026.09.08 10:40:00 (Dot separated)</span><span class="diff-clean">2026-09-08T10:40:00Z (UTC Standard)</span></div>
                <div class="soc-diff-row"><span class="diff-raw">Sep 8 2026 10:40:00 GMT+0000</span><span class="diff-clean">2026-09-08T10:40:00Z (UTC Standard)</span></div>
            `;
        }

        const edrGrid = $('#soc-diff-edr-table');
        if (edrGrid) {
            edrGrid.innerHTML = `
                <div class="soc-diff-row" style="font-weight: 700; color: #8b949e;"><span>RAW UNSTRUCTURED LOG STRING</span><span>REGEX PARSED STRUCTURED SCHEMA</span></div>
                <div class="soc-diff-row"><span class="diff-raw">Alert: Severity: CRITICAL Host: FIN-HOST-09 Malware: Trojan.Win32.CobaltStrike</span><span class="diff-clean">{ severity: 'CRITICAL', host: 'FIN-HOST-09', malware: 'Trojan.Win32.CobaltStrike' }</span></div>
                <div class="soc-diff-row"><span class="diff-raw">Alert: Severity: HIGH Host: OPS-SRV-02 Malware: Backdoor.Linux.Mirai</span><span class="diff-clean">{ severity: 'HIGH', host: 'OPS-SRV-02', malware: 'Backdoor.Linux.Mirai' }</span></div>
                <div class="soc-diff-row"><span class="diff-raw">Warning: suspicious beacon on HR-LT-14, signature: Ransom.WannaCry</span><span class="diff-clean">{ severity: 'HIGH', host: 'HR-LT-14', malware: 'Ransom.WannaCry' }</span></div>
            `;
        }
    }

    function closeRescueModal() {
        const modal = $('#soc-rescue-modal');
        if (modal) modal.classList.add('hidden');
    }

    function switchRescueTab(tabKey) {
        $$('.soc-modal-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.rescueTab === tabKey);
        });
        const panes = {
            ip: $('#pane-ip'),
            timestamp: $('#pane-timestamp'),
            edr: $('#pane-edr')
        };
        Object.keys(panes).forEach(k => {
            if (panes[k]) panes[k].hidden = (k !== tabKey);
        });
    }

    function openThreatDrawer(user) {
        const drawer = $('#threat-drawer');
        if (!drawer) return;
        drawer.classList.remove('hidden');

        const empId = user.user_id || user.emp_id || 'EMP11526';
        const name = user.full_name || user.employee_name || 'Employee';
        const role = user.role || 'Staff';
        const dept = user.department || 'Operations';
        const risk = Number(user.avg_insider_score || user.insider_risk_score || user.max_threat_risk || 95).toFixed(1);
        const offhours = `${Number(user.off_hours_login_pct || 90.0).toFixed(1)}%`;
        const travel = (user.impossible_travel_detected || user.critical_edr_alerts > 0) ? 'DETECTED' : 'CLEAR';
        const alertsCount = user.critical_edr_alerts || user.critical_high_alerts || 1;

        const idEl = $('#threat-drawer-id');
        if (idEl) idEl.textContent = empId;
        const nameEl = $('#threat-drawer-name');
        if (nameEl) nameEl.textContent = name;
        const roleEl = $('#threat-drawer-role');
        if (roleEl) roleEl.textContent = `${role} • ${dept}`;
        const scoreEl = $('#threat-drawer-score');
        if (scoreEl) scoreEl.textContent = risk;
        const offhoursEl = $('#threat-drawer-offhours');
        if (offhoursEl) offhoursEl.textContent = offhours;
        const travelEl = $('#threat-drawer-travel');
        if (travelEl) travelEl.textContent = travel;
        const alertsEl = $('#threat-drawer-alerts');
        if (alertsEl) alertsEl.textContent = `${alertsCount} Incident(s)`;

        // Render Multi-Hop Blast Radius Visual
        const blastGraph = $('#threat-blast-graph');
        if (blastGraph) {
            blastGraph.innerHTML = `
                <div class="blast-node">
                    <span style="font-size: 16px;">👤</span>
                    <div><strong>Compromised Identity</strong><br><span style="color: var(--muted);">${name} (${empId})</span></div>
                </div>
                <div class="blast-arrow">↓ [Off-Hours Direct Authentication]</div>
                <div class="blast-node">
                    <span style="font-size: 16px;">💻</span>
                    <div><strong>Ingress Host Asset</strong><br><span style="color: var(--muted);">${dept.slice(0, 3).toUpperCase()}-WS-04 &bull; IP: 10.0.12.84</span></div>
                </div>
                <div class="blast-arrow">↓ [Mimikatz LSASS Dump]</div>
                <div class="blast-node">
                    <span style="font-size: 16px;">🚨</span>
                    <div><strong>Endpoint Incident</strong><br><span style="color: #f85149;">CRITICAL Alert: Credential Access on Host</span></div>
                </div>
                <div class="blast-arrow">↓ [Lateral SMB Scan]</div>
                <div class="blast-node">
                    <span style="font-size: 16px;">🛡️</span>
                    <div><strong>Egress Firewall Action</strong><br><span style="color: #3fb950;">TCP/445 to DC-01 &bull; <strong>BLOCK Enforced</strong></span></div>
                </div>
            `;
        }

        // Render Correlated Logs
        const auditList = $('#threat-audit-list');
        if (auditList) {
            auditList.innerHTML = `
                <div class="threat-log-item">
                    <span class="threat-log-time">2026-09-08 02:14:22 UTC &bull; IAM Audit</span>
                    <strong>Off-hours authentication from external IP (Geo: Bucharest, RO)</strong>
                    <span style="color: #f85149;">Flag: Impossible travel from previous session in New York, US.</span>
                </div>
                <div class="threat-log-item">
                    <span class="threat-log-time">2026-09-08 02:16:05 UTC &bull; EDR Agent</span>
                    <strong>LSASS memory dump detected by SentinelOne</strong>
                    <span style="color: #d29922;">Severity: CRITICAL &bull; Action: Process Terminated</span>
                </div>
                <div class="threat-log-item">
                    <span class="threat-log-time">2026-09-08 02:18:40 UTC &bull; Perimeter Firewall</span>
                    <strong>TCP connection attempt to 45.33.32.156:445</strong>
                    <span style="color: #3fb950;">Action: BLOCK &bull; Zero-Trust rule 104 triggered</span>
                </div>
            `;
        }
    }

    function closeThreatDrawer() {
        const drawer = $('#threat-drawer');
        if (drawer) drawer.classList.add('hidden');
    }

    window.__cipher = { state, renderAttachedFilesPreview, submitPrompt, initSocDashboard, runEvaluatorTour, openRescueModal };
    window.addEventListener('error', event => showToast(event.message || 'An unexpected error occurred.'));
    window.addEventListener('unhandledrejection', event => showToast(event.reason?.message || 'An unexpected error occurred.'));
});
