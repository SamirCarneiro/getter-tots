#!/usr/bin/env node
// export.js (Node 18+) --project <name|path|id|all> [--days 14] [--out file.json]  : read-only, redacted project activity for reports
const fs=require("fs"),path=require("path"),os=require("os");
const die=(c,m)=>{console.error(c+": "+m);process.exit(1)};
// args like t3ctl: --key value, --key=value (use = for a value that starts with --), --flag
const args=(v)=>{const o={};for(let i=0;i<v.length;i++){if(!v[i].startsWith("--"))continue;const eq=v[i].indexOf("=");if(eq>2){o[v[i].slice(2,eq)]=v[i].slice(eq+1);continue}
 o[v[i].slice(2)]=v[i+1]!==undefined&&!v[i+1].startsWith("--")?v[++i]:true}return o};
const a=args(process.argv.slice(2));
for(const k of Object.keys(a))if(!["project","days","out"].includes(k))die("USAGE",`unknown option --${k} (export.js --project <id|folder|title|all> [--days 14] [--out file.json])`);
for(const k of ["days","out"])if(a[k]===true||a[k]==="")die("USAGE",`--${k} needs a value`);
if(a.days!==undefined&&!(+a.days>0))die("USAGE","--days needs a positive number");
const Q=("project" in a&&a.project!==true?String(a.project):"project" in a?"":"all").trim(),q=Q.toLowerCase(); // ids match exactly; titles and folders ignore case
if(!q)die("USAGE","--project needs a value (a project id, folder, title, or all)");
if(+process.versions.node.split(".")[0]<18||typeof fetch==="undefined")die("NODE_TOO_OLD","needs Node 18 or newer (found "+process.version+"). Install the current LTS from https://nodejs.org");
const t3Dir=()=>{const H=os.homedir();for(let v of [process.env.GETTER_HOME,process.env.T3_HOME,process.env.T3CODE_HOME]){v=(v||"").trim();if(!v)continue;if(v==="~"||/^~[\\/]/.test(v))v=path.join(H,v.slice(1));v=path.resolve(v);return fs.existsSync(path.join(v,"server-runtime.json"))||fs.existsSync(path.join(v,"statev2.sqlite"))||/^(userdata|dev)$/i.test(path.basename(v))?v:path.join(v,"userdata")}
 return path.join(H,".getter-code","userdata")};
let rt;try{rt=JSON.parse(fs.readFileSync(path.join(t3Dir(),"server-runtime.json"),"utf8"))}catch{die("T3_NOT_RUNNING","T3 Code isn't running on this computer (no server-runtime.json). Open T3 Code and try again.")}
let T="";try{T=fs.readFileSync(path.join(__dirname,"token"),"utf8").trim()}catch{}if(!T)die("NO_TOKEN","no `token` file next to this script yet. Ask T3 Tots to issue one (setup step), then retry.");
const H={Authorization:"Bearer "+T,"x-t3-orchestration-protocol":"2"};const B=`http://${!rt.host||rt.host==="0.0.0.0"||rt.host==="::"?"127.0.0.1":rt.host.includes(":")?`[${rt.host}]`:rt.host}:${rt.port}`;
const get=async p=>{let r;try{r=await fetch(B+p,{headers:H})}catch(e){throw new Error(`T3_NOT_REACHABLE: can't reach T3 at ${B} (${(e.cause&&e.cause.code)||e.message}). Is T3 Code open?`)}
 if(r.status===401||r.status===403)throw new Error(`TOKEN_REJECTED (HTTP ${r.status}): the T3 Tots token expired or was revoked. Reissue it (see Token in t3-tots-rules).`);if(!r.ok)throw new Error(p+" "+r.status);return r.json()};
