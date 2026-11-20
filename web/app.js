/* Où est le Poulet: phone web app.
   Two backends with the same shape: Supabase (the real game, role-based access enforced by the database)
   and Local (demo mode, saves to this browser, everything visible). */

/* =================== fixed settings =================== */
const CONFIG = {
  hosts: "Dom & Josh",
  meetPub: "The Bedford",
  meetAddr: "77 Bedford Hill, SW12 9HD",
  radiusMiles: 1,
};
const DEFAULT_TEAMS = [
  {id:"poulet",  num:null, name:"Le Poulet",    color:"#E0A100", chicken:true, members:["Dom","Josh"]},
  {id:"coqs",    num:1,    name:"Les Coqs",     color:"#E5484D", members:["Sam","Jordan","Chloe"]},
  {id:"nuggets", num:2,    name:"The Nuggets",  color:"#3E63DD", members:["Marcus","Ellie","Tom"]},
  {id:"rangers", num:3,    name:"Free Rangers", color:"#12A594", members:["Hana","Ben","Zara"]},
  {id:"hens",    num:4,    name:"Hen Party",    color:"#8E4EC6", members:["Rosie","Kwame","Lily"]},
];
const DEFAULT_SETTINGS = {interval:2, state:"setup", showBoard:false, buyIn:"£15", start:"", budget:0};
const PALETTE = ["#E5484D","#3E63DD","#12A594","#8E4EC6","#F76B15","#D6409F","#0090FF","#46A758","#E0A100","#6E56CF"];
function defaultRules(){
  const ch=chicken();
  return [
    {t:"The chicken flies first", b:`After the first round at ${CONFIG.meetPub}, the chicken (${ch.members.join(" & ")}) leaves with a 15-minute head start and hides in any pub inside the ${CONFIG.radiusMiles}-mile ring. Once they're in, they stay in.`},
    {t:"Hunt as a team", b:"Everyone else sets off in their teams. Stick together all night. No splitting up to cover more pubs."},
    {t:"A drink in every pub", b:"Every pub you walk into, each player buys and finishes a drink before you leave. A half or a soft drink counts. Check in on the app as you arrive."},
    {t:`Every ${D.interval===2?"second":D.interval===1?"":"few"} pub is a challenge`.replace("  "," "), b:"On a challenge pub the app shows your task. Do it, then send a photo or video as proof. When the chicken approves it, your next clue unlocks."},
    {t:"Found the chicken? Join the chicken", b:"Don't shout about it. Buy your drink, squeeze in quietly and let the chicken mark you found. You're hiding with them now, so no tipping off other teams."},
    {t:"Last team buys the round", b:"The game ends when the last team finds the pack, by now crammed into one pub. That team buys the chicken a drink and does a forfeit of Dom's choosing."},
  ];
}
const DEFAULT_HOUSE = [
  "Stay inside the dashed 1-mile ring on the map.",
  "No calling, texting or location-tracking the chicken.",
  "No asking bar staff \"have you seen a group of…\". That's cheating, and they're busy.",
  "Drink water between rounds and look after each other. Nobody gets left behind.",
  "It's Dom's birthday. Dom's word is final on any dispute.",
];

/* =================== map data (OpenStreetMap, ODbL) =================== */
const MAP = window.POULET_MAP;
const STN = MAP.station;
const KX = Math.cos(STN.lat*Math.PI/180)*111320, KY=110540;
const metres = (a,b)=>Math.hypot((b.lng-a.lng)*KX,(b.lat-a.lat)*KY);
const PUBS = MAP.pubs.map(p=>({id:"p"+p.osm, name:p.name, lat:p.lat, lng:p.lng, d:p.d, addr:p.addr, hours:p.hours, web:p.web, garden:p.garden, food:p.food, brand:p.brand}));
const pubById = id=>PUBS.find(p=>p.id===id);
const START = PUBS.find(p=>/^the bedford$/i.test(p.name)) || PUBS[0];
const fmtMi = m=>(m/1609.344).toFixed(m<1609?2:1)+" mi";
const walkMin = m=>Math.max(1,Math.round(m*1.3/80));
const compass = (a,b)=>{const ang=(Math.atan2((b.lng-a.lng)*KX,(b.lat-a.lat)*KY)*180/Math.PI+360)%360;return ["north","north-east","east","south-east","south","south-west","west","north-west"][Math.round(ang/45)%8];};

/* opening hours: understands the common OpenStreetMap forms, e.g. "Mo-Th 12:00-23:00; Fr,Sa 12:00-01:00; Su off" */
const DAYS=["Mo","Tu","We","Th","Fr","Sa","Su"], DAYNAME={Mo:"Mon",Tu:"Tue",We:"Wed",Th:"Thu",Fr:"Fri",Sa:"Sat",Su:"Sun"};
function parseHours(str){
  if(!str) return null; const out={}; let ok=false;
  for(const rule of str.split(";").map(x=>x.trim()).filter(Boolean)){
    const m=rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.+)$/); if(!m) continue;
    const days=new Set();
    m[1].split(",").forEach(part=>{const [a,b]=part.split("-").map(x=>x.trim()); const i=DAYS.indexOf(a), j=b?DAYS.indexOf(b):i;
      for(let k=i;;k=(k+1)%7){days.add(DAYS[k]); if(k===j) break;}});
    const spans=/off|closed/i.test(m[2])?[]:m[2].split(",").map(r=>r.trim().match(/^(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)$/)).filter(Boolean)
      .map(t=>{const o=+t[1]*60+ +t[2]; let c=+t[3]*60+ +t[4]; if(c<=o) c+=1440; return [o,c];});
    days.forEach(d=>{out[d]=spans;}); ok=true;
  }
  return ok?out:null;
}
const hm=m=>{m%=1440;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");};
function hoursNow(str, when){
  const H=parseHours(str); if(!H) return null;
  const d=when||new Date(), di=(d.getDay()+6)%7, mins=d.getHours()*60+d.getMinutes();
  const today=H[DAYS[di]], yest=H[DAYS[(di+6)%7]];
  if(yest) for(const [o,c] of yest) if(c>1440&&mins<c-1440) return {open:true,txt:`Open until ${hm(c)}`};
  if(today===undefined) return {open:null,txt:"Today's hours not listed"};
  for(const [o,c] of today){ if(mins>=o&&mins<c) return {open:true,txt:`Open until ${hm(c)}`}; if(mins<o) return {open:false,txt:`Opens at ${hm(o)}`}; }
  return {open:false,txt:today.length?"Closed for the day":"Closed today"};
}
function weekRows(str){const H=parseHours(str); if(!H) return ""; const di=(new Date().getDay()+6)%7;
  return `<table class="hrs">${DAYS.map((d,i)=>`<tr class="${i===di?"today":""}"><td>${DAYNAME[d]}</td><td>${H[d]===undefined?"–":H[d].length?H[d].map(([o,c])=>hm(o)+"–"+hm(c)).join(", "):"Closed"}</td></tr>`).join("")}</table>`;}

/* =================== helpers =================== */
const CFG = window.POULET_CONFIG || {};
const LS="poulet-v4";
const ls = {get(k){try{return JSON.parse(localStorage.getItem(LS+k))}catch(e){return null}}, set(k,v){try{localStorage.setItem(LS+k,JSON.stringify(v))}catch(e){}}, del(k){try{localStorage.removeItem(LS+k)}catch(e){}}};
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ms=t=>typeof t==="number"?t:Date.parse(t);
const ago=t=>{const m=Math.round((Date.now()-ms(t))/60000);return m<1?"just now":m<60?m+" min ago":Math.round(m/60)+" h ago";};
/* a time that keeps itself up to date: the 30-second ticker rewrites every [data-ago] */
const agoSpan=t=>`<span data-ago="${ms(t)}">${ago(t)}</span>`;
const STALE_MIN=45;
const money=n=>{const v=Math.round(Math.abs(n)*100)/100; return (n<0?"−":"")+"£"+(v%1?v.toFixed(2):String(v));};
const hhmm=t=>new Date(ms(t)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
const gmaps=p=>"https://www.google.com/maps/dir/?api=1&travelmode=walking&destination="+p.lat+","+p.lng;
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const ICON={
  play:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>',
  map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  teams:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>',
  rules:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M9 9h6M9 13h6"/></svg>',
  admin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  cam:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  gallery:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  kitty:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h11l-1 12H7L6 8Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H16.6"/><path d="M8 4c0 1 1 1 1 2M12 3c0 1 1 1 1 2"/></svg>',
  walk:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M7 12l3-4 4 1 3 3M11 15l-1-4"/></svg>',
};
const icon=(k,size,style)=>ICON[k].replace("<svg",`<svg width="${size}" height="${size}"${style?` style="${style}"`:""}`);
const closeBtn='<button class="btn sm ghost" data-action="closesheet">Close</button>';
const sheetHead=title=>`<div class="row">${title?`<h2>${title}</h2>`:""}<span class="spacer"></span>${closeBtn}</div>`;
const fmtPrice=s=>/^\d/.test(s)?"£"+s:s;
let toastT;
function toast(msg,dur){const t=document.getElementById("toast");t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,dur||3400);}
function openSheet(html){document.getElementById("sheetroot").innerHTML=`<div class="scrim" data-action="closesheet"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const f=document.querySelector(".sheet [autofocus]"); if(f&&matchMedia("(min-width:761px)").matches) f.focus();}
function closeSheet(){document.getElementById("sheetroot").innerHTML="";}
function errText(e){const m=(e&&(e.message||e.error_description||e.msg))||String(e||"");
  if(/no_such_team/.test(m)) return "There's no team with that number.";
  if(/already_in_team/.test(m)) return "This phone is already on another team. Ask an organiser to move you.";
  if(/row-level security|permission denied|42501/i.test(m)) return D.settings&&D.settings.state!=="live"?"The game isn't live yet. Wait for the chicken to start it.":"You don't have permission to do that.";
  if(/admins_only/.test(m)) return "Only organisers can do that.";
  if(/Invalid login credentials/i.test(m)) return "That email and password don't match.";
  if(/anonymous/i.test(m)&&/disabled/i.test(m)) return "Joining is switched off. Ask the organiser to enable anonymous sign-ins in Supabase.";
  if(/Failed to fetch|NetworkError|network/i.test(m)) return "No connection. Check your signal and try again.";
  return "Something went wrong. Try again.";}

/* =================== raw data (what this phone is allowed to see) =================== */
const R = {settings:{}, teams:[], rosters:{}, members:[], pubinfo:{}, challenges:{}, secret:{hideout:null,clues:[]},
           visits:[], subs:[], selfies:[], spends:[], unlocked:[], found:[], positions:[], board:[], admins:[], myTeam:null, waiting:null};
const S = {mode:"connecting", loaded:false, me:{email:null,isAdmin:false,userId:null}, adminTab:"live", q:"", cq:"", openPub:null, selPub:null, draft:{},
           chal:{}, viewAs:null, signed:{}, galBy:"team", actTeam:"", seenAt:ls.get("seenAct")||Date.now(), selfieBusy:null};

/* =================== derived state =================== */
let D = {};
function derive(){
  const settings=Object.assign({}, DEFAULT_SETTINGS, R.settings||{});
  const teams=(R.teams.length?R.teams.slice().sort((a,b)=>a.sort-b.sort).map(t=>({id:t.id,num:t.num,name:t.name,color:t.color,chicken:t.is_chicken,members:R.rosters[t.id]||[]})):DEFAULT_TEAMS.map(t=>Object.assign({},t)));
  const visits={}; R.visits.forEach(v=>{(visits[v.team_id]=visits[v.team_id]||[]).push({team:v.team_id,pub:v.pub_id,at:ms(v.at)});});
  Object.values(visits).forEach(a=>a.sort((x,y)=>x.at-y.at||(x.pub<y.pub?-1:1)));
  const subs=R.subs.map(s=>({_id:s.id,team:s.team_id,pub:s.pub_id,stop:s.stop,media:s.media||[],note:s.note,at:ms(s.at),status:s.status,reviewNote:s.review_note,clue:s.clue_no})).sort((a,b)=>b.at-a.at);
  const selfies={}; R.selfies.forEach(x=>{selfies[x.team_id+"|"+x.pub_id]={team:x.team_id,pub:x.pub_id,path:x.path,data:x.data,at:ms(x.at),bucket:"selfies"};});
  const unlocked={}; R.unlocked.forEach(u=>{(unlocked[u.team_id]=unlocked[u.team_id]||[]).push({n:u.n,text:u.body,at:ms(u.at),pub:u.pub_id});});
  Object.values(unlocked).forEach(a=>a.sort((x,y)=>x.n-y.n));
  const found={}; R.found.forEach(f=>{found[f.team_id]={at:ms(f.at)};});
  R.board.forEach(b=>{ if(b.found_at&&!found[b.team_id]) found[b.team_id]={at:ms(b.found_at)}; });
  const positions={}; R.positions.forEach(p=>{positions[p.team_id]={pub:p.pub_id,at:ms(p.at)};});
  const spends=R.spends.map(x=>({id:x.id,amount:+x.amount,note:x.note||"",at:ms(x.at)})).sort((a,b)=>b.at-a.at);
  const kitty={total:Math.max(0,parseFloat(settings.budget)||0), spent:Math.round(spends.reduce((t,x)=>t+x.amount,0)*100)/100};
  kitty.left=Math.round((kitty.total-kitty.spent)*100)/100;
  D={settings, teams, visits, subs, selfies, spends, kitty, unlocked, found, positions, board:R.board,
     challenges:R.challenges, pubinfo:R.pubinfo, secret:R.secret, members:R.members,
     interval:Math.max(1,parseInt(settings.interval)||2)};
}
const hunters=()=>D.teams.filter(t=>!t.chicken);
const chicken=()=>D.teams.find(t=>t.chicken)||D.teams[0];
const teamById=id=>D.teams.find(t=>t.id===id);
const teamOr=id=>teamById(id)||{id,name:id,color:"#888",num:null,members:[]};
const teamLabel=t=>t.chicken?t.name:`Team ${t.num??""} · ${t.name}`;
const dot=(color,size)=>`<span class="dot" style="background:${color}${size?`;width:${size}px;height:${size}px`:""}"></span>`;
const isAdmin=()=>S.mode==="local"||S.me.isAdmin;
/* a signed-in organiser on the real game (in demo mode everyone is organiser and player at once) */
const organiserOnly=()=>S.mode!=="local"&&S.me.isAdmin;
const myTeamId=()=>{ if(isAdmin()&&S.viewAs) return S.viewAs; return R.myTeam&&teamById(R.myTeam)?R.myTeam:null; };
const visitsOf=t=>D.visits[t]||[];
const lastPubOf=t=>{const v=visitsOf(t); if(v.length) return pubById(v[v.length-1].pub); const p=D.positions[t]; return p?pubById(p.pub):null;};
const isStop=i=>(i+1)%D.interval===0;
const subFor=(t,pub)=>D.subs.find(s=>s.team===t&&s.pub===pub);
const selfieFor=(t,pub)=>D.selfies[t+"|"+pub]||null;
const finished=()=>D.settings.state==="finished";
const galleryOpen=()=>isAdmin()||(finished()&&!!myTeamId());
/* every check-in, newest first (organisers see all teams; players only their own) */
const allVisits=()=>Object.values(D.visits).flat().sort((a,b)=>b.at-a.at);
const unseenCount=()=>isAdmin()&&S.mode==="db"?allVisits().filter(v=>v.at>S.seenAt).length:0;
function markSeen(){ S.prevSeen=S.seenAt; S.seenAt=Date.now(); ls.set("seenAct",S.seenAt); }
const foundOrder=()=>hunters().filter(t=>D.found[t.id]).sort((a,b)=>D.found[a.id].at-D.found[b.id].at).map(t=>t.id);
const pending=()=>D.subs.filter(s=>s.status==="pending");
/* phones that asked to join after the game went live, waiting for an organiser */
const joinRequests=()=>D.members.filter(m=>m.approved===false);
const hqCount=()=>pending().length+joinRequests().length+unseenCount();
const live=()=>D.settings.state==="live";
const boardOpen=()=>isAdmin()||D.settings.showBoard===true||D.settings.state==="finished";

function autoClue(n, fromPub){
  const H=pubById(D.secret.hideout); if(!H) return "The chicken hasn't picked a hideout yet. Ask them for a hint in person.";
  const P=fromPub||START, d=metres(P,H);
  if(P.id===H.id) return "Look around you. The chicken is in this very pub.";
  switch(n){
    case 0: return `From ${P.name}, head roughly ${compass(P,H)}.`;
    case 1: return `The chicken is about ${fmtMi(d)} from ${P.name}, roughly a ${walkMin(d)}-minute walk.`;
    case 2: return `The chicken's pub is ${fmtMi(H.d)} from Balham station, to the ${compass(STN,H)}.`;
    case 3: return `Ignore "The": the pub's name starts with ${H.name.replace(/^The\s+/i,"")[0].toUpperCase()}.`;
    case 4: return `The pub's name has ${H.name.replace(/^The\s+/i,"").split(/\s+/).length} word(s) once you drop "The".`;
    default: return `You're ${Math.round(d/25)*25} m from the chicken. Very warm.`;
  }
}

