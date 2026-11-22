# dsh-codex-bridge

DeepSeek Harness（dsh）插件：监控 Codex 订阅额度、在重置前提醒，并通过对话或 QQ 私聊派发、查询、继续、停止本机 Codex 任务。

**版本 0.2.3 · MIT · 尚未发布到 npm**

![Codex bridge](icon.svg)

## 能力

- 读取真实额度比例、窗口长度与重置时间；默认每 10 分钟检查一次，只对 ≥1 天的长窗口提醒。
- 重置前 24 小时且剩余 ≥30% 时提醒；观察到额度明显回升时通知。
- 用自然语言派发后台 Codex 任务：启动、列出、查看结果、继续、停止。
- 可选 QQ 私聊通知，复用已绑定的 `@tencent-connect/dsh-qqbot` 凭据，不另建接收连接。
- 任务索引、结果、订阅与通知状态落盘；重启不会自动重做已中断的编程任务。

## 要求

1. dsh 桌面版或本地 CLI 宿主（按 **0.2.2-rc.3** 验证）。
2. 已用 ChatGPT 账号登录的 Codex CLI；只有 API Key 时无法读订阅额度。
3. 用 QQ 时需已安装并绑定的 **dsh-qqbot 0.5.5**。
4. 电脑保持联网、dsh 持续运行；退出 dsh 就停止监控。

## 安装

1. 解压源码，保留含 `package.json` 的 `dsh-codex-bridge` 目录。
2. dsh → **插件 → 添加插件**，输入该目录完整路径，安装并启用。
3. **设置 → Codex 桥接** 里填写配置（见下表），保存后插件自动重载。
4. 新对话发送「检查 Codex 连接和允许的项目目录」复核。

插件需要宿主提供 `tools`、`configEditor`、`profileContext`；设置页额外需要 `webServer`，缺失时插件照常运行，只是没有界面。以目录链接方式安装时，dsh 只按 `peerDependencies` 把 `@deepseek-ai/*` 路由到自带运行时，因此不要删掉 `package.json` 里的两个 peer 声明。

已在 dsh 0.2.2-rc.3（Windows）验收：安装、激活、设置页读写、额度查询与只读任务。

## 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `codexPath` | 自动检测 | `codex.exe` 或 `codex.js` 的完整路径；不接受 `.cmd/.bat` |
| `allowedRoots` | 空 | 允许派发任务的项目目录，**必须先设置** |
| `writable` | `false` | 默认只读；开启后用 `workspace-write` 并保留按需审批 |
| `pollMinutes` | `10` | 额度检查间隔，检查本身不启动模型 |
| `notifyMinWindowMins` | `1440` | 只提醒 ≥1 天的窗口；设 `0` 才含 5 小时窗口 |
| `remindBeforeHours` | `24` | 重置前多少小时开始提醒 |
| `remindRemainingPercent` | `30` | 提醒所需的最低剩余比例 |
| `recoveryDropPercent` | `10` | 已用比例下降多少个百分点算额度恢复 |
| `notifyRecovery` | `true` | 是否通知额度恢复 |
| `maxConcurrentTasks` | `1` | 同时运行的任务数 |
| `qqAllowedUsers` | 空 | 可远程控制的机器人 OpenID（不是 QQ 号） |

`allowedRoots` 只决定可选的任务目录；文件、命令和网络访问仍由 Codex 自己的沙箱执行。

## 用法

```text
查一下 Codex 的每周额度和重置时间。
让 Codex 在 D:\projects\my-app 检查登录模块，先不要修改。
让 Codex 在 D:\projects\my-app 修复登录失败，完成后告诉我。
列出我的 Codex 任务。
查看 Codex 任务 <ID> 的结果。
继续 Codex 任务 <ID>，补充处理错误提示。
停止 Codex 任务 <ID>。
```

这些是给 dsh 的自然语言，不是斜杠命令。任务在后台运行，结束时推送摘要；完整结果按任务 ID 查询。任务只对发起它的对话或 QQ 私聊可见。

## QQ 私聊

在 QQ 私聊发「检查 Codex 连接」。若被拒绝，按提示把该私聊的 OpenID 填进 `qqAllowedUsers`；或让 QQ 插件处于 `access.c2cMode=allowlist` 并把你加入 `c2cAllow`，此时可直接复用它的白名单。再发「测试 Codex 主动通知」和「订阅 Codex 额度提醒」。

只支持私聊。远程授权只能在电脑端配置，模型工具不能扩大目录或开启可写。平台可能限制主动消息，失败会回错误码并最多重试三次。

## 审批与生命周期

- Codex 要执行命令或改文件时任务进入 `waiting-approval`，在 dsh 审批界面允许一次或拒绝；10 分钟未处理即拒绝。
- 停止使用 `turn/interrupt`，不会撤销已写入的文件；其他交互请求（结构化问答、额外权限等）明确返回不支持。
- 重启后活动任务标为 `interrupted`，明确说「继续」才恢复 thread；退出 dsh 或卸载插件会中断进行中的工作。

## 工具

| 工具 | 操作 |
|---|---|
| `codex_bridge` | `doctor`、`quota`、`projects` |
| `codex_task` | `start`、`continue`、`list`、`status`、`output`、`stop` |
| `codex_notifications` | `subscribe`、`unsubscribe`、`test`、`status` |

额度按服务器返回的窗口解释，不假定固定周几重置，也不能预测未公布的提前重置。

## 开发

```sh
npm test                 # Node 内建测试，20 项，使用假 app-server
npm run check            # manifest / locale / 资源校验
node bin/cli.js doctor   # 未安装到 dsh 也能跑的只读诊断
npm pack
```

架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，真实验证范围见 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 已知边界

- Windows 已做真实安装与只读任务验收；macOS/Linux 未做真机验证。
- 设置页读写已验证，视觉呈现未逐项截图验收。
- QQ 主动送达与按钮审批尚未真实联调；QQ 接入兼容 0.5.5 的内部会话映射，升级后需重新验证。
- 没有自定义额度仪表盘，额度通过对话工具与提醒呈现。

## 许可证

[MIT](LICENSE)。社区插件，与 OpenAI、DeepSeek、Tencent 无隶属或背书关系；只分发自身实现，不打包 Codex、dsh 或 QQ 插件的安装程序与个人配置。
