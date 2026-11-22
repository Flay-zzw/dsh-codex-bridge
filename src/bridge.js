import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { CodexRpc } from './rpc.js';
import { quotaWindows, quotaEvents } from './quota.js';
import { bounded, ownerId, projectPath, safeError, text } from './util.js';

export const defaults = {
  codexPath: '', allowedRoots: [], writable: false, pollMinutes: 10,
  remindBeforeHours: 24, remindRemainingPercent: 30, recoveryDropPercent: 10,
  notifyRecovery: true, notifyMinWindowMins: 1440, maxConcurrentTasks: 1, qqAllowedUsers: [],
};
const ACTIVE = new Set(['starting', 'running', 'waiting-approval', 'stopping', 'uncertain']);
const APPROVALS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);

export class Bridge extends EventEmitter {
  constructor(options) {
    super(); this.config = { ...defaults, ...options.config };
    this.store = options.store || new Store(options.dataDirectory);
    this.rpc = options.rpc || new CodexRpc({ codexPath: this.config.codexPath, cwd: options.cwd });
    this.deliver = options.deliver || (async () => { throw new Error('No notification adapter'); });
    this.pendingApprovals = new Map(); this.locks = new Set(); this.closed = false;
    this.lastError = null; this.eventQueue = Promise.resolve();
  }

  async init({ monitor = true } = {}) {
    await this.store.init();
    // Do not silently restart work after a process restart. Explicit continue reattaches.
    for (const task of this.store.state.tasks) if (ACTIVE.has(task.status)) { task.status = 'interrupted'; task.error = 'Bridge restarted; use continue to resume.'; }
    for (const item of this.store.state.outbox) if (item.status === 'sending') { item.status = 'unknown'; item.error = 'Process restarted during delivery; not automatically resent.'; }
    await this.store.save();
    this.onNotification = message => this.enqueue(() => this.notification(message));
    this.onRequest = message => this.enqueue(() => this.serverRequest(message));
    this.onDisconnect = error => this.enqueue(async () => {
      if (this.closed) return;
      for (const task of this.store.state.tasks) if (ACTIVE.has(task.status)) {
        task.status = 'interrupted'; task.error = safeError(error);
        await this.noticeTask(task, 'interrupted');
      }
      this.clearApprovals(); await this.store.save();
    });
    this.rpc.on('notification', this.onNotification); this.rpc.on('request', this.onRequest); this.rpc.on('disconnect', this.onDisconnect);
    if (monitor) {
      this.timer = setInterval(() => { void this.poll().catch(error => { this.lastError = safeError(error); }); }, this.config.pollMinutes * 60000);
      this.timer.unref?.();
      void this.poll().catch(error => { this.lastError = safeError(error); });
    }
    return this;
  }

  enqueue(operation) {
    this.eventQueue = this.eventQueue.then(operation).catch(error => { this.lastError = safeError(error); this.emit('diagnostic', this.lastError); });
    return this.eventQueue;
  }

  async quota() {
    const result = await this.rpc.request('account/rateLimits/read');
    const next = { checkedAt: new Date().toISOString(), windows: quotaWindows(result) };
    if (!next.windows.length) throw new Error('The account returned no subscription limits. Sign in to Codex with ChatGPT.');
    const events = quotaEvents(this.store.state.quota, next, this.config);
    this.store.state.quota = next;
    for (const event of events) {
      if (event.kind === 'quota-recovered' && !this.config.notifyRecovery) continue;
      for (const subscription of this.store.state.subscriptions) await this.notice(`${subscription.owner}:${event.key}`, subscription.target, event.text);
    }
    await this.store.save();
    return next;
  }

  poll() {
    if (this.closed) return Promise.resolve();
    if (this.pollOperation) return this.pollOperation;
    this.pollOperation = (async () => {
      try { await this.quota(); this.lastError = null; }
      finally { await this.flushOutbox(); }
    })().finally(() => { this.pollOperation = null; });
    return this.pollOperation;
  }

  async notice(key, target, message) {
    if (!target || this.store.state.notices.includes(key)) return;
    this.store.state.notices.push(key);
    this.store.state.notices = this.store.state.notices.slice(-2000);
    this.store.state.outbox.push({ id: randomUUID(), key, target, message: bounded(message, 1800), status: 'pending', attempts: 0, createdAt: Date.now(), nextAttempt: 0 });
    this.store.state.outbox = this.store.state.outbox.slice(-200);
    await this.store.save();
  }

