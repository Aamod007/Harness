import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

try {
  process.loadEnvFile();
} catch (_) {}

// Centralized configuration and path resolution with environment variable overrides
// ponytail: default binary and SDK paths pointing to vendored local debug target
const sdkPath = process.env.JCODE_SDK_PATH || path.join(PROJECT_ROOT, 'vendor', 'jcode', 'sdk', 'typescript', 'dist', 'index.js');
const { JcodeClient } = await import(`file://${sdkPath.replace(/\\/g, '/')}`);

// Centralized runtime limits & options
const DEFAULT_PROVIDER = process.env.JCODE_PROVIDER || 'groq';
const DEFAULT_MODEL = process.env.JCODE_MODEL || 'openai/gpt-oss-120b';
const HISTORY_TIMEOUT_MS = parseInt(process.env.JCODE_TIMEOUT_MS || '2500', 10);
const MAX_FILE_PREVIEW_BYTES = parseInt(process.env.MAX_PREVIEW_BYTES || '', 10) || 2 * 1024 * 1024;
// ponytail: standard directories excluded from workspace explorer
const IGNORED_WORKSPACE_DIRS = new Set(['.git', 'node_modules', 'target', '.cargo', 'dist', '.gemini']);

class JcodeService {
  constructor() {
    this.client = null;
    this.activeSubscribers = new Map(); // sessionId -> Set of listener callbacks
    this.attachedSessionId = null;
    this.workspaceDir = process.env.WORKSPACE_DIR || process.cwd();
    this.jcodeBinary = process.env.JCODE_BINARY || path.join(PROJECT_ROOT, 'vendor', 'jcode', 'target', 'debug', 'jcode.exe');
    this.bridgeBinary = process.env.JCODE_BRIDGE_BINARY || path.join(PROJECT_ROOT, 'vendor', 'jcode', 'target', 'debug', 'jcode-harness-api-bridge.exe');
    this.daemonProcess = null;
    this.bridgeProcess = null;
    this.currentModel = null;
    this.currentProvider = null;
    this.availableRoutes = [];
  }

  async init() {
    await this.ensureProcessesRunning();
    await this.connectClient();
  }

