import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function discoverCodex(explicit = '', env = process.env, platform = process.platform) {
  const candidates = [];
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error('codexPath must be an absolute executable or .js path');
    candidates.push(explicit);
  } else {
    for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
      candidates.push(path.join(dir, platform === 'win32' ? 'codex.exe' : 'codex'));
      if (platform === 'win32') candidates.push(path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    }
    if (platform === 'win32' && env.LOCALAPPDATA) {
      const root = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
      const versions = await readdir(root, { withFileTypes: true }).catch(() => []);
      const paths = await Promise.all(versions.filter(item => item.isDirectory()).map(async item => {
        const file = path.join(root, item.name, 'codex.exe');
        return { file, mtime: (await stat(file).catch(() => ({}))).mtimeMs || 0 };
      }));
      candidates.push(...paths.sort((a, b) => b.mtime - a.mtime).map(item => item.file));
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      if (!(await stat(candidate)).isFile()) continue;
      if (/\.(cmd|bat|ps1)$/i.test(candidate)) throw new Error('Select codex.exe or the npm codex.js entry instead of a shell wrapper');
      return { command: /\.[cm]?js$/i.test(candidate) ? process.execPath : candidate,
        args: /\.[cm]?js$/i.test(candidate) ? [candidate] : [], path: candidate };
    } catch (error) { if (explicit) throw error; }
  }
  throw new Error('Codex CLI was not found. Install Codex CLI or set codexPath to codex.exe / codex.js.');
}

export function codexEnvironment(env = process.env) {
  const next = { ...env };
  // Electron is also a usable Node launcher for npm's codex.js.
  if (process.versions.electron) next.ELECTRON_RUN_AS_NODE = '1';
  if (!next.HOME && next.USERPROFILE) next.HOME = next.USERPROFILE;
  if (!next.HOME) { try { next.HOME = os.homedir(); } catch {} }
  return next;
}
