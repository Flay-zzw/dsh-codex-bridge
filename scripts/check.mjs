import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else if (/\.[cm]?js$/.test(item.name)) {
      const result = spawnSync(process.execPath, ['--preserve-symlinks-main', '--check', file], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
      if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Syntax check failed: ${file}`);
      count++;
    } else if (item.name.endsWith('.json')) JSON.parse(await readFile(file, 'utf8'));
  }
}
await walk(root);
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
for (const file of ['index.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'LICENSE']) await stat(path.join(root, file));
if (manifest.dsh.bundle.patch !== './cordis.patch.yml') throw new Error('Invalid DSH bundle entry');
console.log(`Validated manifest, locales, resources and ${count} JavaScript files.`);
