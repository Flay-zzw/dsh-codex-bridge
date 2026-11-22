import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Bridge } from '../src/bridge.js';
import { Store } from '../src/store.js';
import { quotaEvents, quotaWindows } from '../src/quota.js';
import { authorizeQQ, QQSender, resolveQQPeer } from '../src/qq.js';
import { discoverCodex } from '../src/discover.js';

const local = { sessionId: 'owner-a' };
const remote = { sessionId: 'qq-session', qq: { appId: 'app', scope: 'c2c', targetId: 'person' } };
class MockRpc extends EventEmitter {
  constructor() { super(); this.ready = true; this.calls = []; this.replies = []; this.thread = 0; this.turn = 0; }
  async connect() {}
  async close() {}
  reply(id, result) { this.replies.push({ id, result }); }
  reject(id) { this.replies.push({ id, error: true }); }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${++this.thread}` } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turn}` } };
    if (method === 'thread/read') return { thread: { turns: [] } };
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: Math.floor(Date.now()/1000) + 3600 } } };
    return {};
  }
}
async function setup(t, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-codex-test-'));
  const project = path.join(dir, 'project'); await mkdir(project);
  const rpc = new MockRpc(); const sent = [];
  const bridge = new Bridge({ dataDirectory: path.join(dir, 'data'), rpc,
    config: { allowedRoots: [project], ...overrides }, deliver: async (target, message) => { sent.push({ target, message }); return { delivered:true }; } });
  await bridge.init({ monitor: false });
  t.after(async () => { await bridge.close(); await rm(dir, { recursive: true, force: true }); });
  return { bridge, rpc, project, dir, sent };
}

