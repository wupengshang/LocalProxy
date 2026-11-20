/* Rule parser and PAC generator shared by the extension and tests. */
(function (root) {
  const DEFAULT_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';
  const defaults = () => ({ profiles: [{ id: 'default', name: '本机 Clash', host: '127.0.0.1', port: 7890, type: 'PROXY' }], activeId: 'default', mode: 'smart', sites: [], subscriptionUrl: DEFAULT_URL, subscriptionText: '', updatedAt: null, subscriptionError: '' });
  function decodeList(text) {
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('订阅内容为空');
    if (/^(\[|!|@@|\|\||https?:\/\/)/m.test(text) || /[.*^|]/.test(text)) return text;
    try {
      const decoded = atob(text.replace(/\s/g, ''));
      if (!decoded || !/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) throw new Error();
      return decoded;
    } catch (_) { return text; }
  }
  function compileRule(line) {
    let exception = false;
    if (line.startsWith('@@')) { exception = true; line = line.slice(2); }
    if (!line || /^[!#\[]/.test(line)) return null;
    // Cosmetic filters and ABP options require request context unavailable to PAC.
    if (line.includes('##') || line.includes('#@#') || line.includes('$')) return null;
    if (line.startsWith('/') && line.endsWith('/') && line.length > 2) {
      try { new RegExp(line.slice(1, -1), 'i'); return { exception, pattern: line.slice(1, -1) }; } catch (_) { return null; }
    }
    // Only optimize a pure domain anchor; retain its regex for unusual URL forms.
    const domainMatch = /^\|\|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?:\^)?$/i.exec(line);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : null;
    let prefix = '';
    let domainOnly = false;
    if (line.startsWith('||')) { prefix = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'; line = line.slice(2); domainOnly = /^[a-z0-9.-]+$/i.test(line); }
    else if (line.startsWith('|')) { prefix = '^'; line = line.slice(1); }
    let suffix = '';
    if (line.endsWith('|')) { suffix = '$'; line = line.slice(0, -1); }
    if (!line || /\s/.test(line)) return null;
    let pattern = '';
    for (const c of line) {
      if (c === '*') pattern += '.*';
      else if (c === '^') pattern += '(?:[^a-zA-Z0-9_.%\\-]|$)';
      else pattern += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
    return { exception, pattern: prefix + pattern + (domainOnly ? '(?=[:/?#]|$)' : '') + suffix, domain };
  }
  function parseList(text) {
    const rules = [];
    for (const line of decodeList(text).split(/\r?\n/)) {
      const rule = compileRule(line.trim());
      if (rule) rules.push(rule);
    }
    if (!rules.length) throw new Error('订阅中没有可用规则');
    return rules;
  }
  function normalizeSite(value) {
    let s = value.trim().toLowerCase();
    if (!s) throw new Error('请输入网站域名');
    try { s = new URL(s.includes('://') ? s : 'http://' + s).hostname; } catch (_) { throw new Error('请输入有效的网站域名'); }
    if (!s || s.includes(':') || !/^[a-z0-9.-]+$/.test(s) || s.startsWith('.') || s.endsWith('.') || s.includes('..')) throw new Error('请输入有效的网站域名');
    return s;
  }
  function pac(state) {
    const p = state.profiles.find(x => x.id === state.activeId);
    if (!p) throw new Error('请选择代理');
    if (!['PROXY', 'HTTPS', 'SOCKS5'].includes(p.type) || !/^[a-z0-9.-]+$/i.test(p.host) || !Number.isInteger(Number(p.port)) || Number(p.port) < 1 || Number(p.port) > 65535) throw new Error('代理地址或端口无效');
    const rules = state.subscriptionText ? parseList(state.subscriptionText) : [];
    function group(exception) {
      const matches = rules.filter(rule => rule.exception === exception);
      return {
        domains: matches.filter(rule => rule.domain).map(rule => rule.domain),
        domainPatterns: matches.filter(rule => rule.domain).map(rule => rule.pattern),
        patterns: matches.filter(rule => !rule.domain).map(rule => rule.pattern)
      };
    }
    const data = JSON.stringify({ proxy: `${p.type} ${p.host}:${Number(p.port)}`, mode: state.mode, sites: state.sites, exceptions: group(true), rules: group(false) });
    return `var data = ${data};
function prepare(group) {
 var domains = Object.create(null);
 group.domains.forEach(function(domain) { domains[domain] = true; });
 return { domains: domains, domainPatterns: group.domainPatterns, patterns: group.patterns.map(function(x) { return new RegExp(x, 'i'); }) };
}
var exceptions = prepare(data.exceptions);
var rules = prepare(data.rules);
function matches(group, url, host, normalAuthority) {
 if (normalAuthority) {
  var domain = host;
  while (domain) {
   if (group.domains[domain]) return true;
   var dot = domain.indexOf('.');
   if (dot < 0) break;
   domain = domain.slice(dot + 1);
  }
 } else {
  for (var i = 0; i < group.domainPatterns.length; i++) if (new RegExp(group.domainPatterns[i], 'i').test(url)) return true;
 }
 for (var j = 0; j < group.patterns.length; j++) if (group.patterns[j].test(url)) return true;
 return false;
}
function FindProxyForURL(url, host) {
 host = host.toLowerCase();
 if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.slice(-6) === '.local') return 'DIRECT';
 if (data.mode === 'direct') return 'DIRECT';
 if (data.mode === 'all') return data.proxy;
 for (var i=0;i<data.sites.length;i++) if (host === data.sites[i] || host.slice(-(data.sites[i].length+1)) === '.'+data.sites[i]) return data.proxy;
 var authority = new RegExp('^[a-z][a-z0-9+.-]*://([^/?#]*)', 'i').exec(url);
 var normalAuthority = authority && (authority[1].toLowerCase() === host || authority[1].toLowerCase().indexOf(host + ':') === 0);
 if (matches(exceptions, url, host, normalAuthority)) return 'DIRECT';
 if (matches(rules, url, host, normalAuthority)) return data.proxy;
 return 'DIRECT';
}`;
  }
  root.ProxyRules = { defaults, decodeList, compileRule, parseList, normalizeSite, pac };
})(globalThis);
