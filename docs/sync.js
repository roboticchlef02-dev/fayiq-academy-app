/* Encrypted sync between the PC and the phone.
   The cloud copy lives in a private GitHub repository as one encrypted file; the key never leaves the devices.
   Records are merged one by one (the most recent edit wins). Shared by the desktop app and the phone app. */
const SYNC_REPO='roboticchlef02-dev/fayiq-sync-data',SYNC_PATH='db.bin';
const MOBILE_URL='https://roboticchlef02-dev.github.io/fayiq-academy-app/';
const COLS=['enr','pay','exp','teachers','tpay'];
let SYNC={state:'idle',msg:'',busy:null};           // state: idle | syncing | error

/* ---------- small helpers ---------- */
const _te=new TextEncoder(),_td=new TextDecoder();
function b64(u8){let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){const b=atob(s.replace(/\s/g,''));const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
const b64u=u8=>b64(u8).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u=s=>unb64(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
function canon(o){if(o===null||typeof o!=='object')return JSON.stringify(o);if(Array.isArray(o))return'['+o.map(canon).join(',')+']';
  return'{'+Object.keys(o).filter(k=>o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(o[k])).join(',')+'}'}
function hsh(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return String(h)}
const strip=r=>{const{u,...x}=r;return x};

async function gz(u8,dir){const s=new (dir==='in'?CompressionStream:DecompressionStream)('gzip');const w=s.writable.getWriter();w.write(u8);w.close();return new Uint8Array(await new Response(s.readable).arrayBuffer())}
const keyOf=k=>crypto.subtle.importKey('raw',unb64u(k),'AES-GCM',false,['encrypt','decrypt']);
async function seal(obj,k){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyOf(k),await gz(_te.encode(JSON.stringify(obj)),'in')));
  const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return out;
}
async function unseal(bytes,k){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await keyOf(k),bytes.slice(12));
  return JSON.parse(_td.decode(await gz(new Uint8Array(pt),'out')));
}

