#!/usr/bin/env node
// survey.js (Node 18+): read-only activity survey of T3 threads (projects, models, waiting, stale). Token: `token` next to this script.
const fs=require("fs"),path=require("path"),os=require("os");
const die=(c,m)=>{console.error(c+": "+m);process.exit(1)};
if(+process.versions.node.split(".")[0]<18||typeof fetch==="undefined")die("NODE_TOO_OLD","needs Node 18 or newer (found "+process.version+"). Install the current LTS from https://nodejs.org");
const t3Dir=()=>{const H=os.homedir();for(let v of [process.env.GETTER_HOME,process.env.T3_HOME,process.env.T3CODE_HOME]){v=(v||"").trim();if(!v)continue;if(v==="~"||/^~[\\/]/.test(v))v=path.join(H,v.slice(1));v=path.resolve(v);return fs.existsSync(path.join(v,"server-runtime.json"))||fs.existsSync(path.join(v,"statev2.sqlite"))||/^(userdata|dev)$/i.test(path.basename(v))?v:path.join(v,"userdata")}
 return path.join(H,".getter-code","userdata")};
let rt;try{rt=JSON.parse(fs.readFileSync(path.join(t3Dir(),"server-runtime.json"),"utf8"))}catch{die("T3_NOT_RUNNING","T3 Code isn't running on this computer (no server-runtime.json). Open T3 Code and try again.")}
let T="";try{T=fs.readFileSync(path.join(__dirname,"token"),"utf8").trim()}catch{}if(!T)die("NO_TOKEN","no `token` file next to this script yet. Ask T3 Tots to issue one (setup step), then retry.");
const H={Authorization:"Bearer "+T,"x-t3-orchestration-protocol":"2"};const B=`http://${!rt.host||rt.host==="0.0.0.0"||rt.host==="::"?"127.0.0.1":rt.host.includes(":")?`[${rt.host}]`:rt.host}:${rt.port}`;
const get=async p=>{let r;try{r=await fetch(B+p,{headers:H})}catch(e){throw new Error(`T3_NOT_REACHABLE: can't reach T3 at ${B} (${(e.cause&&e.cause.code)||e.message}). Is T3 Code open?`)}
 if(r.status===401||r.status===403)throw new Error(`TOKEN_REJECTED (HTTP ${r.status}): the T3 Tots token expired or was revoked. Reissue it (see Token in t3-tots-rules).`);if(!r.ok)throw new Error(p+" "+r.status);return r.json()};
// SECRET_KEYS: word for word the same as scripts/scan-private.py and tools/export.js (tests/install_test.py checks)
const SECRET_KEYS = String.raw`sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_[a-z]+_[A-Za-z0-9_]{16,}|whsec_[A-Za-z0-9+/=_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https://hooks\.slack\.com/services/[A-Za-z0-9/]+|https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+`;
const RED=new RegExp(`(${SECRET_KEYS}|eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_.-]+|(?:api[_-]?key|token|secret|password)\\s*[:=]\\s*\\S{8,})`, "gi");
const red=s=>String(s??"").replace(RED,"[redacted]").replaceAll(os.homedir(),"~"); // titles and project names are redacted like export.js
(async()=>{const j=await get("/api/orchestration/shell");for(const t of j.threads)t.title=red(t.title);
const P=Object.fromEntries(j.projects.map(p=>[p.id,red(p.title)]));const now=Date.now(),d=s=>(now-Date.parse(s))/864e5;
const user=j.threads.filter(t=>!/^(mcp|provider)$/.test(t.creationSource));
console.log("threads",j.threads.length,"user-made",user.length,"projects",j.projects.length);
const by={};for(const t of user){const k=P[t.projectId]||"?";by[k]=by[k]||{n:0,n7:0,n30:0,last:""};by[k].n++;if(d(t.updatedAt)<7)by[k].n7++;if(d(t.updatedAt)<30)by[k].n30++;if(t.updatedAt>by[k].last)by[k].last=t.updatedAt}
console.log("\nproject total/7d/30d/last");for(const [k,v] of Object.entries(by).sort((a,b)=>b[1].n30-a[1].n30))console.log(k,v.n,v.n7,v.n30,v.last.slice(0,10));
const m={};for(const t of user.filter(t=>d(t.updatedAt)<30)){const k=t.modelSelection?.model+" "+((t.modelSelection?.options||[]).find(o=>/effort|variant/i.test(o.id))?.value||"");m[k]=(m[k]||0)+1}
console.log("\nmodels 30d");for(const [k,v] of Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,12))console.log(v,k);
console.log("\nstatus");const st={};for(const t of user)st[t.status]=(st[t.status]||0)+1;console.log(st);
console.log("\nwaiting (pending request / actionable plan / error)");for(const t of user)if(t.pendingRuntimeRequest||t.hasActionableProposedPlan||t.lastError)console.log("-",P[t.projectId],"|",t.title,"|",t.pendingRuntimeRequest?"request":t.hasActionableProposedPlan?"plan":"error",t.updatedAt.slice(0,10));
console.log("\nstale active (not settled, idle 3-30d)");for(const t of user)if(!(t.settledOverride==="settled"||(!!t.settledAt&&t.settledOverride!=="unsettled"))&&!t.archivedAt&&d(t.updatedAt)>3&&d(t.updatedAt)<30)console.log("-",P[t.projectId],"|",t.title,"|",t.updatedAt.slice(0,10));
console.log("\nrecent titles 30d");for(const t of user.filter(t=>d(t.updatedAt)<30).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,70))console.log(t.updatedAt.slice(5,10),P[t.projectId],"|",t.title);
})().catch(e=>{console.error("error:",e.message);process.exit(1)});
