importScripts('rules.js');
const KEY = 'settings';
async function getSettings() { const data = await chrome.storage.local.get(KEY); return data[KEY] || ProxyRules.defaults(); }
const MODE_BADGES = {
  smart: { text: '智', color: '#16875b', label: '智能模式' },
  all: { text: '全', color: '#2563c4', label: '全局模式' },
  direct: { text: '停', color: '#737e89', label: '直连模式' }
};
async function updateBadge(settings, control) {
  const badge = control === 'controlled_by_this_extension'
    ? (MODE_BADGES[settings.mode] || MODE_BADGES.direct)
    : { text: '!', color: '#c13b34', label: '代理设置未被本扩展接管' };
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({ title: `轻量代理 · ${badge.label}` })
  ]);
}
async function updateBadgeFromControl() {
  const [settings, control] = await Promise.all([getSettings(), chrome.proxy.settings.get({ incognito: false })]);
  await updateBadge(settings, control.levelOfControl);
}
async function apply(settings, script = ProxyRules.pac(settings)) {
  try {
    await chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: script } }, scope: 'regular' });
    const control = await chrome.proxy.settings.get({ incognito: false });
    await updateBadge(settings, control.levelOfControl);
    if (control.levelOfControl !== 'controlled_by_this_extension') throw new Error('浏览器代理设置被其他扩展或系统策略控制');
  } catch (error) {
    await updateBadge(settings, 'error');
    throw error;
  }
}
async function save(settings) {
  // Validate before persistence so invalid edits do not replace working settings.
  const script = ProxyRules.pac(settings);
  await chrome.storage.local.set({ [KEY]: settings });
  await apply(settings, script);
}
async function refresh(settings) {
  const response = await fetch(settings.subscriptionUrl, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`订阅下载失败：HTTP ${response.status}`);
  const text = await response.text();
  const parsed = ProxyRules.parseList(text);
  settings.subscriptionText = text;
  settings.updatedAt = new Date().toISOString();
  settings.subscriptionError = '';
  await save(settings);
  return parsed.length;
}
chrome.proxy.settings.onChange.addListener(() => { updateBadgeFromControl().catch(console.error); });
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(KEY);
  if (!data[KEY]) await chrome.storage.local.set({ [KEY]: ProxyRules.defaults() });
  await chrome.alarms.create('refresh', { periodInMinutes: 1440 });
  try { await apply(await getSettings()); } catch (e) { console.error(e); }
});
chrome.runtime.onStartup.addListener(async () => { try { await apply(await getSettings()); } catch (e) { console.error(e); } });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'refresh') return;
  const settings = await getSettings();
  if (!settings.subscriptionText || !settings.subscriptionUrl) return;
  try { await refresh(settings); } catch (e) { settings.subscriptionError = e.message; await chrome.storage.local.set({ [KEY]: settings }); }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    if (message.type === 'get') {
      const settings = await getSettings();
      const control = await chrome.proxy.settings.get({ incognito: false });
      return { settings, control: control.levelOfControl };
    }
    if (message.type === 'save') { await save(message.settings); return {}; }
    if (message.type === 'refresh') { const settings = message.settings; const count = await refresh(settings); return { count, settings }; }
    throw new Error('未知操作');
  })().then(result => reply({ ok: true, ...result })).catch(e => reply({ ok: false, error: e.message }));
  return true;
});
