export function quotaWindows(result) {
  const buckets = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? result.rateLimitsByLimitId : result.rateLimits ? { [result.rateLimits.limitId || 'codex']: result.rateLimits } : {};
  const rows = [];
  for (const [bucket, limits] of Object.entries(buckets)) {
    for (const window of ['primary', 'secondary']) {
      const value = limits?.[window];
      if (!value || !Number.isFinite(value.usedPercent)) continue;
      rows.push({ key: `${bucket}:${window}`, bucket, window,
        usedPercent: value.usedPercent, remainingPercent: Math.max(0, 100 - value.usedPercent),
        windowDurationMins: value.windowDurationMins ?? null, resetsAt: value.resetsAt ?? null });
    }
  }
  return rows;
}

export function quotaEvents(previous, current, options, now = Date.now()) {
  const events = [];
  const prior = new Map((previous?.windows || []).map(row => [row.key, row]));
  for (const row of current.windows) {
    if ((row.windowDurationMins ?? 0) < (options.notifyMinWindowMins ?? 0)) continue;
    const old = prior.get(row.key);
    const seconds = row.resetsAt == null ? null : row.resetsAt - now / 1000;
    if (seconds !== null && seconds > 0 && seconds <= options.remindBeforeHours * 3600 && row.remainingPercent >= options.remindRemainingPercent) {
      events.push({ key: `reminder:${row.key}:${row.resetsAt}`, kind: 'quota-reminder', row,
        text: `Codex ${row.bucket}（${row.windowDurationMins ?? '?'} 分钟窗口）还剩 ${row.remainingPercent.toFixed(1)}%，约 ${(seconds / 3600).toFixed(1)} 小时后重置。` });
    }
    // A decrease is an observation, not a prediction or proof of a full reset.
    if (old && old.windowDurationMins === row.windowDurationMins && old.usedPercent - row.usedPercent >= options.recoveryDropPercent) {
      events.push({ key: `recovery:${row.key}:${row.resetsAt}:${Math.floor(now / 600000)}`, kind: 'quota-recovered', row,
        text: `检测到 Codex ${row.bucket} 可用额度增加：剩余 ${old.remainingPercent.toFixed(1)}% → ${row.remainingPercent.toFixed(1)}%。` });
    }
  }
  return events;
}
