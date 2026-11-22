#!/usr/bin/env node
import { CodexRpc } from '../src/rpc.js';
import { quotaWindows } from '../src/quota.js';
import { safeError } from '../src/util.js';

const [action = 'help', ...args] = process.argv.slice(2);
if (!['doctor', 'quota', 'help'].includes(action) || action === 'help') {
  console.log('dsh-codex-bridge doctor|quota [--codex-path ABSOLUTE_PATH]\nInstall the package in DSH for task control and QQ notifications.');
  if (action !== 'help') process.exitCode = 1;
} else {
  const at = args.indexOf('--codex-path');
  const rpc = new CodexRpc({ codexPath: at >= 0 ? args[at + 1] : '' });
  try {
    await rpc.connect();
    if (action === 'quota') console.log(JSON.stringify({ checkedAt: new Date().toISOString(), windows: quotaWindows(await rpc.request('account/rateLimits/read')) }, null, 2));
    else {
      const account = await rpc.request('account/read', { refreshToken: false });
      console.log(JSON.stringify({ connected: true, executable: rpc.executable,
        accountType: account.account?.type || null, plan: account.account?.planType || null,
        requiresOpenaiAuth: account.requiresOpenaiAuth ?? null }, null, 2));
    }
  } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
  finally { await rpc.close(); }
}
