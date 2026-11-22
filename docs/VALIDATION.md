# Validation record — 0.1.0

Validation performed on Windows on 2026-11-19 (Asia/Shanghai). Tests ran against the installed binaries rather than relying only on documentation.

| Check | Result |
|---|---|
| Automated tests | 20 tests: quota buckets/rules, ownership, task concurrency, completion, approvals, stop, outbox, restart, uncertain-start reconciliation, QQ access/identity/HTTP requests, executable discovery and stdio protocol |
| Static/package validation | JavaScript syntax, JSON, manifest, locale files and required resources checked |
| Local Codex connection | Connected to installed `codex-cli 0.162.0-alpha.17.2` using app-server; ChatGPT account detected without printing account email or tokens |
| Actual subscription limits | Read and normalized both 300-minute and 10080-minute windows from the live account |
| Actual Codex task | Started a read-only task in a temporary empty workspace; received `DSH_CODEX_BRIDGE_OK` and terminal `completed` status |
| DSH API smoke | Using DSH's packaged Electron/Node 24.21.0 runtime for DSH 0.2.2-rc.3: parsed Config/defaults, rejected invalid config, registered all three tool definitions, called the projects tool, and cleaned up lifecycle resources |
| UX review | Independent read-only review performed; fixed missing-approval-channel behavior, short-window notification noise, Chinese configuration help, OpenID onboarding and explicit read-only task feedback |

The DSH smoke test used a controlled context with the installed runtime's real Schemastery and `defineTool`; it was **not** an installation into the user's real profile or a full running UI test.

The first sandboxed Codex launch failed because the restricted environment could not resolve the Windows home directory. The same read-only diagnostic and live smoke test succeeded outside that sandbox with normal process access. No Codex login files were copied into the plugin.

## Not yet verified live

- Installation/activation through the running DSH Plugin Manager.
- Rendered plugin configuration form, metadata and icon in light/dark themes.
- QQ proactive message delivery and real QQ approval button clicks.
- Actual writable coding tasks, multi-model access and commands requiring additional network privileges.
- macOS/Linux installations and DSH/QQ plugin versions other than the versions listed above.

QQ sends were tested with a mocked fetch implementation, including denied permissions and credential-redaction behavior. No real QQ message was sent during validation. Active credentials and private session files are not part of the source or npm artifacts.

## First-install acceptance checklist

1. Install the local package directory and confirm the plugin is active with the intended title/icon.
2. Configure a small project in `allowedRoots`, leave read-only enabled, ask DSH for connectivity and current quota.
3. Ask Codex to inspect the project, inspect the returned task ID, then test a longer task's stop behavior.
4. Bind the existing QQ plugin; authorize only the intended private OpenID.
5. From that private chat test proactive delivery, subscribe, start a read-only task, and confirm its completion notification.
6. Enable writable mode only for the intended projects; test a small reversible edit and one approval request.
7. Restart DSH and verify subscriptions persist and interrupted tasks are not automatically replayed.
