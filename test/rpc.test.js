import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CodexRpc } from '../src/rpc.js';
test('stdio handshake, request IDs, concurrent reads and completion before response',async t=>{
  const rpc=new CodexRpc({codexPath:fileURLToPath(new URL('./fake-codex.mjs',import.meta.url)),env:{...process.env,NODE_OPTIONS:'--preserve-symlinks-main'}});
  t.after(()=>rpc.close());
  const notifications=[];rpc.on('notification',item=>notifications.push(item));
  const results=await Promise.all([rpc.request('account/rateLimits/read'),rpc.request('account/rateLimits/read')]);
  assert.equal(results[0].rateLimits.primary.usedPercent,25);
  await rpc.request('thread/start');await rpc.request('turn/start',{threadId:'thread-rpc'});
  assert.equal(notifications.at(-1).method,'turn/completed');
  assert.equal(rpc.pending.size,0);
});
