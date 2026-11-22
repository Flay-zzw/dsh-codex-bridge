import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { discoverCodex, codexEnvironment } from './discover.js';
import { bounded, safeError } from './util.js';

export class CodexRpc extends EventEmitter {
  constructor(options = {}) {
    super(); this.options = options; this.sequence = 0; this.pending = new Map(); this.generation = 0;
    this.on('error', () => {});
  }

  async connect() {
    if (this.child && this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async open() {
    const executable = await discoverCodex(this.options.codexPath);
    this.executable = executable.path;
    const child = spawn(executable.command, [...executable.args, 'app-server', '--listen', 'stdio://'], {
      cwd: this.options.cwd, env: codexEnvironment(this.options.env), windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    this.child = child; this.ready = false; this.generation++;
    this.stderr = '';
    child.stderr.on('data', data => { this.stderr = bounded(this.stderr + data.toString(), 4000); });
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => {
      if (line.length > 8 * 1024 * 1024) { child.kill(); return; }
      let message;
      try { message = JSON.parse(line); } catch { this.emit('error', new Error('Invalid app-server JSON')); return; }
      if (message.id !== undefined && !message.method) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer); this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(safeError(message.error)));
        else entry.resolve(message.result);
      } else if (message.method && message.id !== undefined) this.emit('request', message);
      else if (message.method) this.emit('notification', message);
    });
    const closed = error => {
      if (this.child !== child) return;
      this.ready = false; this.child = null;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      this.pending.clear();
      this.emit('disconnect', error);
    };
    child.once('error', error => closed(new Error(`Cannot start Codex: ${safeError(error)}`)));
    child.once('exit', code => closed(new Error(`Codex app-server exited (${code ?? 'signal'})${this.stderr.trim() ? ': ' + safeError({message:this.stderr.trim()}) : ''}`)));
    child.stdin.on('error', error => this.emit('error', error));
    try {
      this.serverInfo = await this.raw('initialize', { clientInfo: { name: 'dsh_codex_bridge', title: 'DSH Codex bridge', version: '0.1.0' } });
      this.send({ method: 'initialized' }); this.ready = true;
    } catch (error) { child.kill(); throw error; }
  }

  send(message) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Codex app-server is disconnected');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  raw(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, this.options.timeoutMs || 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async request(method, params = {}) { await this.connect(); return this.raw(method, params); }
  reply(id, result) { this.send({ id, result }); }
  reject(id, message = 'Unsupported request in dsh-codex-bridge v0.1') { this.send({ id, error: { code: -32601, message } }); }

  async close() {
    const child = this.child;
    if (!child) return;
    const ended = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 1500);
    await ended; clearTimeout(timer); this.lines?.close();
  }
}