// SECRET_KEYS: word for word the same as scripts/scan-private.py (tests/install_test.py checks)
const SECRET_KEYS = String.raw`sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_[a-z]+_[A-Za-z0-9_]{16,}|whsec_[A-Za-z0-9+/=_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https://hooks\.slack\.com/services/[A-Za-z0-9/]+|https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+`;
const RED=new RegExp(`(${SECRET_KEYS}|eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_.-]+|(?:api[_-]?key|token|secret|password)\\s*[:=]\\s*\\S{8,})`, "gi");
const red=s=>String(s??"").replace(RED,"[redacted]").replaceAll(os.homedir(),"~");
const np=s=>String(s||"").toLowerCase().replace(/\\/g,"/").replace(/\/+$/,"");
const cut=(s,n)=>{s=red(s);return s.length>n?s.slice(0,n)+"…":s};
(async()=>{const sh=await get("/api/orchestration/shell");const days=+a.days||14,since=Date.now()-days*864e5;
// "all", else an exact id, else an exact folder, else an exact title (more than one: AMBIGUOUS, like t3ctl), else every title containing the words (named in a note)
const tiers=q==="all"?[sh.projects]:[p=>p.id===Q,p=>np(p.workspaceRoot)===np(path.resolve(Q.replace(/^~(?=$|[\/\\])/,os.homedir()))),p=>String(p.title||"").toLowerCase()===q].map(f=>sh.projects.filter(f));
const exact=tiers.find(m=>m.length)||[];
if(q!=="all"&&exact.length>1)die("AMBIGUOUS",`${exact.length} projects match "${red(q)}" exactly. Pass the id or folder:\n  ${exact.slice(0,8).map(p=>`${p.id}  ${red(p.title)}  ${red(p.workspaceRoot)}`).join("\n  ")}`);
const projs=exact.length?exact:sh.projects.filter(p=>String(p.title||"").toLowerCase().includes(q)); // several titles containing the words: all of them, and they are listed below
if(!projs.length)die("NOT_FOUND",`no project matches "${red(q)}"`);if(!exact.length&&projs.length>1)console.error(`note: ${projs.length} projects contain "${red(q)}": ${projs.map(p=>red(p.title)).join(" | ")}`);const pid=new Set(projs.map(p=>p.id));
const ts=sh.threads.filter(t=>pid.has(t.projectId)&&Date.parse(t.updatedAt)>=since);const out={generatedAt:new Date().toISOString(),days,computer:os.hostname(),projects:projs.map(p=>({title:red(p.title),root:red(p.workspaceRoot)})),threads:[]};
for(const t of ts){const p=(await get("/api/orchestration/threads/"+encodeURIComponent(t.id))).projection;const items=p.turnItems;
 const files=new Map();for(const i of items)if(i.type==="file_change")files.set(red(i.fileName),(files.get(red(i.fileName))||0)+1);
 for(const c of p.checkpoints||[])for(const f of c.files||[])files.set(red(f.path||f),1);
 const conv=items.filter(i=>(i.type==="user_message"||i.type==="assistant_message")&&i.text).map(i=>({role:i.type==="user_message"?"user":"assistant",at:i.createdAt||i.startedAt,text:cut(i.text,i.type==="user_message"?700:900)}));
 out.threads.push({title:red(t.title),project:red(projs.find(x=>x.id===t.projectId).title),spawned:/^(mcp|provider)$/.test(t.creationSource),model:t.modelSelection?.model,effort:(t.modelSelection?.options||[]).find(o=>/effort|variant/i.test(o.id))?.value||null,
  status:t.activeRunId?"running":t.status,settled:t.settledOverride==="settled"||(!!t.settledAt&&t.settledOverride!=="unsettled"),pendingRequest:!!t.pendingRuntimeRequest,actionablePlan:!!t.hasActionableProposedPlan,lastError:t.lastError?cut(t.lastError.message||JSON.stringify(t.lastError),200):null,
  createdAt:t.createdAt,updatedAt:t.updatedAt,runs:p.runs.length,commands:items.filter(i=>i.type==="command_execution").length,files:[...files].map(([f,n])=>({file:f,edits:n})).slice(0,60),conversation:conv.slice(0,4).concat(conv.length>8?[{role:"gap",text:`… ${conv.length-8} more messages …`}]:[],conv.slice(Math.max(4,conv.length-4)))});}
const s=JSON.stringify(out,null,1);if(a.out){fs.mkdirSync(path.dirname(path.resolve(a.out)),{recursive:true});fs.writeFileSync(a.out,s);console.log("wrote",a.out,out.threads.length,"threads")}else console.log(s);})().catch(e=>{console.error("error:",e.message);process.exit(1)});