test('quota windows use multi-bucket data and tolerate absent windows', () => {
  const rows = quotaWindows({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 23, windowDurationMins: 300 }, secondary: null },
    another: { secondary: { usedPercent: 48, resetsAt: null } },
  } });
  assert.equal(rows.length, 2); assert.equal(rows[0].remainingPercent, 77); assert.equal(rows[1].resetsAt, null);
});
test('no initial recovery alert; upcoming reset and observed recovery have distinct keys', () => {
  const now = Date.now(), settings = { remindBeforeHours:24, remindRemainingPercent:30, recoveryDropPercent:10 };
  const current = { windows: [{ key:'codex:secondary', bucket:'codex', windowDurationMins:10080, usedPercent:20, remainingPercent:80, resetsAt:now/1000 + 3600 }] };
  assert.deepEqual(quotaEvents(null, current, settings, now).map(item=>item.kind), ['quota-reminder']);
  const previous = { windows: [{ ...current.windows[0], usedPercent:65, remainingPercent:35 }] };
  assert.equal(quotaEvents(previous, current, settings, now).length, 2);
});
test('tasks require a configured project and cannot be read by another conversation', async t => {
  const { bridge, rpc, project, dir } = await setup(t);
  await assert.rejects(bridge.start({ cwd:dir, prompt:'test' }, local), /outside allowedRoots/);
  const task = await bridge.start({ cwd:project, prompt:'inspect source' }, local);
  assert.equal(task.status, 'running');
  assert.equal(rpc.calls.find(call=>call.method==='thread/start').params.sandbox, 'read-only');
  assert.throws(()=>bridge.task(task.id,{sessionId:'other'}), /not found/);
  assert.equal(bridge.list({sessionId:'other'}).length, 0);
});
test('concurrent task limit is reserved before Codex is called', async t => {
  const { bridge, project } = await setup(t);
  const results = await Promise.allSettled([bridge.start({cwd:project,prompt:'first'}, local), bridge.start({cwd:project,prompt:'second'}, {sessionId:'b'})]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length, 1);
});
test('completion keeps final output and sends one notification', async t => {
  const { bridge, rpc, project, sent } = await setup(t);
  const task = await bridge.start({ cwd:project, prompt:'inspect' }, remote);
  rpc.emit('notification',{method:'item/completed',params:{threadId:task.threadId,turnId:'turn-1',item:{type:'agentMessage',text:'Done: 2 findings'}}});
  rpc.emit('notification',{method:'turn/completed',params:{threadId:task.threadId,turn:{id:'turn-1',status:'completed'}}});
  await bridge.eventQueue; await bridge.flushOutbox();
  assert.equal(bridge.task(task.id,remote).status, 'completed');
  assert.equal((await bridge.inspect(task.id,remote)).output, 'Done: 2 findings');
  assert.equal(sent.length, 1);
});
test('approval can only be answered through injected host decision; missing channel stays pending', async t => {
  const { bridge, rpc, project } = await setup(t);
  const task = await bridge.start({cwd:project,prompt:'inspect'}, local);
  await bridge.serverRequest({id:19,method:'item/commandExecution/requestApproval',params:{threadId:task.threadId,command:'npm test'}});
  assert.equal(bridge.task(task.id,local).status,'waiting-approval');
  await bridge.inspect(task.id,local,async reason=>{assert.match(reason,/npm test/);return 'allowed-once';});
  assert.deepEqual(rpc.replies.pop(),{id:19,result:{decision:'accept'}});
  await bridge.serverRequest({id:20,method:'item/fileChange/requestApproval',params:{threadId:task.threadId,reason:'write'}});
  const status = await bridge.inspect(task.id,local);
  assert.match(status.approvalNotice,/不可用/);
  assert.equal(bridge.pendingApprovals.size,1);
  await bridge.inspect(task.id,local,async()=> 'rejected');
  assert.deepEqual(rpc.replies.pop(),{id:20,result:{decision:'decline'}});
});
test('unsupported interaction receives an explicit error instead of hanging', async t => {
  const { bridge,rpc,project } = await setup(t);
  const task = await bridge.start({cwd:project,prompt:'inspect'},local);
  await bridge.serverRequest({id:3,method:'item/tool/requestUserInput',params:{threadId:task.threadId}});
  assert.deepEqual(rpc.replies.pop(),{id:3,error:true});
});
test('stop interrupts the recorded turn and does not mark an unacknowledged stop completed', async t => {
  const {bridge,rpc,project}=await setup(t);
  const task=await bridge.start({cwd:project,prompt:'inspect'},local);
  const result=await bridge.stop(task.id,local);
  assert.equal(result.status,'stopping');
  assert.deepEqual(rpc.calls.at(-1),{method:'turn/interrupt',params:{threadId:task.threadId,turnId:'turn-1'}});
});
test('subscription is durable, deduplicated and failed notifications remain observable', async t => {
  const {bridge,sent}=await setup(t);
  await bridge.subscribe(remote,true); await bridge.quota(); await bridge.quota(); await bridge.flushOutbox();
  assert.equal(sent.length,1);
  bridge.deliver=async()=>{throw new Error('QQ permission denied');};
  await bridge.notice('other',remote.qq,'test'); await bridge.flushOutbox();
  const item=bridge.store.state.outbox.at(-1);
  assert.equal(item.status,'pending'); assert.match(item.error,/permission denied/);
  assert.equal(JSON.parse(await readFile(bridge.store.file,'utf8')).subscriptions.length,1);
});
test('state lock prevents two writers and active tasks are not replayed on restart', async t => {
  const {bridge,project}=await setup(t);
  const second=new Store(bridge.store.directory);
  await assert.rejects(second.init(),/Another bridge/);
  await bridge.start({cwd:project,prompt:'inspect'},local);
  // Simulate the saved state left by an abrupt exit without double-closing the fixture.
  const saved=JSON.parse(await readFile(bridge.store.file,'utf8'));
  assert.equal(saved.tasks[0].status,'running');
  assert.equal(saved.version,1);
});
test('QQ requires private allowlisted identity and platform allowlist cannot be bypassed', () => {
  const creds={config:{}};
  assert.throws(()=>authorizeQQ(remote.qq,creds,[]),/allowlist/);
  authorizeQQ(remote.qq,creds,['person']);
  assert.throws(()=>authorizeQQ({...remote.qq,scope:'group'},creds,['person']),/private/);
  assert.throws(()=>authorizeQQ(remote.qq,{config:{access:{c2cMode:'allowlist',c2cAllow:[]}}},['person']),/dsh-qqbot/);
});
test('QQ identity comes from persisted session mapping, not model-supplied target', async t => {
  const {dir}=await setup(t); const prefs=path.join(dir,'prefs.json');
  await writeFile(prefs,JSON.stringify({sessionIds:{'qqbot:app:c2c:person':'qq-session'}}));
  assert.deepEqual(await resolveQQPeer('qq-session',prefs),remote.qq);
  assert.equal(await resolveQQPeer('desktop',prefs),null);
});
test('QQ HTTP adapter sends only to fixed official endpoints and never echoes credentials on errors', async () => {
  const requests=[];
  const sender=new QQSender(()=>({appId:'app',clientSecret:'never-log-this'}),{fetch:async(url,options)=>{
    requests.push({url,options});
    if (url.endsWith('getAppAccessToken')) return {ok:true,status:200,json:async()=>({access_token:'token-secret',expires_in:7200})};
    return {ok:false,status:403,json:async()=>({code:112000,msg:'never-log-this'})};
  }});
  await assert.rejects(sender.send(remote.qq,'notice'),error=>!error.message.includes('never-log-this')&&/403/.test(error.message));
  assert.equal(requests[1].url,'https://api.bot.qq.com/v2/users/person/messages');
  assert.equal(JSON.parse(requests[1].options.body).msg_type,0);
  assert.equal(requests[1].options.redirect,'error');
});
test('long-window defaults suppress short-window reminder and recovery noise', () => {
  const row={key:'codex:primary',bucket:'codex',usedPercent:5,remainingPercent:95,windowDurationMins:300,resetsAt:Date.now()/1000+3600};
  const previous={windows:[{...row,usedPercent:80,remainingPercent:20}]};
  const options={remindBeforeHours:24,remindRemainingPercent:30,recoveryDropPercent:10,notifyMinWindowMins:1440};
  assert.equal(quotaEvents(previous,{windows:[row]},options).length,0);
  assert.equal(quotaEvents(previous,{windows:[row]},{...options,notifyMinWindowMins:0}).length,2);
});
test('unsubscribe cancels pending quota notifications', async t=>{
  const {bridge}=await setup(t);
  await bridge.subscribe(remote,true); await bridge.quota();
  await bridge.subscribe(remote,false);
  assert.equal(bridge.store.state.outbox[0].status,'cancelled');
  assert.equal(bridge.store.state.subscriptions.length,0);
});
test('continue accepts new completion before turn/start response and ignores the previous turn', async t=>{
  const {bridge,rpc,project}=await setup(t);
  const task=await bridge.start({cwd:project,prompt:'inspect'},local);
  await bridge.notification({method:'turn/completed',params:{threadId:task.threadId,turn:{id:'turn-1',status:'completed'}}});
  const request=rpc.request.bind(rpc);
  rpc.request=async(method,params)=>{
    if(method==='turn/start') {
      rpc.emit('notification',{method:'turn/completed',params:{threadId:task.threadId,turn:{id:'turn-2',status:'completed'}}});
      await bridge.eventQueue;
    }
    return request(method,params);
  };
  const continued=await bridge.continue(task.id,'follow-up',local);
  assert.equal(continued.status,'completed');
  await bridge.notification({method:'turn/completed',params:{threadId:task.threadId,turn:{id:'turn-1',status:'failed'}}});
  assert.equal(bridge.task(task.id,local).status,'completed');
});
test('persisted active tasks become interrupted without sending any new model turn', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-codex-restart-'));
  let bridge;
  try {
    const store=await new Store(dir).init();
    store.state.tasks.push({id:'old',owner:'session:owner-a',status:'running',threadId:'old-thread'});
    store.state.outbox.push({id:'sending',status:'sending'});
    await store.save();await store.close();
    const rpc=new MockRpc();
    bridge=new Bridge({dataDirectory:dir,rpc});await bridge.init({monitor:false});
    assert.equal(bridge.store.state.tasks[0].status,'interrupted');
    assert.equal(bridge.store.state.outbox[0].status,'unknown');
    assert.equal(rpc.calls.length,0);
  } finally {
    await bridge?.close();
    assert.equal(path.dirname(dir),os.tmpdir());
    await rm(dir,{recursive:true,force:true});
  }
});
test('Codex executable discovery handles paths with spaces without invoking a shell', async t=>{
  const {dir}=await setup(t);const filename=path.join(dir,'mock codex.js');
  await writeFile(filename,'');
  const executable=await discoverCodex(filename);
  assert.equal(executable.command,process.execPath);assert.deepEqual(executable.args,[filename]);
  await assert.rejects(discoverCodex(path.join(dir,'missing.exe')),/ENOENT/);
});
test('uncertain turn/start reserves its slot until status reconciliation', async t=>{
  const {bridge,rpc,project}=await setup(t);
  const request=rpc.request.bind(rpc);
  rpc.request=async(method,params)=>{if(method==='turn/start')throw new Error('Response timed out');return request(method,params);};
  await assert.rejects(bridge.start({cwd:project,prompt:'inspect'},local),/timed out/);
  const task=bridge.list(local)[0];assert.equal(task.status,'uncertain');
  await assert.rejects(bridge.start({cwd:project,prompt:'next'},local),/limit reached/);
  assert.equal((await bridge.inspect(task.id,local)).status,'failed');
});
