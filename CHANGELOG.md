# Changelog

## 0.2.1

- 新增设置页（**设置 → Codex 桥接**）：表单覆盖全部 11 个配置字段，带范围校验与路径提示；保存走宿主 `configEditor`，改回默认值的项不会写进 profile。
- 修复：包缺少 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` 的 peer 声明。dsh 以目录链接方式安装插件时只按 `peerDependencies` 把 `@deepseek-ai/*` 路由到自带运行时，缺失声明会导致插件无法激活（dsh 0.2.2-rc.3 复现 `ERR_MODULE_NOT_FOUND`）。
- 验收：20 项自动化测试与 `scripts/check.mjs` 的 manifest/locale/资源检查通过；在运行中的 dsh 0.2.2-rc.3 上完成安装、激活、设置页读写（含默认值抑制）与只读任务派发。

## 0.1.0

- DSH bundle with account diagnostics, quota checks, configurable reset reminders and recovery observations.
- Background Codex tasks with project allowlists, read-only/workspace-write sandbox selection, output, continue and interrupt.
- QQ private-chat notifications using an existing dsh-qqbot binding, with explicit remote access control.
- Durable task metadata and notification outbox; restart never silently replays coding work.
- Pending command/file approvals can be reviewed from an active DSH tool call using the host approval channel.
