import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { bounded } from './util.js';

// Compatibility adapter for dsh-qqbot 0.5.5. No websocket and no profile writes.
export async function resolveQQPeer(sessionId, prefsFile = path.join(os.homedir(), '.dsh-qqbot', 'model-prefs.json')) {
  let prefs;
  try { prefs = JSON.parse(await readFile(prefsFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Cannot read QQ session mapping; remote dispatch is unavailable'); }
  const matches = Object.entries(prefs.sessionIds || {}).filter(([, id]) => id === sessionId);
  if (matches.length > 1) throw new Error('Ambiguous QQ session mapping');
  if (!matches.length) return null;
  const match = /^qqbot:([^:]+):(c2c|group):([^:]+)$/.exec(matches[0][0]);
  if (!match) throw new Error('Unsupported QQ session mapping format');
  return { appId: match[1], scope: match[2], targetId: match[3] };
}

export function qqCredentials(ctx, expectedAppId) {
  const entries = ctx.configEditor.entries().filter(entry => entry.options?.name === '@tencent-connect/dsh-qqbot');
  for (const entry of entries) {
    if (entry.options.disabled) continue;
    const config = entry.options.config || {};
    const literal = value => typeof value === 'string' && value !== '__FROM_ENV__' && !value.startsWith('process.env') ? value : '';
    const appId = literal(config.appId) || process.env.QQBOT_APPID;
    const clientSecret = literal(config.appSecret) || process.env.QQBOT_SECRET;
    if (appId === expectedAppId && typeof clientSecret === 'string' && clientSecret && !clientSecret.includes('${')) {
      return { appId, clientSecret, config };
    }
  }
  throw new Error('Matching QQ bot credentials are unavailable. Bind dsh-qqbot first.');
}

export function authorizeQQ(peer, credentials, allowedUsers) {
  if (peer.scope !== 'c2c') throw new Error('v0.1 enables Codex control in QQ private chats only');
  const access = credentials.config.access || {};
  if (access.c2cMode === 'disabled') throw new Error('QQ private access is disabled');
  const allowed = new Set(allowedUsers || []);
  if (access.c2cMode === 'allowlist') {
    if (!(access.c2cAllow || []).includes(peer.targetId)) throw new Error('QQ user is not allowed by dsh-qqbot');
    allowed.add(peer.targetId);
  }
  if (!allowed.has(peer.targetId)) throw new Error(`QQ remote access requires an allowlist. Add your OpenID in the desktop plugin settings: ${peer.targetId}`);
}

export class QQSender {
  constructor(credentials, options = {}) {
    this.credentials = credentials;
    this.fetch = options.fetch || globalThis.fetch;
    this.cache = new Map(); this.pending = new Map();
  }

  async token(creds) {
    const cached = this.cache.get(creds.appId);
    if (cached && cached.secret === creds.clientSecret && cached.expires > Date.now() + 60000) return cached.token;
    if (this.pending.has(creds.appId)) return this.pending.get(creds.appId);
    const operation = (async () => {
      const response = await this.fetch('https://api.bot.qq.com/app/getAppAccessToken', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'User-Agent': 'dsh-codex-bridge/0.1.0' },
        body: JSON.stringify({ appId: creds.appId, clientSecret: creds.clientSecret }), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok || !data.access_token) throw new Error(`QQ token request failed (HTTP ${response.status}, code ${Number(data.code) || 'unknown'})`);
      this.cache.set(creds.appId, { token: data.access_token, secret: creds.clientSecret, expires: Date.now() + Number(data.expires_in || 7200) * 1000 });
      return data.access_token;
    })().finally(() => this.pending.delete(creds.appId));
    this.pending.set(creds.appId, operation); return operation;
  }

  async send(target, content) {
    if (target.scope !== 'c2c' || !/^[\w-]{1,256}$/.test(target.targetId)) throw new Error('Invalid QQ private notification target');
    const creds = this.credentials(target.appId);
    const token = await this.token(creds);
    const response = await this.fetch(`https://api.bot.qq.com/v2/users/${encodeURIComponent(target.targetId)}/messages`, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}`, 'User-Agent': 'dsh-codex-bridge/0.1.0' },
      body: JSON.stringify({ msg_type: 0, content: bounded(content, 1800) }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || (data.code && data.code !== 0)) {
      if (response.status === 401) this.cache.delete(target.appId);
      throw new Error(`QQ proactive delivery failed (HTTP ${response.status}, code ${Number(data.code) || 'unknown'}). Check proactive-message permission.`);
    }
    return { delivered: true, messageId: data.id || null };
  }
}
