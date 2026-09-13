import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { jcodeService } from './jcodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ponytail: load environment variables from .env file if available
const ENV_FILE = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn('[server] Notice: native process.loadEnvFile skipped:', err.message);
  }
}

// Centralized configuration constants
const PORT = parseInt(process.env.PORT || '8080', 10);
const PYTHON_BIN = process.env.PYTHON_PATH || 'python';
const MAX_PAYLOAD_BYTES = parseInt(process.env.MAX_PAYLOAD_BYTES || '', 10) || 5 * 1024 * 1024;
const DEFAULT_ANALYTICS_QUERY = process.env.DEFAULT_ANALYTICS_QUERY || 'Show the trend of failed login attempts by department over the last 7 days.';
const UI_DIR = path.join(PROJECT_ROOT, 'client');
const LM_STUDIO_BASE_URL = (process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const activeProvider = { id: 'jcode', model: null };

process.on('uncaughtException', (err) => {
  console.error('[server uncaughtException]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server unhandledRejection]:', reason);
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function getLmStudioStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`, { signal: controller.signal });
    if (!response.ok) {
      return { configured: true, online: false, endpoint: LM_STUDIO_BASE_URL, message: `LM Studio returned HTTP ${response.status}.` };
    }
    const payload = await response.json();
    const models = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    return { configured: true, online: true, endpoint: LM_STUDIO_BASE_URL, models: models.map((model) => model.id || model.name).filter(Boolean) };
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Timed out. In LM Studio, start the Local Server and load a model.'
      : 'Unavailable. In LM Studio, start the Local Server and load a model.';
    return { configured: true, online: false, endpoint: LM_STUDIO_BASE_URL, message };
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyGroqKey(apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, error: 'Groq rejected this API key. Create or paste a valid key from GroqCloud, then try again.' };
    return { ok: false, error: `Groq key validation failed (HTTP ${response.status}). Please try again.` };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'Groq key validation timed out. Check your connection and try again.' : 'Could not reach Groq to validate the key.' };
  } finally {
    clearTimeout(timeout);
  }
}

function lmStudioChatModels(models = []) {
  return models.filter((model) => !/embed|embedding/i.test(model));
}

async function sendLmStudioPrompt(sessionId, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: activeProvider.model,
        messages: [
          { role: 'system', content: 'You are Cipher, a concise data-harness assistant.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `LM Studio returned HTTP ${response.status}.`);
    const text = payload.choices?.[0]?.message?.content || 'LM Studio returned an empty response.';
    jcodeService.broadcast(sessionId, { ev: 'text_delta', text });
    jcodeService.broadcast(sessionId, { ev: 'turn_done' });
    return { ok: true, session_id: sessionId, provider: 'lm-studio', model: activeProvider.model };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'LM Studio timed out.' : error.message;
    jcodeService.broadcast(sessionId, { ev: 'error', message });
    jcodeService.broadcast(sessionId, { ev: 'turn_done' });
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_PAYLOAD_BYTES) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function runPythonScript(scriptName, args = [], inputData = null) {
  return new Promise((resolve, reject) => {
    const agentsDir = path.join(PROJECT_ROOT, 'agents');
    const scriptPath = path.join(agentsDir, scriptName);
    const py = spawn(PYTHON_BIN, [scriptPath, ...args], { cwd: PROJECT_ROOT });
    let stdout = '';
    let stderr = '';

    if (inputData) {
      py.stdin.write(typeof inputData === 'string' ? inputData : JSON.stringify(inputData));
      py.stdin.end();
    }

    py.stdout.on('data', (d) => { stdout += d; });
    py.stderr.on('data', (d) => { stderr += d; });

    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python script ${scriptName} exited with code ${code}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (_) {
        // Fallback: extract first JSON object/array from stdout (handles prefix debug lines)
        const jsonMatch = stdout.match(/[\[{][\s\S]*$/);
        if (jsonMatch) {
          try { return resolve(JSON.parse(jsonMatch[0])); } catch (_2) { /* fall through */ }
        }
        resolve(stdout);
      }
    });
    py.on('error', reject);
  });
}

function getWorkspaceDiff() {
  return new Promise((resolve) => {
    const git = spawn('git', ['diff', '--no-ext-diff', '--unified=2', '--', '.'], { cwd: PROJECT_ROOT, windowsHide: true });
    let stdout = '';
    git.stdout.on('data', (chunk) => { stdout += chunk; });
    git.on('close', (code) => {
      if (code !== 0 && code !== 1) return resolve({ available: false, files: [], diff: '' });
      const files = [...stdout.matchAll(/^diff --git a\/(.+?) b\//gm)].map(match => match[1]);
      resolve({ available: true, files, diff: stdout.slice(0, 24000), truncated: stdout.length > 24000 });
    });
    git.on('error', () => resolve({ available: false, files: [], diff: '' }));
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const resolved = path.resolve(UI_DIR, filePath);

  if (!resolved.startsWith(UI_DIR)) {
    res.writeHead(403);
    return res.end('Access Denied');
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    return fs.createReadStream(resolved).pipe(res);
  }

  res.writeHead(404);
  res.end('Not Found');
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers for local API flexibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // API: System & JCode Runtime Status
    if (method === 'GET' && pathname === '/api/status') {
      const status = await jcodeService.getStatus();
      return sendJson(res, 200, {
        ...status,
        provider: activeProvider.id === 'lm-studio' ? 'lm-studio' : status.provider,
        model: activeProvider.id === 'lm-studio' ? activeProvider.model : status.model,
        active_provider: activeProvider.id,
        lm_studio: await getLmStudioStatus(),
      });
    }

    if (method === 'GET' && pathname === '/api/providers/lm-studio/status') {
      return sendJson(res, 200, await getLmStudioStatus());
    }

    if (method === 'POST' && pathname === '/api/config/provider') {
      const body = await parseJsonBody(req);
      if (body.provider === 'lm-studio') {
        const lmStudio = await getLmStudioStatus();
        const models = lmStudioChatModels(lmStudio.models);
        if (!lmStudio.online || !models.length) return sendJson(res, 400, { error: 'LM Studio is not ready with a chat model.' });
        activeProvider.id = 'lm-studio';
        activeProvider.model = models.includes(activeProvider.model) ? activeProvider.model : models[0];
        return sendJson(res, 200, { ok: true, provider: activeProvider.id, model: activeProvider.model, models });
      }
      activeProvider.id = 'jcode';
      activeProvider.model = null;
      const status = await jcodeService.getStatus();
      return sendJson(res, 200, { ok: true, provider: 'groq', model: status.model });
    }

    // API: List Sessions
    if (method === 'GET' && pathname === '/api/sessions') {
      const sessions = await jcodeService.listSessions();
      return sendJson(res, 200, { sessions });
    }

    // API: Create Session
    if (method === 'POST' && pathname === '/api/sessions') {
      const body = await parseJsonBody(req);
      const session = await jcodeService.createSession(body.workingDir);
      return sendJson(res, 201, session);
    }

    // API: Persist a concise, user-derived task title.
    const titleMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/title$/);
    if (titleMatch && method === 'POST') {
      const body = await parseJsonBody(req);
      const title = String(body.title || '').trim().slice(0, 96);
      if (!title) return sendJson(res, 400, { error: 'A session title is required.' });
      return sendJson(res, 200, await jcodeService.renameSession(decodeURIComponent(titleMatch[1]), title));
    }

    if (method === 'GET' && pathname === '/api/workspace/diff') {
      return sendJson(res, 200, await getWorkspaceDiff());
    }

    // Match /api/sessions/:id
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      if (method === 'DELETE') {
        const result = await jcodeService.deleteSession(sessionId);
        return sendJson(res, 200, result);
      }
    }

    // Match /api/sessions/:id/history
    const historyMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const sessionId = decodeURIComponent(historyMatch[1]);
      const history = await jcodeService.getHistory(sessionId);
      return sendJson(res, 200, history);
    }

    // Match /api/sessions/:id/prompt
    const promptMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/prompt$/);
    if (promptMatch && method === 'POST') {
      const sessionId = decodeURIComponent(promptMatch[1]);
      const body = await parseJsonBody(req);
      const prompt = body.prompt || body.question;
      if (!prompt) return sendJson(res, 400, { error: 'Prompt is required.' });

      if (activeProvider.id === 'lm-studio') {
        return sendJson(res, 200, await sendLmStudioPrompt(sessionId, prompt));
      }

      // Primary: JCode Harness orchestrates prompt and sub-agents
      try {
        await jcodeService.sendPrompt(sessionId, prompt);
        return sendJson(res, 200, { ok: true, session_id: sessionId });
      } catch (jcodeErr) {
        console.warn('[server] JCode harness offline or error, running fallback:', jcodeErr.message);
        // Fallback: direct script execution if JCode bridge is disconnected
        const isAnalyticsQuery = /trend|failed login|chart|graph|plot|severity|insider|firewall|protocol|risk|compromised|rubric/i.test(prompt);
        if (isAnalyticsQuery) {
          jcodeService.broadcast(sessionId, { ev: 'tool_start', call_id: 'chart_agent', name: 'text_to_chart_agent' });
          const chartResult = await runPythonScript('chartAgent.py', [prompt]);
          jcodeService.broadcast(sessionId, { ev: 'tool_done', call_id: 'chart_agent', output: 'Generated Chart' });
          jcodeService.broadcast(sessionId, { ev: 'text_delta', text: chartResult.text_summary || '' });
          jcodeService.broadcast(sessionId, { ev: 'chart_ready', chart: chartResult.primary_chart, summary: chartResult.text_summary, query: prompt, chart_type: chartResult.chart_type });
          jcodeService.broadcast(sessionId, { ev: 'turn_done' });
          return sendJson(res, 200, { ok: true, session_id: sessionId, chart: chartResult });
        }
        const agentMatch = prompt.match(/using\s+([\w\s&]+):/i);
        if (agentMatch) {
          const queryName = agentMatch[1].trim().toLowerCase();
          const AGENT_MAP = {
            'data loader': 'data_loader_agent', 'cleaning': 'cleaning_agent', 'feature': 'feature_agent',
            'wrangling': 'wrangling_agent', 'sql database': 'sql_agent', 'sql data analyst': 'sql_analyst',
            'pandas': 'pandas_analyst', 'visualization': 'viz_agent', 'eda': 'eda_agent',
            'model evaluation': 'model_eval_agent', 'workflow planner': 'planner_agent',
            'supervisor': 'supervisor_ds_team', 'network': 'network_agent', 'identity': 'identity_agent',
            'threat': 'threat_agent', 'imputation': 'imputation_agent',
          };
          const matchedKey = Object.keys(AGENT_MAP).find(k => queryName.includes(k));
          const agentId = matchedKey ? AGENT_MAP[matchedKey] : 'supervisor_ds_team';
          jcodeService.broadcast(sessionId, { ev: 'tool_start', call_id: agentId, name: agentId });
          const agentResult = await runPythonScript('data_agents.py', ['--agent', agentId]);
          jcodeService.broadcast(sessionId, { ev: 'tool_done', call_id: agentId, output: 'Execution completed' });
          jcodeService.broadcast(sessionId, { ev: 'agent_ready', result: agentResult, agentId, name: matchedKey ? matchedKey.toUpperCase() : agentId });
          jcodeService.broadcast(sessionId, { ev: 'turn_done' });
          return sendJson(res, 200, { ok: true, session_id: sessionId, result: agentResult });
        }
        return sendJson(res, 500, { error: jcodeErr.message });
      }
    }

    // Match /api/sessions/:id/events (Server-Sent Events)
    const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (eventsMatch && method === 'GET') {
      const sessionId = decodeURIComponent(eventsMatch[1]);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');

      const unsubscribe = jcodeService.subscribe(sessionId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.on('close', () => {
        unsubscribe();
      });
      res.on('close', () => {
        unsubscribe();
      });
      return;
    }

    // Match /api/sessions/:id/cancel
    const cancelMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/cancel$/);
    if (cancelMatch && method === 'POST') {
      const sessionId = decodeURIComponent(cancelMatch[1]);
      const result = await jcodeService.cancel(sessionId);
      return sendJson(res, 200, result);
    }

    // Match /api/sessions/:id/models
    const modelsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/models$/);
    if (modelsMatch) {
      const sessionId = decodeURIComponent(modelsMatch[1]);
      if (method === 'GET') {
        if (activeProvider.id === 'lm-studio') {
          const lmStudio = await getLmStudioStatus();
          const models = lmStudioChatModels(lmStudio.models);
          return sendJson(res, 200, { models, current: activeProvider.model, can_switch: true, message: models.length > 1 ? undefined : 'LM Studio has one loaded chat model.' });
        }
        const models = await jcodeService.listModels(sessionId);
        return sendJson(res, 200, models);
      }
      if (method === 'POST') {
        const body = await parseJsonBody(req);
        if (activeProvider.id === 'lm-studio') {
          const lmStudio = await getLmStudioStatus();
          const models = lmStudioChatModels(lmStudio.models);
          if (!models.includes(body.model)) return sendJson(res, 400, { error: 'That model is not currently loaded in LM Studio.' });
          activeProvider.model = body.model;
          return sendJson(res, 200, { ok: true, model: body.model });
        }
        const result = await jcodeService.setModel(sessionId, body.model);
        return sendJson(res, 200, result);
      }
    }

    // API: Set API Key
    if (method === 'POST' && pathname === '/api/config/api-key') {
      const body = await parseJsonBody(req);
      if (body.provider === 'groq') {
        const verification = await verifyGroqKey(body.apiKey);
        if (!verification.ok) return sendJson(res, 400, { error: verification.error });
      }
      const result = await jcodeService.setApiKey(body.provider, body.apiKey);
      return sendJson(res, 200, result);
    }

    // API: Workspace Tree
    if (method === 'GET' && pathname === '/api/workspace/tree') {
      const tree = jcodeService.getWorkspaceTree();
      return sendJson(res, 200, { tree, validation_status: 'ready' });
    }

    // API: Workspace File Content
    if (method === 'GET' && pathname === '/api/workspace/file') {
      const filePath = parsedUrl.searchParams.get('path');
      if (!filePath) return sendJson(res, 400, { error: 'Path parameter required' });
      const fileData = jcodeService.readWorkspaceFile(filePath);
      return sendJson(res, 200, fileData);
    }

    // API: Clear/Reset sessions
    if (method === 'POST' && pathname === '/api/reset') {
      const sessions = await jcodeService.listSessions();
      for (const s of sessions) {
        await jcodeService.deleteSession(s.id).catch(() => {});
      }
      return sendJson(res, 200, { ok: true, cleared: sessions.length });
    }

    // API: Live SOC Dashboard Metrics & Filters (Gate 3)
    if (pathname === '/api/analytics/dashboard') {
      const selection = method === 'POST' ? await parseJsonBody(req) : { dataset: parsedUrl.searchParams.get('dataset') };
      const dashboardData = await runPythonScript('dataset_dashboard.py', [], selection);
      return sendJson(res, 200, dashboardData);
    }

    // API: Text-to-Chart Agent Query (Gate 4)
    if (method === 'POST' && pathname === '/api/agent/chart') {
      const body = await parseJsonBody(req);
      const query = body.query || body.prompt || DEFAULT_ANALYTICS_QUERY;
      const chartResult = await runPythonScript('chartAgent.py', [query]);
      return sendJson(res, 200, chartResult);
    }

    // API: Execute Pipeline (Reproducibility)
    if (method === 'POST' && pathname === '/api/pipeline/run') {
      const result = await runPythonScript('pipeline.py');
      return sendJson(res, 200, { ok: true, result });
    }

    // API: Import / Upload Dataset (Gate 1 & 2 Ingestion & Auto-Analysis)
    if (method === 'POST' && pathname === '/api/upload') {
      const DATA_DIR = process.env.DATASET_DIR || path.join(PROJECT_ROOT, 'data');
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const webReq = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: Readable.toWeb(req),
        duplex: 'half',
      });

      const formData = await webReq.formData();
      const files = Array.from(formData.entries())
        .map(([_, v]) => v)
        .filter((v) => typeof v === 'object' && typeof v.arrayBuffer === 'function');

      if (!files.length) {
        return sendJson(res, 400, { error: 'No files uploaded.' });
      }

      const savedFiles = [];
      for (const file of files) {
        const originalName = file.name || 'uploaded_data.csv';
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.promises.writeFile(path.join(DATA_DIR, originalName), buffer);
        savedFiles.push(originalName);

        // Map to canonical Track 2 dataset files if applicable
        const lower = originalName.toLowerCase();
        const headerSample = buffer.toString('utf8', 0, Math.min(buffer.length, 2048)).toLowerCase();

        if (lower.includes('identity') || lower.includes('asset') || headerSample.includes('manager_username') || headerSample.includes('hire_date')) {
          await fs.promises.writeFile(path.join(DATA_DIR, 'track2_identity_asset_master.csv'), buffer);
        } else if (lower.includes('firewall') || lower.includes('fw') || headerSample.includes('bytes_sent') || headerSample.includes('src_ip')) {
          await fs.promises.writeFile(path.join(DATA_DIR, 'track2_firewall_logs.csv'), buffer);
        } else if (lower.includes('iam') || lower.includes('login') || headerSample.includes('event_type') || headerSample.includes('failed_logins')) {
          await fs.promises.writeFile(path.join(DATA_DIR, 'track2_iam_audit_trail.json'), buffer);
        } else if (lower.includes('endpoint') || lower.includes('alert') || lower.includes('edr') || headerSample.includes('detected_timestamp') || headerSample.includes('alert_id')) {
          await fs.promises.writeFile(path.join(DATA_DIR, 'track2_endpoint_alerts.xlsx'), buffer);
        }
      }

      // The dashboard deliberately reads only this explicit upload registry,
      // never the bundled example datasets.
      const registryPath = path.join(DATA_DIR, '.user-datasets.json');
      const previous = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : [];
      fs.writeFileSync(registryPath, JSON.stringify([...new Set([...previous, ...savedFiles])], null, 2));

      const output = await runPythonScript('pipeline.py');
      let result = typeof output === 'object' ? output : {};
      if (typeof output === 'string') {
        const jsonMatch = output.match(/__PIPELINE_RESULT_JSON__:(.*)/);
        if (jsonMatch) {
          try { result = JSON.parse(jsonMatch[1]); } catch (_) {}
        }
      }

      return sendJson(res, 200, {
        ok: true,
        saved_files: savedFiles,
        clean_total: result.clean_total,
        raw_total: result.raw_total,
        receipt_hash: result.receipt_hash,
      });
    }

    // API: List Extracted Data Agents
    if (method === 'GET' && pathname === '/api/agents') {
      const agents = await runPythonScript('data_agents.py');
      return sendJson(res, 200, { agents });
    }

    // API: Run Specific Extracted Data Agent
    if (method === 'POST' && pathname === '/api/agent/run') {
      const body = await parseJsonBody(req);
      const agentId = body.agentId || body.id;
      const input = body.input || {};
      const activeSession = jcodeService.attachedSessionId;
      if (activeSession) {
        jcodeService.broadcast(activeSession, { ev: 'tool_start', call_id: agentId, name: agentId });
      }
      const result = await runPythonScript('data_agents.py', ['--agent', agentId, '--input', JSON.stringify(input)]);
      if (activeSession) {
        jcodeService.broadcast(activeSession, { ev: 'tool_done', call_id: agentId, output: 'Agent completed' });
        jcodeService.broadcast(activeSession, { ev: 'agent_ready', result, agentId });
        jcodeService.broadcast(activeSession, { ev: 'turn_done' });
      }
      return sendJson(res, 200, { ok: true, result });
    }

    // Fallback static files
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(`[server error] ${method} ${pathname}:`, err);
    sendJson(res, 500, { error: err.message });
  }
});

await jcodeService.init().catch((err) => {
  console.warn('[server] jcodeService initialization warning:', err.message);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[server] Port ${PORT} already bound; connecting to active server.`);
  } else {
    console.error('[server error]:', err);
  }
});

server.listen(PORT, () => {
  console.log(`[JCode Frontend Server] Running at http://localhost:${PORT}`);
});