/* =================== backends =================== */
let api=null, sb=null;

function SupabaseBackend(client){
  const q=async p=>{const r=await p; if(r.error) throw r.error; return r.data;};
  const self={
    async load(){
      const admin=S.me.isAdmin, signedIn=!!S.me.userId;
      const jobs={
        settings:client.from("settings").select("data").eq("id",1).maybeSingle(),
        teams:client.from("teams").select("*"),
        pubinfo:client.from("pub_info").select("*"),
        spends:client.from("spends").select("*"),
      };
      if(signedIn){
        Object.assign(jobs,{
          rosters:client.from("team_rosters").select("*"),
          members:client.from("team_members").select("*"),
          visits:client.from("visits").select("*"),
          subs:client.from("submissions").select("*"),
          selfies:client.from("selfies").select("*"),
          unlocked:client.from("unlocked").select("*"),
          found:client.from("found").select("*"),
          positions:client.rpc("team_positions"),
          board:client.rpc("leaderboard"),
        });
        if(admin) Object.assign(jobs,{challenges:client.from("challenges").select("*"), secret:client.from("secret").select("*").eq("id",1).maybeSingle(), admins:client.from("admins").select("email")});
      }
      const keys=Object.keys(jobs), res=await Promise.all(keys.map(k=>jobs[k]));
      const out={}; keys.forEach((k,i)=>{
        if(res[i].error){ if(k==="selfies"||k==="spends"){ console.warn(k+" unavailable. Re-run schema.sql.",res[i].error); out[k]=[]; return; } throw res[i].error; }
        out[k]=res[i].data; });
      R.settings=(out.settings&&out.settings.data)||{};
      R.teams=out.teams||[];
      R.pubinfo={}; (out.pubinfo||[]).forEach(p=>R.pubinfo[p.pub_id]={price:p.price||"",hours:p.hours||"",note:p.note||""});
      R.rosters={}; (out.rosters||[]).forEach(r=>R.rosters[r.team_id]=r.names||[]);
      R.members=out.members||[];
      const mine=R.members.find(m=>m.user_id===S.me.userId);
      R.myTeam=mine&&mine.approved!==false?mine.team_id:null; R.waiting=mine&&mine.approved===false?mine.team_id:null;
      R.visits=out.visits||[]; R.subs=out.subs||[]; R.selfies=out.selfies||[]; R.spends=out.spends||[]; R.unlocked=out.unlocked||[]; R.found=out.found||[];
      R.positions=out.positions||[]; R.board=out.board||[];
      R.challenges={}; (out.challenges||[]).forEach(c=>R.challenges[c.pub_id]={title:c.title||"",text:c.body||""});
      R.secret=out.secret?{hideout:out.secret.hideout,clues:out.secret.clues||[]}:{hideout:null,clues:[]};
      R.admins=(out.admins||[]).map(a=>a.email).sort();
    },
    async join(num,name){
      if(!S.me.userId){ const r=await client.auth.signInAnonymously(); if(r.error) throw r.error; S.me.userId=r.data.user.id; }
      return q(client.rpc("join_team",{p_num:num,p_name:name||null}));
    },
    checkIn:(team,pub)=>q(client.from("visits").insert({team_id:team,pub_id:pub})),
    undoVisit:(team,pub)=>q(client.from("visits").delete().eq("team_id",team).eq("pub_id",pub)),
    getChallenge:async pub=>{const d=await q(client.rpc("get_challenge",{p_pub:pub})); return d?{title:d.title||"",text:d.body||""}:null;},
    async upload(team,pub,blob,type){
      const ext=(type.split("/")[1]||"bin").replace("jpeg","jpg").replace("quicktime","mov").split(";")[0];
      const path=`${team}/${pub}/${Date.now()}-${uid()}.${ext}`;
      await q(client.storage.from("evidence").upload(path,blob,{contentType:type,upsert:false}));
      return {path,type};
    },
    submit:(team,pub,stop,media,note)=>q(client.from("submissions").insert({team_id:team,pub_id:pub,stop,media,note})),
    async signUrls(bucket,paths){ const d=await q(client.storage.from(bucket).createSignedUrls(paths,3600)); const o={}; d.forEach(x=>{ if(x.signedUrl) o[x.path]=x.signedUrl; }); return o; },
    async uploadSelfie(team,pub,blob){
      const path=`${team}/${pub}/${Date.now()}-${uid()}.jpg`;
      await q(client.storage.from("selfies").upload(path,blob,{contentType:"image/jpeg",upsert:false}));
      return path;
    },
    async saveSelfie(team,pub,path,old){
      await q(client.from("selfies").upsert({team_id:team,pub_id:pub,path,at:new Date().toISOString()}));
      if(old&&old!==path) await client.storage.from("selfies").remove([old]);   // tidy up the replaced photo; a failure here is harmless
    },
    addSpend:(amount,note)=>q(client.from("spends").insert({amount,note:note||null})),
    delSpend:id=>q(client.from("spends").delete().eq("id",id)),
    async deleteSelfie(team,pub,path){
      await q(client.from("selfies").delete().eq("team_id",team).eq("pub_id",pub));
      if(path) await client.storage.from("selfies").remove([path]);
    },
    approve:(id,auto)=>q(client.rpc("approve_submission",{p_id:id,p_auto_text:auto})),
    reject:(id,note)=>q(client.rpc("reject_submission",{p_id:id,p_note:note})),
    unlock:(team,auto,pub)=>q(client.rpc("unlock_clue",{p_team:team,p_auto_text:auto,p_pub:pub})),
    relock:team=>q(client.rpc("relock_clue",{p_team:team})),
    setFound:(team,on)=>on?q(client.from("found").upsert({team_id:team})):q(client.from("found").delete().eq("team_id",team)),
    saveSettings:data=>q(client.from("settings").update({data,updated_at:new Date().toISOString()}).eq("id",1)),
    saveSecret:s=>q(client.from("secret").update({hideout:s.hideout||null,clues:s.clues}).eq("id",1)),
    saveChallenge:(pub,c)=>c?q(client.from("challenges").upsert({pub_id:pub,title:c.title,body:c.text})):q(client.from("challenges").delete().eq("pub_id",pub)),
    savePubInfo:(pub,i)=>i?q(client.from("pub_info").upsert({pub_id:pub,price:i.price,hours:i.hours,note:i.note})):q(client.from("pub_info").delete().eq("pub_id",pub)),
    async saveTeams(list){
      await q(client.from("teams").upsert(list.map(t=>({id:t.id,num:null,name:t.name,color:t.color,is_chicken:!!t.chicken,sort:t.sort}))));   // clear numbers first (they're unique)
      await q(client.from("teams").upsert(list.map(t=>({id:t.id,num:t.num,name:t.name,color:t.color,is_chicken:!!t.chicken,sort:t.sort}))));
      await q(client.from("team_rosters").upsert(list.map(t=>({team_id:t.id,names:t.members}))));
    },
    deleteTeam:id=>q(client.from("teams").delete().eq("id",id)),
    moveMember:(user,team)=>q(client.from("team_members").update({team_id:team}).eq("user_id",user)),
    approveMember:(user,team)=>q(client.from("team_members").update({team_id:team,approved:true}).eq("user_id",user)),
    removeMember:user=>q(client.from("team_members").delete().eq("user_id",user)),
    addAdmin:email=>q(client.from("admins").insert({email})),
    removeAdmin:email=>q(client.from("admins").delete().eq("email",email)),
  };
  return self;
}

function LocalBackend(){
  const K="demo";
  const db=Object.assign({settings:{}, teams:null, rosters:{}, members:[], pubinfo:{}, challenges:{}, secret:{hideout:null,clues:[]}, visits:[], subs:[], selfies:[], spends:[], unlocked:[], found:[], myTeam:null}, ls.get(K)||{});
  if(!db.teams){ db.teams=DEFAULT_TEAMS.map((t,i)=>({id:t.id,num:t.num,name:t.name,color:t.color,is_chicken:!!t.chicken,sort:i})); DEFAULT_TEAMS.forEach(t=>db.rosters[t.id]=t.members.slice()); }
  const save=()=>ls.set(K,db), now=()=>new Date().toISOString();
  const nextN=t=>db.unlocked.filter(u=>u.team_id===t).reduce((m,u)=>Math.max(m,u.n),0)+1;
  const clueText=(n,auto)=>((db.secret.clues[n-1]||"").trim())||auto||"Ask the chicken for a hint.";
  return {
    async load(){
      R.settings=db.settings; R.teams=db.teams; R.rosters=db.rosters; R.members=db.members; R.pubinfo=db.pubinfo; R.challenges=db.challenges;
      R.secret=db.secret; R.visits=db.visits; R.subs=db.subs; R.selfies=db.selfies; R.spends=db.spends; R.unlocked=db.unlocked; R.found=db.found; R.myTeam=db.myTeam; R.admins=[];
      R.waiting=(db.members.find(m=>m.user_id==="me"&&m.approved===false)||{}).team_id||null;
      const pos={}; db.visits.forEach(v=>{ if(!pos[v.team_id]||ms(v.at)>ms(pos[v.team_id].at)) pos[v.team_id]=v; });
      R.positions=Object.values(pos);
      R.board=db.teams.filter(t=>!t.is_chicken).map(t=>({team_id:t.id,pubs:db.visits.filter(v=>v.team_id===t.id).length,clues:db.unlocked.filter(u=>u.team_id===t.id).length,found_at:(db.found.find(f=>f.team_id===t.id)||{}).at||null}));
    },
    async join(num,name){ const t=db.teams.find(x=>x.num===num&&!x.is_chicken); if(!t) throw new Error("no_such_team");
      const cur=db.members.find(m=>m.user_id==="me"); if(cur&&cur.team_id!==t.id) throw new Error("already_in_team");
      if(cur){ if(name) cur.display_name=name; save(); return t.id; }
      const open=(db.settings.state||"setup")==="setup";   // teams lock once the game is live
      db.members.push({user_id:"me",team_id:t.id,display_name:name||null,joined_at:now(),approved:open}); if(open) db.myTeam=t.id; save(); return t.id; },
    async checkIn(team,pub){ if((db.settings.state||"setup")!=="live") throw new Error("row-level security"); if(!db.visits.some(v=>v.team_id===team&&v.pub_id===pub)) db.visits.push({team_id:team,pub_id:pub,at:now()}); save(); },
    async undoVisit(team,pub){ const f=x=>!(x.team_id===team&&x.pub_id===pub); db.visits=db.visits.filter(f); db.selfies=db.selfies.filter(f); save(); },
    async getChallenge(pub){ const c=db.challenges[pub]; return c&&(c.title||c.text)?c:(db.challenges._all||{title:"",text:""}); },
    async upload(team,pub,blob,type){ return {path:"demo/"+uid(),type,demo:true}; },
    async submit(team,pub,stop,media,note){ db.subs.push({id:uid(),team_id:team,pub_id:pub,stop,media,note,at:now(),status:"pending"}); save(); },
    async signUrls(){ return {}; },
    /* demo mode keeps a small copy of the photo in this browser, so the gallery can be tried without Supabase */
    async uploadSelfie(team,pub,blob){ return "demo:"+await shrinkToDataUrl(blob,480); },
    async saveSelfie(team,pub,path){ if((db.settings.state||"setup")!=="live") throw new Error("row-level security");
      db.selfies=db.selfies.filter(x=>!(x.team_id===team&&x.pub_id===pub)); db.selfies.push({team_id:team,pub_id:pub,path:"demo",data:path.slice(5),at:now()}); save(); },
    async addSpend(amount,note){ db.spends.push({id:uid(),amount,note:note||null,at:now()}); save(); },
    async delSpend(id){ db.spends=db.spends.filter(x=>x.id!==id); save(); },
    async deleteSelfie(team,pub){ db.selfies=db.selfies.filter(x=>!(x.team_id===team&&x.pub_id===pub)); save(); },
    async approve(id,auto){ const s=db.subs.find(x=>x.id===id); if(!s||s.status==="approved") return; const n=nextN(s.team_id);
      db.unlocked.push({team_id:s.team_id,n,body:clueText(n,auto),pub_id:s.pub_id,at:now()}); Object.assign(s,{status:"approved",clue_no:n,reviewed_at:now(),review_note:null}); save(); return n; },
    async reject(id,note){ const s=db.subs.find(x=>x.id===id); if(s) Object.assign(s,{status:"rejected",review_note:note||null,reviewed_at:now()}); save(); },
    async unlock(team,auto,pub){ const n=nextN(team); db.unlocked.push({team_id:team,n,body:clueText(n,auto),pub_id:pub||null,at:now()}); save(); return n; },
    async relock(team){ const n=nextN(team)-1; db.unlocked=db.unlocked.filter(u=>!(u.team_id===team&&u.n===n)); save(); },
    async setFound(team,on){ db.found=db.found.filter(f=>f.team_id!==team); if(on) db.found.push({team_id:team,at:now()}); save(); },
    async saveSettings(data){ db.settings=data; save(); },
    async saveSecret(s){ db.secret={hideout:s.hideout||null,clues:s.clues}; save(); },
    async saveChallenge(pub,c){ if(c) db.challenges[pub]=c; else delete db.challenges[pub]; save(); },
    async savePubInfo(pub,i){ if(i) db.pubinfo[pub]=i; else delete db.pubinfo[pub]; save(); },
    async saveTeams(list){ db.teams=list.map(t=>({id:t.id,num:t.num,name:t.name,color:t.color,is_chicken:!!t.chicken,sort:t.sort})); list.forEach(t=>db.rosters[t.id]=t.members); save(); },
    async deleteTeam(id){ db.teams=db.teams.filter(t=>t.id!==id); delete db.rosters[id]; ["visits","subs","selfies","unlocked","found","members"].forEach(k=>db[k]=db[k].filter(x=>x.team_id!==id)); if(db.myTeam===id) db.myTeam=null; save(); },
    async moveMember(user,team){ const m=db.members.find(x=>x.user_id===user); if(m) m.team_id=team; if(user==="me"&&m&&m.approved!==false) db.myTeam=team; save(); },
    async approveMember(user,team){ const m=db.members.find(x=>x.user_id===user); if(m){ m.team_id=team; m.approved=true; } if(user==="me") db.myTeam=team; save(); },
    async removeMember(user){ db.members=db.members.filter(x=>x.user_id!==user); if(user==="me") db.myTeam=null; save(); },
    async addAdmin(){}, async removeAdmin(){},
    reset(){ ls.del(K); },
  };
}

