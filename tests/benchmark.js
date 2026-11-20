// Usage: node tests/benchmark.js path/to/gfwlist.txt
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
require('../rules.js');
const file = process.argv[2];
if (!file) throw new Error('请指定 GFWList 文件路径');
const state = ProxyRules.defaults();
state.subscriptionText = fs.readFileSync(file, 'utf8');
const rules = ProxyRules.parseList(state.subscriptionText);
const optimized = vm.createContext({});
vm.runInContext(ProxyRules.pac(state), optimized);
// Previous implementation: same patterns, exceptions first, sequential regex scan.
const exceptions = rules.filter(r => r.exception).map(r => new RegExp(r.pattern, 'i'));
const patterns = rules.filter(r => !r.exception).map(r => new RegExp(r.pattern, 'i'));
function before(url) {
  if (exceptions.some(rule => rule.test(url))) return 'DIRECT';
  if (patterns.some(rule => rule.test(url))) return 'PROXY 127.0.0.1:7890';
  return 'DIRECT';
}
const domains = [...new Set(rules.filter(r => r.domain).map(r => r.domain))];
const samples = [];
for (const domain of domains.slice(0, 500)) for (const sub of ['', 'sub.']) {
  const host = sub + domain; samples.push(['https://' + host + '/path', host]);
}
for (let i = 0; i < 300; i++) { const host = `not-listed-${i}.example.invalid`; samples.push([`https://${host}/path`, host]); }
for (const [url, host] of samples) {
  const expected = before(url), actual = optimized.FindProxyForURL(url, host);
  if (expected !== actual) throw new Error(`结果不一致: ${url}: ${expected} / ${actual}`);
}
function time(fn) {
  for (const [url, host] of samples) fn(url, host);
  const times = [];
  for (let round = 0; round < 3; round++) {
    const start = performance.now();
    for (const [url, host] of samples) fn(url, host);
    times.push((performance.now() - start) / samples.length);
  }
  return times.sort((a, b) => a - b)[1];
}
console.log(JSON.stringify({ rules: rules.length, fastDomains: rules.filter(r => r.domain).length, samples: samples.length, beforeMsPerUrl: time(before), afterMsPerUrl: time(optimized.FindProxyForURL) }, null, 2));