  flushOutbox() {
    if (this.closed) return Promise.resolve();
    if (this.flushOperation) return this.flushOperation;
    this.flushOperation = (async () => {
      for (const item of this.store.state.outbox) {
        if (item.status !== 'pending' || item.nextAttempt > Date.now()) continue;
        item.status = 'sending'; item.attempts++; await this.store.save();
        try { await this.deliver(item.target, item.message); item.status = 'delivered'; item.deliveredAt = Date.now(); delete item.error; }
        catch (error) {
          item.error = safeError(error);
          item.status = item.attempts >= 3 ? 'failed' : 'pending';
          item.nextAttempt = Date.now() + item.attempts * 600000;
        }
        await this.store.save();
      }
    })().finally(() => { this.flushOperation = null; });
    return this.flushOperation;
  }

  async subscribe(caller, active) {
    const owner = ownerId(caller);
    this.store.state.subscriptions = this.store.state.subscriptions.filter(item => item.owner !== owner);
    if (!active) for (const item of this.store.state.outbox) {
      if (item.key.startsWith(`${owner}:`) && item.status === 'pending') item.status = 'cancelled';
    }
    if (active) {
      if (!caller.qq) throw new Error('Subscribe from your authorized QQ private chat so the notification target can be identified');
      this.store.state.subscriptions.push({ owner, target: caller.qq });
    }
    await this.store.save();
    return { subscribed: active, quota: this.store.state.quota };
  }

  async testNotification(caller) {
    if (!caller.qq) throw new Error('Run the notification test in your authorized QQ private chat');
    return this.deliver(caller.qq, 'Codex 桥接通知测试：主动消息发送成功。');
  }

  async doctor() {
    let codex;
    try {
      await this.rpc.connect();
      const account = await this.rpc.request('account/read', { refreshToken: false });
      codex = { connected: true, executable: this.rpc.executable || null, accountType: account.account?.type || null, plan: account.account?.planType || null, requiresOpenaiAuth: account.requiresOpenaiAuth ?? null };
    } catch (error) { codex = { connected: false, error: safeError(error) }; }
    return { version: '0.1.0', codex, writable: this.config.writable, allowedRoots: this.config.allowedRoots,
      monitoring: { pollMinutes: this.config.pollMinutes, lastError: this.lastError },
      notificationFailures: this.store.state.outbox.filter(item => ['failed', 'unknown'].includes(item.status)).map(item => ({ id: item.id, status: item.status, error: item.error })) };
  }

  task(id, caller) {
    const task = this.store.state.tasks.find(item => item.id === id && item.owner === ownerId(caller));
    if (!task) throw new Error('Task not found for this caller');
    return task;
  }

  view(task, output = false) {
    return { id: task.id, title: task.title, cwd: task.cwd, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt,
      threadId: task.threadId || null, sandbox: task.sandbox || 'read-only', progress: task.progress || null, error: task.error || null,
      pendingApprovals: [...this.pendingApprovals.values()].filter(item => item.taskId === task.id).map(item => ({ id: item.id, reason: item.reason })),
      ...(output ? { output: bounded(task.output || '', 24000) } : {}) };
  }

  list(caller) { return this.store.state.tasks.filter(task => task.owner === ownerId(caller)).slice(-30).reverse().map(task => this.view(task)); }

  async start(args, caller) {
    const owner = ownerId(caller);
    if (this.locks.has(owner)) throw new Error('Another start/continue is in progress');
    this.locks.add(owner);
    let task;
    try {
      const cwd = await projectPath(args.cwd, this.config.allowedRoots);
      if (this.store.state.tasks.filter(item => ACTIVE.has(item.status)).length >= this.config.maxConcurrentTasks) throw new Error('Concurrent task limit reached');
      const prompt = text(args.prompt, 'prompt');
      task = { id: randomUUID(), owner, target: caller.qq || null, title: text(args.title || prompt.slice(0,70), 'title', 120),
        cwd, sandbox: this.config.writable ? 'workspace-write' : 'read-only', status: 'starting', createdAt: Date.now(), updatedAt: Date.now(), output: '', model: args.model || null };
      this.store.state.tasks.push(task); await this.store.save();
      const result = await this.rpc.request('thread/start', {
        cwd, sandbox: this.config.writable ? 'workspace-write' : 'read-only', approvalPolicy: 'on-request',
        ...(args.model ? { model: text(args.model, 'model', 150) } : {}),
      });
      task.threadId = result.thread.id;
      await this.store.save();
      const turn = await this.rpc.request('turn/start', { threadId: task.threadId, input: [{ type: 'text', text: prompt }] });
      task.turnId = turn.turn.id;
      // Completion can precede the turn/start response.
      if (task.status === 'starting') task.status = 'running';
      task.updatedAt = Date.now(); await this.store.save();
      return this.view(task);
    } catch (error) {
      if (task) {
        task.status = task.threadId && this.rpc.ready ? 'uncertain' : 'failed';
        task.error = safeError(error); await this.store.save();
      }
      throw task ? new Error(`${safeError(error)}; task ${task.id} is ${task.status}. Query task status before retrying.`) : error;
    } finally { this.locks.delete(owner); }
  }