/* run a change, then refresh what this phone can see */
async function act(fn, okMsg){
  try{ const r=await fn(); if(okMsg) toast(typeof okMsg==="function"?okMsg(r):okMsg); await refresh(); return r; }
  catch(e){ console.warn(e); toast(errText(e)); await refresh().catch(()=>{}); throw e; }
}
let refreshT=null, refreshing=null;
async function refresh(){ if(refreshing) return refreshing; refreshing=(async()=>{ try{ await api.load(); S.loaded=true; }catch(e){ console.warn(e); if(S.loaded) toast(errText(e)); } finally{ refreshing=null; } derive(); renderAll(); })(); return refreshing; }
function softRefresh(){ clearTimeout(refreshT); refreshT=setTimeout(refresh,500); }

/* signed links for private evidence */
function signedUrl(m){
  if(!m) return "";
  if(m.data) return m.data;                       // demo-mode selfie
  if(!m.path||m.demo) return "";
  const b=m.bucket||"evidence", k=b+":"+m.path;
  if(S.signed[k]) return S.signed[k];
  queueSign(b,m.path); return "";
}
let signQ={}, signT=null;
function queueSign(b,p){ (signQ[b]=signQ[b]||new Set()).add(p); clearTimeout(signT); signT=setTimeout(async()=>{ const q=signQ; signQ={};
  try{ for(const [bucket,set] of Object.entries(q)){ const o=await api.signUrls(bucket,[...set]); Object.entries(o).forEach(([p,u])=>S.signed[bucket+":"+p]=u); } renderAll(); }
  catch(e){ console.warn(e); } },50); }

/* challenges: players fetch theirs from the database only at a challenge pub */
function challengeFor(pubId){
  if(isAdmin()&&S.mode!=="local"&&!S.viewAs){ const c=D.challenges[pubId]; return c&&(c.title||c.text)?c:(D.challenges._all||null); }
  if(S.chal[pubId]!==undefined) return S.chal[pubId];
  S.chal[pubId]=null; api.getChallenge(pubId).then(c=>{S.chal[pubId]=c||null; renderAll();}).catch(()=>{});
  return null;
}

/* =================== navigation =================== */
const NAV=[["play","Play"],["map","Map"],["teams","Teams"],["rules","Rules"],["admin","HQ"]];
/* organisers don't play, so their Play tab only appears while they preview a team */
const navAllowed=k=>k==="admin"?isAdmin():k==="play"?!(organiserOnly()&&!S.viewAs):true;
const home=()=>navAllowed("play")?"play":"admin";
const route=()=>{let h=location.hash.slice(1); if(h==="gallery") h="teams"; return NAV.some(n=>n[0]===h)&&navAllowed(h)?h:home();};
function renderChrome(){
  const r=route(), items=NAV.filter(n=>navAllowed(n[0])), pc=isAdmin()?hqCount():0;
  const badge=k=>k==="admin"&&pc?`<span class="cnt">${pc}</span>`:"";
  document.getElementById("toptabs").innerHTML=items.map(([k,l])=>`<a href="#${k}" ${r===k?'aria-current="page"':""}>${l}${badge(k)}</a>`).join("");
  document.getElementById("bottomnav").innerHTML=items.map(([k,l])=>`<a href="#${k}" ${r===k?'aria-current="page"':""}>${ICON[k]}<span>${l}</span>${badge(k)}</a>`).join("");
  const t=teamById(myTeamId()), pill=document.getElementById("teampill"), on=S.mode==="db"&&S.loaded;
  const sync=`<span class="sync ${on?"live":""}" title="${S.mode==="db"?(on?"Live":"Connecting…"):"Demo mode"}"></span>`;
  pill.innerHTML=(t?`<span class="sw" style="background:${t.color}"></span>${esc(t.name)}${S.viewAs?" (preview)":""}`:organiserOnly()?"Organiser":R.waiting?"Waiting…":"Join a team")+sync;
  NAV.forEach(([k])=>{document.getElementById("v-"+k).hidden=(k!==r);});
}
/* theme: follows the device unless this phone picks light or dark */
function applyTheme(k){ if(k==="light"||k==="dark") document.documentElement.dataset.theme=k; else delete document.documentElement.dataset.theme; }
const themePicker=()=>{const cur=ls.get("theme")||"auto";
  return `<div class="row"><span class="lbl">Appearance</span><span class="spacer"></span><div class="segs" role="group" aria-label="Appearance">${[["auto","Auto"],["light","Light"],["dark","Dark"]].map(([k,l])=>`<button type="button" data-action="theme" data-k="${k}" aria-pressed="${cur===k}">${l}</button>`).join("")}</div></div>`;};
/* one menu for who you are: join, preview, sign in or out */
function accountSheet(){
  const t=teamById(myTeamId()), status=S.mode==="db"?(S.loaded?"Connected live.":"Connecting…"):"Demo mode: everything saves on this device only.";
  if(organiserOnly()) return `${sheetHead("Organiser")}<p class="sm muted">Signed in as ${esc(S.me.email||"")}. ${status}</p>
    <div class="lbl">Preview a team</div>
    <div class="teampick">${hunters().map(x=>`<button type="button" data-action="viewas" data-team="${x.id}" ${S.viewAs===x.id?'aria-pressed="true"':""}><span class="sw" style="background:${x.color}"></span><b>${esc(teamLabel(x))}</b></button>`).join("")}</div>
    ${S.viewAs?'<button class="btn block" data-action="stopview">Stop preview</button>':""}
    ${themePicker()}
    <button class="btn block ghost danger" data-action="signout">Sign out</button>`;
  const w=!t&&teamById(R.waiting);
  return `${sheetHead(t?esc(t.name):w?"Waiting to join":"Join a team")}<p class="sm muted">${t?`You're on ${esc(teamLabel(t))}. `:w?`You've asked to join ${esc(teamLabel(w))}. The chicken will let you in. `:""}${status}</p>
    ${t||w?"":'<button class="btn primary block" data-action="jointeam">Join with your team number</button>'}
    ${S.me.email&&!S.me.isAdmin?`<div class="banner">${esc(S.me.email)} isn't on the organiser list.</div><button class="btn block" data-action="signout">Sign out</button>`
      :sb?'<button class="btn block ghost" data-action="signin">Organiser sign-in</button>':""}
    ${themePicker()}`;
}

/* =================== PLAY =================== */
const meetLine=()=>`Meet at <b>${esc(CONFIG.meetPub)}</b>, ${esc(CONFIG.meetAddr)}${D.settings.start?`, <b>${esc(D.settings.start)}</b>`:""}.`;
function stateBanner(){
  const st=D.settings.state;
  if(st==="setup") return `<div class="banner yolk">${meetLine()} Check-ins open when the chicken starts the game.</div>`;
  if(st==="finished") return `<div class="banner"><b>Game over.</b> Final standings and every team's selfies are on the <a href="#teams">Teams</a> tab.</div>`;
  return "";
}
function joinScreen(){
  const w=teamById(R.waiting), locked=D.settings.state&&D.settings.state!=="setup";
  if(w) return `<div><h1>Nearly there</h1><p class="muted" style="margin-top:6px">The game has started, so teams are locked.</p></div>
    <div class="card"><div class="row">${dot(w.color,14)}<b>${esc(teamLabel(w))}</b></div>
      <p>You've asked to join. The chicken will let you in, and this screen updates by itself.</p>
      <p class="sm muted">Wrong team? Ask ${esc(CONFIG.hosts)} to move you.</p></div>
    ${kittyCard()}`;
  return `<div><h1>Bonsoir! Which team are you?</h1><p class="muted" style="margin-top:6px">Type your team number. You only do this once on this phone.</p></div>
    ${locked?`<div class="banner yolk">The game has started, so teams are locked. You can still ask to join, and the chicken will let you in.</div>`:stateBanner()}
    <div class="card"><div class="field"><label for="joinnum">Team number</label><input type="number" id="joinnum" inputmode="numeric" min="1" placeholder="e.g. 1" autocomplete="off" style="font-size:28px;font-weight:700;text-align:center"></div>
      <div class="field"><label for="joinname">Your name (optional)</label><input type="text" id="joinname" placeholder="So the chicken knows who sent what" autocomplete="given-name"></div>
      <button class="btn primary block" data-action="dojoin">${locked?"Ask to join":"Join team"}</button>
      <p class="sm muted">Not sure of your number? Ask ${esc(CONFIG.hosts)}.</p></div>
    ${kittyCard()}`;
}
function viewPlay(){
  const tid=myTeamId();
  if(!tid) return joinScreen();
  const t=teamById(tid), v=visitsOf(tid), clues=D.unlocked[tid]||[], n=v.length, k=D.interval, found=D.found[tid];
  const last=v.length?v[v.length-1]:null, lastIdx=n-1;
  const lastSub=last?subFor(tid,last.pub):null;
  const showChal=last&&isStop(lastIdx)&&!(lastSub&&lastSub.status==="approved");
  let h=S.viewAs?`<div class="banner yolk row"><span>Previewing <b>${esc(t.name)}</b>.</span><span class="spacer"></span><button class="btn sm" data-action="stopview">Stop preview</button></div>`:stateBanner();
  h+=`<div class="hero"><div class="row"><span class="sw" style="background:${t.color}"></span><span class="lbl">Team ${t.num??""}</span><span class="spacer"></span>${found?'<span class="pill good">Found the chicken</span>':""}</div>
    <h1>${esc(t.name)}</h1>
    ${t.members.length?`<p class="muted">${t.members.map(esc).join(" · ")}</p>`:""}
    <div class="stats"><div><b class="num">${n}</b><span>Pubs</span></div><div><b class="num">${clues.length}</b><span>Clues</span></div></div>
  </div>`;
  h+=kittyCard();
  if(found){
    h+=`<div class="card"><h2>You found them. Now you're the chicken too.</h2><p class="muted">Stay put, keep it quiet, and enjoy watching the others search.</p></div>`;
  } else {
    h+=`<div class="card"><div><h2>${last?`At ${esc(pubById(last.pub).name)}?`:"Ready when you are"}</h2><p class="muted sm">${last?`Checked in ${ago(last.at)}. Moving on? Check in at the next pub.`:`Everyone starts at ${esc(CONFIG.meetPub)}. Check in when you walk into each pub.`}</p></div>
      <div class="progress" aria-label="Progress to next challenge pub">${Array.from({length:k},(_,i)=>`<i class="${i<(n%k||(n&&showChal?k:0))?"on":""}"></i>`).join("")}</div>
      <button class="btn primary block" data-action="checkin" ${live()||S.viewAs?"":"disabled"}>${ICON.pin} ${live()||S.viewAs?"Check in to a pub":"Check-ins open when the game starts"}</button></div>`;
    if(showChal) h+=challengeCard(tid,last.pub,lastIdx);
  }
  h+=installCard();
  h+=`<div class="card"><div class="row"><h2>Clues</h2><span class="spacer"></span><span class="sm muted">${clues.length} unlocked</span></div>
    ${clues.slice().reverse().map(c=>`<div class="clue"><div class="n">${c.n}</div><div><p>${esc(c.text)}</p><span class="sm muted">Unlocked ${hhmm(c.at)}${c.pub&&pubById(c.pub)?` · from ${esc(pubById(c.pub).name)}`:""}</span></div></div>`).join("")}
    <div class="clue locked"><div class="n">${clues.length+1}</div><div><p>Locked</p><span class="sm muted">Finish the challenge at your next challenge pub and send evidence. The chicken unlocks it.</span></div></div>
  </div>`;
  h+=`<div class="card"><h2>Your crawl</h2>${v.length?`<div class="timeline">${v.slice().reverse().map((x,ri)=>{const i=v.length-1-ri,p=pubById(x.pub),st=isStop(i),s=st?subFor(tid,x.pub):null;
      const done=s&&s.status==="approved", inline=ri===0&&showChal;
      /* the latest challenge is the card above; an older unfinished one opens from its pill */
      const pill=!st?"":done||inline?statusPill(s):`<button class="pillbtn" data-action="openchal" data-pub="${x.pub}" data-i="${i}" aria-label="Open challenge">${statusPill(s)}</button>`;
      return `<div class="tl"><span class="k ${st?"c":""}">${i+1}</span><div style="min-width:0"><b>${esc(p?p.name:"Unknown pub")}</b><div class="sm muted">${hhmm(x.at)}${st?" · challenge pub":""}</div>${selfieThumb(tid,x.pub)}</div>
      <div class="row" style="gap:6px;justify-content:flex-end">${pill}${ri===0&&!done&&!S.viewAs?`<button class="btn sm ghost" data-action="undovisit" data-pub="${x.pub}" aria-label="Undo check-in">Undo</button>`:""}</div></div>`;}).join("")}</div>`
    :`<div class="empty">${icon("walk",28)}<span>No pubs yet. Your first check-in starts the clock.</span></div>`}</div>`;
  return h;
}
/* selfies */
const selfieInput=(id,tid,pub,cls,label)=>`<label class="${cls}" for="${id}">${label}<input type="file" id="${id}" accept="image/*" capture="user" class="vh" data-action="pickselfie" data-team="${tid}" data-pub="${pub}"></label>`;
function selfieThumb(tid,pub){
  const sf=selfieFor(tid,pub), u=signedUrl(sf), busy=S.selfieBusy===tid+"|"+pub;
  if(busy) return `<span class="sthumb" aria-label="Uploading selfie">…</span>`;
  if(sf) return `<button class="sthumb" data-action="viewselfie" data-team="${tid}" data-pub="${pub}" aria-label="View selfie">${u?`<img src="${esc(u)}" alt="">`:""}</button>`;
  return live()&&!S.viewAs?selfieInput("sf-"+pub,tid,pub,"btn sm selfie-add",`${icon("cam",14)} Selfie`):"";
}
function selfieSheet(tid,pub){
  const p=pubById(pub);
  return `<div class="selfie-ask">${icon("cam",40)}
    <h2>Team selfie at ${esc(p?p.name:"the pub")}</h2>
    <p class="muted">Proof you made it. Only your team and the chicken see it until the game ends, then everyone can.</p>
    ${selfieInput("sfs-"+pub,tid,pub,"btn primary block","Take the selfie")}
    <button class="btn block ghost" data-action="closesheet">Skip for now</button></div>`;
}
function selfieViewSheet(tid,pub){
  const sf=selfieFor(tid,pub), u=signedUrl(sf), t=teamOr(tid), p=pubById(pub);
  const canRetake=live()&&!S.viewAs&&tid===myTeamId();
  return `<div class="row">${dot(t.color)}<b>${esc(t.name)}</b><span class="spacer"></span>${closeBtn}</div>
    <div class="selfie-big">${u?`<img src="${esc(u)}" alt="${esc(t.name)} at ${esc(p?p.name:"")}">`:'<div class="media-ph" style="width:100%;height:320px">Loading…</div>'}</div>
    <p class="sm muted">${esc(p?p.name:"")}${sf?` · ${hhmm(sf.at)}`:""}</p>
    ${canRetake?selfieInput("sfr-"+pub,tid,pub,"btn block",`${icon("cam",16)} Retake`):""}`;
}
async function uploadSelfie(tid,pub,file){
  const key=tid+"|"+pub, old=selfieFor(tid,pub);
  S.selfieBusy=key; closeSheet(); renderAll(); toast("Uploading your selfie…",20000);
  try{
    const blob=await compressImage(file);
    if(blob.size>5*1024*1024){ toast("That photo is too big. Try again."); return; }
    const path=await api.uploadSelfie(tid,pub,blob);
    await act(()=>api.saveSelfie(tid,pub,path,old&&old.path),old?"Selfie replaced.":"Selfie saved. Looking good.");
  }catch(e){ console.warn(e); toast(/row-level|403|Unauthorized/i.test((e&&e.message)||"")?(live()?"Upload refused. Make sure you've joined a team.":"The game isn't live, so selfies are closed."):"Upload failed. Check your signal and try again."); }
  finally{ S.selfieBusy=null; renderAll(); }
}
function shrinkToDataUrl(blob,max){ return createImageBitmap(blob).then(bmp=>{const s=Math.min(1,max/Math.max(bmp.width,bmp.height));
  const c=document.createElement("canvas"); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s); c.getContext("2d").drawImage(bmp,0,0,c.width,c.height); return c.toDataURL("image/jpeg",.72);}); }

