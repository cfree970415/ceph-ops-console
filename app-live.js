/* Ceph Ops Console - login/session, remote backend link, one-click OSD ops.
   Loaded last: wraps render / renderTop / onAct / API.call from the other files. */
'use strict';

/* ---------- extended state ---------- */
state.auth={required:false,authenticated:false,user:'',role:'viewer',allowWrite:false,
            readOnly:false,backend:'cli',session:'',tab:'password',error:'',busy:false};
state.link={apiBase:'',stateOk:false};
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
   throw new Error(j.error||('HTTP '+r.status));});
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
 var a=state.auth,pw=a.tab==='password';
 var box='<div class="auth-wrap"><div class="auth-card">'+
  '<div class="auth-brand"><div class="brand-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2c3.5 0 6 2.6 6 6.2v1.3c0 1.6.7 3.1 1.9 4.1 1.2 1 1.9 2.5 1.9 4.1 0 2.9-2.3 5.3-5.2 5.3H7.4C4.5 23 2.2 20.6 2.2 17.7c0-1.6.7-3.1 1.9-4.1A5.4 5.4 0 0 0 6 9.5V8.2C6 4.6 8.5 2 12 2z"/><path d="M12 2v6M6 12h12"/></svg></div>'+
  '<div><div style="font-size:16px;font-weight:700">Ceph Ops Console</div><div class="tiny">多版本集群监控与磁盘运维 · 登录</div></div></div>'+
  '<div class="fgrp" style="margin-top:18px"><label class="fld">后端服务地址'+
   (backendBase()?' <span class="tag info">跨机连接</span>':' <span class="tag mute">同源</span>')+'</label>'+
   '<input class="inp" id="auth-api" value="'+esc(backendBase())+'" placeholder="留空为同源；跨机填 http://后端IP:8780" autocomplete="off">'+
   '<div class="hint">前端可独立部署在任意 Web 服务器，只要能访问后端 API 即可；地址会保存在本机浏览器。</div></div>'+
  '<div class="seg" style="margin-bottom:14px"><button class="'+(pw?'on acc':'')+'" data-act="auth-tab" data-value="password">账号密码</button>'+
   '<button class="'+(!pw?'on acc':'')+'" data-act="auth-tab" data-value="token">访问令牌</button></div>'+
  (pw?
   '<div class="fgrp"><label class="fld">用户名</label><input class="inp" id="auth-user" value="admin" autocomplete="username" placeholder="deploy.sh 创建的用户"></div>'+
   '<div class="fgrp"><label class="fld">密码</label><input class="inp" id="auth-pass" type="password" autocomplete="current-password" placeholder="初始密码见部署脚本输出"></div>':
   '<div class="fgrp"><label class="fld">访问令牌（Service Token）</label><input class="inp" id="auth-token" type="password" placeholder="部署脚本生成的 X-Console-Token"><div class="hint">令牌保存在 0600 的 env 文件中；用它换取会话后不会出现在地址栏。</div></div>')+
  (a.error?'<div class="dangerbox" style="margin-bottom:12px">'+ic('alert')+'<div>'+esc(a.error)+'</div></div>':'')+
  '<button class="btn pri" style="width:100%;padding:10px" data-act="auth-login" '+(a.busy?'disabled':'')+'>'+ic('lock',15)+' '+(a.busy?'正在连接…':'登录并连接集群')+'</button>'+
  '<div class="hr"></div><div class="grid g2" style="gap:8px;font-size:11px;color:var(--faint)">'+
   '<div>'+ic('shield',13)+' 会话 8 小时 · HttpOnly Cookie</div><div>'+ic('network',13)+' 支持前后端分离部署</div>'+
   '<div>'+ic('db',13)+' 不影响 Ceph 原生 Dashboard</div><div>'+ic('terminal',13)+' 默认 DRY-RUN</div></div>'+
  '<div style="margin-top:14px;text-align:center"><button class="btn gho sm" data-act="auth-demo">不连接后端，进入离线演示</button></div>'+
  '<div style="margin-top:10px;text-align:center;font-size:11px;color:var(--faint)">UI 构建 '+esc(UI_BUILD)+'</div>'+
  '</div></div>';
 root.innerHTML=box;
}
function authPayload(){
 if(state.auth.tab==='token'){var t=document.getElementById('auth-token');return {token:t?t.value.trim():''};}
 var u=document.getElementById('auth-user'),p=document.getElementById('auth-pass');
 return {username:u?u.value.trim():'',password:p?p.value:''};}
