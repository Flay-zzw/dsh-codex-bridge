/**
 * Codex 桥接的设置页（浏览器侧）。
 *
 * dsh 只在插件注册了 settings.section 的地方渲染设置页，因此本文件为插件提供
 * 自己的配置界面：表单从宿主的 /codex-bridge/config 读字段表与当前值，保存时
 * POST 回去，由宿主的 configEditor 校验并写盘。
 */

const CONFIG_PATH = '/codex-bridge/config';

window.__ModuleLoader__.load({
  id: 'dsh-codex-bridge',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useMemo, useState } = React;
    const h = React.createElement;

    const zh = (typeof navigator === 'object' && String(navigator.language || '').toLowerCase().startsWith('zh'));
    const text = zh ? {
      title: 'Codex 桥接',
      subtitle: '查看 Codex 额度、派发本地任务，并决定 dsh 能把哪些目录交给 Codex。',
      save: '保存',
      saving: '保存中…',
      reload: '重新读取',
      saved: '已保存，插件正在以新配置重新加载。',
      savedStale: '保存请求已发出，但没有收到响应；稍后点“重新读取”确认是否生效。',
      loading: '正在读取配置…',
      failed: '读取配置失败',
      emptyNumber: '这一项必须填写数字',
      tooSmall: '不能小于',
      tooLarge: '不能大于',
      notAbsolute: '不是绝对路径，任务会被拒绝：',
      unsupported: '当前 profile 不支持保存配置，请手动编辑 profile 的 cordis.patch.yml。',
    } : {
      title: 'Codex bridge',
      subtitle: 'Read Codex quota, dispatch local tasks, and decide which directories dsh may hand to Codex.',
      save: 'Save',
      saving: 'Saving…',
      reload: 'Reload',
      saved: 'Saved. The plugin is reloading with the new configuration.',
      savedStale: 'The save request got no response; reload later to confirm whether it took effect.',
      loading: 'Reading configuration…',
      failed: 'Could not read the configuration',
      emptyNumber: 'This field needs a number',
      tooSmall: 'Must be at least',
      tooLarge: 'Must be at most',
      notAbsolute: 'Not an absolute path; tasks will be refused: ',
      unsupported: 'This profile cannot save plugin configuration; edit the profile cordis.patch.yml instead.',
    };

    const isAbsolute = value => /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 2px 24px', color: 'inherit', fontSize: 13 },
      head: { display: 'flex', flexDirection: 'column', gap: 4 },
      h2: { margin: 0, fontSize: 16, fontWeight: 600 },
      hint: { margin: 0, opacity: 0.7, lineHeight: 1.5 },
      group: { display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid color-mix(in srgb, currentColor 14%, transparent)', paddingTop: 14 },
      legend: { fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', opacity: 0.75, textTransform: 'uppercase' },
      field: { display: 'flex', flexDirection: 'column', gap: 6 },
      label: { fontWeight: 500 },
      note: { margin: 0, opacity: 0.65, lineHeight: 1.5 },
      input: {
        font: 'inherit', color: 'inherit', background: 'color-mix(in srgb, currentColor 5%, transparent)',
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: 8, padding: '7px 9px', width: '100%', boxSizing: 'border-box',
      },
      textarea: {
        font: 'inherit', color: 'inherit', background: 'color-mix(in srgb, currentColor 5%, transparent)',
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: 8, padding: '7px 9px',
        width: '100%', boxSizing: 'border-box', minHeight: 74, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', lineHeight: 1.6,
      },
      check: { display: 'flex', gap: 8, alignItems: 'center' },
      actions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      button: {
        font: 'inherit', cursor: 'pointer', padding: '7px 16px', borderRadius: 8,
        border: '1px solid color-mix(in srgb, currentColor 26%, transparent)',
        background: 'color-mix(in srgb, currentColor 10%, transparent)', color: 'inherit',
      },
      buttonPrimary: {
        font: 'inherit', cursor: 'pointer', padding: '7px 16px', borderRadius: 8, border: '1px solid transparent',
        background: '#247bbf', color: '#fff',
      },
      ok: { color: '#1a8f4a' },
      bad: { color: '#c0392b' },
      warn: { color: '#b8791a' },
      errorList: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 },
    };

    function Field({ field, value, onChange, problems }) {
      const id = `codex-bridge-${field.key}`;
      const label = field[labelKey()].label;
      const hint = field[labelKey()].hint;
      let control;
      if (field.kind === 'boolean') {
        control = h('label', { style: styles.check, htmlFor: id },
          h('input', { id, type: 'checkbox', checked: Boolean(value), onChange: event => onChange(event.target.checked) }),
          h('span', null, hint));
      } else if (field.kind === 'number') {
        control = h('input', {
          id, type: 'number', style: styles.input, value: value === '' ? '' : value,
          min: field.min, max: field.max, step: field.step ?? 1,
          onChange: event => onChange(event.target.value === '' ? '' : Number(event.target.value)),
        });
      } else if (field.kind === 'stringlist') {
        control = h('textarea', {
          id, style: styles.textarea, spellCheck: false,
          value: Array.isArray(value) ? value.join('\n') : '',
          onChange: event => onChange(event.target.value.split('\n').map(item => item.trim()).filter(Boolean)),
        });
      } else {
        control = h('input', {
          id, type: 'text', style: styles.input, value: value ?? '', spellCheck: false,
          onChange: event => onChange(event.target.value),
        });
      }
      return h('div', { style: styles.field },
        field.kind === 'boolean'
          ? h('span', { style: styles.label }, label)
          : h('label', { style: styles.label, htmlFor: id }, label),
        control,
        field.kind === 'boolean' ? null : h('p', { style: styles.note }, hint),
        problems.length > 0 ? h('ul', { style: styles.errorList }, problems.map((problem, index) => h('li', { key: index, style: styles.warn }, problem))) : null);
    }

    let langKey = 'zh';
    function labelKey() { return langKey; }

    function ConfigPage() {
      langKey = zh ? 'zh' : 'en';
      const [remote, setRemote] = useState({ status: 'loading', config: null, fields: [], groups: [], error: null });
      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);
      const [notice, setNotice] = useState(null);

      const load = useCallback(async () => {
        // 保存会重载插件，路由可能短暂不可用：重试几次再判定失败。
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const response = await fetch(CONFIG_PATH, { cache: 'no-store', headers: { accept: 'application/json' } });
            const body = await response.json().catch(() => null);
            if (!response.ok || !body || body.ok !== true) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`);
            setRemote({ status: 'ready', config: body.config, fields: body.fields ?? [], groups: body.groups ?? [], error: null });
            setDraft({ ...body.config });
            return;
          } catch (error) {
            if (attempt === 3) {
              setRemote(previous => ({ ...previous, status: 'failed', error: String(error && error.message ? error.message : error) }));
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
          }
        }
      }, []);

      useEffect(() => { void load(); }, [load]);

      const problemsFor = useCallback(field => {
        if (!draft) return [];
        const value = draft[field.key];
        const found = [];
        if (field.kind === 'number') {
          if (value === '' || typeof value !== 'number' || !Number.isFinite(value)) found.push(text.emptyNumber);
          else {
            if (value < field.min) found.push(`${text.tooSmall} ${field.min}`);
            if (value > field.max) found.push(`${text.tooLarge} ${field.max}`);
          }
        }
        if (field.kind === 'stringlist' && Array.isArray(value)) {
          for (const item of value) if (!isAbsolute(item)) found.push(`${text.notAbsolute}${item}`);
        }
        return found;
      }, [draft]);

      const blocking = useMemo(() => (remote.fields ?? []).some(field => problemsFor(field).length > 0), [remote.fields, problemsFor]);

      const save = useCallback(async () => {
        if (!draft || saving) return;
        setSaving(true);
        setNotice(null);
        try {
          const response = await fetch(CONFIG_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ config: draft }),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || !body || body.ok !== true) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`);
          setNotice({ kind: 'ok', message: text.saved });
          setTimeout(() => { void load(); }, 1500);
        } catch (error) {
          setNotice({ kind: 'bad', message: String(error && error.message ? error.message : error) });
        } finally {
          setSaving(false);
        }
      }, [draft, saving, load]);

      if (remote.status === 'loading') {
        return h('div', { style: styles.page }, h('p', { style: styles.hint }, text.loading));
      }
      if (remote.status === 'failed') {
        return h('div', { style: styles.page },
          h('p', { style: styles.bad }, `${text.failed}：${remote.error}`),
          h('div', { style: styles.actions }, h('button', { type: 'button', style: styles.button, onClick: () => { setRemote(previous => ({ ...previous, status: 'loading' })); void load(); } }, text.reload)));
      }

      const groups = remote.groups.length > 0 ? remote.groups : [{ id: '__all', zh: '配置', en: 'Configuration' }];
      return h('div', { style: styles.page },
        h('div', { style: styles.head },
          h('h2', { style: styles.h2 }, text.title),
          h('p', { style: styles.hint }, text.subtitle)),
        groups.map(group => {
          const fields = remote.fields.filter(field => field.group === group.id);
          if (fields.length === 0) return null;
          return h('section', { key: group.id, style: styles.group },
            h('div', { style: styles.legend }, group[langKey] ?? group.en),
            fields.map(field => h(Field, {
              key: field.key,
              field,
              value: draft ? draft[field.key] : undefined,
              onChange: value => setDraft(previous => ({ ...previous, [field.key]: value })),
              problems: problemsFor(field),
            })));
        }),
        h('div', { style: styles.actions },
          h('button', { type: 'button', style: blocking || saving ? { ...styles.buttonPrimary, opacity: 0.55, cursor: 'not-allowed' } : styles.buttonPrimary, disabled: blocking || saving, onClick: save }, saving ? text.saving : text.save),
          h('button', { type: 'button', style: styles.button, onClick: () => { void load(); } }, text.reload),
          notice ? h('span', { style: notice.kind === 'ok' ? styles.ok : styles.bad }, notice.message) : null));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'codex-bridge',
          order: 55,
          label: text.title,
        }, ConfigPage));
      },
    };
  },
});