/* =================== KITTY =================== */
/* everyone sees what's left; organisers knock off each round they buy */
function kittyCard(){
  const k=D.kitty, admin=isAdmin()&&!S.viewAs;
  if(!k.total&&!D.spends.length) return "";
  const pct=k.total?Math.max(0,Math.min(100,k.left/k.total*100)):0, lvl=k.left<0||pct<10?"low":pct<25?"mid":"ok", last=D.spends[0];
  return `<div class="card kitty ${lvl}"><div class="row"><span class="lbl">${icon("kitty",14,"vertical-align:-2px")} Kitty</span><span class="spacer"></span>${admin?`<button class="btn sm yolk" data-action="spend">Bought a round</button>`:""}</div>
    <div class="kbig"><b class="num">${money(Math.abs(k.left))}</b><span>${k.left<0?"over budget":"left"}</span></div>
    <div class="kbar" role="meter" aria-valuemin="0" aria-valuemax="${k.total}" aria-valuenow="${Math.max(0,k.left)}" aria-label="Kitty left"><i style="width:${pct}%"></i></div>
    <div class="sm muted">${money(k.spent)} spent of ${money(k.total)}${D.spends.length?` · ${D.spends.length} ${D.spends.length===1?"round":"rounds"}`:""}${last?` · last ${money(last.amount)} ${agoSpan(last.at)}`:""}</div></div>`;
}
function spendSheet(){
  return `${sheetHead("Bought a round")}
    <p class="sm muted">${money(D.kitty.left)} left in the kitty.</p>
    <div class="field"><label for="spend-amt">How much? (£)</label><input type="text" id="spend-amt" inputmode="decimal" placeholder="e.g. 42.50" autocomplete="off" autofocus style="font-size:28px;font-weight:700;text-align:center"></div>
    <div class="field"><label for="spend-note">What for? (optional)</label><input type="text" id="spend-note" placeholder="e.g. Round for the found teams"></div>
    <p class="sm muted">Everyone can see the amount and note, so don't name the pub you're hiding in.</p>
    <button class="btn primary block" data-action="dospend">Take it off the kitty</button>`;
}
/* HQ → Setup: the total and the log. Rounds are added from the kitty card on HQ → Live. */
function adminKitty(){
  const k=D.kitty;
  return `<div class="card"><h2>Kitty</h2><p class="sm muted">Usually the buy-in (${esc(D.settings.buyIn||"£15")}) times the number of players. Everyone sees the total and what's left. Log rounds from HQ → Live.</p>
      <div class="row"><input type="text" id="kitty-total" inputmode="decimal" value="${k.total||""}" placeholder="e.g. 240" aria-label="Kitty total in pounds" style="flex:1;min-width:120px"><button class="btn primary" data-action="savekitty">Save total</button></div>
      ${D.spends.length?D.spends.map(x=>`<div class="trow"><b class="num">${money(x.amount)}</b><div style="min-width:0"><span>${esc(x.note||"Round")}</span><div class="sm muted">${hhmm(x.at)} · ${agoSpan(x.at)}</div></div><button class="btn sm ghost danger" data-action="delspend" data-id="${esc(x.id)}">Remove</button></div>`).join(""):""}</div>`;
}
const parseMoney=v=>{const n=parseFloat(String(v||"").replace(/[£,\s]/g,"")); return isFinite(n)?Math.round(n*100)/100:NaN;};

/* =================== GALLERY =================== */
function galleryTile(sf){
  const t=teamOr(sf.team), p=pubById(sf.pub), u=signedUrl(sf);
  return `<button class="gtile" data-action="viewselfie" data-team="${sf.team}" data-pub="${sf.pub}">
    ${u?`<img src="${esc(u)}" alt="${esc(t.name)} at ${esc(p?p.name:"")}" loading="lazy">`:'<span class="media-ph">Loading…</span>'}
    <span class="cap"><span class="dot" style="background:${t.color}"></span><span>${esc(S.galBy==="team"?(p?p.name:""):t.name)}</span></span></button>`;
}
/* shown under the standings on the Teams tab once the game is finished (organisers always) */
function gallerySection(){
  const all=Object.values(D.selfies);
  let h=`<div class="row" id="gallery"><h2>Selfies</h2><span class="spacer"></span><div class="segs" role="group" aria-label="Group selfies by">${[["team","By team"],["pub","By pub"]].map(([k,l])=>`<button type="button" data-action="galby" data-k="${k}" aria-pressed="${S.galBy===k}">${l}</button>`).join("")}</div></div>`;
  if(isAdmin()&&!finished()) h+=`<p class="sm muted">Players see everyone's selfies once you set the game to Finished.</p>`;
  if(!all.length) return h+`<div class="card empty">${icon("gallery",28)}<span>No selfies yet. Teams add one each time they check in.</span></div>`;
  if(S.galBy==="team"){
    h+=hunters().map(t=>{const order=visitsOf(t.id).map(v=>v.pub), list=all.filter(x=>x.team===t.id).sort((a,b)=>order.indexOf(a.pub)-order.indexOf(b.pub));
      return list.length?`<div class="card"><div class="row">${dot(t.color,14)}<h3>${esc(t.name)}</h3><span class="spacer"></span><span class="sm muted">${list.length} ${list.length===1?"pub":"pubs"}</span></div><div class="ggrid">${list.map(galleryTile).join("")}</div></div>`:"";}).join("");
  } else {
    const byPub={}; all.forEach(x=>(byPub[x.pub]=byPub[x.pub]||[]).push(x));
    h+=Object.entries(byPub).sort((a,b)=>Math.min(...a[1].map(x=>x.at))-Math.min(...b[1].map(x=>x.at))).map(([pid,list])=>{const p=pubById(pid);
      return `<div class="card"><div class="row"><h3>${esc(p?p.name:"Unknown pub")}</h3><span class="spacer"></span><span class="sm muted">${list.length} ${list.length===1?"team":"teams"}</span></div><div class="ggrid">${list.sort((a,b)=>a.at-b.at).map(galleryTile).join("")}</div></div>`;}).join("");
  }
  return h;
}

