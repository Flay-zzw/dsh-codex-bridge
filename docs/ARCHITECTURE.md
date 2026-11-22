# Architecture and extension boundaries

## Modules

- `index.js`: DSH Host entry, Schemastery configuration and three model-facing tools.
- `src/rpc.js`: newline-delimited JSON-RPC over a child `codex app-server --listen stdio://` process. Performs initialize/initialized, request correlation, timeouts, notifications and incoming server requests.
- `src/discover.js`: PATH/native desktop CLI discovery without hardcoded user names or release hashes. Never uses a shell to interpolate a prompt or directory.
- `src/bridge.js`: background task lifecycle, owner isolation, approvals, quota polling and notification outbox.
- `src/quota.js`: multi-bucket quota normalization and reminder/recovery decisions.
- `src/qq.js`: compatibility adapter for the installed dsh-qqbot 0.5.5 mapping and the QQ HTTP API. No second websocket consumer.
- `src/store.js`: versioned JSON snapshots, atomic replace and a single-writer lock.

## Codex protocol

The connection uses the current local Codex account. The plugin never reads `auth.json`, exchanges OpenAI tokens itself, consumes earned reset credits, or requests API-key billing.

Used methods: `initialize`, `initialized`, `account/read`, `account/rateLimits/read`, `thread/start`, `thread/resume`, `thread/read`, `turn/start`, `turn/interrupt`. Task output comes from `item/completed` and terminal state from `turn/completed`. Quota polling remains authoritative for usage from other Codex clients; it does not depend on a busy Codex chat producing notifications.

Supported server requests: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`. Requests wait in memory with a 10-minute timer. A subsequent active `codex_task` status/output call routes the reason to DSH `approval.request`, preserving the host user-only approval flow. Only `allowed-once` maps to `accept`; rejections/cancellations map to `decline`. Missing answerers keep the request pending until timeout. Unrecognized requests receive JSON-RPC method-not-found.

The plugin does not assume it can resume every existing desktop Codex chat. It manages threads it created and persists their IDs.

Official protocol reference: https://learn.chatgpt.com/docs/app-server

## QQ adapter

The adapter reads the already-composed QQ row from `configEditor.entries()` (no config writes). It reads just the `sessionIds` mapping of `~/.dsh-qqbot/model-prefs.json` to resolve the current tool caller into `qqbot:<appId>:c2c:<OpenID>`. Targets never come from model arguments. Access requires a matching configured bot and the bridge's allowlist or the QQ plugin's explicit private allowlist; the latter cannot be overridden by the bridge.

Active sends request a token at `https://api.bot.qq.com/app/getAppAccessToken`, then POST a plain text notification to `https://api.bot.qq.com/v2/users/<OpenID>/messages`. HTTPS redirects are rejected. Credentials stay in memory; API failures report HTTP and platform codes without response bodies. Tokens are cached only in memory. The bridge does not listen for messages; dsh-qqbot continues to handle all inbound traffic, model interaction and approval buttons.

**Compatibility seam:** QQ peer identity and composed entry metadata are not a published cross-plugin notification service. Their upgrade stability is limited. Changes should be confined to `src/qq.js`. Do not patch another plugin or change its account binding as a compatibility workaround. A future public QQ service can replace this adapter.

## Persistence and lifecycle

Default state directory: `<active-profile>/data/dsh-codex-bridge`. State contains task summaries/results, subscribed OpenIDs, quota snapshots and outbox entries, but no account secrets. Protect it like local coding chat history. Files are created with restrictive modes where the OS supports them; Windows inherits directory ACLs.

The file lock prevents multiple processes sharing this profile data. A stale PID lock is removed only when the owning process is absent; ambiguous permission errors fail closed. Corrupt state is not silently replaced. Outbox keys deduplicate reminder and task events. HTTP delivery is not exactly-once: timeouts and retries may duplicate messages. A crash during delivery becomes `unknown` and is not automatically resent.

Unloading stops the polling timer, declines pending approvals and closes app-server. Restart marks active task metadata interrupted instead of automatically starting more work. Explicit continue resumes the recorded Codex thread, checks for an existing running turn, and appends a new instruction. An operation that cannot be resumed reports its failure.

## Distribution

The npm package is a DSH bundle (`dsh.bundle.patch`). It contains the implementation, locale metadata, original icon and docs; it does not contain DSH/OpenAI/QQ binaries or extracted vendor documentation. Source tests use only Node built-ins. Runtime core APIs are supplied by the dsh installation rather than vendored into this project.

The CLI supports read-only diagnosis independently. A standalone always-on daemon, other notification channels, a dashboard, structured Codex user-input requests, and desktop chat takeover are outside 0.1.0.
