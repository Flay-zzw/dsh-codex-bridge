import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export function bounded(value, max = 12000) {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) + '\n[truncated]' : text;
}

export function safeError(error) {
  return bounded(error?.message || 'Operation failed', 1200)
    .replace(/Bearer\s+\S+|QQBot\s+\S+/gi, '[redacted]')
    .replace(/("?(?:access_token|refresh_token|appSecret|client_secret)"?\s*[:=]\s*)"?[^"\s,}]+/gi, '$1[redacted]');
}

export function text(value, name, max = 32000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}

export async function projectPath(requested, roots) {
  if (!path.isAbsolute(requested || '')) throw new Error('Project directory must be absolute');
  const target = await realpath(requested);
  if (!(await stat(target)).isDirectory()) throw new Error('Project directory is not a directory');
  for (const root of roots) {
    if (!path.isAbsolute(root)) continue;
    const canonical = await realpath(root);
    const relative = path.relative(canonical, target);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return target;
  }
  throw new Error('Project is outside allowedRoots. Add this project in the plugin settings first.');
}

export function ownerId(caller) {
  return caller.qq ? `qq:${caller.qq.appId}:${caller.qq.targetId}` : `session:${text(caller.sessionId, 'session id', 256)}`;
}