function statusPill(s){if(!s)return `<span class="pill">To do</span>`;return s.status==="approved"?`<span class="pill good">Clue ${s.clue||""} unlocked</span>`:s.status==="rejected"?`<span class="pill bad">Try again</span>`:`<span class="pill yolk">With the chicken</span>`;}
function challengeCard(tid,pubId,i){
  const c=challengeFor(pubId), s=subFor(tid,pubId), dk=tid+"|"+pubId, dr=S.draft[dk]||{files:[],note:""};
  const canSend=(live()||S.mode==="local")&&!S.viewAs;
  return `<div class="card chal"><div class="row"><span class="lbl" style="color:var(--yolk-ink)">Challenge pub · stop ${i+1}</span><span class="spacer"></span>${statusPill(s)}</div>
    <div class="t">${c&&c.title?esc(c.title):"Your challenge"}</div>
    <p>${c&&c.text?esc(c.text):`The chicken hasn't posted this challenge yet. Message ${esc(CONFIG.hosts)} for it, then send your evidence here.`}</p>
    ${s&&s.status==="pending"?`<div class="banner">Evidence sent ${ago(s.at)}. Hang tight while the chicken checks it. Your clue appears here as soon as they approve.</div>`:
    `${s&&s.status==="rejected"?`<div class="banner"><b>Not quite.</b> ${esc(s.reviewNote||"Have another go and resend.")}</div>`:""}
     <label class="drop" for="ev-${pubId}">${icon("cam",26)}<b style="color:var(--ink)">Add photo or video</b><span class="sm">Images are shrunk automatically. Videos up to 20 MB.</span>
       <input type="file" id="ev-${pubId}" accept="image/*,video/*" multiple data-action="pickfiles" data-key="${dk}"></label>
     ${dr.files.length?`<div class="media-prev">${dr.files.map(f=>f.type.startsWith("video")?`<video src="${f.preview}" muted playsinline></video>`:`<img src="${f.preview}" alt="">`).join("")}</div>`:""}
     <div class="field"><label for="note-${pubId}">Anything to add?</label><input type="text" id="note-${pubId}" data-action="note" data-key="${dk}" value="${esc(dr.note)}" placeholder="e.g. Ellie did the tower solo"></div>
     <button class="btn yolk block" data-action="submit" data-team="${tid}" data-pub="${pubId}" data-i="${i}" ${canSend?"":"disabled"}>Send evidence to the chicken</button>`}
  </div>`;
}
const challengeSheet=(tid,pub,i)=>openSheet(sheetHead("")+challengeCard(tid,pub,i));

let deferredInstall=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;renderAll();});
const standalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
function installCard(){
  if(standalone()||ls.get("noinstall")) return "";
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(!deferredInstall&&!ios) return "";
  return `<div class="card"><div class="row"><div style="min-width:0"><h3>Put it on your home screen</h3><p class="sm muted">${deferredInstall?"Opens full-screen like a normal app.":"In Safari, tap the Share button, then <b>Add to Home Screen</b>."}</p></div><span class="spacer"></span>
    ${deferredInstall?'<button class="btn primary sm" data-action="install">Install</button>':""}<button class="btn ghost sm" data-action="hideinstall">Not now</button></div></div>`;
}
function checkinSheet(q){
  const tid=myTeamId(), from=lastPubOf(tid)||START, seen=new Set(visitsOf(tid).map(v=>v.pub));
  const list=PUBS.filter(p=>!q||p.name.toLowerCase().includes(q.toLowerCase())).map(p=>({p,m:metres(from,p)})).sort((a,b)=>a.m-b.m);
  return `${sheetHead("Which pub?")}
    <input type="search" id="pubq" placeholder="Search ${PUBS.length} pubs" value="${esc(q||"")}" autocomplete="off" aria-label="Search pubs">
    <p class="sm muted">Sorted by distance from ${esc(from.name)}.</p>
    <div class="items" id="pubqlist">${list.map(({p,m})=>pubRow(p,{action:"confirmcheckin",m,seen:seen.has(p.id),disabled:seen.has(p.id),
      meta:seen.has(p.id)?"Already visited":`${walkMin(m)} min walk · ${fmtMi(m)}`})).join("")}</div>`;
}
/* one pub row for the check-in sheet and the map list; the badge shows miles, or a tick once visited */
function pubRow(p,{action,m,seen,disabled,sel,meta}){
  return `<button class="pubrow ${sel?"sel":""}" data-action="${action}" data-pub="${p.id}" ${disabled?"disabled":""}>
    <span class="ic ${p.id===START.id?"start":""} ${seen?"done":""}">${seen?"✓":fmtMi(m).replace(" mi","")}</span>
    <span style="min-width:0"><b>${esc(p.name)}</b><small>${meta}</small></span></button>`;
}

/* =================== MAP =================== */
let LM=null, layers={}, pubMarkers={};
const HOVER=matchMedia("(hover:hover) and (pointer:fine)").matches;
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function initMap(){
  if(LM||typeof L==="undefined") return;
  const canvas=L.canvas({padding:.5});
  LM=L.map("leaflet",{preferCanvas:true,renderer:canvas,zoomSnap:.5,minZoom:13,maxZoom:19,attributionControl:true,zoomControl:false});
  LM.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  LM.setView([STN.lat,STN.lng],14); L.control.zoom({position:"bottomright"}).addTo(LM);
  const pad=0.022; LM.setMaxBounds([[STN.lat-pad,STN.lng-pad*1.6],[STN.lat+pad,STN.lng+pad*1.6]]);
  layers.tiles=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,className:"osm-tiles",
    attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(LM);
  layers.ring=L.circle([STN.lat,STN.lng],{radius:MAP.radius,renderer:canvas,interactive:false,weight:2.5,dashArray:"8 8",fill:true,fillOpacity:.04}).addTo(LM);
  L.marker([STN.lat,STN.lng],{icon:L.divIcon({className:"",html:'<span class="pin-stn"></span>',iconSize:[0,0]}),title:"Balham station",keyboard:false}).bindTooltip("Balham station",{direction:"top",offset:[0,-10]}).addTo(LM);
  PUBS.forEach(p=>{
    const m = p.id===START.id
      ? L.marker([p.lat,p.lng],{icon:L.divIcon({className:"",html:`<span class="pin-start">START · ${esc(p.name)}</span>`,iconSize:[0,0]}),title:p.name,zIndexOffset:900})
      : L.circleMarker([p.lat,p.lng],{renderer:canvas,radius:7,weight:2.5,fillOpacity:1});
    m.bindPopup(()=>pubPopup(p),{autoPanPadding:[30,80],maxWidth:300});
    if(HOVER) m.bindTooltip(()=>pubCard(p,false),{direction:"top",offset:[0,-10],opacity:1,className:"pubtip"});
    m.on("popupopen",()=>m.closeTooltip&&m.closeTooltip()); m.on("click",()=>{S.selPub=p.id;renderPubList();});
    m.addTo(LM); pubMarkers[p.id]=m;
  });
  layers.teams=L.layerGroup().addTo(LM);
  styleMap(); fitAll(); renderMapDynamic();
}
function isDark(){const t=document.documentElement.dataset.theme; return t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;}
function styleMap(){
  if(!LM) return;
  document.getElementById("leaflet").classList.toggle("dark-tiles",isDark());
  layers.ring.setStyle({color:css("--comb"),fillColor:css("--comb")});
  stylePubs();
}
function stylePubs(){
  if(!LM) return;
  const tid=myTeamId(), seen=new Set(tid?visitsOf(tid).map(v=>v.pub):[]);
  PUBS.forEach(p=>{const m=pubMarkers[p.id]; if(!m||!m.setStyle) return;
    const done=seen.has(p.id), sel=S.selPub===p.id;
    m.setStyle({color:sel?css("--yolk"):css("--surface"),fillColor:done?css("--good"):css("--ink"),radius:sel?10:7});});
}
function fitAll(){if(LM) LM.fitBounds(L.latLng(STN.lat,STN.lng).toBounds(MAP.radius*2.1),{padding:[10,10]});}
function infoOf(p){const o=D.pubinfo[p.id]||{}; return {price:(o.price||"").trim(), hours:(o.hours||"").trim()||p.hours||"", note:(o.note||"").trim()};}
function pubCard(p, full){
  const i=infoOf(p), now=hoursNow(i.hours), from=lastPubOf(myTeamId())||null, dm=from&&from.id!==p.id?metres(from,p):null;
  const tags=[p.id===START.id?'<span class="pill yolk">Meeting point</span>':"", p.garden?'<span class="pill">Beer garden</span>':"", p.food?'<span class="pill">Food</span>':"", p.brand?`<span class="pill">${esc(p.brand)}</span>`:""].join("");
  return `<div class="pcard"><div class="pc-h"><b>${esc(p.name)}</b>${p.addr?`<span class="sm muted">${esc(p.addr)}</span>`:""}</div>
    <div class="pc-grid">
      <div><span class="lbl">Pint</span><b class="num">${i.price?esc(fmtPrice(i.price)):"–"}</b><span class="sm muted">${i.price?"average":"not added yet"}</span></div>
      <div><span class="lbl">Today</span><b class="${now&&now.open?"ok":now&&now.open===false?"no":""}">${now?(now.open?"Open":now.open===false?"Closed":"–"):"–"}</b><span class="sm muted">${now?esc(now.txt):"Hours not listed"}</span></div>
      <div><span class="lbl">Walk</span><b class="num">${walkMin(dm||p.d)} min</b><span class="sm muted">from ${dm?"your last pub":"the station"}</span></div>
    </div>
    ${tags?`<div class="row" style="gap:6px">${tags}</div>`:""}
    ${i.note?`<p class="sm">${esc(i.note)}</p>`:""}
    ${full&&i.hours&&parseHours(i.hours)?`<details><summary class="sm">Opening hours this week</summary>${weekRows(i.hours)}</details>`:""}
    ${full&&p.web?`<a class="sm" href="${esc(p.web)}" target="_blank" rel="noopener">Pub website</a>`:""}
  </div>`;
}
function visibleTeamsOnMap(){ return hunters().filter(t=>!D.found[t.id]&&(t.id===myTeamId()||isAdmin())); }
function pubPopup(p){
  const tid=myTeamId(), seen=tid&&visitsOf(tid).some(v=>v.pub===p.id);
  const here=visibleTeamsOnMap().filter(t=>{const lp=lastPubOf(t.id);return lp&&lp.id===p.id;});
  return `<div class="pp">${pubCard(p,true)}
    ${here.length?`<span class="sm">Last seen here: ${here.map(t=>esc(t.name)).join(", ")}</span>`:""}
    <div class="row" style="gap:6px">${tid&&!seen&&!D.found[tid]&&!S.viewAs&&live()?`<button class="btn sm primary" data-action="confirmcheckin" data-pub="${p.id}">Check in</button>`:seen?'<span class="pill good">Visited</span>':""}
    <a class="btn sm" href="${gmaps(p)}" target="_blank" rel="noopener">Directions</a></div></div>`;
}
function renderMapDynamic(){
  if(!LM) return;
  layers.teams.clearLayers();
  const at={};
  visibleTeamsOnMap().forEach(t=>{const lp=lastPubOf(t.id);if(lp)(at[lp.id]=at[lp.id]||[]).push(t);});
  Object.entries(at).forEach(([pid,ts])=>{const p=pubById(pid); if(!p) return; ts.forEach((t,j)=>{
    const ang=-Math.PI/4+j*0.9;
    L.marker([p.lat+Math.sin(ang)*0.00018, p.lng+Math.cos(ang)*0.00028],{interactive:false,zIndexOffset:1000,icon:L.divIcon({className:"",html:`<span class="pin-team" style="background:${t.color}">${esc(t.name.replace(/^(The|Le|Les)\s+/i,"")[0])}</span>`,iconSize:[0,0]})}).addTo(layers.teams);});});
  stylePubs();
}
function renderPubList(){
  const el=document.getElementById("publist"); if(!el) return;
  const tid=myTeamId(), seen=new Set(tid?visitsOf(tid).map(v=>v.pub):[]), q=S.q.toLowerCase();
  const list=PUBS.filter(p=>!q||p.name.toLowerCase().includes(q));
  const shown=visibleTeamsOnMap();
  const legend=shown.length?`<div class="row sm" style="gap:12px">${shown.map(t=>`<span class="row" style="gap:6px">${dot(t.color)}${esc(t.name)}</span>`).join("")}</div>`:"";
  const meta=p=>{const i=infoOf(p),n=hoursNow(i.hours);return [p.id===START.id?"Meeting point":"", n?n.txt:"", i.price?fmtPrice(i.price)+" pint":""].filter(Boolean).join(" · ")||"&nbsp;";};
  el.innerHTML=`${legend}
    <input type="search" id="mapq" placeholder="Search ${PUBS.length} pubs" value="${esc(S.q)}" aria-label="Search pubs" autocomplete="off">
    <div class="items">${list.map(p=>pubRow(p,{action:"focuspub",m:p.d,seen:seen.has(p.id),sel:S.selPub===p.id,meta:meta(p)})).join("")||'<p class="sm muted">No pubs match that.</p>'}</div>`;
}

/* =================== TEAMS =================== */
function viewTeams(){
  const fo=foundOrder(), open=boardOpen(), mine=myTeamId();
  const stats={}; D.board.forEach(b=>stats[b.team_id]=b);
  const ranked=hunters().slice().sort((a,b)=>{const fa=fo.indexOf(a.id),fb=fo.indexOf(b.id);
    if(fa>=0||fb>=0) return (fa<0?99:fa)-(fb<0?99:fb);
    const sa=stats[a.id]||{}, sb_=stats[b.id]||{};
    return (sb_.clues||0)-(sa.clues||0) || (sb_.pubs||0)-(sa.pubs||0) || (a.num||0)-(b.num||0);});
  const list=open?ranked:hunters();
  const card=(t,i)=>{const st=stats[t.id], f=fo.indexOf(t.id), seeDetail=open||t.id===mine;
    return `<article class="teamcard"><div class="top"><span class="sw" style="background:${t.color}">${open?i+1:t.num??""}</span><div style="min-width:0"><h3>${esc(t.name)}${t.id===mine?' <span class="pill">You</span>':""}</h3><span class="sm muted">Team ${t.num??""}</span></div><span class="spacer"></span>
      ${f>=0&&seeDetail?'<span class="pill good">Found</span>':seeDetail?'<span class="pill">Hunting</span>':`<span class="pill">${icon("lock",12)} Hidden</span>`}</div>
      <div class="body">${t.members.length?`<div class="members">${t.members.map(m=>`<span>${esc(m)}</span>`).join("")}</div>`:""}
      ${seeDetail&&st?`<div class="kpis"><div><b class="num">${st.pubs}</b><span>Pubs</span></div><div><b class="num">${st.clues}</b><span>Clues</span></div></div>`:""}
      </div></article>`;};
  return `<div><h1>Teams</h1><p class="muted">${open?"Ranked by who found the chicken first, then by clues unlocked.":"Scores stay secret until the end of the game. You can see your own team's progress."}</p></div>
    ${chickenCard(fo.length,open)}
    <div class="lbl">Hunting teams</div>
    <div class="grid2">${list.map(card).join("")}</div>
    ${galleryOpen()?gallerySection():""}`;
}

/* the chicken isn't competing, so it sits above the teams rather than among them */
function chickenCard(foundN,open){
  const c=chicken(), all=hunters().length;
  const status=open&&foundN?(foundN===all?"Everyone found them":`Found by ${foundN} of ${all}`):"Hiding";
  return `<section class="card chickencard"><div class="row"><span class="csw" style="background:${c.color}">P</span>
    <div style="min-width:0"><span class="lbl">The chicken</span><h3>${esc(c.name)}</h3>${c.members.length?`<span class="sm muted">${c.members.map(esc).join(" · ")}</span>`:""}</div>
    <span class="spacer"></span><span class="pill">${status}</span></div></section>`;
}

/* =================== RULES =================== */
function rulesList(){ const r=D.settings.rules; return Array.isArray(r)&&r.length?r:defaultRules(); }
function houseList(){ const r=D.settings.house; return Array.isArray(r)&&r.length?r:DEFAULT_HOUSE; }
function viewRules(){
  return `<div><h1>How to play</h1><p class="muted">Où est le Poulet is hide and seek with pubs. The chicken hides, everyone else drinks their way to finding them.</p></div>
  <div class="facts">
    <div class="fact"><span class="lbl">Buy-in</span><b>${esc(D.settings.buyIn||"£15")}</b><span class="sm muted">Per person, paid at the start. It goes in the kitty.</span></div>
    <div class="fact"><span class="lbl">Meet</span><b>${esc(CONFIG.meetPub)}</b><span class="sm muted">${esc(CONFIG.meetAddr)}. ${esc(CONFIG.hosts)} buy the first round.${D.settings.start?` Start time: <b>${esc(D.settings.start)}</b>.`:""}</span></div>
    <div class="fact"><span class="lbl">Play area</span><b>${CONFIG.radiusMiles} mile${CONFIG.radiusMiles===1?"":"s"}</b><span class="sm muted">From Balham station. ${PUBS.length} pubs to choose from.</span></div>
  </div>
  <h2>The rules</h2>
  <ol class="steps">${rulesList().map(r=>`<li><div><h3>${esc(r.t)}</h3><p>${esc(r.b)}</p></div></li>`).join("")}</ol>
  <div class="card"><h2>House rules</h2><ul class="plain">${houseList().map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
}
function signinSheet(){
  return `${sheetHead("Organiser sign-in")}
    <form id="signinform" style="display:grid;gap:12px">
      <div class="field"><label for="signin-email">Email</label><input type="text" id="signin-email" inputmode="email" autocomplete="username" autocapitalize="off" autofocus></div>
      <div class="field"><label for="signin-pw">Password</label><input type="password" id="signin-pw" autocomplete="current-password"></div>
      <button class="btn primary block" type="submit" id="signin-go">Sign in</button></form>
    ${R.myTeam?'<p class="sm muted">Signing in here takes this phone off its team.</p>':""}`;
}

/* =================== ADMIN =================== */
/* Chicken HQ: Live (running the night), Setup (game, kitty, teams, organisers), Content (what players read) */
const ATABS=[["live","Live"],["setup","Setup"],["content","Content"]];
function viewAdmin(){
  const n=hqCount();
  return `<div><h1>Chicken HQ</h1>${S.mode==="local"?'<p class="muted">Demo mode: everything saves on this device only. Add your Supabase details to config.js to run the real game.</p>':""}</div>
    <div class="segs" role="group" aria-label="Chicken HQ sections">${ATABS.map(([k,l])=>`<button type="button" data-action="atab" data-k="${k}" aria-pressed="${S.adminTab===k}">${l}${k==="live"&&n?` <span class="cnt">${n}</span>`:""}</button>`).join("")}</div>
    ${({live:adminLive,setup:adminSetup,content:adminContent})[S.adminTab]()}`;
}
function mediaHtml(s){return (s.media||[]).map(m=>{const u=signedUrl(m); if(!u) return `<div class="media-ph">${m.demo?"Demo photo":"Loading…"}</div>`;
  return m.type&&m.type.startsWith("video")?`<video src="${esc(u)}" controls playsinline preload="metadata"></video>`:`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Evidence photo" loading="lazy"></a>`;}).join("");}
function lastSeenLine(tid){
  const v=visitsOf(tid), last=v[v.length-1];
  if(!last) return `<span class="sm muted">No check-ins yet</span>`;
  const p=pubById(last.pub), stale=live()&&!D.found[tid]&&Date.now()-last.at>STALE_MIN*60000;
  return `<span class="sm lastseen ${stale?"stale":""}" ${D.found[tid]?"":`data-stale="${last.at}"`}>At <b>${esc(p?p.name:"?")}</b> · ${hhmm(last.at)} · ${agoSpan(last.at)}</span>`;
}

/* ---- Live ---- */
function adminLive(){ return adminRequests()+kittyCard()+adminReview()+adminBoard()+adminFeed(); }
/* teams are locked once the game is live: late phones wait here until an organiser lets them in */
function adminRequests(){
  const list=joinRequests(); if(!list.length) return "";
  return `<div class="card"><h2>Asking to join</h2><p class="sm muted">Teams are locked while the game is live. Check the team before you let them in.</p>
    ${list.map(m=>{const t=teamOr(m.team_id);return `<div class="trow board">${dot(t.color,14)}<div style="display:grid;gap:8px;min-width:0"><div><b>${esc(m.display_name||"Unnamed phone")}</b> <span class="sm muted">· asked for ${esc(teamLabel(t))} · ${ago(m.joined_at)}</span></div>
      <div class="row" style="gap:6px"><select id="req-${esc(m.user_id)}" aria-label="Team for ${esc(m.display_name||"this phone")}" style="width:auto">${hunters().map(x=>`<option value="${x.id}" ${x.id===m.team_id?"selected":""}>Team ${x.num??""}</option>`).join("")}</select>
        <button class="btn sm good" data-action="approvejoin" data-user="${esc(m.user_id)}">Let in</button><button class="btn sm ghost danger" data-action="kick" data-user="${esc(m.user_id)}" data-msg="Request declined.">Decline</button></div></div></div>`;}).join("")}</div>`;
}
function adminReview(){
  const p=pending(), done=D.subs.filter(s=>s.status!=="pending").slice(0,12);
  const subCard=s=>{const t=teamOr(s.team), pub=pubById(s.pub), c=D.challenges[s.pub]||D.challenges._all, n=(D.unlocked[s.team]||[]).length;
    const nextClue=(D.secret.clues[n]||"").trim()||autoClue(n,pub);
    return `<div class="card sub"><div class="row">${dot(t.color,14)}<h3>${esc(t.name)}</h3><span class="spacer"></span><span class="sm muted">${ago(s.at)}</span></div>
      <div class="sm"><b>${esc(pub?pub.name:"?")}</b> · stop ${s.stop}${c&&c.title?` · ${esc(c.title)}`:""}</div>
      ${s.media&&s.media.length?`<div class="media-prev">${mediaHtml(s)}</div>`:`<p class="sm muted">No photo or video attached${s.note?"":". They may show you in person."}</p>`}
      ${s.note?`<p>“${esc(s.note)}”</p>`:""}
      <div class="banner yolk sm"><b>Approving unlocks clue ${n+1}:</b> ${esc(nextClue)}</div>
      <div class="row"><button class="btn good" data-action="approve" data-id="${esc(s._id)}">Approve and unlock</button>
        <input type="text" id="rej-${esc(s._id)}" placeholder="Reason (optional)" style="flex:1;min-width:140px">
        <button class="btn danger" data-action="reject" data-id="${esc(s._id)}">Send back</button></div></div>`;};
  return p.map(subCard).join("")+(done.length?`<details class="card"><summary><b>Reviewed evidence</b> <span class="sm muted">(${done.length})</span></summary>
    ${done.map(s=>{const t=teamOr(s.team);return `<div class="trow">${dot(t.color)}<div style="min-width:0"><b>${esc(t.name)}</b> <span class="sm muted">· ${esc((pubById(s.pub)||{}).name||"")}</span></div>${statusPill(s)}</div>`;}).join("")}</details>`:"");
}
/* one row per team: where they are, how they're doing, and what you can do about it */
function adminBoard(){
  return `<div class="card"><h2>Teams</h2>${hunters().map(t=>{const v=visitsOf(t.id), n=(D.unlocked[t.id]||[]).length, f=D.found[t.id], sel=v.filter(x=>selfieFor(t.id,x.pub)).length;
    return `<div class="trow board">${dot(t.color,14)}
      <div style="display:grid;gap:6px;min-width:0"><div class="row" style="gap:8px"><b>${esc(teamLabel(t))}</b>${f?'<span class="pill good">Found</span>':""}</div>
        <span class="sm muted">${v.length} pubs · ${n} clues · ${sel}/${v.length} selfies</span>
        ${f?"":lastSeenLine(t.id)}
        <div class="row" style="gap:6px"><button class="btn sm" data-action="unlock" data-team="${t.id}">Unlock clue ${n+1}</button>
          ${n?`<button class="btn sm ghost" data-action="relock" data-team="${t.id}">Re-lock ${n}</button>`:""}
          <button class="btn sm ${f?"ghost":"good"}" data-action="found" data-team="${t.id}">${f?"Undo found":"Mark found"}</button></div></div></div>`;}).join("")}</div>`;
}
/* check-in feed: organisers only (the database never sends other teams' visits to players) */
function adminFeed(){
  const f=S.actTeam, list=allVisits().filter(v=>!f||v.team===f).slice(0,150);
  const rows=list.map(v=>{const t=teamOr(v.team), p=pubById(v.pub), n=visitsOf(v.team).findIndex(x=>x.pub===v.pub)+1, sf=selfieFor(v.team,v.pub), u=signedUrl(sf);
    return `<div class="trow act ${v.at>(S.prevSeen||S.seenAt)?"new":""}">${dot(t.color,14)}
      <div style="min-width:0"><b>${esc(t.name)}</b> <span class="sm">at ${esc(p?p.name:"?")}</span><div class="sm muted">Pub ${n} · ${hhmm(v.at)} · ${agoSpan(v.at)}</div></div>
      ${sf?`<button class="sthumb" data-action="viewselfie" data-team="${v.team}" data-pub="${v.pub}" aria-label="View selfie">${u?`<img src="${esc(u)}" alt="">`:""}</button>`:"<span></span>"}</div>`;}).join("");
  return `<div class="card"><div class="row"><h2>Check-ins</h2><span class="spacer"></span><select id="actteam" aria-label="Filter by team" style="width:auto">
      <option value="">All teams</option>${hunters().map(t=>`<option value="${t.id}" ${f===t.id?"selected":""}>${esc(teamLabel(t))}</option>`).join("")}</select></div>
    ${rows||'<p class="sm muted">No check-ins yet.</p>'}</div>`;
}

/* ---- Setup ---- */
function adminSetup(){
  const st=D.settings.state, sw=(id,on,label,help)=>`<label class="switch" for="${id}"><input type="checkbox" id="${id}" data-setting="${id.replace("set-","")}" ${on?"checked":""}><span class="track"><span class="knob"></span></span><span><b>${label}</b><span class="sm muted" style="display:block">${help}</span></span></label>`;
  const byTeam={}, joined=D.members.filter(m=>m.approved!==false); joined.forEach(m=>(byTeam[m.team_id]=byTeam[m.team_id]||[]).push(m));
  return `<div class="card"><h2>Game</h2>
      <div class="statebar">${[["setup","Not started","Players can join teams. No check-ins yet."],["live","Live","Check-ins and evidence are open."],["finished","Finished","Check-ins close. Scores and selfies are revealed."]].map(([k,l,hlp])=>
        `<button type="button" class="statebtn ${st===k?"on":""}" data-action="setstate" data-k="${k}" aria-pressed="${st===k}"><b>${l}</b><span class="sm">${hlp}</span></button>`).join("")}</div>
      ${sw("set-showBoard",D.settings.showBoard===true,"Show the leaderboard during the game","Off: scores are revealed when you finish the game.")}</div>
    <div class="card"><h2>Settings</h2>
      <div class="grid2" style="gap:12px">
        <div class="field"><label for="set-buyIn">Buy-in</label><input type="text" id="set-buyIn" value="${esc(D.settings.buyIn||"")}" placeholder="£15"></div>
        <div class="field"><label for="set-start">Start time at ${esc(CONFIG.meetPub)}</label><input type="text" id="set-start" value="${esc(D.settings.start||"")}" placeholder="e.g. Sat 6 Dec, 2pm"></div>
        <div class="field"><label for="set-int">Challenge every how many pubs?</label><input type="number" id="set-int" min="1" max="6" value="${D.interval}"></div>
      </div>
      <div><button class="btn primary" data-action="savesettings">Save settings</button></div></div>
    ${adminKitty()}
    <div class="card"><div class="row"><h2>Teams</h2><span class="spacer"></span><button class="btn sm" data-action="addteam">Add team</button></div>
      <p class="sm muted">The first team is the chicken. The rest are numbered 1, 2, 3… in this order, and that number is how players join. Member names: one per line or separated by commas.</p>
      ${D.teams.map((t,i)=>`<div class="chalrow"><div class="row"><span class="pill" style="min-width:64px;justify-content:center">${t.chicken?"Chicken":"Team "+i}</span><input type="text" id="tn-${i}" value="${esc(t.name)}" style="flex:1;min-width:150px" aria-label="Team name">
          <select id="tc-${i}" style="width:auto" aria-label="Team colour">${PALETTE.concat(PALETTE.includes(t.color)?[]:[t.color]).map(c=>`<option value="${c}" ${c===t.color?"selected":""}>${c}</option>`).join("")}</select>
          ${dot(t.color,20)}${t.chicken?"":`<button class="btn sm ghost danger" data-action="delteam" data-id="${t.id}">Remove</button>`}</div>
        <textarea id="tm-${i}" aria-label="${esc(t.name)} members">${esc(t.members.join(", "))}</textarea></div>`).join("")}
      <div><button class="btn primary" data-action="saveteams">Save teams</button></div></div>
    <div class="card"><h2>Players</h2><p class="sm muted">Phones that have joined a team. Move someone who joined the wrong team, or remove them so they can join again. Once the game is live, new phones need your approval on HQ → Live.</p>
      ${joined.length?hunters().map(t=>(byTeam[t.id]||[]).length?`<div class="lbl" style="margin-top:6px">${esc(teamLabel(t))}</div>${byTeam[t.id].map(m=>`<div class="trow">${dot(t.color)}<div style="min-width:0"><b>${esc(m.display_name||"Unnamed phone")}</b><div class="sm muted">Joined ${ago(m.joined_at)}</div></div>
        <div class="row" style="gap:6px"><select data-move="${esc(m.user_id)}" aria-label="Move player" style="width:auto">${hunters().map(x=>`<option value="${x.id}" ${x.id===t.id?"selected":""}>Team ${x.num??""}</option>`).join("")}</select><button class="btn sm ghost danger" data-action="kick" data-user="${esc(m.user_id)}">Remove</button></div></div>`).join("")}`:"").join(""):'<p class="sm muted">Nobody has joined yet.</p>'}</div>
    ${S.mode==="local"?'<div class="card"><h2>Demo data</h2><p class="sm muted">Clears everything saved on this device.</p><div><button class="btn danger" data-action="resetdemo">Reset demo</button></div></div>'
      :`<div class="card"><h2>Organisers</h2><p class="sm muted">Emails that can sign in to Chicken HQ. Each one also needs an account: Supabase → Authentication → Users → Add user (tick Auto Confirm).</p>
      ${R.admins.map(e=>`<div class="trow">${dot("var(--yolk)")}<span class="sm">${esc(e)}${e===S.me.email?" (you)":""}</span>${e===S.me.email?"<span></span>":`<button class="btn sm ghost danger" data-action="deladmin" data-id="${esc(e)}">Remove</button>`}</div>`).join("")}
      <div class="row"><input type="text" id="adminq" inputmode="email" autocomplete="off" autocapitalize="off" placeholder="friend@example.com" aria-label="Organiser email" style="flex:1;min-width:180px"><button class="btn" data-action="addadmin">Add</button></div></div>`}`;
}

/* ---- Content ---- */
function adminContent(){ return adminClues()+adminChallenges()+adminRules(); }
function adminClues(){
  const H=pubById(D.secret.hideout), clues=D.secret.clues.length?D.secret.clues:["","","","",""];
  return `<div class="card"><h2>Hideout</h2><p class="sm muted">Only organisers can see this. Automatic clues are worked out from it.</p>
      <select id="hideout"><option value="">Not chosen yet</option>${PUBS.map(p=>`<option value="${p.id}" ${D.secret.hideout===p.id?"selected":""}>${esc(p.name)} · ${fmtMi(p.d)}</option>`).join("")}</select>
      ${H?`<span class="sm">Hiding at <b>${esc(H.name)}</b></span>`:""}</div>
    <div class="card"><div class="row"><h2>Clues, in order</h2><span class="spacer"></span><button class="btn sm" data-action="addclue">Add clue</button></div>
      <p class="sm muted">Each approved challenge unlocks the next clue for that team. Leave one blank and the app writes it from the team's location and your hideout.</p>
      ${clues.map((c,i)=>`<div class="clueedit"><span class="n">${i+1}</span><div class="field"><textarea data-clue="${i}" aria-label="Clue ${i+1}" placeholder="Auto: ${esc(autoClue(i,null))}">${esc(c)}</textarea></div><button class="btn sm ghost" data-action="delclue" data-i="${i}" aria-label="Remove clue ${i+1}">Remove</button></div>`).join("")}
      <div><button class="btn primary" data-action="saveclues">Save clues</button></div></div>`;
}
/* every pub folds away; only the one being edited is open */
function adminChallenges(){
  const q=(S.cq||"").toLowerCase(), list=PUBS.filter(p=>!q||p.name.toLowerCase().includes(q));
  const all=D.challenges._all||{}, setN=PUBS.filter(p=>{const c=D.challenges[p.id];return c&&(c.title||c.text);}).length;
  return `<div class="card"><h2>Default challenge</h2><p class="sm muted">Used at any challenge pub that doesn't have its own. Teams only see a challenge once they reach that challenge pub.</p>
      <div class="field"><label for="ch-_all-t">Title</label><input type="text" id="ch-_all-t" value="${esc(all.title||"")}" placeholder="e.g. Pub selfie"></div>
      <div class="field"><label for="ch-_all-x">What they have to do</label><textarea id="ch-_all-x" placeholder="e.g. Get a selfie with the bar staff">${esc(all.text||"")}</textarea></div>
      <div><button class="btn primary" data-action="savechal" data-pub="_all">Save default</button></div></div>
    <div class="card"><div class="row"><h2>Pubs</h2><span class="spacer"></span><span class="sm muted">${setN} of ${PUBS.length} have their own challenge</span></div>
      <input type="search" id="chalq" placeholder="Find a pub" value="${esc(S.cq||"")}" aria-label="Find a pub">
      <div>${list.map(p=>{const c=D.challenges[p.id]||{}, pi=D.pubinfo[p.id]||{};
        return `<details class="pubedit" data-pub="${p.id}" ${S.openPub===p.id?"open":""}><summary><b>${esc(p.name)}</b><span class="sm muted">${fmtMi(p.d)}</span><span class="spacer"></span>${c.title||c.text?'<span class="pill good">Challenge</span>':""}</summary>
        <div class="chalrow">
        <input type="text" id="ch-${p.id}-t" value="${esc(c.title||"")}" placeholder="Challenge title" aria-label="${esc(p.name)} challenge title">
        <textarea id="ch-${p.id}-x" placeholder="What they have to do" aria-label="${esc(p.name)} challenge">${esc(c.text||"")}</textarea>
        <div class="pinfo"><div class="field"><label for="pi-${p.id}-p">Average pint</label><input type="text" id="pi-${p.id}-p" value="${esc(pi.price||"")}" placeholder="e.g. 6.40"></div>
          <div class="field"><label for="pi-${p.id}-h">Opening hours${p.hours?" (from OpenStreetMap)":""}</label><input type="text" id="pi-${p.id}-h" value="${esc(pi.hours||"")}" placeholder="${esc(p.hours||"e.g. Mo-Th 12:00-23:00; Fr-Sa 12:00-00:00; Su 12:00-22:30")}"></div></div>
        <input type="text" id="pi-${p.id}-n" value="${esc(pi.note||"")}" placeholder="Note for players, e.g. Pool table upstairs" aria-label="${esc(p.name)} note">
        <div><button class="btn sm primary" data-action="savechal" data-pub="${p.id}">Save</button></div></div></details>`;}).join("")}</div></div>`;
}
function adminRules(){
  const rules=rulesList(), house=houseList();
  return `<div class="card"><div class="row"><h2>Rules</h2><span class="spacer"></span><button class="btn sm" data-action="addrule">Add rule</button></div>
      <p class="sm muted">Shown in order on the Rules tab.</p>
      ${rules.map((r,i)=>`<div class="chalrow"><div class="row"><span class="pill">${i+1}</span><input type="text" data-rule-t="${i}" value="${esc(r.t)}" style="flex:1;min-width:160px" aria-label="Rule ${i+1} title"><button class="btn sm ghost danger" data-action="delrule" data-i="${i}">Remove</button></div>
        <textarea data-rule-b="${i}" aria-label="Rule ${i+1} detail">${esc(r.b)}</textarea></div>`).join("")}
      <div class="field"><label for="houserules">House rules, one per line</label><textarea id="houserules" style="min-height:160px">${esc(house.join("\n"))}</textarea></div>
      <div class="row"><button class="btn primary" data-action="saverules">Save rules</button><button class="btn ghost" data-action="resetrules">Restore the original rules</button></div></div>`;
}

/* =================== actions =================== */
async function compressImage(file){
  try{const bmp=await createImageBitmap(file); const s=Math.min(1,1600/Math.max(bmp.width,bmp.height));
    const c=document.createElement("canvas"); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(b=>r(b||file),"image/jpeg",.82));}catch(e){return file;}
}
async function submitEvidence(team,pub,i){
  const dk=team+"|"+pub, dr=S.draft[dk]||{files:[],note:""};
  if(!dr.files.length&&!dr.note.trim()){toast("Add a photo, video or a note first.");return;}
  const btn=document.querySelector(`[data-action="submit"][data-pub="${pub}"]`); const reset=()=>{if(btn){btn.disabled=false;btn.textContent="Send evidence to the chicken";}};
  if(btn){btn.disabled=true;btn.textContent="Sending…";}
  const media=[];
  try{
    for(const f of dr.files){
      const blob=f.type.startsWith("image")?await compressImage(f.file):f.file;
      if(blob.size>20*1024*1024){toast("That video is over 20 MB. Trim it and try again.");reset();return;}
      media.push(await api.upload(team,pub,blob,blob.type||f.type));
    }
  }catch(e){ console.warn(e); toast(/row-level|403|Unauthorized/i.test(e.message||"")?"Upload refused. Make sure you've joined a team.":"Upload failed. Check your signal and try again."); reset(); return; }
  try{ await act(()=>api.submit(team,pub,i+1,media,dr.note.trim()),"Sent. The chicken has been notified."); }
  catch(e){ reset(); return; }
  dr.files.forEach(f=>URL.revokeObjectURL(f.preview)); delete S.draft[dk]; closeSheet();
}
function readClues(){return Array.from(document.querySelectorAll("[data-clue]")).map(t=>t.value);}
function saveSecret(patch){ return act(()=>api.saveSecret(Object.assign({hideout:D.secret.hideout,clues:D.secret.clues},patch))); }
function readTeams(){
  let n=0;
  return D.teams.map((t,i)=>{const chickenTeam=i===0;
    return {id:t.id,chicken:chickenTeam,num:chickenTeam?null:++n,sort:i,
      name:((document.getElementById("tn-"+i)||{}).value||t.name).trim()||t.name,
      color:(document.getElementById("tc-"+i)||{}).value||t.color,
      members:((document.getElementById("tm-"+i)||{}).value??t.members.join(", ")).split(/[,\n]/).map(s=>s.trim()).filter(Boolean)};});
}
function readRules(){return Array.from(document.querySelectorAll("[data-rule-t]")).map(el=>({t:el.value.trim(),b:(document.querySelector(`[data-rule-b="${el.dataset.ruleT}"]`)||{}).value||""})).filter(r=>r.t||r.b.trim());}
const saveSettings=patch=>act(()=>api.saveSettings(Object.assign({},R.settings,patch)));

