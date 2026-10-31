/* Shared business logic: used by the desktop app and the phone app. Needs a global `S` (the state). */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fd=d=>d?d.split('-').reverse().join('/'):'—';
const money=n=>new Intl.NumberFormat('en-US').format(Math.round(n||0))+' دج';
const num=v=>{const n=parseFloat(v);return isNaN(n)?0:n};
const MONTHS=['جانفي','فيفري','مارس','أفريل','ماي','جوان','جويلية','أوت','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
/* ---------- business rules ---------- */
const CYC=()=>Math.min(4,Math.max(1,Math.floor(num(S.settings.cycle))||4));
const teacherFor=e=>S.teachers.find(t=>t.subject===e.subject&&t.level===e.level);
const priceOf=e=>num(e.price)||num(teacherFor(e)?.price);
function info(e){
  const c=CYC();
  const bl=Array.from({length:6},(_,b)=>{const a=e.att.slice(b*4,b*4+4);return{a,y:a.filter(x=>x&&x.v==='y').length,any:a.some(x=>x)}});
  const done=bl.map(b=>b.y>=c);
  const cycles=done.filter(Boolean).length;
  let cur=done.indexOf(false); if(cur<0)cur=6;
  const renew=cycles>0&&cur<6&&!bl[cur].any;
  const ended=cur===6;
  const subs=Math.max(1,cycles+(cur<6&&bl[cur].any?1:0));
  const price=priceOf(e), due=price*subs;
  const paid=S.pay.filter(p=>p.eid===e.id).reduce((s,p)=>s+num(p.amount),0);
  const t=teacherFor(e), pct=num(t?.pct)/100;
  const cd=[];
  bl.forEach((b,i)=>{if(done[i]){const ys=b.a.filter(x=>x&&x.v==='y');cd.push({block:i+1,date:ys[c-1]?.d||null,amount:price*pct})}});
  const sessions=bl.reduce((s,b)=>s+b.y,0);
  let pst; if(!price)pst='none'; else if(paid<=0)pst='bad'; else if(paid>=due)pst='ok'; else pst='part';
  return{bl,done,cycles,cur,renew,ended,subs,price,due,paid,rest:Math.max(0,due-paid),pst,cd,earned:cycles*price*pct,expected:price*pct,sessions,teacher:t};
}
function totals(){
  let income=S.pay.reduce((s,p)=>s+num(p.amount),0),exp=S.exp.reduce((s,x)=>s+num(x.amount),0);
  let earned=0,expected=0,rest=0,unpaid=0,cycles=0,sessions=0,renew=0;
  S.enr.forEach(e=>{const i=info(e);earned+=i.earned;expected+=i.expected;rest+=i.rest;if(i.pst==='bad')unpaid++;cycles+=i.cycles;sessions+=i.sessions;if(i.renew)renew++});
  const names=new Set(S.enr.map(e=>e.name.trim()));
  const salPaid=S.tpay.reduce((s,p)=>s+num(p.amount),0),salLeft=TN().reduce((s,n)=>s+Math.max(0,tTotals(n).left),0);
  return{salPaid,salLeft,income,exp,earned,expected,rest,unpaid,cycles,sessions,renew,net:income-exp-earned,students:names.size,enr:S.enr.length,teachers:new Set(S.teachers.map(t=>t.name)).size};
}

function fix(){S.tpay=S.tpay||[];S.seq=S.seq||{t:0,p:0,x:0};S.seq.tp=S.seq.tp||0;S.sync=S.sync||{}}
const TN=()=>[...new Set(S.teachers.map(t=>t.name))];
function tTotals(name){let earned=0;S.enr.forEach(e=>{const t=teacherFor(e);if(t&&t.name===name)earned+=info(e).earned});
  const paid=S.tpay.filter(p=>p.name===name).reduce((s,p)=>s+num(p.amount),0);return{earned,paid,left:earned-paid}}

/* unique ids for records created on any device (no collisions between PC and phone) */
let _lastUid=0;
function uid(){let n=Date.now()*1000+Math.floor(Math.random()*1000);if(n<=_lastUid)n=_lastUid+1;_lastUid=n;return n}
function nextEnrId(prefix){
  const m=S.enr.reduce((a,e)=>e.id[0]===prefix?Math.max(a,parseInt(e.id.slice(1))||0):a,0);
  return prefix+String(m+1).padStart(3,'0');
}

