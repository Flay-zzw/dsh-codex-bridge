# Codex bridge for DeepSeek Harness

Version 0.1.0 is an installable preview, not yet published on npm. Install the local package directory from **DSH → Plugins → Add plugin**. The package contains a Host plugin and no custom Client page.

Requirements: a local DSH host (validated API version 0.2.2-rc.3), a signed-in Codex CLI with app-server, and optionally dsh-qqbot 0.5.5 for QQ private chat. The host must remain running and online.

1. Set `allowedRoots` to absolute project directories in the plugin configuration.
2. Leave `writable=false` for inspection, or enable it for workspace-write coding tasks.
3. Ask DSH to check Codex connectivity and quota.
4. For QQ, bind the existing QQ plugin. Ask to check Codex from a private chat; if rejected, add the returned bot user OpenID (not the numeric QQ account number) to `qqAllowedUsers` in the desktop configuration. An existing QQ plugin private allowlist also grants access.
5. Ask QQ to test proactive Codex notifications, then subscribe to quota reminders.

Three tools are exposed: `codex_bridge` (doctor/quota/projects), `codex_task` (start/continue/list/status/output/stop), and `codex_notifications` (subscribe/unsubscribe/test/status). Tasks are owned by their initiating conversation or private QQ peer. No tool can expand permissions, change the QQ binding or approve itself.

Quota polling defaults to 10 minutes. Alerts default to windows of at least one day, with a reminder 24 hours before reset if at least 30% remains. Recovery means an observed decrease in used percentage, not a prediction of unscheduled resets.

Codex command/file approvals are presented when an active task status/output tool call routes them to DSH's human approval channel. Unsupported interactive requests return an explicit error. Restart does not replay tasks; use explicit continue. Interrupting a task does not undo edits.

Run `npm test`, `npm run check`, and `npm pack --dry-run` from the source checkout. No external test dependencies are required. Runtime DSH APIs are supplied by the host. Cross-platform implementation exists, but live validation was Windows-only. QQ delivery, running DSH UI and rendered forms/icons remain unverified; see [validation](VALIDATION.md).

Licensed under MIT. This community package is not affiliated with OpenAI, DeepSeek or Tencent.
