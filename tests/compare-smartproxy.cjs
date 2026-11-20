// Requires Node.js 24+. Usage: node tests/compare-smartproxy.cjs /path/to/gfwlist.txt [/path/to/SmartProxy]
const fs=require('fs'), vm=require('vm'), {stripTypeScriptTypes}=require('node:module'), {performance}=require('node:perf_hooks');
const path=require('node:path');
const listPath=process.argv[2]; if(!listPath) throw new Error('请指定 GFWList 文件路径');
const root=path.resolve(process.argv[3] || path.join(__dirname, '../../SmartProxy')) + '/';
let code=fs.readFileSync(root+'src/lib/RuleImporter.ts','utf8'); code=code.slice(code.indexOf('export const externalAppRuleParser =')).replace('export const externalAppRuleParser', 'var externalAppRuleParser');
const types={RegexHost:0,RegexUrl:1,Exact:2,SearchUrl:3,SearchDomain:4,SearchDomainSubdomain:5,SearchDomainAndPath:6,SearchDomainSubdomainAndPath:7};
let ctx={ImportedProxyRule:class {},CompiledProxyRuleType:types,console,Utils:{}};vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(code,{mode:'strip'}),ctx);
const decoded=Buffer.from(fs.readFileSync(listPath,'utf8').replace(/\s/g,''),'base64').toString();
let imported=ctx.externalAppRuleParser.GFWList.parse(decoded);for(let r of [...imported.whiteList,...imported.blackList]) {r.compiledRuleType=r.importedRuleType; if(r.importedRuleType===1 || r.importedRuleType===0) r.regex=new RegExp(r.regex,r.importedRuleType===0?'i':'');}
let source=fs.readFileSync(root+'src/core/ProxyEngineChrome.ts','utf8');source=source.slice(source.indexOf('function findMatchedUrlInRules('),source.indexOf('}`;\n\t\treturn pacTemplateString;')+1);source=Function('return `'+source+'`')();
ctx.console=console;vm.runInContext(source,ctx);
const whitelist=imported.whiteList, blacklist=imported.blackList;function upstream(url,host){return ctx.findMatchedUrlInRules(url,host,host,whitelist)?'DIRECT':ctx.findMatchedUrlInRules(url,host,host,blacklist)?'PROXY':'DIRECT';}
require('../rules.js');let state=ProxyRules.defaults();state.subscriptionText=fs.readFileSync(listPath,'utf8');const rules=ProxyRules.parseList(state.subscriptionText),c=vm.createContext({});vm.runInContext(ProxyRules.pac(state),c);const domains=[...new Set(rules.filter(r=>r.domain).map(r=>r.domain))];let sample=[];for(const d of domains.slice(0,500)) for(const sub of ['', 'sub.']) {let h=sub+d;sample.push(['https://'+h+'/path',h]);}for(let i=0;i<300;i++){let h='not-listed-'+i+'.example.invalid';sample.push(['https://'+h+'/path',h]);}
let diffs=0;for(const [url,h] of sample)if((upstream(url,h)==='PROXY') !== c.FindProxyForURL(url,h).startsWith('PROXY'))diffs++;
function bench(fn){for(const x of sample)fn(...x);let times=[];for(let k=0;k<3;k++){let s=performance.now();for(const x of sample)fn(...x);times.push((performance.now()-s)/sample.length);}return times.sort((a,b)=>a-b)[1]};
console.log(JSON.stringify({upstreamRules:whitelist.length+blacklist.length,ours:rules.length,samples:sample.length,differentOutcomes:diffs,upstreamMs:bench(upstream),oursMs:bench(c.FindProxyForURL)},null,2));