document.addEventListener("click",async e=>{
  const a=e.target.closest("[data-action]"); if(!a) return;
  const act_=a.dataset.action;
  if(act_==="closesheet"){ if(e.target===a||a.tagName==="BUTTON") closeSheet(); return; }
  if(act_==="pickfiles"||act_==="pickselfie"||act_==="note") return;
  e.preventDefault();
  try{ switch(act_){
    case "menu": openSheet(accountSheet()); break;
    case "theme": { const k=a.dataset.k; if(k==="auto") ls.del("theme"); else ls.set("theme",k); applyTheme(k); openSheet(accountSheet()); break; }
    case "jointeam": closeSheet(); location.hash="play"; renderAll(); setTimeout(()=>{const n=document.getElementById("joinnum"); if(n) n.focus();},50); break;
    case "dojoin": {
      const num=parseInt((document.getElementById("joinnum")||{}).value,10), name=((document.getElementById("joinname")||{}).value||"").trim();
      if(!num){toast("Type your team number.");break;}
      a.disabled=true; a.textContent="Joining…";
      const label=a.textContent;
      try{ const t=await act(()=>api.join(num,name)); toast(R.waiting?"Request sent. The chicken will let you in.":`You're on ${(teamById(t)||{}).name||"your team"}. Allez!`); }
      catch(err){ a.disabled=false; a.textContent=label; }
      break; }
    case "viewas": S.viewAs=a.dataset.team; S.chal={}; closeSheet(); location.hash="play"; renderAll(); break;
    case "stopview": S.viewAs=null; S.chal={}; closeSheet(); if(organiserOnly()) location.hash="admin"; renderAll(); break;
    case "checkin": if(!myTeamId()){location.hash="play";break;} openSheet(checkinSheet("")); break;
    case "confirmcheckin": {
      const tid=myTeamId(); if(!tid){toast("Join a team first.");break;}
      const p=pubById(a.dataset.pub), n=visitsOf(tid).length, stop=isStop(n);
      openSheet(`<h2>Check in to ${esc(p.name)}?</h2><p class="muted">This is pub ${n+1} for ${esc(teamById(tid).name)}.${stop?" <b>It's a challenge pub.</b> Your challenge appears straight after.":""}</p>
        <button class="btn primary block" data-action="docheckin" data-pub="${p.id}">Yes, we're here</button><button class="btn block ghost" data-action="closesheet">Cancel</button>`); break; }
    case "docheckin": { const tid=myTeamId(), p=pubById(a.dataset.pub); a.disabled=true;
      closeSheet(); if(LM) LM.closePopup();
      const ok=await act(()=>api.checkIn(tid,p.id),`Checked in to ${p.name}. Get the drinks in.`).then(()=>true,()=>false);
      S.chal={}; location.hash="play"; window.scrollTo(0,0);
      if(ok&&!S.viewAs) openSheet(selfieSheet(tid,p.id));
      break; }
    case "undovisit": { const tid=myTeamId(), pub=a.dataset.pub, sf=selfieFor(tid,pub);
      await act(async()=>{ if(sf) await api.deleteSelfie(tid,pub,sf.path); await api.undoVisit(tid,pub); },"Check-in removed.").catch(()=>{}); break; }
    case "viewselfie": openSheet(selfieViewSheet(a.dataset.team,a.dataset.pub)); break;
    case "galby": S.galBy=a.dataset.k; renderView("teams"); break;
    case "spend": openSheet(spendSheet()); break;
    case "dospend": { const amt=parseMoney(document.getElementById("spend-amt").value), note=document.getElementById("spend-note").value.trim();
      if(!(amt>0)||amt>=10000){ toast("Enter the amount, e.g. 42.50"); break; }
      a.disabled=true; closeSheet();
      await act(()=>api.addSpend(amt,note),()=>`${money(amt)} off the kitty. ${money(Math.round((D.kitty.left-amt)*100)/100)} left.`).catch(()=>{}); break; }
    case "delspend": await act(()=>api.delSpend(a.dataset.id),"Round removed. Back in the kitty.").catch(()=>{}); break;
    case "savekitty": { const v=parseMoney(document.getElementById("kitty-total").value);
      if(!(v>=0)){ toast("Enter the kitty total, e.g. 240"); break; }
      await saveSettings({budget:v}).then(()=>toast(`Kitty set to ${money(v)}.`)).catch(()=>{}); break; }
    case "openchal": challengeSheet(myTeamId(),a.dataset.pub,+a.dataset.i); break;
    case "submit": submitEvidence(a.dataset.team,a.dataset.pub,+a.dataset.i); break;
    case "fit": fitAll(); break;
    case "focuspub": { const p=pubById(a.dataset.pub); S.selPub=p.id; renderPubList(); stylePubs(); if(LM){LM.flyTo([p.lat,p.lng],Math.max(LM.getZoom(),16.5));setTimeout(()=>pubMarkers[p.id].openPopup(),350);}
      if(matchMedia("(max-width:900px)").matches) document.querySelector(".mapbox").scrollIntoView({behavior:"smooth",block:"start"}); break; }
    case "atab": S.adminTab=a.dataset.k; if(S.adminTab==="live") markSeen(); renderAll(); break;
    case "approve": { const s=D.subs.find(x=>x._id===a.dataset.id); if(!s) break; a.disabled=true; const n=(D.unlocked[s.team]||[]).length;
      await act(()=>api.approve(s._id,autoClue(n,pubById(s.pub))),r=>`Clue ${r||n+1} unlocked for ${(teamById(s.team)||{}).name}.`).catch(()=>{}); break; }
    case "reject": { const r=document.getElementById("rej-"+a.dataset.id); await act(()=>api.reject(a.dataset.id,r?r.value.trim():""),"Sent back to the team.").catch(()=>{}); break; }
    case "unlock": { const t=a.dataset.team, n=(D.unlocked[t]||[]).length, lp=lastPubOf(t); await act(()=>api.unlock(t,autoClue(n,lp),lp?lp.id:null),r=>`Clue ${r||n+1} unlocked.`).catch(()=>{}); break; }
    case "relock": await act(()=>api.relock(a.dataset.team),"Clue re-locked.").catch(()=>{}); break;
    case "found": { const t=a.dataset.team, on=!D.found[t]; await act(()=>api.setFound(t,on),on?`${teamById(t).name} found the chicken!`:"Undone.").catch(()=>{}); break; }
    case "setstate": { const k=a.dataset.k; await saveSettings({state:k}).then(()=>toast(k==="live"?"The game is live. Allez!":k==="finished"?"Game over. Scores revealed.":"Back to not started.")).catch(()=>{}); break; }
    case "addclue": await saveSecret({clues:readClues().concat([""])}).catch(()=>{}); break;
    case "delclue": { const c=readClues(); c.splice(+a.dataset.i,1); await saveSecret({clues:c}).catch(()=>{}); break; }
    case "saveclues": await saveSecret({clues:readClues()}).then(()=>toast("Clues saved.")).catch(()=>{}); break;
    case "savechal": { const id=a.dataset.pub, t=document.getElementById(`ch-${id}-t`).value.trim(), x=document.getElementById(`ch-${id}-x`).value.trim();
      const jobs=[api.saveChallenge(id,(t||x)?{title:t,text:x}:null)];
      const pp=document.getElementById(`pi-${id}-p`);
      if(pp){const inf={price:pp.value.trim(),hours:document.getElementById(`pi-${id}-h`).value.trim(),note:document.getElementById(`pi-${id}-n`).value.trim()};
        jobs.push(api.savePubInfo(id,(inf.price||inf.hours||inf.note)?inf:null));}
      await act(()=>Promise.all(jobs),"Saved.").catch(()=>{}); break; }
    case "savesettings": await saveSettings({buyIn:document.getElementById("set-buyIn").value.trim(),start:document.getElementById("set-start").value.trim(),
      interval:Math.max(1,Math.min(6,parseInt(document.getElementById("set-int").value)||2))}).then(()=>toast("Settings saved.")).catch(()=>{}); break;
    case "addteam": { const teams=readTeams(); const used=new Set(teams.map(t=>t.color));
      teams.push({id:"t"+uid().slice(0,8),chicken:false,num:teams.filter(t=>!t.chicken).length+1,sort:teams.length,name:"New team",color:PALETTE.find(c=>!used.has(c))||PALETTE[0],members:[]});
      await act(()=>api.saveTeams(teams),"Team added.").catch(()=>{}); break; }
    case "delteam": { const id=a.dataset.id, t=teamById(id);
      openSheet(`<h2>Remove ${esc(t.name)}?</h2><p class="muted">This deletes the team with its check-ins, evidence and clues, and its players will need to join again. Team numbers after it move up by one.</p>
        <button class="btn danger block" data-action="confirmdelteam" data-id="${id}">Remove team</button><button class="btn block ghost" data-action="closesheet">Cancel</button>`); break; }
    case "confirmdelteam": { const id=a.dataset.id; closeSheet(); const teams=readTeams().filter(t=>t.id!==id); let n=0; teams.forEach((t,i)=>{t.sort=i; t.num=t.chicken?null:++n;});
      await act(async()=>{ await api.deleteTeam(id); await api.saveTeams(teams); },"Team removed.").catch(()=>{}); break; }
    case "saveteams": await act(()=>api.saveTeams(readTeams()),"Teams saved.").catch(()=>{}); break;
    case "kick": await act(()=>api.removeMember(a.dataset.user),a.dataset.msg||"Player removed. They can join again.").catch(()=>{}); break;
    case "approvejoin": { const u=a.dataset.user, sel=document.getElementById("req-"+u), team=sel?sel.value:null; if(!team) break; a.disabled=true;
      await act(()=>api.approveMember(u,team),`Let in to ${(teamById(team)||{}).name||"the team"}.`).catch(()=>{}); break; }
    case "addadmin": { const el=document.getElementById("adminq"), em=(el&&el.value||"").trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(em)){toast("Enter an email address.");break;}
      await act(()=>api.addAdmin(em),`${em} added. Create their account in Supabase if you haven't.`).catch(()=>{}); break; }
    case "deladmin": await act(()=>api.removeAdmin(a.dataset.id),"Organiser removed.").catch(()=>{}); break;
    case "addrule": { const r=readRules(); r.push({t:"New rule",b:""}); await saveSettings({rules:r}).catch(()=>{}); break; }
    case "delrule": { const r=readRules(); r.splice(+a.dataset.i,1); await saveSettings({rules:r}).catch(()=>{}); break; }
    case "saverules": await saveSettings({rules:readRules(),house:(document.getElementById("houserules").value||"").split("\n").map(s=>s.trim()).filter(Boolean)}).then(()=>toast("Rules saved.")).catch(()=>{}); break;
    case "resetrules": await saveSettings({rules:null,house:null}).then(()=>toast("Original rules restored.")).catch(()=>{}); break;
    case "resetdemo": api.reset&&api.reset(); location.reload(); break;
    case "signin": openSheet(signinSheet()); break;
    case "signout": S.viewAs=null; closeSheet(); await sb.auth.signOut(); S.me={email:null,isAdmin:false,userId:null}; R.myTeam=null; R.waiting=null; location.hash="play"; await refresh(); toast("Signed out."); break;
    case "install": if(deferredInstall){ deferredInstall.prompt(); deferredInstall=null; renderAll(); } break;
    case "hideinstall": ls.set("noinstall",1); renderAll(); break;
  } }catch(err){ console.warn(err); }
}, true);