/* ---------- pairing ---------- */
const newKey=()=>b64u(crypto.getRandomValues(new Uint8Array(32)));
const pairCode=c=>'FQ1.'+b64u(_te.encode(JSON.stringify({t:c.t,k:c.k})));
function parsePair(code){
  code=String(code||'').trim().replace(/^.*[#&?]c=/,'');
  if(!code.startsWith('FQ1.'))throw new Error('رمز الربط غير صالح');
  const o=JSON.parse(_td.decode(unb64u(code.slice(4))));
  if(!o.t||!o.k)throw new Error('رمز الربط غير صالح');
  return{t:o.t,k:o.k};
}
const pairLink=c=>MOBILE_URL+'#c='+pairCode(c);
const syncOn=()=>!!(S.sync&&S.sync.cfg);

/* ---------- change tracking: every record carries `u` (time of its last edit) ---------- */
function syncMeta(){S.sync=S.sync||{};const y=S.sync;y.h=y.h||{};y.k=y.k||{};y.d=y.d||{};y.last=y.last||0;return y}
function stamp(){
  const y=syncMeta(),now=Date.now();let ch=false;
  for(const c of COLS){
    const seen=new Set();
    for(const r of S[c]){
      const id=String(r.id),k=c+':'+id,h=hsh(canon(strip(r)));seen.add(id);
      if(y.h[k]!==h){r.u=now;y.h[k]=h;ch=true}
    }
    for(const id of (y.k[c]||[]))if(!seen.has(id)){(y.d[c]=y.d[c]||{})[id]=now;delete y.h[c+':'+id];ch=true}
    y.k[c]=[...seen];
  }
  const hc=hsh(canon({name:S.settings.name,cycle:S.settings.cycle}));
  if(y.h.cfg!==hc){S.settings.u=now;y.h.cfg=hc;ch=true}
  const hl=hsh(canon(strip(S.lists)));
  if(y.h.lists!==hl){S.lists.u=now;y.h.lists=hl;ch=true}
  if(ch)y.dirty=true;
  return ch;
}
function buildDoc(){
  const by=a=>[...a].sort((x,y)=>String(x.id).localeCompare(String(y.id)));
  const c={};for(const k of COLS)c[k]=by(S[k]);
  c.cfg=[{id:'cfg',name:S.settings.name,cycle:S.settings.cycle,u:S.settings.u||0}];
  c.lists=[{id:'lists',...S.lists}];
  return{v:1,t:Date.now(),c,d:S.sync.d};
}
function mergeDoc(doc){
  const y=syncMeta();let changed=false;
  for(const c of COLS){
    const dm=(y.d[c]=y.d[c]||{}),rd=(doc.d&&doc.d[c])||{};
    for(const id in rd)if((dm[id]||0)<rd[id])dm[id]=rd[id];
    for(const id in dm){
      const r=S[c].find(x=>String(x.id)===id);
      if(r&&(r.u||0)<dm[id]){S[c]=S[c].filter(x=>x!==r);changed=true}
    }
    for(const rr of (doc.c[c]||[])){
      const id=String(rr.id);if(dm[id]&&dm[id]>=(rr.u||0))continue;
      const r=S[c].find(x=>String(x.id)===id);
      if(!r){S[c].push(rr);changed=true;y.h[c+':'+id]=hsh(canon(strip(rr)))}
      else if((rr.u||0)>(r.u||0)){Object.keys(r).forEach(k=>delete r[k]);Object.assign(r,rr);changed=true;y.h[c+':'+id]=hsh(canon(strip(rr)))}
    }
    y.k[c]=S[c].map(r=>String(r.id));
  }
  const rc=(doc.c.cfg||[])[0];
  if(rc&&(rc.u||0)>(S.settings.u||0)){S.settings.name=rc.name;S.settings.cycle=rc.cycle;S.settings.u=rc.u;y.h.cfg=hsh(canon({name:rc.name,cycle:rc.cycle}));changed=true}
  const rl=(doc.c.lists||[])[0];
  if(rl&&(rl.u||0)>(S.lists.u||0)){const{id,...l}=rl;S.lists=l;y.h.lists=hsh(canon(strip(l)));changed=true}
  return changed;
}

/* ---------- GitHub transport ---------- */
async function ghFetch(method,body,extra){
  const c=S.sync.cfg;
  return fetch(`https://api.github.com/repos/${SYNC_REPO}/contents/${SYNC_PATH}`,{
    method,cache:'no-store',body:body?JSON.stringify(body):undefined,
    headers:{Authorization:'Bearer '+c.t,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(extra||{})}});
}
async function getRemote(){
  const y=S.sync,r=await ghFetch('GET',null,y.etag&&!y.dirty?{'If-None-Match':y.etag}:null);
  if(r.status===304)return{status:'same'};
  if(r.status===404)return{status:'none'};
  if(r.status===401||r.status===403){throw new Error(r.status===401?'رمز GitHub غير صالح أو منتهي':'تم تجاوز حدّ الطلبات أو لا توجد صلاحية')}
  if(!r.ok)throw new Error('خطأ في الخادم ('+r.status+')');
  const j=await r.json();let bytes;
  if(j.encoding==='base64'&&j.content)bytes=unb64(j.content);
  else{const rr=await ghFetch('GET',null,{Accept:'application/vnd.github.raw+json'});bytes=new Uint8Array(await rr.arrayBuffer())}
  let doc;try{doc=await unseal(bytes,S.sync.cfg.k)}catch(e){throw new Error('مفتاح التشفير لا يطابق بيانات الخادم')}
  return{status:'ok',doc,sha:j.sha,etag:r.headers.get('ETag')};
}
async function putRemote(doc,sha){
  const bytes=await seal(doc,S.sync.cfg.k);
  const r=await ghFetch('PUT',{message:'sync '+new Date().toISOString(),content:b64(bytes),...(sha?{sha}:{})});
  if(r.status===409||r.status===422)return{conflict:true};
  if(r.status===401||r.status===403)throw new Error('لا توجد صلاحية للكتابة على مستودع المزامنة');
  if(!r.ok)throw new Error('فشل الرفع ('+r.status+')');
  const j=await r.json();return{ok:true,sha:j.content.sha};
}

/* ---------- the sync itself ---------- */
function notifySync(){try{window.onSyncChange&&window.onSyncChange()}catch(e){}}
function syncNow(reason){
  if(!syncOn())return Promise.resolve({ok:false});
  if(SYNC.busy)return SYNC.busy;
  SYNC.state='syncing';notifySync();
  SYNC.busy=(async()=>{
    const y=syncMeta();
    let changed=false;
    try{
      for(let attempt=0;attempt<4;attempt++){
        if(y.last)stamp();
        const res=await getRemote();
        if(res.status==='ok'){if(mergeDoc(res.doc))changed=true;y.etag=res.etag;y.sha=res.sha}
        stamp();
        const doc=buildDoc();
        const same=res.status==='same'||(res.status==='ok'&&canon(doc.c)===canon(res.doc.c)&&canon(doc.d)===canon(res.doc.d));
        if(same){y.dirty=false;y.last=Date.now();break}
        const p=await putRemote(doc,res.status==='none'?null:(res.sha||y.sha));
        if(p.conflict){y.etag=null;y.sha=null;continue}
        y.sha=p.sha;y.etag=null;y.dirty=false;y.last=Date.now();break;
      }
      SYNC.state='idle';SYNC.msg='';
      save();try{if(changed&&window.onSynced)window.onSynced()}catch(e){}
      notifySync();return{ok:true};
    }catch(e){
      SYNC.state='error';SYNC.msg=(e&&e.message)||'تعذّرت المزامنة';
      if(!navigator.onLine)SYNC.msg='لا يوجد اتصال بالإنترنت';
      notifySync();
      if(y.dirty)setTimeout(()=>syncNow('retry'),60000);
      return{ok:false,msg:SYNC.msg};
    }finally{SYNC.busy=null}
  })();
  return SYNC.busy;
}
let _syncT=null;
function scheduleSync(){if(!syncOn())return;clearTimeout(_syncT);_syncT=setTimeout(()=>syncNow('change'),20000)}
function startSyncTimers(){
  setTimeout(()=>syncNow('start'),1500);
  setInterval(()=>syncNow('timer'),15*60*1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncNow('visible');else if(S.sync&&S.sync.dirty)syncNow('hidden')});
  window.addEventListener('online',()=>syncNow('online'));
}
async function enableSync(tokenOrCode){
  const v=String(tokenOrCode||'').trim();
  const cfg=v.startsWith('FQ1.')||v.includes('#c=')?parsePair(v):{t:v.replace(/^.*\s/,''),k:(S.sync&&S.sync.cfg&&S.sync.cfg.k)||newKey()};
  if(!cfg.t)throw new Error('الصق رمز GitHub أولًا');
  const y=syncMeta();const old=y.cfg;y.cfg=cfg;
  const r=await fetch('https://api.github.com/repos/'+SYNC_REPO,{headers:{Authorization:'Bearer '+cfg.t,Accept:'application/vnd.github+json'},cache:'no-store'});
  if(!r.ok){y.cfg=old;throw new Error(r.status===401?'رمز GitHub غير صالح':'الرمز لا يملك صلاحية على مستودع المزامنة')}
  save();return syncNow('enable');
}
function disableSync(){const y=syncMeta();y.cfg=null;y.etag=null;y.sha=null;save();notifySync()}
