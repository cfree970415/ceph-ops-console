/* Ceph Ops Console - login/session, remote backend link, one-click OSD ops.
   Loaded last: wraps render / renderTop / onAct / API.call from the other files. */
'use strict';

/* ---------- extended state ---------- */
state.auth={required:false,authenticated:false,user:'',role:'viewer',allowWrite:false,writeCapability:false,
            readOnly:false,backend:'cli',session:'',tab:'password',error:'',busy:false};
state.link={apiBase:'',stateOk:false,stateError:'',stateHttp:0,stateAt:0,
            diag:null,diagBusy:false,diagError:''};
state.quick=null;
state.isolation=null;

function authReset(){return {required:state.auth.required,authenticated:false,user:'',role:'viewer',
 allowWrite:false,readOnly:false,backend:'cli',session:'',tab:'password',error:'',busy:false};}
/* faultOsd() / backendBase() live in app-core.js so they exist before first render */

/* ---------- HTTP: works same-origin AND across servers ---------- */
function apiFetch(m,p,b){
 var h={'Content-Type':'application/json'},sid='',tk='';
 try{sid=state.auth.session||sessionStorage.getItem('cc_session')||'';}catch(e){}
 if(sid)h['X-Console-Session']=sid;
 try{tk=state.token||sessionStorage.getItem('cc_token')||'';}catch(e){}
 if(tk&&!state.auth.authenticated)h['X-Console-Token']=tk;
 if(b&&b._confirm)h['X-Confirm-Token']=b._confirm;
 var body=b?JSON.stringify(b):undefined;
 return fetch(backendBase()+p,{method:m,headers:h,body:body,credentials:'omit'}).then(function(r){
  if(!r.ok)return r.json().catch(function(){return {};}).then(function(j){
   var e=new Error(j.error||('HTTP '+r.status));e.status=r.status;throw e;});
  return r.json();});
}
var __origApiCall=API.call;
API.call=function(m,p,b){
 if(state.mode!=='live'&&p!=='/api/login'&&p!=='/api/session')return __origApiCall(m,p,b);
 return apiFetch(m,p,b);
};

/* ---------- login screen ---------- */
function renderAuth(){
 var root=document.getElementById('auth-root');if(!root)return;
 if(state.mode!=='live'||state.auth.authenticated){root.innerHTML='';root.style.display='none';return;}
 root.style.display='block';
 var __authSnap=snapshotForm(root);
 var a=state.auth,pw=a.tab==='password';
 var box='<div class="auth-wrap"><div class="auth-card">'+
  '<div class="auth-brand"><div class="brand-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2c3.5 0 6 2.6 6 6.2v1.3c0 1.6.7 3.1 1.9 4.1 1.2 1 1.9 2.5 1.9 4.1 0 2.9-2.3 5.3-5.2 5.3H7.4C4.5 23 2.2 20.6 2.2 17.7c0-1.6.7-3.1 1.9-4.1A5.4 5.4 0 0 0 6 9.5V8.2C6 4.6 8.5 2 12 2z"/><path d="M12 2v6M6 12h12"/></svg></div>'+
  '<div><div style="font-size:16px;font-weight:700">Ceph Ops Console</div><div class="tiny">登录</div></div></div>'+
  '<div class="fgrp" style="margin-top:18px"><label class="fld">后端服务地址'+
   (backendBase()?' <span class="tag info">跨机连接</span>':' <span class="tag mute">同源</span>')+'</label>'+
   '<input class="inp" id="auth-api" value="'+esc(backendBase())+'" placeholder="留空为同源；跨机填 http://后端IP:8780" autocomplete="off"></div>'+
  '<div class="seg" style="margin-bottom:14px"><button class="'+(pw?'on acc':'')+'" data-act="auth-tab" data-value="password">账号密码</button>'+
   '<button class="'+(!pw?'on acc':'')+'" data-act="auth-tab" data-value="token">访问令牌</button></div>'+
  (pw?
   '<div class="fgrp"><label class="fld">用户名</label><input class="inp" id="auth-user" value="admin" autocomplete="username" placeholder="deploy.sh 创建的用户"></div>'+
   '<div class="fgrp"><label class="fld">密码</label><input class="inp" id="auth-pass" type="password" autocomplete="current-password" placeholder="初始密码见部署脚本输出"></div>':
   '<div class="fgrp"><label class="fld">访问令牌（Service Token）</label><input class="inp" id="auth-token" type="password" placeholder="部署脚本生成的 X-Console-Token"></div>')+
  (a.error?'<div class="dangerbox" style="margin-bottom:12px">'+ic('alert')+'<div>'+esc(a.error)+'</div></div>':'')+
  '<button class="btn pri" style="width:100%;padding:10px" data-act="auth-login" '+(a.busy?'disabled':'')+'>'+ic('lock',15)+' '+(a.busy?'正在连接…':'登录并连接集群')+'</button>'+

  '<div style="margin-top:10px;text-align:center;font-size:11px;color:var(--faint)">UI 构建 '+esc(UI_BUILD)+'</div>'+
  '</div></div>';
 root.innerHTML=box;
 restoreForm(root,__authSnap);
}
function authPayload(){
 if(state.auth.tab==='token'){var t=document.getElementById('auth-token');return {token:t?t.value.trim():''};}
 var u=document.getElementById('auth-user'),p=document.getElementById('auth-pass');
 return {username:u?u.value.trim():'',password:p?p.value:''};}
function applySession(r){
 /* Logging in as admin (or any real account) always means the live console.
    There is no offline demo shell any more. */
 state.mode='live';
 if(state.link){state.link.stateError='';state.link.stateHttp=0;state.link.diag=null;}
 state.auth.authenticated=true;state.auth.user=r.user||'admin';state.auth.role=r.role||'viewer';
 state.auth.allowWrite=!!r.allow_write&&state.auth.role==='admin';
 /* write_capability = 服务端是否带 --allow-write；allow_write 是设置页总开关生效后的结果。 */
 state.auth.writeCapability=!!r.write_capability;
 state.auth.readOnly=!!r.read_only;state.auth.backend=r.backend||'cli';
 state.auth.error='';state.auth.busy=false;
 if(r.session){state.auth.session=r.session;try{sessionStorage.setItem('cc_session',r.session);}catch(e){}}
 if(r.auth_required)state.auth.required=true;
 state.settings.allowWrite=state.auth.allowWrite;
}
function doLogin(){
 var apiEl=document.getElementById('auth-api'),api=apiEl?apiEl.value.trim().replace(/\/+$/,''):'';
 state.apiBase=api;state.link.apiBase=api;
 try{if(api)localStorage.setItem('cc_api_base',api);else localStorage.removeItem('cc_api_base');}catch(e){}
 var payload=authPayload();
 if(state.auth.tab==='token'&&!payload.token){state.auth.error='请填写访问令牌';renderAuth();return;}
 if(state.auth.tab==='password'&&!payload.username){state.auth.error='请填写用户名';renderAuth();return;}
 state.auth.busy=true;state.auth.error='';renderAuth();
 apiFetch('POST','/api/login',payload).then(function(r){
  applySession(r);signedIn();
 }).catch(function(e){
  state.auth.error=e.message||'连接失败，请检查后端地址与服务状态';state.auth.busy=false;renderAuth();});
}
function doLogout(){
 apiFetch('POST','/api/logout',{}).catch(function(){});
 try{sessionStorage.removeItem('cc_session');sessionStorage.removeItem('cc_token');}catch(e){}
 state.token='';state.quick=null;state.profile=null;state.isolation=null;
 if(state.link){state.link.stateOk=false;state.link.stateError='';state.link.stateHttp=0;
  state.link.stateAt=0;state.link.diag=null;state.link.diagError='';}
 state.auth=authReset();render();renderAuth();toast('已退出登录','ok');
}
/* ---------- change the signed-in account's password ---------- */
function changePassword(){
 var $=function(id){return document.getElementById(id);},msg=$('pw-msg');
 var show=function(text,bad){if(msg)msg.innerHTML='<span class="'+(bad?'td':'t')+'">'+esc(text)+'</span>';};
 if(state.mode!=='live'||!state.auth.authenticated){show('请先连接后端并登录',true);return;}
 var old=$('pw-old')?$('pw-old').value:'',nw=$('pw-new')?$('pw-new').value:'',nw2=$('pw-new2')?$('pw-new2').value:'';
 if(!old){show('请输入当前密码',true);return;}
 if(nw.length<8){show('新密码至少 8 位',true);return;}
 if(nw!==nw2){show('两次输入的新密码不一致',true);return;}
 show('正在修改…',false);
 apiFetch('POST','/api/password',{old_password:old,new_password:nw,confirm_password:nw2}).then(function(r){
  ['pw-old','pw-new','pw-new2'].forEach(function(id){var el=$(id);if(el)el.value='';});
  show(r.message||'密码已更新',false);toast('密码修改成功','ok');
 }).catch(function(e){show(e.message||'修改失败，请稍后重试',true);});
}
function enterLive(){
 /* Clicking the LIVE button while already live and signed in must be a no-op.
    Resetting state.auth here used to log the user out and re-open the login
    screen (Settings -> run mode -> LIVE 对接集群). */
 if(state.mode==='live'&&state.auth.authenticated){
  toast('当前已连接后端 · '+esc(state.auth.user||'')+'，无需重新登录','ok');
  return;
 }
 var sid=state.auth.session||'';
 if(!sid){try{sid=sessionStorage.getItem('cc_session')||'';}catch(e){}}
 /* A different session may point at a different cluster: never reuse samples. */
 resetSamples();
 state.mode='live';state.auth=authReset();state.auth.required=true;state.auth.session=sid;
 render();
 if(!sid){renderAuth();toast('请填写后端地址并登录','w');return;}
 /* Try to resume the saved session before showing the login form, so a
    A page refresh must not force a password re-entry. */
 apiFetch('GET','/api/session').then(function(r){
  if(r.authenticated){applySession(r);signedIn();}
  else{renderAuth();toast('会话已失效，请重新登录','w');}
 }).catch(function(){renderAuth();toast('连接失败，请检查后端地址与服务状态','w');});
}
function signedIn(){
 render();renderAuth();
 apiFetch('GET','/api/probe').then(function(r){if(r.profile)state.profile=r.profile;}).catch(function(){})
  .then(function(){return syncState();})
  .then(function(){return apiFetch('GET','/api/isolation').then(function(r){state.isolation=r.data||null;}).catch(function(){});})
  .then(function(){render();toast('已连接后端 · '+esc(state.auth.user||'')+' · '+(state.auth.allowWrite?'EXECUTE':'DRY-RUN'),'ok');});
}

