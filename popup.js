const $ = id => document.getElementById(id);
let state;
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw new Error(result?.error || '操作失败');
  return result;
}
function message(text, error = false) { $('message').textContent = text; $('message').style.color = error ? '#a23b32' : '#267052'; }
function render() {
  $('mode').value = state.mode;
  $('profile').replaceChildren(...state.profiles.map(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; return o; }));
  $('profile').value = state.activeId;
  const p = state.profiles.find(x => x.id === state.activeId);
  $('name').value = p.name; $('host').value = p.host; $('port').value = p.port; $('type').value = p.type;
  $('subscription').value = state.subscriptionUrl;
  $('updated').textContent = state.updatedAt ? '更新于 ' + new Date(state.updatedAt).toLocaleString() : '尚未更新';
  $('sites').replaceChildren(...state.sites.map(site => {
    const chip = document.createElement('span'); chip.className = 'chip'; chip.append(document.createTextNode(site));
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = '删除 ' + site; remove.onclick = () => run(async () => { state.sites = state.sites.filter(s => s !== site); await save(); });
    chip.append(remove); return chip;
  }));
}
async function save() { await request('save', { settings: state }); render(); message('已保存'); }
async function run(fn) { try { await fn(); } catch (e) { message(e.message, true); try { const result = await request('get'); state = result.settings; render(); } catch (_) {} } }
$('mode').onchange = () => run(async () => { state.mode = $('mode').value; await save(); });
$('profile').onchange = () => run(async () => { state.activeId = $('profile').value; await save(); });
$('addProfile').onclick = () => run(async () => { const id = crypto.randomUUID(); state.profiles.push({ id, name: '新代理', host: '127.0.0.1', port: 7890, type: 'PROXY' }); state.activeId = id; await save(); });
$('deleteProfile').onclick = () => run(async () => { if (state.profiles.length === 1) throw new Error('至少保留一个代理'); state.profiles = state.profiles.filter(p => p.id !== state.activeId); state.activeId = state.profiles[0].id; await save(); });
$('saveProfile').onclick = () => run(async () => { const p = state.profiles.find(x => x.id === state.activeId); p.name = $('name').value.trim(); p.host = $('host').value.trim(); p.port = Number($('port').value); p.type = $('type').value; if (!p.name) throw new Error('请输入代理名称'); await save(); });
async function addSite(value) { const site = ProxyRules.normalizeSite(value); if (!state.sites.includes(site)) state.sites.push(site); await save(); $('site').value = ''; }
$('addSite').onclick = () => run(() => addSite($('site').value));
$('site').onkeydown = e => { if (e.key === 'Enter') $('addSite').click(); };
$('current').onclick = () => run(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.url || !/^https?:\/\//.test(tab.url)) throw new Error('当前页面不是普通网站'); await addSite(tab.url); });
$('refresh').onclick = () => run(async () => { const url = $('subscription').value.trim(); let parsed; try { parsed = new URL(url); } catch (_) { throw new Error('请输入有效的订阅链接'); } if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('订阅链接必须使用 HTTP 或 HTTPS'); state.subscriptionUrl = url; $('refresh').disabled = true; message('正在更新订阅…'); try { const result = await request('refresh', { settings: state }); state = result.settings; render(); message(`订阅已更新，共 ${result.count} 条规则`); } finally { $('refresh').disabled = false; } });
run(async () => { const result = await request('get'); state = result.settings; render(); $('status').textContent = result.control === 'controlled_by_this_extension' ? '已接管代理设置' : '检查代理控制'; if (result.control !== 'controlled_by_this_extension') message('代理设置可能被其他扩展或浏览器策略控制', true); else if (state.subscriptionError) message('自动更新失败：' + state.subscriptionError, true); });
