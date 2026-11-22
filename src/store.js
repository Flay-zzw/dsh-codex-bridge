import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'state.json');
    this.queue = Promise.resolve();
    this.state = { version: 1, tasks: [], subscriptions: [], quota: null, outbox: [], notices: [] };
  }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.lock = path.join(this.directory, '.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.handle = await open(this.lock, 'wx', 0o600);
        await this.handle.writeFile(String(process.pid));
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pid = Number(await readFile(this.lock, 'utf8'));
        if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid bridge lock; inspect it before removing');
        try { process.kill(pid, 0); throw new Error('Another bridge instance is using this data directory'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
        await unlink(this.lock);
      }
    }
    if (!this.handle) throw new Error('Could not acquire bridge state lock');
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !['tasks', 'subscriptions', 'outbox', 'notices'].every(key => Array.isArray(saved[key]))) throw new Error('Unsupported or corrupt bridge state');
      this.state = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') { await this.close(); throw error; }
    }
    return this;
  }

  save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const operation = this.queue.then(async () => {
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, this.file);
      } catch (error) { await unlink(tmp).catch(() => {}); throw error; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async close() {
    await this.queue;
    if (this.handle) { await this.handle.close(); this.handle = null; await unlink(this.lock); }
  }
}