  async continue(id, prompt, caller) {
    const task = this.task(id, caller);
    if (ACTIVE.has(task.status) || this.locks.has(task.id)) throw new Error('Task is active; inspect or stop it first');
    this.locks.add(task.id);
    const priorStatus = task.status;
    try {
      await projectPath(task.cwd, this.config.allowedRoots);
      if (this.store.state.tasks.filter(item => ACTIVE.has(item.status)).length >= this.config.maxConcurrentTasks) throw new Error('Concurrent task limit reached');
      const instruction = text(prompt, 'prompt');
      if (!task.threadId) throw new Error('This task has no resumable Codex thread');
      task.status = 'starting'; await this.store.save();
      task.sandbox = this.config.writable ? 'workspace-write' : 'read-only';
      await this.rpc.request('thread/resume', { threadId: task.threadId, cwd: task.cwd,
        sandbox: this.config.writable ? 'workspace-write' : 'read-only', approvalPolicy: 'on-request' });
      const snapshot = await this.rpc.request('thread/read', { threadId: task.threadId, includeTurns: true });
      if (snapshot.thread.turns?.some(turn => turn.status === 'inProgress')) throw new Error('Codex still has an active turn; stop it before continuing');
      task.output = ''; task.error = null; task.priorTurnId = task.turnId || null; task.turnId = null;
      task.target = caller.qq || null; task.updatedAt = Date.now(); await this.store.save();
      const result = await this.rpc.request('turn/start', { threadId: task.threadId, input: [{ type: 'text', text: instruction }] });
      task.turnId = result.turn.id; if (task.status === 'starting') task.status = 'running';
      await this.store.save(); return this.view(task);
    } catch (error) {
      if (task.status === 'starting') task.status = task.turnId === null && this.rpc.ready ? 'uncertain' : priorStatus;
      task.error = safeError(error); await this.store.save(); throw error;
    }
    finally { this.locks.delete(task.id); }
  }

  async stop(id, caller) {
    const task = this.task(id, caller);
    if (!task.threadId) throw new Error('Task has no Codex thread');
    if (!this.rpc.ready || task.status === 'interrupted') await this.rpc.request('thread/resume', { threadId: task.threadId });
    let turnId = task.turnId;
    if (!turnId || !ACTIVE.has(task.status)) {
      const result = await this.rpc.request('thread/read', { threadId: task.threadId, includeTurns: true });
      turnId = result.thread.turns?.findLast(turn => turn.status === 'inProgress')?.id;
      if (!turnId) return this.view(task);
    }
    task.status = 'stopping'; await this.store.save();
    await this.rpc.request('turn/interrupt', { threadId: task.threadId, turnId });
    for (const pending of [...this.pendingApprovals.values()]) if (pending.taskId === task.id) this.finishApproval(pending.id, 'cancel');
    return this.view(task);
  }

  async notification({ method, params = {} }) {
    if (method === 'account/rateLimits/updated') return; // Polling is authoritative across clients and multiple buckets.
    const task = this.store.state.tasks.find(item => item.threadId === params.threadId);
    if (!task) return;
    if (params.turnId && task.turnId && params.turnId !== task.turnId) return;
    if (method === 'turn/completed' && task.turnId && params.turn?.id !== task.turnId) return;
    if (method === 'item/completed') {
      const item = params.item || {};
      if (item.type === 'agentMessage') {
        task.output = bounded(`${task.output}${task.output ? '\n\n' : ''}${item.text || ''}`, 48000);
      } else task.progress = bounded(`${item.type || 'item'} completed`, 250);
    } else if (method === 'item/started') task.progress = bounded(`${params.item?.type || 'item'} running`, 250);
    else if (method === 'turn/completed') {
      task.status = params.turn?.status === 'completed' ? 'completed' : params.turn?.status === 'interrupted' ? 'interrupted' : 'failed';
      task.error = params.turn?.error ? safeError(params.turn.error) : null;
      for (const pending of [...this.pendingApprovals.values()]) if (pending.taskId === task.id) this.finishApproval(pending.id, 'cancel');
      await this.noticeTask(task, `${task.status}:${params.turn?.id || task.turnId}`);
    } else return;
    task.updatedAt = Date.now(); await this.store.save();
    void this.flushOutbox();
  }

