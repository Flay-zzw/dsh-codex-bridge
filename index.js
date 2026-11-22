import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Bridge, defaults } from './src/bridge.js';
import { authorizeQQ, qqCredentials, QQSender, resolveQQPeer } from './src/qq.js';
import { ownerId, safeError } from './src/util.js';

export const name = 'codex-bridge';
export const inject = ['tools', 'configEditor', 'profileContext'];
export const Config = z.object({
  codexPath: z.string().default('').description('Codex 路径：留空自动检测；也可填写 codex.exe 或 codex.js 的完整路径。'),
  allowedRoots: z.array(z.string()).default([]).description('允许的项目目录：填写完整路径，运行任务前必须至少设置一个。'),
  writable: z.boolean().default(false).description('允许修改项目：默认关闭（只读）。修复代码时需要开启，使用 workspace-write 沙箱。'),
  pollMinutes: z.number().min(1).max(1440).default(10).description('额度检查间隔（分钟）；检查本身不会启动模型任务。'),
  remindBeforeHours: z.number().min(0.1).max(168).default(24).description('重置前多少小时提醒，默认 24 小时。'),
  remindRemainingPercent: z.number().min(0).max(100).default(30).description('重置前提醒所需的最低剩余额度百分比。'),
  recoveryDropPercent: z.number().min(1).max(100).default(10).description('已用比例下降多少个百分点时，通知额度恢复。'),
  notifyMinWindowMins: z.number().min(0).max(10080).default(1440).description('通知窗口最短长度（分钟）：默认 1440，跳过 5 小时等短窗口；设为 0 包含全部窗口。'),
  notifyRecovery: z.boolean().default(true).description('额度恢复时通知已订阅用户。'),
  maxConcurrentTasks: z.number().min(1).max(4).default(1).description('同时运行的 Codex 任务数量上限。'),
  qqAllowedUsers: z.array(z.string()).default([]).description('可控制 Codex 的 QQ 机器人 OpenID（不是 QQ 号码）。在 QQ 私聊查询 Codex 连接可获得；也可复用 QQ 插件已有的私聊白名单。'),
});

const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

export async function apply(ctx, config) {
  const effective = { ...defaults, ...config };
  const sender = new QQSender(appId => {
    const creds = qqCredentials(ctx, appId);
    return creds;
  });
  const bridge = new Bridge({ config: effective, dataDirectory: path.join(ctx.profileContext.dir, 'data', 'dsh-codex-bridge'),
    deliver: async (target, message) => {
      authorizeQQ(target, qqCredentials(ctx, target.appId), effective.qqAllowedUsers);
      return sender.send(target, message);
    } });
  const ready = bridge.init();
  ctx.effect(() => () => ready.then(() => bridge.close()));
  await ready;

  async function caller(exec) {
    exec.signal?.throwIfAborted();
    const sessionId = exec.agent?.session?.id;
    if (!sessionId) throw new Error('This tool requires a dsh conversation');
    const qq = await resolveQQPeer(sessionId);
    if (qq) authorizeQQ(qq, qqCredentials(ctx, qq.appId), effective.qqAllowedUsers);
    return { sessionId, qq };
  }

  function tool(definition) {
    ctx.effect(() => ctx.tools.register(defineTool({ ...definition, output,
      async execute(args, exec) {
        try { return await definition.run(args, exec, await caller(exec)); }
        catch (error) { return { ok: false, error: safeError(error) }; }
      },
    })));
  }

  tool({ name: 'codex_bridge', description: 'Check local Codex connectivity and project settings, or read current subscription limit percentages and reset timestamps. Quota checks do not start a model turn.',
    parameters: { action: { type: 'string', required: true, enum: ['doctor', 'quota', 'projects'] } },
    async run(args) {
      if (args.action === 'doctor') return { ...await bridge.doctor(), approvalChannelAvailable: Boolean(ctx.get('approval')) };
      if (args.action === 'quota') return bridge.quota();
      if (args.action === 'projects') return { allowedRoots: effective.allowedRoots, writable: effective.writable };
      throw new Error('Unknown action');
    },
  });

  tool({ name: 'codex_task', description: 'Start, continue, inspect, list or stop a background Codex coding task. Start work only at the user’s request. Tasks use configured project directories and sandbox permissions. Status/output may ask the user to decide pending Codex approvals through the dsh approval channel. Returned task IDs remain available after restart.',
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'continue', 'list', 'status', 'output', 'stop'] },
      task_id: { type: 'string', description: 'Required for continue, status, output and stop.' },
      cwd: { type: 'string', description: 'Absolute project directory; required for start and must be within allowedRoots.' },
      prompt: { type: 'string', description: 'User-authorized work instruction; required for start and continue.' },
      title: { type: 'string', description: 'Optional short task title for start, at most 120 characters.' },
      model: { type: 'string', description: 'Optional Codex model ID for start. Omit to use the local default.' },
    },
    async run(args, exec, who) {
      if (args.action === 'list') return { tasks: bridge.list(who) };
      if (args.action === 'start') return bridge.start(args, who);
      if (args.action === 'continue') return bridge.continue(args.task_id, args.prompt, who);
      if (args.action === 'stop') return bridge.stop(args.task_id, who);
      if (args.action === 'status' || args.action === 'output') {
        const approval = ctx.get('approval');
        const approve = approval ? reason => approval.request({ agent: exec.agent, toolName: 'codex_task', callId: exec.callId,
          reason: `Codex 请求一次性批准：\n${reason}`, signal: AbortSignal.any([exec.signal, AbortSignal.timeout(300000)]) }) : null;
        return bridge.inspect(args.task_id, who, approve);
      }
      throw new Error('Unknown action');
    },
  });

  tool({ name: 'codex_notifications', description: 'Subscribe or unsubscribe the current authorized QQ private chat to Codex quota reminders; test proactive delivery or view delivery status. Subscribe only at the user’s request. This does not change QQ account binding or access policies.',
    parameters: { action: { type: 'string', required: true, enum: ['subscribe', 'unsubscribe', 'test', 'status'] } },
    async run(args, _exec, who) {
      if (args.action === 'subscribe') return bridge.subscribe(who, true);
      if (args.action === 'unsubscribe') return bridge.subscribe(who, false);
      if (args.action === 'test') return bridge.testNotification(who);
      if (args.action !== 'status') throw new Error('Unknown action');
      const owner = ownerId(who);
      return { subscribed: bridge.store.state.subscriptions.some(item => item.owner === owner),
        deliveries: bridge.store.state.outbox.filter(item => item.key.startsWith(`${owner}:`) || (who.qq && item.target.appId === who.qq.appId && item.target.targetId === who.qq.targetId))
          .slice(-10).map(item => ({ id: item.id, status: item.status, attempts: item.attempts, error: item.error || null })) };
    },
  });
}
