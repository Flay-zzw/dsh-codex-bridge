/**
 * 配置页的宿主侧：为设置页提供读取与保存配置的 HTTP 路由。
 *
 * 保存走官方 configEditor.edit()：它保留 profile patch 的其余内容（其他插件、
 * 注释、`!!js` 表达式）、校验候选值、串行化写入并热重载目标行。插件不自己重写
 * profile 的 cordis.patch.yml。
 */

import { defaults } from './bridge.js';

/** 路由路径（客户端与宿主共用的唯一来源）。 */
export const CONFIG_PATH = '/codex-bridge/config';

const MAX_BODY_BYTES = 256 * 1024;

/** 字段表：类型、范围、分组与双语文案，客户端用它渲染表单。 */
const FIELDS = [
  { key: 'codexPath', kind: 'string', group: 'codex', placeholder: 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\<hash>\\codex.exe',
    zh: { label: 'Codex 可执行文件', hint: '留空自动检测；也可填 codex.exe 或 npm 安装的 codex.js 完整路径（Windows 不接受 .cmd/.bat 包装脚本）。' },
    en: { label: 'Codex executable', hint: 'Leave empty to auto-detect, or give the full path to codex.exe or the npm codex.js (shell wrappers such as .cmd/.bat are rejected on Windows).' } },
  { key: 'allowedRoots', kind: 'stringlist', group: 'project',
    zh: { label: '允许的项目目录', hint: '每行一个绝对路径，例如 D:\\projects\\my-app。不填就无法派发任务。' },
    en: { label: 'Allowed project directories', hint: 'One absolute path per line, for example D:\\projects\\my-app. Tasks cannot start until one is set.' } },
  { key: 'writable', kind: 'boolean', group: 'project',
    zh: { label: '允许 Codex 修改代码', hint: '关闭时任务以只读沙箱运行；开启后使用 workspace-write 并保留按需审批。' },
    en: { label: 'Allow Codex to modify code', hint: 'Off runs tasks in a read-only sandbox; on uses workspace-write with on-demand approvals.' } },
  { key: 'pollMinutes', kind: 'number', min: 1, max: 1440, step: 1, group: 'quota',
    zh: { label: '额度检查间隔（分钟）', hint: '检查本身不启动模型任务。' },
    en: { label: 'Quota check interval (minutes)', hint: 'A check does not start a model turn.' } },
  { key: 'notifyMinWindowMins', kind: 'number', min: 0, max: 10080, step: 60, group: 'quota',
    zh: { label: '通知窗口最短长度（分钟）', hint: '默认 1440 只提醒至少一天的窗口；设为 0 连 5 小时窗口一起提醒。' },
    en: { label: 'Shortest window to notify (minutes)', hint: 'Default 1440 reminds only about windows of at least one day; 0 includes the 5-hour window.' } },
  { key: 'remindBeforeHours', kind: 'number', min: 0.1, max: 168, step: 0.5, group: 'quota',
    zh: { label: '重置前多少小时提醒', hint: '默认 24 小时。' },
    en: { label: 'Remind before reset (hours)', hint: 'Default 24 hours.' } },
  { key: 'remindRemainingPercent', kind: 'number', min: 0, max: 100, step: 1, group: 'quota',
    zh: { label: '提醒所需的最低剩余百分比', hint: '默认 30%。' },
    en: { label: 'Minimum remaining percent to remind', hint: 'Default 30%.' } },
  { key: 'recoveryDropPercent', kind: 'number', min: 1, max: 100, step: 1, group: 'quota',
    zh: { label: '额度恢复判定阈值（百分点）', hint: '已用比例下降多少个百分点时认为额度增加。' },
    en: { label: 'Recovery threshold (percentage points)', hint: 'How far the used percentage must drop to count as recovered quota.' } },
  { key: 'notifyRecovery', kind: 'boolean', group: 'quota',
    zh: { label: '额度恢复时通知', hint: '只报告观察到的额度增加，不断言获得了完整新周期。' },
    en: { label: 'Notify on quota recovery', hint: 'Reports observed increases only; it never claims a full new cycle.' } },
  { key: 'maxConcurrentTasks', kind: 'number', min: 1, max: 4, step: 1, group: 'task',
    zh: { label: '同时运行的任务数', hint: '默认 1。' },
    en: { label: 'Concurrent tasks', hint: 'Default 1.' } },
  { key: 'qqAllowedUsers', kind: 'stringlist', group: 'remote',
    zh: { label: '可用的 QQ OpenID', hint: '每行一个机器人用户 OpenID（不是 QQ 号）；在 QQ 私聊查询 Codex 连接可获得。留空表示只允许桌面端。' },
    en: { label: 'Allowed QQ OpenIDs', hint: 'One bot OpenID per line (not a QQ number); ask in the QQ private chat to receive it. Empty means desktop only.' } },
];