/* ---------- boot: same-origin or cross-server backend ---------- */
function liveBoot(){
 if(window.__CC_LIVE_BOOTED__)return;window.__CC_LIVE_BOOTED__=true;
 var b=window.__CEPH_BOOT__||null,q=new URLSearchParams(location.search),saved='';
 try{saved=localStorage.getItem('cc_api_base')||'';}catch(e){}
 var apiParam=q.get('api');
 state.apiBase=apiParam?apiParam.replace(/\/+$/,''):(b?'':saved);
 state.link.apiBase=state.apiBase;
 state.auth.required=!!(b&&b.authRequired)||!!state.apiBase;
 var sid='';try{sid=sessionStorage.getItem('cc_session')||'';}catch(e){}
 /* 只有一种运行模式：连接真实后端。没有后端就没有数据，不存在演示页。 */
 state.mode='live';
 render();renderAuth();
 if(sid)state.auth.session=sid;
 apiFetch('GET','/api/session').then(function(r){
  if(r.authenticated){applySession(r);signedIn();}
  else if(state.token){
   return apiFetch('POST','/api/login',{token:state.token}).then(function(l){applySession(l);signedIn();});
  }
  else renderAuth();
 }).catch(function(){renderAuth();})
 .then(function(){try{history.replaceState({},'',location.pathname);}catch(e){}});
 startRefresh();
}
function startRefresh(){
 setInterval(function(){
  if(!state.autoRefresh)return;
  if(!state.auth.authenticated)return;
  syncState();
  apiFetch('GET','/api/isolation').then(function(r){state.isolation=r.data||null;}).catch(function(){});
 },15000);
}

/* ---------- wrap shell render: no cluster data before login ---------- */
var __baseRender=render;
render=function(){
 var __content=document.getElementById('content'),__formSnap=snapshotForm(__content);
 if(state.mode==='live'&&!state.auth.authenticated){
  document.documentElement.setAttribute('data-theme',state.theme);
  var n=document.getElementById('nav'),t=document.getElementById('topbar'),
      c=document.getElementById('content'),f=document.getElementById('side-foot');
  if(n)n.innerHTML='';if(f)f.innerHTML='';
  if(t)t.innerHTML='<div class="crumb">Ceph Ops Console<small>等待登录</small></div>';
  if(c)c.innerHTML='<div class="empty">'+ic('lock',34)+'<div>正在连接后端，请先登录</div></div>';
  restoreForm(c,__formSnap);return;}
 __baseRender();
 /* A signed-in LIVE console that has no valid /api/state must not fall back
    to stale or zeroed numbers on any cluster view. */
 if(state.auth.authenticated&&liveNoData()&&CLUSTER_VIEWS.indexOf(state.view)>=0){
  var box=document.getElementById('content');if(box)box.innerHTML=noDataPage();
 }
 restoreForm(document.getElementById('content'),__formSnap);
};
/* Ask the backend why ceph status cannot be read. Read-only, no side effects. */
function runDiag(){
 if(!state.link)return;
 state.link.diagBusy=true;state.link.diagError='';render();
 apiFetch('GET','/api/diag').then(function(r){
  state.link.diag=r.data||null;state.link.diagBusy=false;render();
 }).catch(function(e){
  state.link.diagError=(e&&e.message)||'自检请求失败';state.link.diagBusy=false;render();
 });
}
var __baseRenderTop=renderTop;
renderTop=function(){
 __baseRenderTop();
 var bar=document.getElementById('topbar');if(!bar)return;
 var n=liveNoData()?0:activeAlerts().filter(function(a){return a.sev==='critical'&&a.status==='active';}).length;
 var h='<button class="ib" data-act="nav" data-view="alerts" title="查看告警页面" style="position:relative">'+ic('bell')+
   (n?'<span class="nav-badge" style="position:absolute;top:-6px;right:-6px">'+n+'</span>':'')+'</button>';
 if(state.auth.authenticated)h='<span class="pill '+(state.auth.allowWrite?'ok':'warn')+'">'+ic('shield',13)+' '+
   esc(state.auth.user)+' · '+(state.auth.role==='admin'?'管理员':'只读')+(state.auth.allowWrite?'':' · DRY-RUN')+'</span>'+
   '<button class="ib" data-act="nav" data-view="settings" title="系统设置 · 修改密码">'+ic('settings',15)+'</button>'+
   '<button class="ib" data-act="logout" title="退出登录">'+ic('lock')+'</button>'+h;
 bar.innerHTML+=h;
};

/* ---------- isolation card (proves native dashboard is untouched) ---------- */
/* ---------- one-click kick / replace one disk / add a disk / in ---------- */
function quickTitle(k){
 return k==='kick'?'一键踢盘（DOWN + OUT）':k==='in'?'一键 IN 盘（恢复上线）':
  k==='replace'?'一键换盘（坏盘换新盘 · OSD 编号不变）':
  k==='init'?'新增磁盘（初始化新盘 · 新编号）':'一键换盘';}
function quickIntent(k){return k==='kick'?'downout':k==='in'?'in':k==='init'?'init':'replace';}
function quickPlan(k,w){
 if(state.mode==='live'&&state.auth.authenticated){
  return apiFetch('POST','/api/plan',{intent:quickIntent(k),osd_id:w.osdId,host:w.host,dev:w.dev})
   .then(function(r){return (r.steps||[]).map(function(s){
     return {n:s.name,c:s.command||('# '+s.name+'：'+s.note),note:s.note||'',manual:!!s.manual};});});
 }
 if(k==='init')return Promise.resolve([
  {n:'预检设备',c:'# 预检设备是否空闲、可加入集群',note:'确认设备未被 OSD 占用',manual:true},
  {n:'清理元数据',c:'ceph-volume lvm zap '+w.dev+' --destroy',note:'清掉分区表 / LVM / 文件系统签名'},
  {n:'创建 OSD',c:'ceph-volume lvm create --data '+w.dev,note:'创建新 OSD（新编号）并加入 CRUSH'},
  {n:'健康验证',c:'ceph -s --format=json',note:'观察 PG 回到 active+clean'}]);
 if(k==='replace')return Promise.resolve([
  {n:'停止故障 OSD 守护进程',c:'# 先停服务：否则心跳会把 down 改回 up',note:'盘已坏时可能直接失败',manual:true},
  {n:'标记 OSD OUT',c:'ceph osd out '+w.osdId,note:'把数据迁走'},
  {n:'物理更换故障盘',c:'# 现场按盘位 / SN 换上同规格新盘',note:'不要换盘位',manual:true},
  {n:'清理新盘元数据',c:'ceph-volume lvm zap '+w.dev+' --destroy',note:'只作用于新盘'},
  {n:'用原编号重建 OSD',c:'ceph-volume lvm create --data '+w.dev+' --osd-id '+w.osdId,note:'强制复用原编号'},
  {n:'复核',c:'ceph osd dump --format=json',note:'确认 osd.'+w.osdId+' up/in'}]);
 return Promise.resolve(wizardPlan({osdId:w.osdId,host:w.host,dev:w.dev,intent:quickIntent(k)}));
}
/* 设备列表：新增磁盘只列真正空闲的盘；换盘还要允许「带着旧 LVM 签名的新盘」
   （换上的盘往往能读到上一块的残留签名，流程里会先 zap 再重建）。 */