  async ensureProcessesRunning() {
    try {
      const probeClient = await JcodeClient.connect();
      probeClient.close();
      console.log('[jcodeService] Existing JCode bridge is healthy.');
      return;
    } catch {
      console.log('[jcodeService] Bridge not yet reachable, checking daemon and bridge binaries...');
    }

    // Ensure daemon is running
    if (fs.existsSync(this.jcodeBinary) && !this.daemonProcess) {
      console.log(`[jcodeService] Spawning JCode daemon (serve) with provider '${DEFAULT_PROVIDER}'...`);
      this.daemonProcess = spawn(
        this.jcodeBinary,
        ['-p', DEFAULT_PROVIDER, '-m', DEFAULT_MODEL, 'serve', '--tools', 'bash,read,write,apply_patch'],
        {
          cwd: this.workspaceDir,
          stdio: ['ignore', 'ignore', 'inherit'],
          detached: true,
        }
      );
      this.daemonProcess.unref();
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Ensure bridge is running
    if (fs.existsSync(this.bridgeBinary) && !this.bridgeProcess) {
      console.log('[jcodeService] Spawning JCode harness API bridge...');
      this.bridgeProcess = spawn(this.bridgeBinary, [], {
        cwd: this.workspaceDir,
        stdio: ['ignore', 'ignore', 'inherit'],
        detached: true,
      });
      this.bridgeProcess.unref();
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async connectClient() {
    let retries = 5;
    while (retries > 0) {
      try {
        this.client = await JcodeClient.connect();
        console.log('[jcodeService] Connected to JCode harness API.');

        this.client.on('event', (frame) => {
          const sId = frame.session_id || this.attachedSessionId;
          if (sId) {
            if (frame.ev === 'permission_request' && frame.request_id) {
              this.respondPermission(sId, frame.request_id, 'allow').catch(() => {});
            }
            this.broadcast(sId, frame);
          }
        });
        this.client.on('harness_error', (frame) => {
          const sId = frame.session_id || this.attachedSessionId;
          if (sId) this.broadcast(sId, { ...frame, ev: 'error' });
        });
        this.client.on('error', (err) => {
          console.warn('[jcodeService] Client error:', err.message);
        });
        this.client.on('close', () => {
          console.warn('[jcodeService] Client connection closed.');
          this.client = null;
          this.attachedSessionId = null;
        });

        const sessions = await this.client.listSessions();
        if (sessions.length > 0) {
          const info = await this.client.getRuntimeInfo(sessions[0].session_id).catch(() => null);
          if (info) {
            this.currentModel = info.model;
            this.currentProvider = info.provider;
            this.availableRoutes = info.routes || [];
          }
        }
        return;
      } catch (err) {
        retries--;
        console.warn(`[jcodeService] Failed connecting to JCode API (${err.message}), retrying in 1s...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error('Could not connect to JCode harness API after retries.');
  }

  async ensureAttached(sessionId) {
    if (!this.client) await this.connectClient();
    if (this.attachedSessionId !== sessionId) {
      await this.client.attachSession(sessionId).catch(() => {});
      this.attachedSessionId = sessionId;
    }
    return this.client;
  }

  async getStatus() {
    let connected = false;

    try {
      if (this.client) {
        await this.client.listSessions();
        connected = true;
      }
    } catch {
      connected = false;
    }

    return {
      ok: true,
      connected,
      workspace: this.workspaceDir,
      provider: this.currentProvider || DEFAULT_PROVIDER,
      model: this.currentModel || DEFAULT_MODEL,
      routes: this.availableRoutes,
    };
  }

  async listSessions() {
    if (!this.client) await this.connectClient();
    const rawSessions = await this.client.listSessions();
    return rawSessions.map((s) => {
      let cleanSubject = s.title;
      if (!cleanSubject || cleanSubject.startsWith('session_') || /^(llama|qwen|gpt)_\d+_[a-f0-9]+$/i.test(cleanSubject)) {
        cleanSubject = 'New Session';
      }
      return {
        id: s.session_id,
        subject: cleanSubject,
        time: s.last_modified ? new Date(s.last_modified).toISOString() : new Date().toISOString(),
        working_dir: s.working_dir || this.workspaceDir,
      };
    });
  }

  async createSession(workingDir = this.workspaceDir) {
    if (!this.client) await this.connectClient();
    const session = await this.client.createSession(workingDir);
    this.attachedSessionId = session.session_id;
    const info = await this.client.getRuntimeInfo(session.session_id).catch(() => null);
    if (info) {
      this.currentModel = info.model || this.currentModel;
      this.currentProvider = info.provider || this.currentProvider;
      this.availableRoutes = info.routes || this.availableRoutes;
    }
    return {
      id: session.session_id,
      subject: 'New Session',
      working_dir: workingDir,
      time: new Date().toISOString(),
    };
  }

  async renameSession(sessionId, title) {
    const client = await this.ensureAttached(sessionId);
    await client.renameSession(sessionId, title);
    return { ok: true, id: sessionId, subject: title };
  }

  async deleteSession(sessionId) {
    if (!this.client) await this.connectClient();
    try {
      await this.client.archiveSession(sessionId);
    } catch (err) {
      if (!/unknown_session|does not exist/i.test(err.message)) {
        throw err;
      }
    }
    this.activeSubscribers.delete(sessionId);
    if (this.attachedSessionId === sessionId) {
      this.attachedSessionId = null;
    }
    return { ok: true, id: sessionId };
  }

  async getHistory(sessionId) {
    try {
      const client = await this.ensureAttached(sessionId);
      const historyPromise = client.getHistory(sessionId);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HISTORY_TIMEOUT_MS));
      return await Promise.race([historyPromise, timeoutPromise]);
    } catch (_) {
      return { session_id: sessionId, messages: [] };
    }
  }

  async sendPrompt(sessionId, prompt) {
    const client = await this.ensureAttached(sessionId);
    await client.sendMessage(sessionId, prompt, { waitForAccept: false });
    return { ok: true, session_id: sessionId };
  }

  async cancel(sessionId) {
    try {
      const client = await this.ensureAttached(sessionId);
      await client.cancel(sessionId);
      return { ok: true, session_id: sessionId };
    } catch (err) {
      console.error(`[jcodeService] Cancel error for ${sessionId}:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  async respondPermission(sessionId, requestId, decision = 'allow') {
    const client = await this.ensureAttached(sessionId);
    await client.respondToPermission(sessionId, requestId, decision);
    return { ok: true };
  }

  async listModels(sessionId) {
    try {
      const client = await this.ensureAttached(sessionId);
      const result = await client.listModels(sessionId);
      return result;
    } catch (err) {
      console.warn(`[jcodeService] listModels error:`, err.message);
      return { models: [], current: this.currentModel };
    }
  }

  async setModel(sessionId, model) {
    const client = await this.ensureAttached(sessionId);
    await client.setModel(sessionId, model);
    this.currentModel = model;
    return { ok: true, model };
  }

  async setApiKey(provider, apiKey) {
    if (!this.client) await this.connectClient();
    await this.client.setApiKey(provider, apiKey);
    return { ok: true, provider };
  }

  subscribe(sessionId, callback) {
    if (!this.activeSubscribers.has(sessionId)) {
      this.activeSubscribers.set(sessionId, new Set());
    }
    this.activeSubscribers.get(sessionId).add(callback);
    this.ensureAttached(sessionId).catch(() => {});

    return () => {
      const set = this.activeSubscribers.get(sessionId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.activeSubscribers.delete(sessionId);
        }
      }
    };
  }

  broadcast(sessionId, event) {
    const listeners = this.activeSubscribers.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error('[jcodeService] Broadcast listener error:', err);
        }
      }
    }
  }

  getWorkspaceTree(dir = this.workspaceDir, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const nodes = [];

      for (const entry of entries) {
        if (IGNORED_WORKSPACE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.workspaceDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          nodes.push({
            name: entry.name,
            path: relPath,
            type: 'directory',
            children: this.getWorkspaceTree(fullPath, depth + 1, maxDepth),
          });
        } else if (entry.isFile()) {
          nodes.push({
            name: entry.name,
            path: relPath,
            type: 'file',
          });
        }
      }

      return nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });
    } catch {
      return [];
    }
  }

  readWorkspaceFile(relPath) {
    const fullPath = path.resolve(this.workspaceDir, relPath);
    if (!fullPath.startsWith(path.resolve(this.workspaceDir))) {
      throw new Error('Access denied: path outside workspace.');
    }
    if (!fs.existsSync(fullPath)) {
      throw new Error('File not found.');
    }
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_FILE_PREVIEW_BYTES) {
      throw new Error(`File exceeds ${(MAX_FILE_PREVIEW_BYTES / (1024 * 1024)).toFixed(0)}MB preview limit.`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    return {
      path: relPath,
      name: path.basename(relPath),
      extension: path.extname(relPath),
      size_formatted: `${(stat.size / 1024).toFixed(1)} KB`,
      lines_count: lines.length,
      content,
    };
  }
}

export const jcodeService = new JcodeService();