const GROUPS = [
  { id: 'codex', zh: 'Codex 连接', en: 'Codex connection' },
  { id: 'project', zh: '项目与权限', en: 'Projects and permissions' },
  { id: 'quota', zh: '额度提醒', en: 'Quota reminders' },
  { id: 'task', zh: '任务', en: 'Tasks' },
  { id: 'remote', zh: '远程控制', en: 'Remote control' },
];

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...HEADERS, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/** 只允许同源请求：带 Origin 时必须与 Host 一致（桌面 IPC 不带 Origin）。 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalize(key, value) {
  const field = FIELDS.find(item => item.key === key);
  if (!field) throw new TypeError(`未知配置项：${key}`);
  if (field.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(`${key} 必须是布尔值`);
    return value;
  }
  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} 必须是数字`);
    if (value < field.min || value > field.max) throw new TypeError(`${key} 必须在 ${field.min} 到 ${field.max} 之间`);
    return value;
  }
  if (field.kind === 'string') {
    if (typeof value !== 'string') throw new TypeError(`${key} 必须是字符串`);
    return value.trim();
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError(`${key} 必须是字符串列表`);
  return value.map(item => item.trim()).filter(Boolean);
}

/** 把提交值里与默认值相同的键摘掉，避免把默认值固化进 profile。 */
function applyPatch(current, inherited, submitted, fallback) {
  const next = { ...current };
  for (const [key, value] of Object.entries(submitted)) {
    const base = inherited && Object.hasOwn(inherited, key) ? inherited[key] : fallback[key];
    const equal = Array.isArray(value)
      ? (Array.isArray(base) && JSON.stringify(value) === JSON.stringify(base))
      : value === base;
    if (equal) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * 注册配置路由，返回注销函数。
 * @param options.webServer - 宿主 webServer 服务
 * @param options.configEditor - 宿主 configEditor 服务
 * @param options.entry - 本插件所在的行
 * @param options.config - 当前生效配置（apply 收到的值）
 * @param options.logger - 可选日志
 */
export function registerConfigRoute({ webServer, configEditor, entry, config, logger = console }) {
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: CONFIG_PATH,
      handler: async (req, res) => {
        if (!sameOrigin(req)) return send(res, 403, { ok: false, error: '跨源请求被拒绝' });
        if (req.method === 'GET' || req.method === 'HEAD') {
          return send(res, 200, { ok: true, config, fields: FIELDS, groups: GROUPS });
        }
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: '仅支持 GET 与 POST' });
        if (!String(req.headers['content-type'] || '').includes('application/json')) {
          return send(res, 415, { ok: false, error: '需要 application/json 请求体' });
        }
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          return send(res, 400, { ok: false, error: `请求体不是合法 JSON：${error.message}` });
        }
        const submitted = body && body.config;
        if (submitted === null || typeof submitted !== 'object' || Array.isArray(submitted)) {
          return send(res, 400, { ok: false, error: '请求体缺少 config 对象' });
        }
        let patch;
        try {
          patch = Object.fromEntries(Object.entries(submitted).map(([key, value]) => [key, normalize(key, value)]));
        } catch (error) {
          return send(res, 400, { ok: false, error: error.message });
        }
        if (entry === undefined || typeof configEditor?.edit !== 'function') {
          return send(res, 503, { ok: false, error: '当前 profile 不支持保存配置' });
        }
        try {
          await configEditor.edit(entry, (current, inherited) => applyPatch(current ?? {}, inherited, patch, defaults));
        } catch (error) {
          logger.warn?.(`codex-bridge: 保存配置失败：${error?.message ?? error}`);
          return send(res, 500, { ok: false, error: `保存失败：${error?.message ?? error}` });
        }
        return send(res, 200, { ok: true, saved: patch });
      },
    }),
  ];
  return () => { for (const dispose of disposers) dispose(); };
}
