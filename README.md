# dsh-codex-bridge

一个可安装的 DeepSeek Harness（dsh）插件：监控 Codex 订阅额度，在重置前提醒，通过 QQ 私聊派发、查询、继续和停止本机 Codex 任务。

**版本：0.2.1。源码采用 MIT 许可证。此包尚未发布到 npm。**

![Codex bridge](icon.svg)

## 已实现

- 自动发现 Codex CLI，也可在配置里手动指定可执行文件。
- 查询真实额度使用比例、窗口长度和下次重置时间，支持多个额度桶。
- 默认每 10 分钟检查一次；默认只对至少一天的长窗口发送提醒，避免 5 小时窗口频繁通知。
- 默认在重置前 24 小时且剩余至少 30% 时提醒。观察到可用额度明显增加时通知。
- 通过 dsh 自然语言工具启动、列出、查看、继续和停止 Codex 任务。
- 可选 QQ 主动通知，复用 `@tencent-connect/dsh-qqbot` 已绑定的凭据，不再建立第二条 QQ 接收连接。
- 保存任务索引、结果、订阅和通知状态。重启不会自动重做编程任务。
- Codex 的命令和文件变更审批可在查询任务时转交 dsh 的审批通道；没有“让模型自己批准”的工具。

## 环境要求

1. dsh 桌面版或本地 CLI 宿主。本版按 **dsh 0.2.2-rc.3** 的已安装文档和运行时验证；其他版本尚未实测。
2. 可运行 `codex app-server` 的 Codex CLI，使用 ChatGPT 账号登录。仅有 API Key 时无法监控订阅额度。
3. 使用 QQ 时需要已安装、绑定的 **dsh-qqbot 0.5.5**。其他版本的会话映射格式未验证。
4. 电脑保持联网，dsh 宿主持续运行；仅开着电脑而退出 dsh 不会继续监控。

任务执行和 DeepSeek 理解你的消息会使用各自账号的额度。额度检查本身不发起模型推理。插件没有托管服务器，不上传 Codex 登录凭据；QQ 通知会把提醒和任务结果摘要发给你授权的 QQ 私聊。

## 安装

1. 下载并解压源码 ZIP。保留包含 `package.json` 的 `dsh-codex-bridge` 文件夹。
2. 打开 dsh → **插件 → 添加插件**，输入该文件夹的**完整路径**，安装并启用。
3. 在 **设置 → Codex 桥接** 里填写下面的字段（插件自带设置页，保存即生效并重载插件）。
4. 新建一个 dsh 对话，发送：**“检查 Codex 连接和允许的项目目录。”**

本插件需要宿主提供 `tools`、`configEditor` 和 `profileContext` 服务；设置页额外需要 `webServer`，缺失时插件照常运行，只是没有界面。若插件显示未激活，先查看缺失服务或配置错误；不要改动 dsh 的安装包。

已安装副本也可以从打包文件安装：把 `npm pack` 生成的 `.tgz` 放进该 profile 的 `vendor/` 目录，再在 **添加插件** 里选中它。以目录链接方式安装时，dsh 只按 `peerDependencies` 把 `@deepseek-ai/*` 路由到自带运行时，因此 `package.json` 必须保留这两个 peer 声明。

已在 dsh **0.2.2-rc.3**（Windows）上验收：安装、激活、设置页读写、额度查询与只读任务派发。

## 首次设置

| 配置 | 默认 | 用途 |
|---|---|---|
| `codexPath` | 空，自动检测 | 可指定 `codex.exe` 或 npm 安装的 `codex.js` 完整路径。Windows 不接收 `.cmd/.bat` 包装脚本。 |
| `allowedRoots` | 空列表 | 允许派发任务的项目目录列表，必须先设置。建议每个项目单独一条。 |
| `writable` | `false` | 默认**只读**。要让 Codex 修复或编辑代码，需在桌面配置开启；任务回执会显示所用沙箱。 |
| `pollMinutes` | `10` | 检查额度间隔。 |
| `notifyMinWindowMins` | `1440` | 仅提醒至少一天的窗口；设为 `0` 才包含 5 小时等短窗口。额度查询始终显示全部窗口。 |
| `remindBeforeHours` | `24` | 距离服务器报告的重置时间多少小时开始提醒。 |
| `remindRemainingPercent` | `30` | 重置前剩余比例达到该值时提醒。 |
| `recoveryDropPercent` | `10` | 已用比例下降至少多少个百分点时报告“可用额度增加”。 |
| `notifyRecovery` | `true` | 是否通知观察到的额度恢复。 |
| `maxConcurrentTasks` | `1` | 同时执行的任务数。 |
| `qqAllowedUsers` | 空列表 | 允许远程控制的机器人用户 **OpenID，不是 QQ 号码**。QQ 插件已有的私聊白名单也可复用。 |

`allowedRoots` 控制可选择的任务工作目录。Codex 的文件、命令、网络访问由它自己的沙箱执行；这不是独立虚拟机或完整的读取隔离。开启 `writable` 使用 `workspace-write`，并保留按需审批。

## 开通手机 QQ 使用