document.addEventListener("submit",async e=>{
  if(e.target.id!=="signinform") return; e.preventDefault();
  const em=document.getElementById("signin-email").value.trim(), pw=document.getElementById("signin-pw").value, b=document.getElementById("signin-go");
  if(!em||!pw){toast("Enter the email and password.");return;}
  b.disabled=true; b.textContent="Signing in…";
  const r=await sb.auth.signInWithPassword({email:em,password:pw});
  if(r.error){ toast(errText(r.error)); b.disabled=false; b.textContent="Sign in"; return; }
  closeSheet();
});
document.addEventListener("input",e=>{
  const el=e.target;
  if(el.id==="pubq"){const box=document.createElement("div");box.innerHTML=checkinSheet(el.value);document.getElementById("pubqlist").replaceWith(box.querySelector("#pubqlist"));}
  else if(el.id==="mapq"){S.q=el.value;const pos=el.selectionStart;renderPubList();const n=document.getElementById("mapq");n.focus();n.setSelectionRange(pos,pos);}
  else if(el.id==="chalq"){S.cq=el.value;const pos=el.selectionStart;renderView("admin");const n=document.getElementById("chalq");n.focus();n.setSelectionRange(pos,pos);}
  else if(el.dataset.action==="note"){(S.draft[el.dataset.key]=S.draft[el.dataset.key]||{files:[],note:""}).note=el.value;}
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&document.querySelector(".scrim")) closeSheet();
  if(e.key==="Enter"&&(e.target.id==="spend-amt"||e.target.id==="spend-note")){ e.preventDefault(); const b=document.querySelector('[data-action="dospend"]'); if(b) b.click(); }
  if(e.key==="Enter"&&(e.target.id==="joinnum"||e.target.id==="joinname")){ e.preventDefault(); const b=document.querySelector('[data-action="dojoin"]'); if(b) b.click(); }
});
document.addEventListener("change",async e=>{
  const el=e.target;
  if(el.dataset.action==="pickselfie"){ const f=el.files&&el.files[0]; if(f) uploadSelfie(el.dataset.team,el.dataset.pub,f); }
  else if(el.id==="actteam"){ S.actTeam=el.value; renderView("admin"); }
  else if(el.dataset.action==="pickfiles"){const dk=el.dataset.key, d=(S.draft[dk]=S.draft[dk]||{files:[],note:""});
    Array.from(el.files).slice(0,4).forEach(f=>d.files.push({file:f,type:f.type||"image/jpeg",preview:URL.createObjectURL(f)}));
    const [tid,pub]=dk.split("|"); const i=visitsOf(tid).findIndex(v=>v.pub===pub);
    if(el.closest(".sheet")) challengeSheet(tid,pub,i); else renderView("play");}
  else if(el.id==="hideout"){ await saveSecret({hideout:el.value||null,clues:document.querySelector("[data-clue]")?readClues():D.secret.clues}).then(()=>toast(el.value?"Hideout set.":"Hideout cleared.")).catch(()=>{}); }
  else if(el.dataset.setting){ const k=el.dataset.setting, on=el.checked; await saveSettings({[k]:on}).then(()=>toast(on?"Switched on.":"Switched off.")).catch(()=>{}); }
  else if(el.dataset.move){ await act(()=>api.moveMember(el.dataset.move,el.value),"Player moved.").catch(()=>{}); }
});
/* remember which pub is open in HQ → Content, so a save or a live update doesn't fold it shut */
document.addEventListener("toggle",e=>{const d=e.target; if(!d.matches||!d.matches("details.pubedit")) return;
  if(d.open) S.openPub=d.dataset.pub; else if(S.openPub===d.dataset.pub) S.openPub=null;},true);
