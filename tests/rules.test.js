const assert = require('node:assert/strict');
const vm = require('node:vm');
require('../rules.js');
const r = globalThis.ProxyRules;
const text = '[AutoProxy 0.2.9]\n! comment\n||example.com\n@@||safe.example.com\n|https://exact.test/path|\n/regex[0-9]+\\.test/\n';
const encoded = Buffer.from(text).toString('base64').replace(/(.{30})/g, '$1\n');
assert.equal(r.decodeList(encoded), text);
assert.equal(r.parseList(encoded).length, 4);
assert.equal(r.normalizeSite('https://Example.COM:123/path'), 'example.com');
assert.throws(() => r.normalizeSite(''));
const state = r.defaults();
state.subscriptionText = encoded;
state.sites = ['manual.test', 'safe.example.com'];
const context = vm.createContext({});
vm.runInContext(r.pac(state), context);
const check = (url, host) => context.FindProxyForURL(url, host);
assert.equal(check('https://example.com/', 'example.com'), 'PROXY 127.0.0.1:7890');
assert.equal(check('https://sub.example.com/', 'sub.example.com'), 'PROXY 127.0.0.1:7890');
assert.equal(check('https://notexample.com/', 'notexample.com'), 'DIRECT');
assert.equal(check('https://example.com.evil/', 'example.com.evil'), 'DIRECT');
assert.equal(check('https://safe.example.com/', 'safe.example.com'), 'PROXY 127.0.0.1:7890');
assert.equal(check('https://sub.safe.example.com/', 'sub.safe.example.com'), 'PROXY 127.0.0.1:7890');
state.sites = []; vm.runInContext(r.pac(state), context);
assert.equal(check('https://safe.example.com/', 'safe.example.com'), 'DIRECT');
assert.equal(check('https://exact.test/path', 'exact.test'), 'PROXY 127.0.0.1:7890');
assert.equal(check('https://exact.test/path/more', 'exact.test'), 'DIRECT');
assert.equal(check('https://regex42.test/', 'regex42.test'), 'PROXY 127.0.0.1:7890');
state.mode = 'all'; vm.runInContext(r.pac(state), context);
assert.equal(check('http://localhost/', 'localhost'), 'DIRECT');
assert.equal(check('https://other.test/', 'other.test'), 'PROXY 127.0.0.1:7890');
state.mode = 'direct'; vm.runInContext(r.pac(state), context);
assert.equal(check('https://example.com/', 'example.com'), 'DIRECT');
state.profiles[0].port = 99999;
assert.throws(() => r.pac(state));
assert.throws(() => r.parseList('! only comments'));
console.log('规则、订阅解码和代理模式测试通过');
// The fast path must preserve the prior regex matcher, including exception priority.
const comparisonText = '[AutoProxy]\n||example.com^\n@@||safe.example.com^\n||plain.test\n||wild*.test^\n|https://path.test/abc|\n';
state.mode = 'smart'; state.profiles[0].port = 7890; state.subscriptionText = comparisonText; state.sites = [];
vm.runInContext(r.pac(state), context);
const parsed = r.parseList(comparisonText);
function reference(url) {
  if (parsed.some(rule => rule.exception && new RegExp(rule.pattern, 'i').test(url))) return 'DIRECT';
  if (parsed.some(rule => !rule.exception && new RegExp(rule.pattern, 'i').test(url))) return 'PROXY 127.0.0.1:7890';
  return 'DIRECT';
}
for (const [url, host] of [
  ['https://example.com/', 'example.com'], ['https://sub.example.com:443/path', 'sub.example.com'],
  ['https://example.com.evil/', 'example.com.evil'], ['https://safe.example.com/', 'safe.example.com'],
  ['https://sub.safe.example.com/', 'sub.safe.example.com'], ['https://plain.test:8443/', 'plain.test'],
  ['https://wildcard.test/', 'wildcard.test'], ['https://path.test/abc', 'path.test'],
  ['https://user@example.com/', 'example.com'], ['https://example.com@other.test/', 'other.test'],
  ['https://EXAMPLE.COM/', 'example.com'], ['https://unknown.test/', 'unknown.test']
]) assert.equal(check(url, host), reference(url), url);