1. 在 dsh 的 QQ 插件里完成原有扫码绑定。不需要把 AppSecret、Token 或 Codex 登录文件粘贴到聊天。
2. 在 QQ **私聊**里发送：**“检查 Codex 连接。”**
3. 如果未授权，插件会拒绝操作，并给出该私聊的 OpenID。到电脑端把它加入本插件的 `qqAllowedUsers`；或者使用 QQ 插件的 `access.c2cMode=allowlist` 和 `access.c2cAllow`。
4. 再在 QQ 发送：**“测试 Codex 主动通知。”** 确认收到独立测试消息。测试失败时查看本次工具返回的平台错误码；后台通知失败可查询通知状态。
5. 发送：**“订阅 Codex 额度提醒。”** 订阅会持久保存，QQ 会话闲置或 `/new` 后仍可通知同一私聊。

远程授权只能在电脑端配置；模型工具不能添加白名单、扩大项目范围或开启可写权限。本版不开放 QQ 群聊控制，也不会为所有聊天自动订阅。

QQ 平台可能限制主动发送。已有聊天回复能成功，不等于主动通知一定可用。插件记录失败、最多尝试三次并退避重试，不能绕过平台权限。网络超时后的重试可能产生重复消息；重启时遇到正在发送的消息会标为 `unknown`，不自动重发。

## 可以这样用

```text
查一下 Codex 的每周额度和重置时间。
订阅 Codex 额度提醒。
测试 Codex 主动通知。

让 Codex 在 D:\projects\my-app 检查登录模块，先不要修改。
让 Codex 在 D:\projects\my-app 修复登录失败，完成后告诉我。
列出我的 Codex 任务。
查看 Codex 任务 <任务 ID> 的结果。
继续 Codex 任务 <任务 ID>，补充处理错误提示。
停止 Codex 任务 <任务 ID>。
取消订阅 Codex 额度提醒。
```

这些是给 dsh 的自然语言，不是固定 QQ 斜杠命令。dsh 会选择对应工具；返回任务 ID 后应保留它，后续查询和停止均以该 ID 为准。

任务开始后会在后台运行。最终通知发送结果摘要，完整结果通过任务工具查询。任务只对发起它的本地对话或 QQ 私聊可见；两个不同本地对话默认不共享任务列表。

## 审批、停止和重启

- Codex 申请执行命令或变更文件时，任务进入 `waiting-approval`，QQ 会提示需要处理。回复“查看 Codex 任务 <ID>”，在 dsh/QQ 的审批界面选择允许一次或拒绝。
- dsh 审批服务不可用时，查看状态不会替你批准或拒绝；插件会明确提示。10 分钟内未处理的请求最终拒绝。
- 目前支持 Codex 的命令执行和文件变更审批。其他交互请求（例如结构化问答、额外权限、外部授权）返回明确的“不支持”，不会永久悬挂；复杂任务仍可能需要回到电脑处理。
- 停止任务使用 `turn/interrupt`；收到完成事件前显示 `stopping`。停止不会撤销已经写入的文件。
- 重启后原来的活动任务标记为 `interrupted`，保留已收到的结果和 Codex thread ID。用户明确说“继续”时才恢复该 thread 并追加新指令，不会自动重放旧任务。
- 关闭 dsh/卸载插件会关闭桥接连接，活动工作可能中断；不要把它当作独立常驻服务。

## 工具接口

| 工具 | 操作 |
|---|---|
| `codex_bridge` | `doctor`、`quota`、`projects` |
| `codex_task` | `start`、`continue`、`list`、`status`、`output`、`stop` |
| `codex_notifications` | `subscribe`、`unsubscribe`、`test`、`status` |

额度按服务器返回的窗口和时间解释，不假定固定周几重置，也不能预测未公布的提前重置。使用比例下降只描述为额度增加，不断言获得了完整的新一周额度。

## 独立诊断命令

即使尚未安装到 dsh，也可以在源码目录运行（本地 Node.js 22+）：

```sh
node bin/cli.js doctor
node bin/cli.js quota
node bin/cli.js doctor --codex-path /absolute/path/to/codex
```

只读诊断不创建桥接任务数据库，不回显账号邮箱或登录令牌。独立命令目前不提供 QQ 接收或任务控制。

## 开源开发与验证

本包没有网络运行依赖。宿主侧的 `@deepseek-ai/dsh-tools` 和 `@deepseek-ai/schemastery` 从 dsh 自带运行时解析；不要另外安装一份 dsh 内核进 profile。

```sh
npm test
npm run check
npm pack --dry-run
npm pack
```

测试使用 Node 内建测试器和假的 app-server，不需要账号，不会发送 QQ 消息。[架构](docs/ARCHITECTURE.md)说明协议和适配边界；[验证记录](docs/VALIDATION.md)列出本版真实验证范围；[英文快速说明](docs/README.en.md)方便贡献者上手。

## 已知边界

- 已验证 Windows 本机的 CLI 发现、真实额度读取和只读 Codex 任务；跨平台路径逻辑有实现，但 macOS/Linux 未做真实安装验证。
- 已在运行中的 dsh 0.2.2-rc.3 上验收安装、激活、设置页读写与只读任务；设置页的视觉呈现没有逐项做截图验收。
- QQ HTTP 适配器、权限和会话映射有自动化测试；真实 QQ 主动送达及按钮审批尚未联调验收。
- 设置页覆盖全部配置字段，保存走 `configEditor`；仍没有自定义额度仪表盘，额度以对话工具与提醒呈现。
- QQ 接入兼容的是已检查的 0.5.5 内部会话映射，升级 QQ 插件后应重新验证；未来适合换成公开的通知服务接口。

## 许可证

[MIT](LICENSE)。这是社区插件，与 OpenAI、DeepSeek、Tencent 没有隶属或背书关系。插件只分发自己的实现，不打包 Codex、dsh 或 QQ 插件的安装程序和个人配置。