document.addEventListener("mouseover",e=>{const r=e.target.closest&&e.target.closest(".pubrow[data-action=focuspub]"); if(!r||!LM||!HOVER) return;
  const m=pubMarkers[r.dataset.pub]; if(m&&m.openTooltip&&m.getTooltip()) m.openTooltip();});
document.addEventListener("mouseout",e=>{const r=e.target.closest&&e.target.closest(".pubrow[data-action=focuspub]"); if(!r||!LM) return;
  if(r.contains(e.relatedTarget)) return; const m=pubMarkers[r.dataset.pub]; if(m&&m.closeTooltip) m.closeTooltip();});

/* =================== render =================== */
const VIEWS={play:viewPlay,teams:viewTeams,rules:viewRules,admin:viewAdmin};
function renderView(k){ if(VIEWS[k]){const el=document.getElementById("v-"+k); el.innerHTML=VIEWS[k](); } }
function renderAll(){
  if(!D.teams) derive();
  if(route()==="admin"&&S.adminTab==="live"&&document.visibilityState==="visible"&&unseenCount()) markSeen();
  renderChrome(); const r=route();
  if(r==="map"){ initMap(); if(LM) setTimeout(()=>LM.invalidateSize(),0); renderPubList(); renderMapDynamic(); }
  else { const a=document.activeElement, typing=a&&(a.tagName==="TEXTAREA"||(a.tagName==="INPUT"&&!["file","checkbox"].includes(a.type))||a.tagName==="SELECT")&&document.getElementById("v-"+r).contains(a);
    if(!typing) renderView(r); }
  if(LM) renderMapDynamic();
}
window.addEventListener("hashchange",()=>{renderAll();window.scrollTo(0,0);});
const mq=matchMedia("(prefers-color-scheme: dark)"); (mq.addEventListener?mq.addEventListener("change",styleMap):mq.addListener(styleMap));
new MutationObserver(styleMap).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

/* =================== boot =================== */
async function applySession(session){
  S.me.userId=session&&session.user?session.user.id:null;
  S.me.email=session&&session.user&&!session.user.is_anonymous?session.user.email:null;
  S.me.isAdmin=false;
  if(session&&S.me.email){ const r=await sb.rpc("is_admin"); S.me.isAdmin=!r.error&&r.data===true; }
  S.chal={}; S.signed={};
}
/* organisers get a pop-up for every check-in and selfie. Players never receive other teams' rows, so they never see these. */
function organiserAlert(table,payload){
  if(!S.me.isAdmin||!payload||!payload.new) return;
  const r=payload.new; if(r.by_user&&r.by_user===S.me.userId) return;
  const t=teamById(r.team_id), p=pubById(r.pub_id); if(!t) return;
  let msg="";
  if(table==="team_members"&&payload.eventType==="INSERT"&&r.approved===false){ toast(`${r.display_name||"A new phone"} is asking to join ${t.name}. See HQ → Live.`,8000); if(navigator.vibrate) try{ navigator.vibrate(120); }catch(e){} return; }
  if(table==="visits"&&payload.eventType==="INSERT") msg=`${teamLabel(t)} checked in to ${p?p.name:"a pub"}`;
  else if(table==="selfies"&&(payload.eventType==="INSERT"||payload.eventType==="UPDATE")) msg=`📸 ${t.name} ${payload.eventType==="UPDATE"?"retook their":"added a"} selfie at ${p?p.name:"a pub"}`;
  if(!msg) return;
  toast(msg,6000);
  if(navigator.vibrate) try{ navigator.vibrate(120); }catch(e){}
}
/* keep "x min ago" and the overdue highlight current without re-drawing the page (which would wipe unsaved form edits) */
setInterval(()=>{
  document.querySelectorAll("[data-ago]").forEach(el=>{el.textContent=ago(+el.dataset.ago);});
  document.querySelectorAll("[data-stale]").forEach(el=>{el.classList.toggle("stale",live()&&Date.now()-(+el.dataset.stale)>STALE_MIN*60000);});
},30000);
let channel=null;
function subscribe(){
  if(channel) sb.removeChannel(channel);
  channel=sb.channel("game-"+uid());
  ["settings","teams","team_rosters","team_members","pub_info","challenges","secret","visits","submissions","selfies","spends","unlocked","found"].forEach(t=>
    channel.on("postgres_changes",{event:"*",schema:"public",table:t},payload=>{ if(t==="visits"||t==="settings"||t==="challenges") S.chal={}; organiserAlert(t,payload); softRefresh(); }));
  channel.subscribe();
}
(async()=>{
  derive();
  if(!CFG.supabaseUrl||!CFG.supabaseAnonKey||!window.supabase){
    S.mode="local"; api=LocalBackend(); await refresh(); return;
  }
  sb=window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  api=SupabaseBackend(sb); S.mode="db"; renderAll();
  const {data:{session}}=await sb.auth.getSession();
  await applySession(session); await refresh(); subscribe();
  sb.auth.onAuthStateChange((ev,sess)=>{
    if(ev==="SIGNED_IN"||ev==="SIGNED_OUT"||ev==="USER_UPDATED"){
      const wasAdmin=S.me.isAdmin;
      applySession(sess).then(()=>{ subscribe(); return refresh(); }).then(()=>{ if(ev==="SIGNED_IN"&&S.me.isAdmin&&!wasAdmin){ location.hash="admin"; toast("You're in. Welcome to Chicken HQ."); }
        else if(ev==="SIGNED_IN"&&S.me.email&&!S.me.isAdmin) toast("Signed in, but this email isn't on the organiser list."); });
    }
  });
  setInterval(()=>{ if(document.visibilityState==="visible"&&D.settings.showBoard) refresh(); },45000);
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
})();
if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