function pickDevices(q,list,host){
 var seen={},usedBy={},same=[],ok=[],soft=[];
 (state.osds||[]).forEach(function(x){if(x&&x.dev)usedBy[x.dev]=x.id;});
 (list||[]).forEach(function(d){
  if(!d||!d.dev||seen[d.dev])return;
  if(host&&d.host&&d.host!==host)return;
  seen[d.dev]=1;
  /* 任何别的 OSD 正在用的盘都不列——zap 是不可逆的，不能给误选的机会。
     注意 osd.0 的 id 是 0（falsy），必须显式判断 undefined，不能只写 truthy。 */
  if(usedBy[d.dev]!==undefined&&usedBy[d.dev]!==q.osdId)return;
  /* 换盘时新盘通常出现在原盘位、也就是原设备路径上（/dev/nvme0n2 拔掉换新，
     路径还是它）。这种情况要排在最前，而不是被过滤掉。 */
  if(q.kind==='replace'&&q.oldDev&&d.dev===q.oldDev){same.push(d);return;}
  (d.available?ok:soft).push(d);
 });
 if(q.kind==='init')return ok;
 return same.concat(ok,soft);
}
/* 换盘：目标是「某个坏掉的 OSD」，新盘是它的替代品，重建后编号必须还是原来那个 */
function quickOpenReplace(o){
 if(!o||o.id==null){toast('请先选择一个要更换的 OSD','e');return;}
 state.quick={kind:'replace',osdId:o.id,host:o.host||'',dev:'',oldDev:o.dev||'',serial:o.serial||'',
  weight:o.weight,devices:[],phase:'loading',steps:[],logs:[],progress:0,phrase:'',confirmed:false,
  busy:false,error:'',stage:'pre',aborted:false,pending:[],hasManual:true,
  dryRun:!state.settings.allowWrite,role:state.auth.role||'admin'};
 state.wizard=null;
 var mine=state.quick;
 quickPaintModal();
 loadFreeDevices(mine).then(function(list){
  if(!state.quick||state.quick!==mine)return;
  var q=mine,pick=pickDevices(q,list,q.host);
  q.devices=pick;
  q.dev=pick.length?pick[0].dev:'';
  if(!q.dev){q.phase='confirm';quickPaintModal();return;}
  return replanQuick(q);
 }).catch(function(e){
  if(!state.quick||state.quick!==mine)return;
  var q=mine;q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 新增磁盘（扩容）：目标是「设备」，不是某个 OSD；先探测可用的空闲盘再生成命令 */
function loadFreeDevices(q){
 if(!(state.mode==='live'&&state.auth.authenticated))return Promise.resolve([]);
 return apiFetch('GET','/api/devices',null).then(function(r){return (r&&r.devices)||[];})
  .catch(function(){return [];});
}
function quickOpen(kind,osdId){
 var n=osdId==null?(kind==='in'?(inOsd()||{}).id:(faultOsd()||{}).id):Number(osdId);
 var o=state.osds.filter(function(x){return x.id===n;})[0]||state.osds[0];
 if(kind==='init'){return quickOpenInit(o);}
 if(kind==='replace'){return quickOpenReplace(o);}
 if(!o){toast('没有可用的 OSD','e');return;}
 state.quick={kind:kind,osdId:o.id,host:o.host,dev:o.dev,serial:o.serial||'',phase:'loading',steps:[],logs:[],
  progress:0,phrase:'',confirmed:false,busy:false,error:'',stage:'pre',aborted:false,pending:[],hasManual:false,
  dryRun:!state.settings.allowWrite,role:state.auth.role||'admin'};
 state.wizard=null;
 var mine=state.quick;              // ignore stale responses if another dialog was opened
 quickPaintModal();
 quickPlan(kind,mine).then(function(steps){
  if(!state.quick||state.quick!==mine)return;
  var q=mine;
  q.steps=steps;q.hasManual=steps.some(function(s){return s.manual||String(s.c).charAt(0)==='#';});
  q.phase='confirm';
  if(!state.settings.confirm){q.phrase='osd.'+q.osdId;q.confirmed=true;}
  quickPaintModal();
 }).catch(function(e){
  if(!state.quick||state.quick!==mine)return;
  var q=mine;q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 新增磁盘：目标是「设备」，不是某个 OSD；走完会多出一个新编号的 OSD */
function quickOpenInit(o){
 state.quick={kind:'init',osdId:o?o.id:null,host:(o&&o.host)||'',
  dev:'',serial:'',devices:[],phase:'loading',steps:[],logs:[],progress:0,phrase:'',confirmed:false,
  busy:false,error:'',stage:'auto',aborted:false,pending:[],hasManual:false,
  dryRun:!state.settings.allowWrite,role:state.auth.role||'admin'};
 state.wizard=null;
 var mine=state.quick;
 quickPaintModal();
 loadFreeDevices(mine).then(function(list){
  if(!state.quick||state.quick!==mine)return;
  var q=mine,pick=pickDevices(q,list,q.host);
  q.devices=pick;
  q.dev=pick.length?pick[0].dev:'';
  if(!q.dev){q.phase='confirm';quickPaintModal();return;}
  return replanQuick(q);
 }).catch(function(e){
  if(!state.quick||state.quick!==mine)return;
  var q=mine;q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 换了新盘 / 改了设备路径 / 改了服务器：重新向后端要命令序列 */
function replanQuick(q){
 q.phase='loading';q.phrase='';quickPaintModal();
 return quickPlan(q.kind,q).then(function(steps){
  if(state.quick!==q)return;
  q.steps=steps;
  q.hasManual=steps.some(function(s){return s.manual||String(s.c).charAt(0)==='#';});
  q.phase='confirm';
  if(!state.settings.confirm){
   q.phrase=q.kind==='replace'?'osd.'+q.osdId:q.dev;
   q.confirmed=true;}
  quickPaintModal();
 }).catch(function(e){
  if(state.quick!==q)return;
  q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
function qHead(){var q=state.quick;
 var tail=(q.kind==='init'||q.kind==='replace')?' · osd.'+q.osdId+' → '+esc(q.dev||'选择新盘'):' · osd.'+q.osdId;
 if(q.kind==='init')tail=' · '+esc(q.dev||'选择新盘');
 return modalHead(quickTitle(q.kind)+tail,
 '后端按 Ceph 版本自动选择命令模板 · '+(q.dryRun?'DRY-RUN 只生成命令':'真实执行'));}
function quickPaintModal(){
 var q=state.quick;if(!q)return;
 var o=state.osds.filter(function(x){return x.id===q.osdId;})[0]||{},b='',foot='';
 if(q.phase==='loading'){
  b='<div class="empty">'+ic('refresh',34)+'<div>正在向后端请求该版本的命令序列…</div></div>';
  foot='<div class="sp"></div><button class="btn" data-act="q-close">取消</button>';
 }else if(q.phase==='error'){
  b='<div class="dangerbox">'+ic('alert')+'<div>'+esc(q.error)+'</div></div>'+
    '<div class="note" style="margin-top:12px">请确认已登录、后端为 CLI 通道且 /api/plan 可访问。</div>';
  foot='<div class="sp"></div><button class="btn" data-act="q-close">关闭</button><button class="btn" data-act="q-retry">重试</button>';
 }else if(q.phase==='confirm'&&(q.kind==='init'||q.kind==='replace')){
  /* 两个「动盘」入口共用同一块表单，语义完全不同：
     - replace：坏盘 1:1 换新盘，重建后必须还是 osd.<id>（编号不变）
     - init：额外加一块盘，扩容，会分配一个新编号 */
  var isRep=q.kind==='replace';
  var devOpts=q.devices.map(function(d){
   return '<option value="'+esc(d.dev)+'"'+(d.dev===q.dev?' selected':'')+'>'+esc(d.dev)+' · '+bytes(d.size||0)+
    ' · '+esc(d.host||'本机')+(isRep&&d.dev===q.oldDev?' · 原盘位':'')+
    (d.available?'':' · 需先清理')+(d.note?' · '+esc(d.note):'')+'</option>';}).join('');
  b='<div class="warnbox" style="margin-bottom:14px">'+ic(isRep?'disk':'zap')+
   '<div><b>'+(isRep?'把 osd.'+q.osdId+' 的坏盘换成新盘，重建后仍是 osd.'+q.osdId
                  :'把新插入的磁盘初始化并加入集群（会新增一个 OSD 编号）')+'</b><br>'+
   (isRep?
    '流程：停守护进程 → OUT（把 PG 迁走）→ 移除 OSD 但<b>保留编号</b> → <b>现场换盘（平台暂停）</b> → 清理新盘签名 → 用原编号重建 → 回读 osd dump 复核。':
    '流程：预检设备（是否空闲 / 可加入）→ 清理旧元数据（分区表 / LVM / 文件系统签名）→ 创建 OSD → 等待上线 → 健康验证。')+
   '<br>'+(isRep?'适用于「盘坏了、硬件层已经换成新盘」的 1:1 替换；要扩容加盘请用「新增磁盘」。'
                :'不改动任何已有 OSD 的数据，也不做退役。')+
   '<br>当前为 <b>'+(q.dryRun?'DRY-RUN 演示（命令不下发）':'真实 EXECUTE 模式')+'</b>。</div></div>'+
   (isRep?'<div class="grid g2" style="margin-bottom:14px"><div>'+
     '<div class="stat-line"><span>目标 OSD</span><b class="mono tp">osd.'+q.osdId+'</b></div>'+
     '<div class="stat-line"><span>原设备</span><b class="mono">'+esc(q.oldDev||'未采集')+'</b></div></div><div>'+
     '<div class="stat-line"><span>服务器</span><b class="mono">'+esc(q.host||'未采集')+'</b></div>'+
     '<div class="stat-line"><span>原序列号</span><b class="mono">'+esc(q.serial||'未采集')+'</b></div></div></div>':'')+
   '<div class="fgrp" style="margin-bottom:12px"><label class="fld">'+
    (isRep?'新盘所在服务器（编号不变的前提：仍装回原服务器的原盘位）':'目标服务器')+'</label>'+
    '<input class="inp mono" data-bind="quick.host" value="'+esc(q.host)+'" placeholder="ceph-single" autocomplete="off"></div>'+
   '<div class="fgrp" style="margin-bottom:8px"><label class="fld">'+(isRep?'换上来的新盘设备':'新盘设备')+'</label>'+
   (q.devices.length
    ?'<select class="inp mono" data-bind="quick.dev" data-act="q-dev">'+devOpts+'</select>'
    :'<input class="inp mono" data-bind="quick.dev" value="'+esc(q.dev)+'" placeholder="/dev/nvme0n2" autocomplete="off">')+'</div>'+
   '<div class="btn-row" style="margin-bottom:12px;align-items:center"><span class="note">'+
    (q.devices.length
      ?(isRep?'候选只含该服务器上未被其它 OSD 占用的盘；新盘仍挂在原路径时会标「原盘位」并排在最前。带旧签名（显示「需先清理」）是正常的，流程里会先 zap。'
             :'只列出未被 OSD 占用的空闲盘，插入新盘后点「重新探测」即可看到。')
      :'未探测到可自动纳管的空闲盘，请手工填写设备路径（如 /dev/nvme0n2），并确认该盘未被别的 OSD 使用。')+
    '</span><div class="sp"></div><button class="btn sm" data-act="q-replan">'+ic('refresh',12)+' 重新生成命令</button>'+
    '<button class="btn sm" data-act="q-dev-refresh">'+ic('disk',12)+' 重新探测</button></div>'+
   '<div class="tiny" style="margin-bottom:8px;font-weight:600;color:var(--muted)">后端生成的命令序列（'+esc(liveProfile().version||'')+' / '+esc(liveProfile().orchestrator||'')+'）</div>'+
   '<div class="cmdbox" style="max-height:190px;overflow:auto">'+q.steps.map(function(s,i){
     return '<div class="'+(s.manual?'tw':'')+'"><span class="cm">'+('0'+(i+1)).slice(-2)+'</span> '+esc(s.c)+
      (s.note?' <span class="cm"># '+esc(s.note)+'</span>':'')+'</div>';}).join('')+'</div>';
  if(state.settings.confirm){
   b+=isRep
    ?'<div class="hr"></div><div class="fgrp"><label class="fld">输入 <span class="mono" style="color:var(--accent2)">osd.'+q.osdId+'</span> 确认要重建的编号</label>'+
     '<input class="inp" data-bind="quick.phrase" value="'+esc(q.phrase)+'" placeholder="osd.'+q.osdId+'" autocomplete="off"></div>'+
     '<label class="chk"><input type="checkbox" data-bind="quick.confirmed"'+(q.confirmed?' checked':'')+'><span>我已确认 <span class="mono">'+esc(q.oldDev||'原盘')+'</span> 已换成新盘 <span class="mono">'+esc(q.dev||'-')+'</span>，且编号保持 osd.'+q.osdId+'</span></label>'
    :'<div class="hr"></div><div class="fgrp"><label class="fld">输入设备路径 <span class="mono" style="color:var(--accent2)">'+esc(q.dev||'/dev/sdb')+'</span> 确认</label>'+
     '<input class="inp mono" data-bind="quick.phrase" value="'+esc(q.phrase)+'" placeholder="'+esc(q.dev)+'" autocomplete="off"></div>'+
     '<label class="chk"><input type="checkbox" data-bind="quick.confirmed"'+(q.confirmed?' checked':'')+'><span>我已现场核对盘位与设备名 <span class="mono">'+esc(q.dev)+'</span></span></label>';
  }else b+='<div class="hint" style="margin-top:10px">已在设置中关闭二次确认：点击「立即执行」将直接开始。</div>';
  if(state.mode==='live'&&state.auth.role!=='admin')b+='<div class="dangerbox" style="margin-top:12px">'+ic('lock')+'<div>当前为只读账号，后端会拒绝写操作。请用管理员账号登录。</div></div>';
  foot='<button class="btn" data-act="q-close">取消</button><div class="sp"></div>'+
   '<button class="btn pri" data-act="q-run">'+ic(isRep?'wrench':'zap',14)+' 立即执行'+(isRep?'换盘':'初始化')+'</button>';
 }else if(q.phase==='confirm'){
  var used=o.size?pct(o.used,o.size):0,isKick=q.kind==='kick',isIn=q.kind==='in';
  b='<div class="'+(isKick?'dangerbox':'warnbox')+'" style="margin-bottom:14px">'+ic(isIn?'check':'alert')+
   '<div><b>'+(isKick?'即将把 osd.'+q.osdId+' 停掉并从集群摘出（DOWN + OUT）':'即将把 osd.'+q.osdId+' 重新加入集群')+'</b><br>'+
   (isKick?'流程：停止 OSD 守护进程 → 标记 DOWN → 标记 OUT（从 CRUSH 摘出，触发回填）→ 状态复核 → 健康验证。<b>不做退役</b>：不 purge、不删认证、不清盘，随时可点 IN 恢复。':
    '流程：启动 OSD 守护进程 → 确认 OSD 仍在 CRUSH → 取消 OUT 标记（osd in）→ 恢复权重并回填 → 健康验证。')+
   '<br>当前为 <b>'+(q.dryRun?'DRY-RUN 演示（命令不下发）':'真实 EXECUTE 模式')+'</b>。</div></div>'+
   '<div class="grid g2" style="margin-bottom:14px"><div>'+
    '<div class="stat-line"><span>目标 OSD</span><b class="mono">osd.'+q.osdId+'</b></div>'+
    '<div class="stat-line"><span>主机 / 设备</span><b class="mono">'+esc(q.host)+' · '+esc(q.dev)+'</b></div>'+
    '<div class="stat-line"><span>序列号</span><b class="mono">'+esc(q.serial||'-')+'</b></div></div><div>'+
    '<div class="stat-line"><span>容量使用</span><b class="mono">'+used+'% ('+(o.used!=null?bytes(o.used):'-')+')</b></div>'+
    '<div class="stat-line"><span>SMART</span><b class="'+(o.smart&&o.smart!=='OK'?'td':'t')+'">'+esc(o.smart||'-')+'</b></div>'+
    '<div class="stat-line"><span>命令步骤</span><b class="mono">'+q.steps.length+' 条</b></div></div></div>'+
   '<div class="tiny" style="margin-bottom:8px;font-weight:600;color:var(--muted)">后端生成的命令序列（'+esc(liveProfile().version||'')+' / '+esc(liveProfile().orchestrator||'')+'）</div>'+
   '<div class="cmdbox" style="max-height:190px;overflow:auto">'+q.steps.map(function(s,i){
     return '<div class="'+(s.manual?'tw':'')+'"><span class="cm">'+('0'+(i+1)).slice(-2)+'</span> '+esc(s.c)+
      (s.note?' <span class="cm"># '+esc(s.note)+'</span>':'')+'</div>';}).join('')+'</div>';
  if(state.settings.confirm){
   b+='<div class="hr"></div><div class="fgrp"><label class="fld">输入 <span class="mono" style="color:var(--accent2)">osd.'+q.osdId+'</span> 确认目标</label>'+
    '<input class="inp" data-bind="quick.phrase" value="'+esc(q.phrase)+'" placeholder="osd.'+q.osdId+'" autocomplete="off"></div>'+
    '<label class="chk"><input type="checkbox" data-bind="quick.confirmed"'+(q.confirmed?' checked':'')+'><span>我已现场核对物理盘位与 SN <span class="mono">'+esc(q.serial||'-')+'</span></span></label>';
  }else b+='<div class="hint" style="margin-top:10px">已在设置中关闭二次确认：点击「立即执行」将直接开始。</div>';
  if(state.mode==='live'&&state.auth.role!=='admin')b+='<div class="dangerbox" style="margin-top:12px">'+ic('lock')+'<div>当前为只读账号，后端会拒绝写操作。请用管理员账号登录。</div></div>';
  foot='<button class="btn" data-act="q-close">取消</button><div class="sp"></div>'+
   (isIn?'':'<button class="btn" data-act="q-wizard" title="'+(isKick?'踢盘只做 down + out；需要彻底移除 OSD 时走完整退役向导（含 purge / 清盘）':'改用带自动预检的完整向导')+'">'+(isKick?'完整退役向导':'高级向导')+'</button>')+
   '<button class="btn '+(isKick?'dan':'pri')+'" data-act="q-run">'+ic('zap',14)+' 立即执行'+(isKick?'踢盘':'IN 盘')+'</button>';
 }else if(q.phase==='running'||q.phase==='paused'){
  b='<div class="flex" style="margin-bottom:10px"><span class="tag '+(q.dryRun?'warn':'err')+'">'+(q.dryRun?'DRY-RUN':'EXECUTE')+'</span>'+
    '<span class="tag info">stage: '+esc(q.stage)+'</span><div class="sp"></div><b class="mono" id="q-pct">'+q.progress+'%</b></div>'+
   '<div class="prog"><i id="q-prog" style="width:'+q.progress+'%"></i></div>'+
   '<div class="term" id="q-term" style="height:230px"></div>';
  if(q.phase==='paused'){
   b+='<div class="warnbox" style="margin-top:12px">'+ic('wrench')+'<div><b>请现场更换磁盘</b>：按 SN <span class="mono">'+esc(q.serial||'-')+'</span> 与盘位把 <span class="mono">'+esc(q.oldDev||'原盘')+'</span> 换成新盘（新盘装回<b>原盘位</b>，编号才能沿用）。'+
    '平台已暂停，后续 '+q.pending.length+' 条命令（清理新盘签名 / 用原编号重建 / 复核 up·in）将在确认后继续下发。</div></div>';
   if(q.prereq&&q.prereq.ok===false){
    b+='<div class="dangerbox" style="margin-top:10px">'+ic('alert')+'<div><b>编号复用前提尚未满足，先别急着继续</b><br>'+
     (q.prereq.blockers||[]).map(function(x){return '· '+esc(x);}).join('<br>')+
     '<br>点「继续执行」时平台会重新只读核验：原编号仍不是 <span class="mono">destroyed</span> 就拒绝 zap，'+
     '否则新盘会被分配成新的 OSD 编号。先用 <span class="mono">ceph orch osd rm status</span> / '+
     '<span class="mono">ceph osd dump</span> 确认移除队列走完再继续。</div></div>';
   }
   foot='<div class="sp"></div><button class="btn" data-act="q-abort">中止流程</button>'+
    '<button class="btn pri" data-act="q-resume">'+ic('check',14)+' 磁盘已换好，继续执行</button>';
  }else foot='<div class="sp"></div><button class="btn dan" data-act="q-abort">中止</button>';
 }else if(q.phase==='done'){
  var v=q.verify||null,badVerify=(q.kind==='kick'||q.kind==='replace')&&v&&v.ok===false;
  /* 复核结论分三种：没复用编号（真失败，等也没用）、编排器还在部署（可自动复核）、成功。
     「OSD up 慢」只属于第二种；把第一种也显示成「未完全生效」会误导成等待即可。 */
  var pending=!!(badVerify&&v.pending),hardFail=badVerify&&!pending;
  var stateColor=hardFail?'td':pending?'tw':'t';
  var headline=hardFail?(q.kind==='replace'&&v.newOsd?'未复用原编号':'未完全生效'):
               pending?'已提交，等待编排器重建':'流程已完成';
  b='<div style="text-align:center;padding:12px 0 18px"><div style="font-size:38px" class="'+stateColor+'">'+
   ic(badVerify?'alert':'check',38)+'</div>'+
   '<div style="font-size:16px;font-weight:700;margin-top:8px">'+quickTitle(q.kind)+headline+'</div>'+
   '<div class="note" style="margin-top:6px">'+
   (q.kind==='init'?esc(q.dev)+' @ '+esc(q.host):
    q.kind==='replace'?'osd.'+q.osdId+' · '+esc(q.oldDev||'原盘')+' → '+esc(q.dev||'新盘'):'osd.'+q.osdId)+' · '+
   (q.dryRun?'DRY-RUN：命令仅生成并写入审计，未下发集群':
    q.kind==='init'?'已初始化并加入集群，数据开始回填；新 OSD 会在 OSD 列表出现':
    q.kind==='kick'?(badVerify?'复核结论见下方':'已停服务并标记 DOWN + OUT，数据回填中；需要恢复时点「IN」即可重新加入集群'):
    q.kind==='replace'?(badVerify?'原编号必须仍是 osd.'+q.osdId+'，详见下方复核结论':'新盘已用原编号 osd.'+q.osdId+' 重建并上线，数据开始回填'):
    '命令已下发，请在概览确认 HEALTH_OK 与 PG active+clean')+'</div></div>'+
   (hardFail?'<div class="dangerbox" style="margin-bottom:12px">'+ic('alert')+'<div><b>换盘复核未通过'+
     (v.newOsd?'：新盘被分配为 osd.'+v.newOsd:'')+'</b><br>'+esc(v.message)+
     (v.newOsd?'<br>一键换盘要求「编号不变」，这次等同于新增磁盘。确认数据无碍后清理多出的 OSD，检查 OSDSpec 再重试。':'')+
     '</div></div>':
    pending?'<div class="warnbox" style="margin-bottom:12px">'+ic('alert')+'<div><b>编排器仍在部署，不是失败</b><br>'+esc(v.message)+
     '<br>每 5 秒自动复核一次'+(q.recheckLeft?'（已复核 '+q.recheckLeft+' 次）':'')+
     (q.recheckDone?'，自动复核已结束，可手动点「重新复核」。':'。')+'</div></div>':'')+
   '<div class="grid g2"><div><div class="stat-line"><span>执行步骤</span><b class="mono">'+q.steps.length+'</b></div>'+
   '<div class="stat-line"><span>集群版本</span><b class="mono">'+esc(liveProfile().version||'-')+'</b></div></div>'+
   '<div><div class="stat-line"><span>'+(q.kind==='init'?'新 OSD':'编号复核')+'</span><b class="'+
   (hardFail?'td':pending?'tw':'t')+'">'+
   (q.kind==='init'?'待同步（列表刷新后可见）':
    q.kind==='replace'?(v&&v.ok?'osd.'+q.osdId+' 已 up/in（编号不变）':
     hardFail&&v.newOsd?'未复用：新盘成了 osd.'+v.newOsd:pending?'等待 osd.'+q.osdId+' 上线':'待复核'):
    q.kind==='kick'?'待复核（后端已回读 osd dump）':'已自动恢复')+'</b></div>'+
   '<div class="stat-line"><span>审计记录</span><b class="t">已写入</b></div></div></div>'+
   '<div class="warnbox" style="margin-top:12px">'+ic('shield')+'<div>真实环境请回到「告警中心」确认告警已清除，并在「变更审计」复核完整命令序列与返回码。</div></div>';
  foot='<div class="sp"></div>'+
   (badVerify?'<button class="btn" data-act="q-recheck"'+(q.recheckBusy?' disabled':'')+'>'+ic('refresh',14)+
    (q.recheckBusy?' 复核中…':' 重新复核')+'</button>':'')+
   '<button class="btn" data-act="q-alerts">查看告警</button>'+
   '<button class="btn" data-act="q-audit">变更审计</button><button class="btn pri" data-act="q-close">完成</button>';
 }
 openModal(qHead()+'<div class="modal-b">'+b+'</div><div class="modal-f">'+foot+'</div>','lg');
 if(q.phase==='running'||q.phase==='paused')quickPaintLogs();
}
/* 只读重新复核：zap 后由 OSDSpec 异步重建，OSD 起来有延迟。
   不重跑流程、不下发任何写命令，只回读 osd dump / metadata 看编号有没有复用。 */
function qRecheck(q,cb){
 if(!state.quick||state.quick!==q)return;
 if(state.mode!=='live'||!state.auth.authenticated){toast('演示模式没有后端可复核','w');if(cb)cb();return;}
 q.recheckBusy=true;quickPaintModal();
 apiFetch('POST','/api/osd/verify',{osd_id:q.osdId,dev:q.dev||''}).then(function(r){
  if(!state.quick||state.quick!==q)return;
  q.recheckBusy=false;q.recheckLeft=(q.recheckLeft||0)+1;
  q.verify=r.verify||q.verify;
  quickPaintModal();
  if(q.verify.ok){toast('复核通过：'+q.verify.message,'ok');setTimeout(function(){syncState(true);},800);}
  else if(!q.verify.pending)toast('复核结论：'+q.verify.message,'e');
  if(cb)cb();
 }).catch(function(e){
  if(!state.quick||state.quick!==q)return;
  q.recheckBusy=false;toast('重新复核失败：'+e.message,'e');quickPaintModal();
  if(cb)cb();
 });
}
function qAutoRecheck(q,left){
 if(!state.quick||state.quick!==q||q.phase!=='done'||!q.verify||!q.verify.pending)return;
 if(left<=0){q.recheckDone=true;quickPaintModal();return;}
 setTimeout(function(){
  if(!state.quick||state.quick!==q||q.phase!=='done'||!q.verify||!q.verify.pending)return;
  qRecheck(q,function(){qAutoRecheck(q,left-1);});
 },5000);
}
function qLog(cls,text){var q=state.quick;if(!q)return;q.logs.push({cls:cls,text:text});quickPaintLogs();}
function quickPaintLogs(){
 var t=document.getElementById('q-term');if(!t||!state.quick)return;
 t.innerHTML=state.quick.logs.map(function(l){return '<div class="'+l.cls+'">'+esc(l.text)+'</div>';}).join('');
 t.scrollTop=t.scrollHeight;
 var p=document.getElementById('q-prog'),x=document.getElementById('q-pct');
 if(p)p.style.width=state.quick.progress+'%';if(x)x.textContent=state.quick.progress+'%';
}
function quickApply(){
 var q=state.quick,o=state.osds.filter(function(x){return x.id===q.osdId;})[0],isIn=q.kind==='in';
 if(q.kind==='init'){
  /* 新增磁盘：新 OSD 的 id / 容量只有后端知道，本地不猜，等强制刷新带回真实值。 */
  addAudit('OSD_INIT_1CLICK',q.dev||'-',q.steps.map(function(s){return s.c;}).join(' ; '),
   (q.dryRun?'DRY-RUN 演练 · ':'一键执行 · ')+(state.auth.user||'console'));
  return;}
 if(q.kind==='kick'){/* 踢盘 = down + out：OSD 仍在集群里，不能从列表删掉，
   只把本地状态标成 down / out，真实值由随后的强制刷新覆盖。
   后端复核没过时不能往前端写成 down——那会让界面说谎。 */
  if(!q.verify||q.verify.ok!==false){if(o){o.up=false;o.inn=false;}
   state.cluster.osdsIn=Math.max(0,(state.cluster.osdsIn||0)-1);}}
 else if(q.kind==='replace'){
  /* 换盘：编号不变，只看后端复核结论改 up/in；新盘的 SMART / 用量只有刷新才知道，
     不能在这里编一个「已恢复」的假象。 */
  if(!q.verify||q.verify.ok!==false){if(o){o.up=true;o.inn=true;}}}
 else if(isIn){if(o){o.inn=true;o.up=true;}
  state.cluster.osdsIn=Math.min(state.cluster.osds,(state.cluster.osdsIn||0)+1);}
 state.alerts.forEach(function(a){if(a.osd!==q.osdId||a.status==='resolved')return;
  /* 踢盘后 OSD 是 down+out，告警还在不在由后端真实健康检查决定，本地不假装恢复；
     IN 只清掉「被标记 OUT」类告警；盘仍 down 的硬件告警永远不假装恢复。 */
  if(q.kind==='kick')return;
  if(isIn&&a.code!=='OSD_OUT'&&a.code!=='OSD_IN')return;
  a.status='resolved';});
 state.cluster.osdsUp=state.osds.filter(function(x){return x.up;}).length+
  Math.max(0,state.cluster.osds-state.osds.length);
 state.cluster.health=healthInfo().t;state.lastRefresh=Date.now();
 addAudit(q.kind==='kick'?'OSD_KICK_1CLICK':isIn?'OSD_IN_1CLICK':'OSD_REPLACE_1CLICK','osd.'+q.osdId,
  q.steps.map(function(s){return s.c;}).join(' ; '),
  (q.dryRun?'DRY-RUN 演练 · ':'一键执行 · ')+(state.auth.user||'console'));
}
function quickExec(stage){
 var q=state.quick;if(!q)return;
 q.phase='running';q.stage=stage;q.aborted=false;q.logs=[];q.progress=0;q.pending=[];q.verify=null;
 q.recheckLeft=0;q.recheckDone=false;q.recheckBusy=false;quickPaintModal();
 qLog('d','# Ceph Ops Console · '+(q.dryRun?'DRY-RUN':'EXECUTE')+' · '+dt(Date.now()));
 qLog('d','# target '+(q.kind==='init'?q.dev+' @ '+q.host:
  'osd.'+q.osdId+' @ '+q.host+' '+(q.kind==='replace'?(q.oldDev||'?')+' → '+q.dev:q.dev))+
  ' · '+liveProfile().version+' / '+liveProfile().orchestrator);
 qLog('d','# stage='+stage+' · 所有命令参数化执行，不经 shell');qLog('d','');
 var body=q.kind==='init'
  ?{host:q.host,dev:q.dev,confirm_phrase:q.phrase,allow_write:!q.dryRun,stage:'auto'}
  :{osd_id:q.osdId,host:q.host,dev:q.dev,confirm_phrase:'osd.'+q.osdId,allow_write:!q.dryRun,stage:stage};
 var req;
 if(state.mode==='live'&&state.auth.authenticated){
  req=apiFetch('POST',q.kind==='kick'?'/api/quick/kick':q.kind==='in'?'/api/quick/in':
   q.kind==='init'?'/api/quick/init':'/api/quick/replace',body);
 }else{
  var manualIdx=-1;q.steps.forEach(function(s,i){if(manualIdx<0&&(s.manual||String(s.c).charAt(0)==='#'))manualIdx=i;});
  var slice=stage==='pre'&&manualIdx>=0?q.steps.slice(0,manualIdx):
            (stage==='post'&&manualIdx>=0?q.steps.slice(manualIdx+1):q.steps);
  req=Promise.resolve({commands:slice.map(function(s){return s.c;}),results:[],dry_run:true,
   pause:q.kind==='replace'&&stage==='pre'&&manualIdx>=0,
   pending_commands:manualIdx>=0?q.steps.slice(manualIdx+1).map(function(s){return s.c;}):[],
   manual_step:{name:'物理更换故障盘',note:'现场操作'}});
 }
 req.then(function(r){
  if(!state.quick||state.quick!==q)return;
  q.prereq=r.prereq||null;
  var cmds=r.commands||[],res=r.results||[],i=0;
  qLog('c','✓ 后端返回 '+cmds.length+' 条命令（dry_run='+!!r.dry_run+'）');
  function step(){
   if(!state.quick||state.quick!==q)return;
   if(q.aborted){qLog('e','! 用户中止，剩余步骤未执行');q.phase='done';quickPaintModal();return;}
   if(i>=cmds.length){
    if(r.pause||(q.kind==='replace'&&stage==='pre'&&q.hasManual)){
     q.pending=r.pending_commands||[];q.phase='paused';quickPaintModal();return;}
    q.progress=100;
    if(r.verify){
     q.verify=r.verify;
     if(r.verify.ok)qLog('c','✓ 复核通过：'+r.verify.message);
     else qLog('e','! 复核未通过：'+r.verify.message);
    }
    qLog('c','✓ 全部步骤完成');
    quickApply();q.phase='done';quickPaintModal();
    if(r.verify&&!r.verify.ok){
     if(r.verify.pending)toast('流程已提交，等待编排器用原编号重建（自动复核中）','w');
     else toast(r.verify.newOsd?'换盘未复用原编号：新盘成了 osd.'+r.verify.newOsd:'复核未通过：'+r.verify.message,'e');
    }else toast(quickTitle(q.kind)+' 流程完成','ok');
    if(r.verify&&r.verify.pending&&state.mode==='live'&&state.auth.authenticated)qAutoRecheck(q,12);
    if(state.mode==='live'&&state.auth.authenticated)setTimeout(function(){syncState(true);},1500);
    return;}
   var c=String(cmds[i]);qLog(c.charAt(0)==='#'?'d':'p',c.charAt(0)==='#'?c:'$ '+c);
   setTimeout(function(){
    if(!state.quick||state.quick!==q)return;
    if(q.aborted){qLog('e','! 用户中止');q.phase='done';quickPaintModal();return;}
    if(res[i])qLog('d','  '+String(res[i]).slice(0,240));
    else if(c.charAt(0)==='#')qLog('w','  [人工步骤] 等待现场确认');
    else qLog(q.dryRun?'w':'c','  ok'+(q.dryRun?'  (dry-run: 未下发)':''));
    i++;q.progress=Math.round(i/Math.max(1,cmds.length)*100);quickPaintLogs();step();
   },280);
  }
  step();
 }).catch(function(e){
  if(!state.quick||state.quick!==q)return;
  qLog('e','! 后端返回：'+(e.message||e));
  q.error=e.message||'执行失败';q.phase='error';quickPaintModal();
 });
}

/* ---------- create pool ---------- */
/* 建池是「新增」类操作：不迁移也不删除任何现有数据，但会立刻产生 PG 并开始
   占用集群 IO，所以同样走预览 → 二次确认 → 后端回读复核这条链路。 */
function poolSpec(){
 var p=state.pool||{};
 return {name:String(p.name||'').trim(),type:p.type||'replicated',
  size:Number(p.size)||0,min_size:Number(p.minSize)||0,
  pg_num:Number(p.pg)||0,pgp_num:Number(p.pgp)||Number(p.pg)||0,
  rule:p.rule||'',ec_profile:(p.type==='erasure')?(p.ec||'default'):'',
  app:p.app||'',autoscale:!!p.autoscale};
}
function poolValidate(){
 var p=state.pool,s=poolSpec();
 if(!s.name)return '请填写存储池名称';
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s.name))return '名称只允许字母、数字、点、下划线、短横线，且不超过 64 位';
 if(s.name.charAt(0)==='.')return '名称不能以 . 开头（Ceph 保留）';
 if(p.type==='replicated'){
  if(!(s.size>=1&&s.size<=10))return '副本数需在 1 ~ 10 之间';
  if(!(s.min_size>=1&&s.min_size<=s.size))return 'min_size 需在 1 ~ size 之间';
 }else if(!s.ec_profile){return '请选择 EC profile';}
 if(!(s.pg_num>=1&&s.pg_num<=65536))return 'PG 数需在 1 ~ 65536 之间';
 return '';
}
function poolOpen(){
 var live=state.mode==='live'&&state.auth.authenticated;
 state.pool={name:'',type:'replicated',size:3,minSize:2,pg:0,pgp:0,rule:'',ec:'',
  app:'rbd',autoscale:true,opts:null,loading:live,phase:'form',steps:[],spec:null,
  phrase:'',confirmed:false,busy:false,error:'',dryRun:!state.settings.allowWrite,
  logs:[],verify:null,exists:false,results:[]};
 state.quick=null;
 poolPaint();
 if(!live){state.pool.loading=false;poolPaint();return;}
 apiFetch('GET','/api/pool/options').then(function(r){
  var p=state.pool;if(!p)return;
  var d=r.data||{};
  p.opts=d;p.loading=false;p.autoscale=!!d.autoscale;
  var g=Number(d.pg_suggest)||64;p.pg=g;p.pgp=g;
  if((d.ec_profiles||[]).length)p.ec=d.ec_profiles[0].name;
  poolPaint();
 }).catch(function(e){
  var p=state.pool;if(!p)return;
  p.loading=false;p.opts={};p.error='无法读取集群池配置：'+(e.message||e);poolPaint();
 });
}
/* 预览：命令序列必须来自后端，前端不自己拼 ceph 命令 */
function poolPreview(){
 var p=state.pool;if(!p||p.busy)return;
 var bad=poolValidate();if(bad){toast(bad,'e');return;}
 if(!(state.mode==='live'&&state.auth.authenticated)){
  p.error='未连接后端：请先登录后再创建存储池';poolPaint();return;}
 p.error='';p.phase='loading';poolPaint();
 apiFetch('POST','/api/pool/plan',poolSpec()).then(function(r){
  var q=state.pool;if(!q)return;
  q.spec=r.spec||poolSpec();q.exists=!!r.exists;
  q.steps=(r.steps||[]).map(function(s){return {n:s.name,c:s.command||('# '+s.name),note:s.note||'',manual:!!s.manual};});
  q.phase='confirm';
  if(!state.settings.confirm){q.phrase=q.spec.name;q.confirmed=true;}
  poolPaint();
 }).catch(function(e){
  var q=state.pool;if(!q)return;
  q.phase='form';q.error=e.message||'命令预览失败';poolPaint();
 });
}
function poolRun(){
 var p=state.pool;if(!p||p.busy)return;
 var s=poolSpec();
 if(state.settings.confirm&&(p.phrase!==s.name||!p.confirmed)){
  toast('请输入池名 '+s.name+' 并勾选确认','e');return;}
 p.busy=true;p.error='';p.phase='running';p.logs=[];p.results=[];p.verify=null;poolPaint();
 var body=poolSpec();
 body.confirm_phrase=s.name;   /* 后端校验的就是这个池名，与输入框内容无关 */
 body.allow_write=!p.dryRun;
 apiFetch('POST','/api/pool/create',body).then(function(r){
  var q=state.pool;if(!q)return;
  q.busy=false;q.verify=r.verify||null;q.results=r.results||[];q.commands=r.commands||[];
  q.spec=r.spec||q.spec;q.phase='done';
  poolPaint();
  var bad=q.verify&&q.verify.ok===false;
  if(q.dryRun)toast('DRY-RUN：建池命令已生成，尚未下发集群','w');
  else toast(bad?'池已创建但复核未通过，请查看详情':'存储池 '+s.name+' 已创建',bad?'w':'ok');
  if(state.mode==='live'&&state.auth.authenticated)setTimeout(function(){syncState(true).then(function(){render();});},800);
 }).catch(function(e){
  var q=state.pool;if(!q)return;
  q.busy=false;q.phase='confirm';q.error=e.message||'创建失败';poolPaint();
 });
}
function poolField(label,inner,hint){
 return '<div class="fgrp" style="margin-bottom:12px"><label class="fld">'+label+'</label>'+inner+
  (hint?'<div class="hint">'+hint+'</div>':'')+'</div>';
}
function poolPaint(){
 var p=state.pool;if(!p)return;
 var o=p.opts||{},b='',foot='',name='';
 if(p.loading){
  b='<div class="empty">'+ic('refresh',34)+'<div>正在读取集群池配置（OSD 数 / CRUSH rule / EC profile）…</div></div>';
  foot='<div class="sp"></div><button class="btn" data-act="pool-close">取消</button>';
 }else if(p.phase==='form'){
  var rules=(o.rules||[]).map(function(r){
   return '<option value="'+esc(r)+'"'+(p.rule===r?' selected':'')+'>'+esc(r)+'</option>';}).join('');
  var ecs=(o.ec_profiles||[]).map(function(e){
   var km=(e.k!=null&&e.m!=null)?(' · k='+e.k+' m='+e.m+'（可容忍 '+e.m+' 块盘故障）'):'';
   return '<option value="'+esc(e.name)+'"'+(p.ec===e.name?' selected':'')+'>'+esc(e.name)+km+'</option>';}).join('');
  var sug=Number(o.pg_suggest)||0;
  b='<div class="warnbox" style="margin-bottom:14px">'+ic('db')+
   '<div><b>在集群里新建一个存储池</b><br>只新增池与 PG，不迁移、不删除现有数据，也不改动已有池的配置。'+
   '新建池会立刻产生 PG 并开始占用 IO，集群繁忙时建议先在低峰期操作。<br>'+
   '已有池 '+((o.pools||[]).length||state.pools.length||0)+' 个 · OSD '+(o.osds!=null?o.osds:state.osds.length)+' 个 · 当前为 <b>'+
   (p.dryRun?'DRY-RUN 演示（命令不下发）':'真实 EXECUTE 模式')+'</b>。</div></div>'+
   poolField('存储池名称','<input class="inp mono" data-bind="pool.name" value="'+esc(p.name)+'" placeholder="例如 k8s-rbd" autocomplete="off">','建好后不能改名：RBD / CephFS / RGW 的应用都会被这个名称引用。')+
   poolField('类型','<select class="inp" data-bind="pool.type" data-act="pool-type">'+
     '<option value="replicated"'+(p.type==='replicated'?' selected':'')+'>replicated · 多副本（常规首选）</option>'+
     '<option value="erasure"'+(p.type==='erasure'?' selected':'')+'>erasure · 纠删码（省空间，写放大高）</option></select>','')+
   (p.type==='replicated'
    ?'<div class="grid g2" style="gap:10px">'+
      poolField('副本数 size','<input class="inp mono" type="number" min="1" max="10" data-bind="pool.size" value="'+esc(p.size)+'">','3 副本可容忍 1 块盘故障且不丢数据。')+
      poolField('min_size','<input class="inp mono" type="number" min="1" max="10" data-bind="pool.minSize" value="'+esc(p.minSize)+'">','可用副本低于该值会停止写入，通常取 size-1。')+'</div>'
    :'<div class="grid g2" style="gap:10px">'+
      poolField('EC profile','<select class="inp mono" data-bind="pool.ec" data-act="pool-type">'+(ecs||'<option value="default">default</option>')+'</select>','k+m 决定空间放大与容忍度；ks=4 km=2 之类由 profile 决定。')+
      poolField('min_size（可选）','<input class="inp mono" type="number" min="0" max="32" data-bind="pool.minSize" value="'+esc(p.minSize)+'">','一般填 k+1；填 0 表示用 profile 默认。')+'</div>')+
   '<div class="grid g2" style="gap:10px">'+
    poolField('PG 数（pg_num）','<input class="inp mono" type="number" min="1" max="65536" data-bind="pool.pg" value="'+esc(p.pg)+'">',
      sug?('建议 '+sug+'（按 '+((o.osds!=null?o.osds:'?'))+' 个 OSD × 100 / 3 副本估算，取 2 的幂）：'+
       '<button class="btn sm" data-act="pool-suggest-pg" data-value="'+sug+'">用建议值</button>'):'')+
    poolField('PG 自动扩缩','<label class="chk" style="margin-top:6px"><input type="checkbox" data-bind="pool.autoscale"'+(p.autoscale?' checked':'')+'><span>开启 <span class="mono">pg_autoscale_mode</span>（按实际用量自动调 PG）</span></label>','14.x 及以上支持；老版本该步会失败但不影响建池。')+'</div>'+
   '<div class="grid g2" style="gap:10px">'+
    poolField('CRUSH rule','<select class="inp mono" data-bind="pool.rule"><option value="">默认（集群默认 rule）</option>'+rules+'</select>','需要指定故障域 / 设备类时选择对应 rule。')+
    poolField('应用类型','<select class="inp" data-bind="pool.app">'+
      [['','不启用（通用池）'],['rbd','rbd · 块存储'],['cephfs','cephfs · 文件系统元数据 / 数据'],['rgw','rgw · 对象网关']].map(function(x){
       return '<option value="'+x[0]+'"'+(p.app===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select>','enable 只是打应用标记；CephFS 还需另外创建文件系统，RBD 可直接建镜像。')+'</div>'+
   (p.error?'<div class="dangerbox" style="margin-top:12px">'+ic('alert')+'<div>'+esc(p.error)+'</div></div>':'');
  if(state.mode==='live'&&state.auth.role!=='admin')b+='<div class="dangerbox" style="margin-top:12px">'+ic('lock')+'<div>当前为只读账号，后端会拒绝创建；请用管理员账号登录。</div></div>';
  foot='<button class="btn" data-act="pool-close">取消</button><div class="sp"></div>'+
   '<button class="btn pri" data-act="pool-preview">'+ic('terminal',14)+' 生成命令预览</button>';
 }else if(p.phase==='loading'){
  b='<div class="empty">'+ic('refresh',34)+'<div>正在向后端请求建池命令序列…</div></div>';
  foot='<div class="sp"></div><button class="btn" data-act="pool-close">取消</button>';
 }else if(p.phase==='confirm'){
  var sp=p.spec||poolSpec();
  var typeTxt=sp.type==='erasure'?('erasure · '+esc(sp.ec_profile)):'replicated · size '+sp.size+' / min_size '+sp.min_size;
  b='<div class="warnbox" style="margin-bottom:14px">'+ic('db')+
   '<div><b>即将创建存储池 '+esc(sp.name)+'</b><br>流程：建池 → 设置 size / min_size → 开启 PG 自动扩缩 → 标记应用类型 → 回读池配置复核 → 健康验证。<br>'+
   '这是新增操作，不会删除或改写任何现有池的数据。<br>当前为 <b>'+(p.dryRun?'DRY-RUN 演示（命令不下发）':'真实 EXECUTE 模式')+'</b>。</div></div>'+
   '<div class="grid g2" style="margin-bottom:14px"><div>'+
    '<div class="stat-line"><span>名称</span><b class="mono tp">'+esc(sp.name)+'</b></div>'+
    '<div class="stat-line"><span>类型</span><b class="mono">'+typeTxt+'</b></div>'+
    '<div class="stat-line"><span>PG</span><b class="mono">'+sp.pg_num+' / pgp '+sp.pgp_num+'</b></div></div><div>'+
    '<div class="stat-line"><span>应用</span><b class="mono">'+esc(sp.app||'未标记')+'</b></div>'+
    '<div class="stat-line"><span>CRUSH rule</span><b class="mono">'+esc(sp.rule||'默认')+'</b></div>'+
    '<div class="stat-line"><span>自动扩缩</span><b class="'+(sp.autoscale?'t':'tw')+'">'+(sp.autoscale?'开启':'关闭')+'</b></div></div></div>'+
   (p.exists?'<div class="dangerbox" style="margin-bottom:12px">'+ic('alert')+'<div>集群中已存在同名池 <b class="mono">'+esc(sp.name)+'</b>，创建会被拒绝。请改名后重试。</div></div>':'')+
   '<div class="tiny" style="margin-bottom:8px;font-weight:600;color:var(--muted)">后端生成的命令序列（'+esc(liveProfile().version||'')+' / '+esc(liveProfile().orchestrator||'')+'）</div>'+
   '<div class="cmdbox" style="max-height:200px;overflow:auto">'+p.steps.map(function(s,i){
     return '<div><span class="cm">'+('0'+(i+1)).slice(-2)+'</span> '+esc(s.c)+
      (s.note?' <span class="cm"># '+esc(s.note)+'</span>':'')+'</div>';}).join('')+'</div>'+
   (p.error?'<div class="dangerbox" style="margin-top:12px">'+ic('alert')+'<div>'+esc(p.error)+'</div></div>':'');
  if(state.settings.confirm){
   b+='<div class="hr"></div><div class="fgrp"><label class="fld">输入池名 <span class="mono" style="color:var(--accent2)">'+esc(sp.name)+'</span> 确认</label>'+
    '<input class="inp mono" data-bind="pool.phrase" value="'+esc(p.phrase)+'" placeholder="'+esc(sp.name)+'" autocomplete="off"></div>'+
    '<label class="chk"><input type="checkbox" data-bind="pool.confirmed"'+(p.confirmed?' checked':'')+'><span>我确认要创建该存储池，且名称与参数符合预期</span></label>';
  }else b+='<div class="hint" style="margin-top:10px">已在设置中关闭二次确认：点击「立即创建」将直接下发。</div>';
  foot='<button class="btn" data-act="pool-back">返回修改</button><div class="sp"></div>'+
   '<button class="btn pri" data-act="pool-run"'+(p.exists?' disabled':'')+'>'+ic('db',14)+' 立即创建存储池</button>';
 }else if(p.phase==='running'){
  b='<div class="flex" style="margin-bottom:10px"><span class="tag '+(p.dryRun?'warn':'err')+'">'+(p.dryRun?'DRY-RUN':'EXECUTE')+'</span>'+
   '<div class="sp"></div><b class="mono">后端执行中…</b></div>'+
   '<div class="empty">'+ic('refresh',34)+'<div>正在下发 '+(p.steps.length||0)+' 条命令并回读池配置，请稍候…</div></div>';
  foot='<div class="sp"></div><button class="btn" disabled>执行中</button>';
 }else if(p.phase==='done'){
  var bad=p.verify&&p.verify.ok===false;
  var v=p.verify||{};
  b='<div style="text-align:center;padding:12px 0 18px"><div style="font-size:38px" class="'+(bad?'td':'t')+'">'+
   ic(bad?'alert':'check',38)+'</div>'+
   '<div style="font-size:16px;font-weight:700;margin-top:8px">'+
   (p.dryRun?'命令已生成（DRY-RUN 未下发）':bad?'命令已下发，但复核未通过':'存储池已创建')+'</div>'+
   '<div class="note" style="margin-top:6px">'+esc((p.spec||{}).name||'')+' · '+
   (p.dryRun?'DRY-RUN：命令仅生成并写入审计，未下发集群':
    bad?esc(v.message||'无法回读该池'):esc(v.message||'已创建'))+'</div></div>'+
   (bad?'<div class="dangerbox" style="margin-bottom:12px">'+ic('alert')+'<div>'+esc(v.message||'')+'</div></div>':'')+
   '<div class="grid g2"><div>'+
    '<div class="stat-line"><span>执行步骤</span><b class="mono">'+p.steps.length+'</b></div>'+
    '<div class="stat-line"><span>集群版本</span><b class="mono">'+esc(liveProfile().version||'-')+'</b></div></div><div>'+
    '<div class="stat-line"><span>复核结果</span><b class="'+(bad?'td':'t')+'">'+(p.dryRun?'未执行':(bad?'未通过':'通过'))+'</b></div>'+
    '<div class="stat-line"><span>审计记录</span><b class="t">已写入</b></div></div></div>'+
   (p.results.length?'<div class="cmdbox" style="max-height:170px;overflow:auto;margin-top:12px">'+
     p.results.map(function(r){return '<div class="'+(/^(warning|verify|stopped)/.test(String(r))?'tw':'')+'">'+esc(String(r))+'</div>';}).join('')+'</div>':'')+
   '<div class="warnbox" style="margin-top:12px">'+ic('shield')+'<div>回到「存储池」页确认新池已出现、PG 回到 active+clean；建池的完整命令与返回码已写入变更审计。</div></div>';
  foot='<div class="sp"></div><button class="btn" data-act="pool-audit">变更审计</button>'+
   '<button class="btn pri" data-act="pool-view">查看存储池</button>';
 }
 openModal(modalHead('创建存储池','不触碰现有池与数据 · '+(p.dryRun?'DRY-RUN':'EXECUTE'))+
  '<div class="modal-b">'+b+'</div><div class="modal-f">'+foot+'</div>','md');
}
function poolAction(act,el){
 var p=state.pool;
 switch(act){
  case 'pool-open':poolOpen();return;
  case 'pool-close':state.pool=null;closeModal();render();return;
  case 'pool-back':if(p){p.phase='form';p.error='';poolPaint();}return;
  case 'pool-type':if(p){poolPaint();}return;
  case 'pool-suggest-pg':if(p){p.pg=Number(el.getAttribute('data-value'))||p.pg;p.pgp=p.pg;poolPaint();}return;
  case 'pool-preview':poolPreview();return;
  case 'pool-run':poolRun();return;
  case 'pool-view':state.pool=null;closeModal();state.view='pools';render();
   if(state.mode==='live')syncState(true).then(function(){render();});return;
  case 'pool-audit':state.pool=null;closeModal();state.view='audit';render();loadAudit(true).then(function(){render();});return;
  default:return;
 }
}

/* ---------- action routing ---------- */
function quickAction(act,el){
 var q=state.quick;
 switch(act){
  case 'q-open':quickOpen(el.getAttribute('data-kind')||'replace',el.getAttribute('data-id'));return;
  case 'q-close':state.quick=null;closeModal();render();return;
  case 'q-retry':if(q)quickOpen(q.kind,q.osdId);return;
  case 'q-wizard':if(q){if(q.kind==='in'){toast('IN 盘只涉及 osd in 与回填观察，直接执行即可','w');return;}
   var k=q.kind,id=q.osdId;state.quick=null;closeModal();startWizard(id,k==='kick'?'remove':'replace');}return;
  case 'q-dev':/* 选了另一块新盘：重新生成命令序列 */
   if(q&&(q.kind==='init'||q.kind==='replace')){q.dev=el.value||q.dev;replanQuick(q);}return;
  case 'q-replan':
   if(q&&(q.kind==='init'||q.kind==='replace')){replanQuick(q);}return;
  case 'q-dev-refresh':
   if(q&&(q.kind==='init'||q.kind==='replace')){
    var keep=q;
    loadFreeDevices(keep).then(function(list){
     if(state.quick!==keep)return;
     var usable=pickDevices(keep,list,keep.host);
     keep.devices=usable;
     if(usable.length)keep.dev=usable[0].dev;
     if(keep.dev)replanQuick(keep);else{keep.steps=[];keep.phase='confirm';quickPaintModal();}
    });}return;
  case 'q-run':
   if(!q)return;
   if(q.kind==='init'){
    if(!q.dev){toast('请先选择或填写新盘设备','e');return;}
    if(state.settings.confirm&&(q.phrase!==q.dev||!q.confirmed)){toast('请输入设备路径 '+q.dev+' 并勾选盘位确认','e');return;}
   }else if(q.kind==='replace'){
    if(!q.dev){toast('请先选择或填写换上新盘的设备路径','e');return;}
    if(!q.host){toast('请填写新盘所在的服务器','e');return;}
    if(state.settings.confirm&&(q.phrase!=='osd.'+q.osdId||!q.confirmed)){toast('请输入 osd.'+q.osdId+' 确认编号不变，并勾选换盘确认','e');return;}
   }else if(q.phrase!=='osd.'+q.osdId||!q.confirmed){toast('请输入 osd.'+q.osdId+' 并勾选盘位确认','e');return;}
   if(state.mode==='live'&&state.auth.role!=='admin'){toast('只读账号无法执行写操作，请用管理员登录','e');return;}
   quickExec(q.kind==='init'?'auto':'pre');return;
  case 'q-resume':if(q)quickExec('post');return;
  case 'q-abort':if(q){q.aborted=true;toast('已发送中止请求','w');}return;
  case 'q-recheck':if(q)qRecheck(q,null);return;
  case 'q-alerts':state.quick=null;closeModal();state.view='alerts';render();return;
  case 'q-audit':state.quick=null;closeModal();state.view='audit';render();return;
  default:return;
 }
}
function authAction(act,el){
 switch(act){
  case 'auth-tab':state.auth.tab=el.getAttribute('data-value');state.auth.error='';renderAuth();return;
  case 'auth-login':doLogin();return;
  default:return;
 }
}
var __baseOnAct=onAct;
onAct=function(act,el){
 if(act.indexOf('auth-')===0)return authAction(act,el);
 if(act.indexOf('q-')===0)return quickAction(act,el);
 if(act.indexOf('pool-')===0)return poolAction(act,el);
 if(act==='diag-retry'){__histAt=0;syncState(true).then(function(){return loadHistory(true);}).then(function(){render();});return;}
 if(act==='diag-run'){runDiag();return;}
 if(act==='logout')return doLogout();
 if(act==='change-password')return changePassword();
 if(act==='overlay'){
  if(state.quick&&(state.quick.phase==='running'||state.quick.phase==='paused')){
   toast('操作进行中，请先完成或中止','w');return;}
  if(state.pool&&state.pool.busy){toast('建池命令正在下发，请稍候','w');return;}
  state.quick=null;state.pool=null;return __baseOnAct(act,el);}
 if(act==='modal-close'&&(state.quick||state.pool)){
  if(state.pool&&state.pool.busy){toast('建池命令正在下发，请稍候','w');return;}
  state.quick=null;state.pool=null;return __baseOnAct(act,el);}
 if(act==='nav'&&(state.quick||state.pool)){state.quick=null;state.pool=null;}
 return __baseOnAct(act,el);
};

/* app-wizard.js may have booted before this file was evaluated (readyState
   !== 'loading'), so make sure the login/link initialisation always runs. */
if(document.readyState==='loading'){
 document.addEventListener('DOMContentLoaded',function(){liveBoot();});
}else{
 liveBoot();
}