function applySession(r){
 /* Logging in as admin (or any real account) always means the live console.
    The demo shell is only reachable by explicitly choosing DEMO. */
 state.mode='live';try{sessionStorage.removeItem('cc_demo');}catch(e){}
 state.auth.authenticated=true;state.auth.user=r.user||'admin';state.auth.role=r.role||'viewer';
 state.auth.allowWrite=!!r.allow_write&&state.auth.role==='admin';
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
 try{sessionStorage.removeItem('cc_session');sessionStorage.removeItem('cc_token');sessionStorage.removeItem('cc_demo');}catch(e){}
 state.token='';state.quick=null;state.profile=null;state.isolation=null;state.link.stateOk=false;
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
 try{sessionStorage.removeItem('cc_demo');}catch(e){}
 /* Clicking the LIVE button while already live and signed in must be a no-op.
    Resetting state.auth here used to log the user out and re-open the login
    screen (Settings -> run mode -> LIVE 对接集群). */
 if(state.mode==='live'&&state.auth.authenticated){
  toast('当前已连接后端 · '+esc(state.auth.user||'')+'，无需重新登录','ok');
  return;
 }
 var sid=state.auth.session||'';
 if(!sid){try{sid=sessionStorage.getItem('cc_session')||'';}catch(e){}}
 state.mode='live';state.auth=authReset();state.auth.required=true;state.auth.session=sid;
 render();
 if(!sid){renderAuth();toast('请填写后端地址并登录','w');return;}
 /* Try to resume the saved session before showing the login form, so a
    DEMO -> LIVE round trip does not force a password re-entry. */
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

/* ---------- boot: decide demo / live / cross-server link ---------- */
function liveBoot(){
 if(window.__CC_LIVE_BOOTED__)return;window.__CC_LIVE_BOOTED__=true;
 var b=window.__CEPH_BOOT__||null,q=new URLSearchParams(location.search),saved='';
 try{saved=localStorage.getItem('cc_api_base')||'';}catch(e){}
 var apiParam=q.get('api'),wantDemo=q.get('demo')==='1';
 state.apiBase=apiParam?apiParam.replace(/\/+$/,''):(b?'':saved);
 state.link.apiBase=state.apiBase;
 state.auth.required=!!(b&&b.authRequired)||!!state.apiBase;
 var sid='';try{sid=sessionStorage.getItem('cc_session')||'';}catch(e){}
 var choseDemo=false;try{choseDemo=sessionStorage.getItem('cc_demo')==='1';}catch(e){}
 var httpPage=/^https?:$/.test(location.protocol||'');
 /* A saved session means the user really signed in: it outranks any remembered
    DEMO choice, so a logged-in admin can never land on the demo shell again.
    DEMO only wins via an explicit ?demo=1 URL or when no session exists. */
 state.mode=wantDemo?'demo':(sid?'live':(choseDemo?'demo':((b||state.apiBase||httpPage)?'live':'demo')));
 render();renderAuth();
 if(state.mode==='live'){
  if(sid)state.auth.session=sid;
  apiFetch('GET','/api/session').then(function(r){
   if(r.authenticated){applySession(r);signedIn();}
   else if(state.token){
    return apiFetch('POST','/api/login',{token:state.token}).then(function(l){applySession(l);signedIn();});
   }
   else renderAuth();
  }).catch(function(){renderAuth();})
  .then(function(){try{history.replaceState({},'',location.pathname);}catch(e){}});
 }
 startRefresh();
}
function startRefresh(){
 setInterval(function(){
  if(!state.autoRefresh)return;
  if(state.mode!=='live'){state.lastRefresh=Date.now();
   state.metrics.cap=state.metrics.cap.slice(1).concat([state.metrics.cap[23]+0.06]);
   state.cluster.iops=Math.round(17000+Math.random()*3500);
   if(!state.wizard&&!state.quick)render();return;}
  if(!state.auth.authenticated)return;
  syncState();
  apiFetch('GET','/api/isolation').then(function(r){state.isolation=r.data||null;}).catch(function(){});
 },15000);
}

/* ---------- wrap shell render: never show demo data before login ---------- */
var __baseRender=render;
render=function(){
 if(state.mode==='live'&&!state.auth.authenticated){
  document.documentElement.setAttribute('data-theme',state.theme);
  var n=document.getElementById('nav'),t=document.getElementById('topbar'),
      c=document.getElementById('content'),f=document.getElementById('side-foot');
  if(n)n.innerHTML='';if(f)f.innerHTML='';
  if(t)t.innerHTML='<div class="crumb">Ceph Ops Console<small>等待登录</small></div>';
  if(c)c.innerHTML='<div class="empty">'+ic('lock',34)+'<div>正在连接后端，请先登录</div></div>';
  return;}
 __baseRender();
};
var __baseRenderTop=renderTop;
renderTop=function(){
 __baseRenderTop();
 var bar=document.getElementById('topbar');if(!bar)return;
 var n=activeAlerts().filter(function(a){return a.sev==='critical'&&a.status==='active';}).length;
 var h='<button class="ib" data-act="nav" data-view="alerts" title="查看告警页面" style="position:relative">'+ic('bell')+
   (n?'<span class="nav-badge" style="position:absolute;top:-6px;right:-6px">'+n+'</span>':'')+'</button>';
 if(state.mode==='demo')h='<button class="btn sm" data-act="show-login">'+ic('link',13)+' 连接后端</button>'+h;
 else if(state.auth.authenticated)h='<span class="pill '+(state.auth.allowWrite?'ok':'warn')+'">'+ic('shield',13)+' '+
   esc(state.auth.user)+' · '+(state.auth.role==='admin'?'管理员':'只读')+(state.auth.allowWrite?'':' · DRY-RUN')+'</span>'+
   '<button class="ib" data-act="nav" data-view="settings" title="系统设置 · 修改密码">'+ic('settings',15)+'</button>'+
   '<button class="ib" data-act="logout" title="退出登录">'+ic('lock')+'</button>'+h;
 bar.innerHTML+=h;
};

/* ---------- isolation card (proves native dashboard is untouched) ---------- */
function isolationCard(){
 var d=state.isolation,head='<span class="tag ok">不影响原生 Dashboard</span>';
 if(!d)return card('与 Ceph 原生 Dashboard 的隔离',
  '<div class="note">登录后端后，此处会显示实时检查结果：原生 Dashboard 地址、端口占用、独立凭证与未改动项。'+
  '本控制台使用独立进程、独立端口与独立 client keyring，不修改 <span class="code-inline">ceph.conf</span>、不改动 mgr 模块配置。</div>',head);
 var rows=(d.checks||[]).map(function(x){
  return '<div class="stat-line"><span><span class="tag '+(x.status==='err'?'err':'ok')+'">'+(x.status==='err'?'冲突':'正常')+'</span> '+esc(x.item)+
   '</span><span class="tm" style="max-width:62%;text-align:right">'+esc(x.detail)+'</span></div>';}).join('');
 return card('与 Ceph 原生 Dashboard 的隔离',
  '<div class="stat-line"><span>原生 Dashboard</span><b class="mono">'+(d.native_dashboard&&d.native_dashboard.detected?esc(d.native_dashboard.url):'未探测到 / 使用 REST 地址')+'</b></div>'+
  '<div class="stat-line"><span>本控制台</span><b class="mono tp">ceph-console : '+esc(d.port)+'</b></div>'+
  '<div class="stat-line"><span>独立凭证</span><b class="mono mini">'+esc(d.dedicated_client)+'</b></div>'+
  '<div class="hr"></div>'+rows+
  '<div class="warnbox" style="margin-top:12px">'+ic('shield')+'<div>原生 Dashboard 继续按原地址和原账号使用；本控制台只是通过只读命令与独立 client 凭证观察集群。写操作同样经该凭证下发，不会修改 mgr dashboard 的任何配置。</div></div>',head);
}

/* ---------- one-click kick / replace ---------- */
function quickTitle(k){return k==='kick'?'一键踢盘（退役）':'一键换盘（保留 OSD ID）';}
function quickPlan(k,w){
 if(state.mode==='live'&&state.auth.authenticated){
  return apiFetch('POST','/api/plan',{intent:k==='kick'?'remove':'replace',osd_id:w.osdId,host:w.host,dev:w.dev})
   .then(function(r){return (r.steps||[]).map(function(s){
     return {n:s.name,c:s.command||('# '+s.name+'：'+s.note),note:s.note||'',manual:!!s.manual};});});
 }
 return Promise.resolve(wizardPlan({osdId:w.osdId,host:w.host,dev:w.dev,intent:k==='kick'?'remove':'replace'}));
}
function quickOpen(kind,osdId){
 var n=osdId==null?(faultOsd()||{}).id:Number(osdId);
 var o=state.osds.filter(function(x){return x.id===n;})[0]||state.osds[0];
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
function qHead(){var q=state.quick;return modalHead(quickTitle(q.kind)+' · osd.'+q.osdId,
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
 }else if(q.phase==='confirm'){
  var used=o.size?pct(o.used,o.size):0;
  b='<div class="'+(q.kind==='kick'?'dangerbox':'warnbox')+'" style="margin-bottom:14px">'+ic('alert')+
   '<div><b>即将'+(q.kind==='kick'?'把 osd.'+q.osdId+' 永久踢出集群':'踢出并更换 osd.'+q.osdId+' 的磁盘')+'</b><br>'+
   (q.kind==='replace'?'流程：移除 OSD → 清理磁盘元数据 → <b>人工换盘（平台暂停）</b> → 原 ID 重建 → 回填观察。':'流程：标记 OUT → 等待回填 → 移除 OSD 与认证 → 清理设备 → 健康验证。')+
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
   '<button class="btn" data-act="q-wizard" title="改用带自动预检的完整向导">高级向导</button>'+
   '<button class="btn '+(q.kind==='kick'?'dan':'pri')+'" data-act="q-run">'+ic('zap',14)+' 立即执行'+(q.kind==='kick'?'踢盘':'换盘')+'</button>';
 }else if(q.phase==='running'||q.phase==='paused'){
  b='<div class="flex" style="margin-bottom:10px"><span class="tag '+(q.dryRun?'warn':'err')+'">'+(q.dryRun?'DRY-RUN':'EXECUTE')+'</span>'+
    '<span class="tag info">stage: '+esc(q.stage)+'</span><div class="sp"></div><b class="mono" id="q-pct">'+q.progress+'%</b></div>'+
   '<div class="prog"><i id="q-prog" style="width:'+q.progress+'%"></i></div>'+
   '<div class="term" id="q-term" style="height:230px"></div>';
  if(q.phase==='paused'){
   b+='<div class="warnbox" style="margin-top:12px">'+ic('wrench')+'<div><b>请现场更换磁盘</b>：按 SN <span class="mono">'+esc(q.serial||'-')+'</span> 与盘位更换 '+esc(q.dev)+
    '。平台已暂停，后续 '+q.pending.length+' 条命令（重建 OSD / 重新加入 / 健康验证）将在确认后继续下发。</div></div>';
   foot='<div class="sp"></div><button class="btn" data-act="q-abort">中止流程</button>'+
    '<button class="btn pri" data-act="q-resume">'+ic('check',14)+' 磁盘已换好，继续执行</button>';
  }else foot='<div class="sp"></div><button class="btn dan" data-act="q-abort">中止</button>';
 }else if(q.phase==='done'){
  b='<div style="text-align:center;padding:12px 0 18px"><div style="font-size:38px" class="t">'+ic('check',38)+'</div>'+
   '<div style="font-size:16px;font-weight:700;margin-top:8px">'+quickTitle(q.kind)+'流程已完成</div>'+
   '<div class="note" style="margin-top:6px">osd.'+q.osdId+' · '+(q.dryRun?'DRY-RUN：命令仅生成并写入审计，未下发集群':'命令已下发，请在概览确认 HEALTH_OK 与 PG active+clean')+'</div></div>'+
   '<div class="grid g2"><div><div class="stat-line"><span>执行步骤</span><b class="mono">'+q.steps.length+'</b></div>'+
   '<div class="stat-line"><span>集群版本</span><b class="mono">'+esc(liveProfile().version||'-')+'</b></div></div>'+
   '<div><div class="stat-line"><span>关联告警</span><b class="t">已自动恢复</b></div>'+
   '<div class="stat-line"><span>审计记录</span><b class="t">已写入</b></div></div></div>'+
   '<div class="warnbox" style="margin-top:12px">'+ic('shield')+'<div>真实环境请回到「告警中心」确认告警已清除，并在「变更审计」复核完整命令序列与返回码。</div></div>';
  foot='<div class="sp"></div><button class="btn" data-act="q-alerts">查看告警</button>'+
   '<button class="btn" data-act="q-audit">变更审计</button><button class="btn pri" data-act="q-close">完成</button>';
 }
 openModal(qHead()+'<div class="modal-b">'+b+'</div><div class="modal-f">'+foot+'</div>','lg');
 if(q.phase==='running'||q.phase==='paused')quickPaintLogs();
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
 var q=state.quick,o=state.osds.filter(function(x){return x.id===q.osdId;})[0];
 if(q.kind==='kick'){state.osds=state.osds.filter(function(x){return x.id!==q.osdId;});
  state.cluster.osds=Math.max(0,state.cluster.osds-1);}
 else if(o){o.up=true;o.inn=true;o.smart='OK';o.used=Math.round(o.used*0.55);}
 state.alerts.forEach(function(a){if(a.osd===q.osdId&&a.status!=='resolved')a.status='resolved';});
 state.cluster.osdsUp=state.osds.filter(function(x){return x.up;}).length+
  Math.max(0,state.cluster.osds-state.osds.length);
 state.cluster.health=healthInfo().t;state.lastRefresh=Date.now();
 addAudit(q.kind==='kick'?'OSD_KICK_1CLICK':'OSD_REPLACE_1CLICK','osd.'+q.osdId,
  q.steps.map(function(s){return s.c;}).join(' ; '),
  (q.dryRun?'DRY-RUN 演示 · ':'一键执行 · ')+(state.mode==='live'?state.auth.user:'本地演示'));
}
function quickExec(stage){
 var q=state.quick;if(!q)return;
 q.phase='running';q.stage=stage;q.aborted=false;q.logs=[];q.progress=0;q.pending=[];quickPaintModal();
 qLog('d','# Ceph Ops Console · '+(q.dryRun?'DRY-RUN':'EXECUTE')+' · '+dt(Date.now()));
 qLog('d','# target osd.'+q.osdId+' @ '+q.host+' '+q.dev+' · '+liveProfile().version+' / '+liveProfile().orchestrator);
 qLog('d','# stage='+stage+' · 所有命令参数化执行，不经 shell');qLog('d','');
 var body={osd_id:q.osdId,host:q.host,dev:q.dev,confirm_phrase:'osd.'+q.osdId,
  allow_write:!q.dryRun,stage:stage};
 var req;
 if(state.mode==='live'&&state.auth.authenticated){
  req=apiFetch('POST',q.kind==='kick'?'/api/quick/kick':'/api/quick/replace',body);
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
  var cmds=r.commands||[],res=r.results||[],i=0;
  qLog('c','✓ 后端返回 '+cmds.length+' 条命令（dry_run='+!!r.dry_run+'）');
  function step(){
   if(!state.quick||state.quick!==q)return;
   if(q.aborted){qLog('e','! 用户中止，剩余步骤未执行');q.phase='done';quickPaintModal();return;}
   if(i>=cmds.length){
    if(r.pause||(q.kind==='replace'&&stage==='pre'&&q.hasManual)){
     q.pending=r.pending_commands||[];q.phase='paused';quickPaintModal();return;}
    q.progress=100;qLog('c','✓ 全部步骤完成');
    quickApply();q.phase='done';quickPaintModal();
    toast(quickTitle(q.kind)+' 流程完成','ok');
    if(state.mode==='live'&&state.auth.authenticated)setTimeout(function(){syncState();},1500);
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

/* ---------- action routing ---------- */
function quickAction(act,el){
 var q=state.quick;
 switch(act){
  case 'q-open':quickOpen(el.getAttribute('data-kind')||'replace',el.getAttribute('data-id'));return;
  case 'q-close':state.quick=null;closeModal();render();return;
  case 'q-retry':if(q)quickOpen(q.kind,q.osdId);return;
  case 'q-wizard':if(q){var k=q.kind,id=q.osdId;state.quick=null;closeModal();startWizard(id,k==='kick'?'remove':'replace');}return;
  case 'q-run':
   if(!q)return;
   if(q.phrase!=='osd.'+q.osdId||!q.confirmed){toast('请输入 osd.'+q.osdId+' 并勾选盘位确认','e');return;}
   if(state.mode==='live'&&state.auth.role!=='admin'){toast('只读账号无法执行写操作，请用管理员登录','e');return;}
   quickExec('pre');return;
  case 'q-resume':if(q)quickExec('post');return;
  case 'q-abort':if(q){q.aborted=true;toast('已发送中止请求','w');}return;
  case 'q-alerts':state.quick=null;closeModal();state.view='alerts';render();return;
  case 'q-audit':state.quick=null;closeModal();state.view='audit';render();return;
  default:return;
 }
}
function authAction(act,el){
 switch(act){
  case 'auth-tab':state.auth.tab=el.getAttribute('data-value');state.auth.error='';renderAuth();return;
  case 'auth-login':doLogin();return;
  case 'auth-demo':state.mode='demo';state.auth=authReset();state.auth.required=false;
   /* DEMO is an explicit choice: remember it so a page refresh does not
      silently drop the user back into the live login screen. */
   try{sessionStorage.setItem('cc_demo','1');}catch(e){}
   /* Keep apiBase: a cross-server frontend must be able to switch back to
      LIVE without retyping the backend address. */
   state.settings.allowWrite=false;state.link.stateOk=false;render();renderAuth();
   toast('已进入离线演示模式，数据不来自集群','w');return;
  default:return;
 }
}
var __baseOnAct=onAct;
onAct=function(act,el){
 if(act.indexOf('auth-')===0)return authAction(act,el);
 if(act.indexOf('q-')===0)return quickAction(act,el);
 if(act==='logout')return doLogout();
 if(act==='change-password')return changePassword();
 if(act==='show-login')return enterLive();
 if(act==='overlay'){
  if(state.quick&&(state.quick.phase==='running'||state.quick.phase==='paused')){
   toast('操作进行中，请先完成或中止','w');return;}
  state.quick=null;return __baseOnAct(act,el);}
 if(act==='modal-close'&&state.quick){state.quick=null;return __baseOnAct(act,el);}
 if(act==='nav'&&state.quick){state.quick=null;}
 return __baseOnAct(act,el);
};

/* app-wizard.js may have booted before this file was evaluated (readyState
   !== 'loading'), so make sure the login/link initialisation always runs. */
if(document.readyState==='loading'){
 document.addEventListener('DOMContentLoaded',function(){liveBoot();});
}else{
 liveBoot();
}