  async noticeTask(task, suffix) {
    await this.notice(`task:${task.id}:${suffix}`, task.target,
      `Codex 任务「${task.title}」：${task.status}\n任务 ID：${task.id}\n${bounded(task.output || task.error || task.progress || '', 1000)}`);
  }

  async serverRequest(message) {
    const task = this.store.state.tasks.find(item => item.threadId === message.params?.threadId);
    if (!task || !APPROVALS.has(message.method)) {
      this.rpc.reject(message.id);
      if (task) { task.progress = `Unsupported interactive request: ${message.method}`; await this.noticeTask(task, `unsupported:${message.id}`); void this.flushOutbox(); }
      return;
    }
    const id = randomUUID();
    const reason = bounded([message.params.reason, message.params.command, message.params.cwd].filter(Boolean).join('\n') || message.method, 2500);
    const timer = setTimeout(() => { void this.enqueue(async () => {
      this.finishApproval(id, 'decline'); task.status = 'running'; task.progress = 'Approval timed out and was declined'; await this.store.save();
    }); }, 600000);
    this.pendingApprovals.set(id, { id, rpcId: message.id, taskId: task.id, reason, timer });
    task.status = 'waiting-approval'; task.progress = reason;
    await this.notice(`approval:${id}`, task.target,
      `Codex 任务「${task.title}」需要确认：\n${bounded(reason, 1000)}\n请回复“查看 Codex 任务 ${task.id}”，再通过审批按钮决定。10 分钟未处理将拒绝。`);
    await this.store.save(); void this.flushOutbox();
  }

  finishApproval(id, decision) {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer); this.pendingApprovals.delete(id);
    try { this.rpc.reply(pending.rpcId, { decision }); } catch {}
    return true;
  }

  async inspect(id, caller, approve) {
    const task = this.task(id, caller);
    if (task.status === 'uncertain') {
      if (!this.rpc.ready) await this.rpc.request('thread/resume', { threadId: task.threadId });
      const result = await this.rpc.request('thread/read', { threadId: task.threadId, includeTurns: true });
      const candidate = result.thread.turns?.at(-1);
      const latest = candidate?.id === task.priorTurnId ? null : candidate;
      if (latest) {
        task.turnId = latest.id;
        task.status = latest.status === 'inProgress' ? 'running' : latest.status === 'completed' ? 'completed' : latest.status === 'interrupted' ? 'interrupted' : 'failed';
        const messages = (latest.items || []).filter(item => item.type === 'agentMessage').map(item => item.text || '').join('\n\n');
        if (messages) task.output = bounded(messages, 48000);
      } else task.status = 'failed';
    }
    for (const pending of [...this.pendingApprovals.values()]) {
      if (pending.taskId !== task.id) continue;
      // The adapter only accepts a decision from DSH's human approval service.
      const outcome = approve ? await approve(pending.reason) : 'unavailable';
      if (outcome === 'unavailable') return { ...this.view(task, true), approvalNotice: '审批通道不可用；请求仍在等待，10 分钟后拒绝。请检查 dsh 审批服务和 QQ 审批通道。' };
      if (this.finishApproval(pending.id, outcome === 'allowed-once' ? 'accept' : 'decline')) task.status = 'running';
    }
    await this.store.save(); return this.view(task, true);
  }

  clearApprovals() { for (const item of this.pendingApprovals.values()) clearTimeout(item.timer); this.pendingApprovals.clear(); }

  async close() {
    this.closed = true; clearInterval(this.timer);
    for (const item of [...this.pendingApprovals.values()]) this.finishApproval(item.id, 'cancel');
    await this.rpc.close();
    await this.pollOperation?.catch(() => {}); await this.flushOperation?.catch(() => {});
    await this.eventQueue;
    for (const task of this.store.state.tasks) if (ACTIVE.has(task.status)) { task.status = 'interrupted'; task.error = 'Bridge stopped; use continue to resume'; }
    await this.store.save(); await this.store.close();
    this.rpc.off('notification', this.onNotification); this.rpc.off('request', this.onRequest); this.rpc.off('disconnect', this.onDisconnect);
  }
}
