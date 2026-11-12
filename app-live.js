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

/* ---------- state.quick 的唯一真相 ----------
   现场事故（138，服务器重启后首次登录）：弹窗还开着、复选框也勾上了，
   清单却还是灰的、右侧一直冒「弹窗状态已失效」——某个分支把 state.quick
   清成了 null，DOM 却留在页面上，用户对着一个僵尸弹窗填表、勾选，全部落空。
   这类问题只靠读代码查不动，所以这里做三层防护：
   1) 意外清空直接拒绝：弹窗还在 DOM 里，就不允许把会话清掉（qc() 例外，
      它是主动关闭的正规出口）——从根上消灭「有 UI 没状态」；
   2) 真被清了也能自愈：quickLive() 在每次输入/勾选前从界面把已填内容
      读回来（quickRecover），用户不用关掉重开；
   3) 每次「有 -> 无」都在服务端日志留一条 reset（带调用栈行号），
      下次再出现直接看日志就知道是谁清的。 */
var __qClearing=false;
(function(){
 var q0=state.quick;
 try{
  Object.defineProperty(state,'quick',{
   configurable:true,
   get:function(){return q0;},
   set:function(v){
    var prev=q0;
    if(prev&&!v&&!__qClearing){
     var liveM=null;
     try{liveM=document.querySelector('#modal-root .modal');}catch(e){}
     if(liveM){
      /* 弹窗还开着却被清状态 = 用户接下来填的每一格都会丢。
         这里直接拒绝这次清空（会话保住），只留证据。 */
      var where0='';
      try{
       var ls=String((new Error()).stack||'').split('\n');
       for(var j=1;j<ls.length;j++){
        var s0=ls[j];
        if(s0.indexOf('set (')>=0||s0.indexOf('defineProperty')>=0)continue;
        where0=s0.replace(/^\s*at\s*/,'').replace(/https?:\/\/[^/]+\//,'').replace(/\?v=[\d.]+/,'').slice(0,120);
        break;}
      }catch(e){}
      state.quickBlocked=state.quickBlocked||[];
      state.quickBlocked.push({at:Date.now(),where:where0||'unknown'});
      if(state.quickBlocked.length>8)state.quickBlocked.shift();
      try{if(typeof qTrace==='function')qTrace(prev,'blocked-clear',where0||'unknown');}catch(e){}
      return;
     }
    }
    q0=v;
    if(!prev||v)return;
    var where='';
    try{
     var lines=String((new Error()).stack||'').split('\n');
     for(var i=1;i<lines.length;i++){
      var s=lines[i];
      if(s.indexOf('set (')>=0||s.indexOf('defineProperty')>=0)continue;
      where=s.replace(/^\s*at\s*/,'').replace(/https?:\/\/[^/]+\//,'').replace(/\?v=[\d.]+/,'').slice(0,120);
      break;}
    }catch(e){}
    prev.clearedAt=Date.now();
    /* 留一份「最后一次清空」的凭据：即使 quick 已经没了，q-run 报
       no-state 时也能把「谁在什么时候清的」一起送到服务端日志。 */
    state.quickLastReset={at:Date.now(),where:where||'unknown',kind:prev.kind||''};
    try{if(typeof qTrace==='function')qTrace(prev,'reset',where||'unknown');}catch(e){}
    /* 这里刻意不关弹窗：主动关闭的路径（q-close / overlay / nav / ...）
       自己都会 closeModal()，不需要这里代劳；而意外的清空如果立刻关窗，
       用户刚填的内容就白填了。留着弹窗，点「立即执行」时由 quickRecover
       从界面读回已填内容继续——这是对用户损失最小的做法。 */
   }
  });
 }catch(e){}
})();

/* 主动关闭弹窗时的正规清空出口。只有它（和「弹窗本来就不在了」）能真的
   把会话清掉；其它任何地方误写 state.quick=null 都会被上面的 setter 拒绝，
   否则就会出现「UI 还在、状态没了」的僵尸弹窗。 */
function qc(){
 __qClearing=true;
 try{state.quick=null;}finally{__qClearing=false;}
}

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
 state.token='';qc();state.pool=null;state.profile=null;state.isolation=null;
 closeModal();
 if(state.link){state.link.stateOk=false;state.link.stateError='';state.link.stateHttp=0;
  state.link.stateAt=0;state.link.diag=null;state.link.diagError='';}
 state.auth=authReset();render();renderAuth();toast('已退出登录','ok');
}
/* ---------- change the signed-in account's password ---------- */
/* ---------- 远程执行（二进制 / 包安装集群） ----------
   动盘命令必须在「盘所在主机」上执行：cephadm 由 mon 代跑，包安装没有这一层。
   这两个动作只改配置 / 只做探活，不执行任何写命令。 */
function sshForm(){
 var s=state.settings.ssh||{};
 return {enabled:s.enabled!==false,user:s.user||'root',
  port:Number(s.port)||22,key:s.key||'',sudo:s.sudo!==false};
}
function sshSave(){
 if(state.mode!=='live'||!state.auth.authenticated){toast('请先登录后再保存','w');return;}
 var body={ssh:sshForm(),deploy_mode:state.settings.deployMode||'auto'};
 toast('正在保存远程执行配置…','');
 apiFetch('POST','/api/remote/config',body).then(function(r){
  if(r.profile)state.profile=r.profile;
  if(r.ssh)state.settings.ssh=Object.assign({},state.settings.ssh||{},r.ssh);
  if(r.deploy_mode)state.settings.deployMode=r.deploy_mode;
  render();
  var st=state.settings.ssh||{};
  toast(st.ready?('已保存 · 远程执行就绪（'+(st.user||'root')+'@<host>:'+(st.port||22)+'）')
                :('已保存，但远程执行还不可用：'+(st.reason||'请检查 ssh 客户端')), st.ready?'ok':'w');
  syncState(true);
 }).catch(function(e){toast('保存失败：'+(e.message||'未知错误'),'e');});
}
function sshTest(){
 if(state.mode!=='live'||!state.auth.authenticated){toast('请先登录后再测试','w');return;}
 toast('正在逐台测试 ssh 连通性（只跑 hostname，不下发任何命令）…','');
 apiFetch('POST','/api/remote/test',{}).then(function(r){
  state.sshProbe=r.hosts||[];
  if(r.ssh)state.settings.ssh=Object.assign({},state.settings.ssh||{},r.ssh);
  render();
  var bad=(r.hosts||[]).filter(function(h){return !h.ok&&!h.local;});
  if(!r.ready){toast('远程执行不可用：'+((r.ssh&&r.ssh.reason)||'未配置'),'e');return;}
  toast(bad.length?(bad.length+' 台主机不可达：'+bad.map(function(h){return h.host;}).join('、'))
                  :('全部 '+(r.hosts||[]).length+' 台主机 ssh 可达'), bad.length?'w':'ok');
 }).catch(function(e){toast('测试失败：'+(e.message||'未知错误'),'e');});
}
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
  k==='retire'?'① 换盘前·清退（确认 down → 删除旧编号）':
  k==='deploy'?'② 换盘后·新盘入群（分配新编号）':
  k==='replace'?'完整换盘预览（删旧编号 + 新盘入群）':
  k==='init'?'新增磁盘（初始化新盘 · 新编号）':'一键换盘';}
function quickIntent(k){return k==='kick'?'downout':k==='in'?'in':k==='init'?'init':
  k==='retire'?'retire':k==='deploy'?'deploy':'replace';}
/* 换盘两个阶段是各自独立的请求：现场物理换盘可能隔几小时、页面可能早被关掉，
   不能把后半段挂在 state.quick 的 pre/pause 会话上。 */
function isPhase(k){return k==='retire'||k==='deploy';}
function quickPlan(k,w){
 if(state.mode==='live'&&state.auth.authenticated){
  return apiFetch('POST','/api/plan',{intent:quickIntent(k),osd_id:w.osdId,host:w.host,dev:w.dev})
   .then(function(r){
    var steps=(r.steps||[]).map(function(s){
     /* host / remote：二进制包安装集群里，systemctl、ceph-volume 必须 ssh 到
        盘所在主机执行。步骤上标出来，用户一眼就知道这条不是在本机跑。 */
     return {n:s.name,c:s.command||('# '+s.name+'：'+s.note),note:s.note||'',manual:!!s.manual,
      host:s.host||'',remote:!!s.remote,via:s.via||''};});
    /* 只读预检（清退前是否 down / 入群前新盘归属）挂在数组上，
       不改变步骤结构，原有调用方不用改。 */
    steps.precheck=r.precheck||null;
    return steps;});
 }
 if(k==='init')return Promise.resolve([
  {n:'预检设备',c:'# 预检设备是否空闲、可加入集群',note:'确认设备未被 OSD 占用',manual:true},
  {n:'清理元数据',c:'ceph-volume lvm zap '+w.dev+' --destroy',note:'清掉分区表 / LVM / 文件系统签名'},
  {n:'创建 OSD',c:'ceph-volume lvm create --data '+w.dev,note:'创建新 OSD（新编号）并加入 CRUSH'},
  {n:'健康验证',c:'ceph -s --format=json',note:'观察 PG 回到 active+clean'}]);
 if(k==='retire')return Promise.resolve([
  {n:'确认故障 OSD 确实 down',c:'ceph osd dump --format=json',note:'后端执行前硬校验：仍为 up 直接拒绝清退'},
  {n:'清掉旧版僵尸移除任务',c:'ceph orch osd rm stop '+w.osdId,note:'只取消 --replace 排队任务，不动数据'},
  {n:'标记 OSD OUT',c:'ceph osd out '+w.osdId,note:'把 PG 迁走'},
  {n:'永久删除故障 OSD（编号不保留）',c:'ceph osd purge '+w.osdId+' --yes-i-really-mean-it',note:'mon 命令式：删 CRUSH / auth / osdmap，不走 cephadm 队列，不查 safe-to-destroy'},
  {n:'复核旧编号已删除',c:'ceph osd dump --format=json',note:'osds[] 里不应再有 osd.'+w.osdId+'，之后才可现场换盘'}]);
 if(k==='deploy')return Promise.resolve([
  {n:'确认新盘已被识别',c:'ceph orch device ls '+w.host+' --format=json',note:'新盘要出现在原主机上'},
  {n:'校验新盘归属',c:'# 只拦正被 up/in 的健康 OSD 使用的盘',note:'旧签名 / 残留编号不阻断'},
  {n:'清理新盘残留签名',c:'ceph orch device zap '+w.host+' '+w.dev+' --force',note:'抹掉旧 LVM / 分区表签名'},
  {n:'创建并部署新 OSD',c:'ceph orch daemon add osd '+w.host+':'+w.dev,note:'命令式创建，mon 分配新编号'},
  {n:'确认新 OSD 上线',c:'ceph osd dump --format=json',note:'新盘被某个 up/in 的 OSD 接管即可，编号不要求相同'},
  {n:'集群健康验证',c:'ceph -s --format=json',note:'等 PG active+clean'}]);
 if(k==='replace')return Promise.resolve([
  {n:'确认故障 OSD 确实 down',c:'# 后端硬校验：仍为 up 拒绝',note:'先让盘真下线',manual:true},
  {n:'清退旧 OSD（删除编号）',c:'ceph osd purge '+w.osdId+' --yes-i-really-mean-it',note:'不可逆：CRUSH / auth / osdmap 一起删'},
  {n:'物理更换故障盘',c:'# 现场按盘位 / SN 换上同规格新盘',note:'装回原盘位',manual:true},
  {n:'清理新盘元数据',c:'ceph-volume lvm zap '+w.dev+' --destroy',note:'只作用于新盘'},
  {n:'创建 OSD（新编号）',c:'ceph-volume lvm create --data '+w.dev,note:'不带 --osd-id，由 mon 分配新编号'},
  {n:'复核',c:'ceph osd dump --format=json',note:'确认新盘已被某个 up/in 的 OSD 接管'}]);
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
  /* 换盘时，旧编号 / 残留编号指向的那块盘正是要换掉的：允许列出（标「需先清理」）。
     只有「正被 up/in 的健康 OSD 使用」的盘、以及新增磁盘入口，才严格排除。 */
  if(usedBy[d.dev]!==undefined&&usedBy[d.dev]!==q.osdId){
   var ownerUp=false;
   (state.osds||[]).forEach(function(x){if(x&&x.dev===d.dev&&x.up&&x.inn)ownerUp=true;});
   if(q.kind==='init'||ownerUp)return;
   soft.push(d);return;
  }
  /* 换盘时新盘通常出现在原盘位、也就是原设备路径上（/dev/nvme0n2 拔掉换新，
     路径还是它）。这种情况要排在最前，而不是被过滤掉。 */
  if((q.kind==='replace'||q.kind==='deploy')&&q.oldDev&&d.dev===q.oldDev){same.push(d);return;}
  (d.available?ok:soft).push(d);
 });
 if(q.kind==='init')return ok;
 return same.concat(ok,soft);
}
/* 换盘拆成两个互不依赖的按钮：
   ① retire —— 此时新盘还没装，不需要选设备，确认旧 OSD 确实 down 后删除旧编号；
   ② deploy —— 现场换完盘之后才点，挑那块新盘，由 mon 分配一个新编号入群。 */
function quickOpenPhase(o,kind){
 if(!o||o.id==null){toast('请先选择一个要更换的 OSD','e');return;}
 state.quick={kind:kind,osdId:o.id,host:o.host||'',dev:o.dev||'',oldDev:o.dev||'',serial:o.serial||'',
  weight:o.weight,devices:[],phase:'loading',steps:[],logs:[],progress:0,phrase:'',confirmed:false,
  busy:false,error:'',stage:'auto',aborted:false,pending:[],hasManual:false,precheck:null,
  dryRun:!state.settings.allowWrite,role:state.auth.role||'admin'};
 state.wizard=null;
 var mine=state.quick;
 quickPaintModal();
 var prep=kind==='deploy'
  ?loadFreeDevices(mine).then(function(list){
    if(state.quick!==mine)return;
    var pick=pickDevices(mine,list,mine.host);
    mine.devices=pick;
    if(pick.length)mine.dev=pick[0].dev;})
  :Promise.resolve();
 prep.then(function(){
  if(state.quick!==mine)return;
  return replanQuick(mine);
 }).catch(function(e){
  if(state.quick!==mine)return;
  var q=mine;q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 高级向导的完整换盘预览：删掉旧编号，现场换盘，再用新编号把新盘加回集群 */
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
 return apiFetch('GET','/api/devices',null).then(function(r){
  /* 多节点包安装集群：盘是逐台 ssh 采的，哪台没采到必须让用户看见，
     否则「列表里没有新盘」会被误认为「盘没插好」。 */
  state.deviceScan={hosts:(r&&r.hosts)||[],mode:(r&&r.mode)||'',remote:(r&&r.remote)||null};
  return (r&&r.devices)||[];})
  .catch(function(){return [];});
}
function quickOpen(kind,osdId){
 var n=osdId==null?(kind==='in'?(inOsd()||{}).id:(faultOsd()||{}).id):Number(osdId);
 var o=state.osds.filter(function(x){return x.id===n;})[0]||state.osds[0];
 if(kind==='init'){return quickOpenInit(o);}
 if(kind==='replace'){return quickOpenReplace(o);}
 if(isPhase(kind)){return quickOpenPhase(o,kind);}
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
  q.steps=steps;q.precheck=steps.precheck||null;
  q.hasManual=steps.some(function(s){return s.manual||String(s.c).charAt(0)==='#';});
  q.phase='confirm';
  if(!state.settings.confirm){q.phrase='osd.'+q.osdId;q.confirmed=true;}
  quickPaintModal();
 }).catch(function(e){
  if(!state.quick||state.quick!==mine)return;
  var q=mine;q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 新增磁盘：目标是「设备」，不是某个 OSD；走完会多出一个新编号的 OSD */
/* 前端行为埋点：把「点了按钮之后走到了哪个分支」发到后端日志。
   后端只记日志、不写审计、不要求写权限，所以安全上没有新增面。
   目的很实际：「点了没反应」在浏览器里发生，后端访问日志只能证明
   「没发出请求」，证明不了卡在前端哪一步——有了它，一次复现就能定位。 */
function qTrace(q,branch,detail){
 try{
  if(q){q.trace=q.trace||[];q.trace.push({t:Date.now(),b:branch,d:detail||''});
   if(q.trace.length>24)q.trace.shift();}
  if(!(state.mode==='live'&&state.auth.authenticated))return;
  apiFetch('POST','/api/beacon',{ui:UI_BUILD,kind:(q&&q.kind)||'',branch:branch,
   detail:(detail||'')+(q?(' phase='+q.phase+' pendingRun='+!!q.pendingRun):'')}).catch(function(){});
 }catch(e){}
}
function quickOpenInit(o){
 state.quick={kind:'init',osdId:o?o.id:null,host:(o&&o.host)||'',
  dev:'',serial:'',devices:[],phase:'loading',steps:[],logs:[],progress:0,phrase:'',confirmed:false,
  busy:false,error:'',stage:'auto',aborted:false,pending:[],hasManual:false,
  dryRun:!state.settings.allowWrite,role:state.auth.role||'admin'};
 state.wizard=null;
 var mine=state.quick;
 qTrace(mine,'open','init');
 quickPaintModal();
 loadFreeDevices(mine).then(function(list){
  if(!state.quick||state.quick!==mine)return;
  var q=mine,pick=pickDevices(q,list,q.host);
  q.devices=pick;
  /* 用户可能在探测还没返回时就手工填了设备名（探测慢的时候很常见）。
     旧逻辑无条件 q.dev=pick.length?pick[0].dev:''，会把用户填的值清空，
     用户再点「立即执行」就会被判「没填设备路径」——看起来就是点了没反应。 */
  if(!q.dev||q.devAuto){
   q.dev=pick.length?pick[0].dev:'';
   q.devAuto=!!pick.length;
  }
  q.phase='confirm';
  qTrace(q,'devices','n='+pick.length+' dev='+(q.dev||'-'));
  /* loading 阶段被点掉的「立即执行」在这里补跑；旧逻辑只在这个分支里
     直接 return，pendingRun 永远没人消费，第一次点击就这么蒸发了。 */
  if(q.pendingRun){
   q.pendingRun=false;
   var bad=qValidate(q);
   if(!bad){quickExec((q.kind==='init'||isPhase(q.kind))?'auto':'pre');return;}
   q.inputError=bad.msg;q.errorField=bad.field;
   q.status='命令已生成，但还差一项才能开始：'+bad.msg;
   quickPaintModal();return;
  }
  /* 没排队的点击：有设备路径就把预检和命令序列拉出来给用户看；
     没有就停在表单，等用户填。绝不在这里直接 return 而不重绘。 */
  if(q.dev){replanQuick(q);return;}
  quickPaintModal();
 }).catch(function(e){
  if(!state.quick||state.quick!==mine)return;
  var q=mine;q.pendingRun=false;q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 换了新盘 / 改了设备路径 / 改了服务器：重新向后端要命令序列 */
function replanQuick(q){
 q.phase='loading';q.phrase='';q.inputError='';q.errorField='';q.status='';quickPaintModal();
 return quickPlan(q.kind,q).then(function(steps){
  if(state.quick!==q)return;
  q.steps=steps;
  q.precheck=steps.precheck||null;
  q.hasManual=steps.some(function(s){return s.manual||String(s.c).charAt(0)==='#';});
  q.phase='confirm';
  if(!state.settings.confirm){
   q.phrase=(isPhase(q.kind)||q.kind==='replace')?'osd.'+q.osdId:q.dev;
   q.confirmed=true;}
  /* 用户在 loading 阶段就点了「立即执行」：命令一生成就接着跑，不等第二次点击。 */
  if(q.pendingRun){
   q.pendingRun=false;
   quickExec((q.kind==='init'||isPhase(q.kind))?'auto':'pre');
   return;}
  quickPaintModal();
 }).catch(function(e){
  if(state.quick!==q)return;
  q.pendingRun=false;
  q.phase='error';q.error=e.message||'命令预览失败';quickPaintModal();});
}
/* 「立即执行」的前端校验：返回 {msg, field}，field 指向出错的输入框，
   点一次就能看见是哪一栏没填（把控件标红 + 滚进视野 + 聚焦）。
   这里只拦明显的漏填，真正的安全闸门在后端。 */
function qValidate(q){
 if(!q)return null;
 if(q.kind==='init'){
  if(!q.dev)return {msg:'请先填写或选择新盘设备路径（例如 /dev/nvme0n2）',field:'quick.dev'};
  if(!q.host)return {msg:'请填写目标服务器（新盘插在哪台机器上）',field:'quick.host'};
  if(state.settings.confirm&&!q.confirmed)return {msg:'请先勾选「我已现场核对盘位与设备名」',field:'quick.confirmed'};
  if(state.settings.confirm&&q.phrase!==q.dev)
   return {msg:'二次确认未通过：请在输入框里原样输入设备路径 '+q.dev,field:'quick.phrase'};
 }else if(q.kind==='replace'||q.kind==='deploy'){
  if(!q.dev)return {msg:'请先选择或填写换上新盘的设备路径',field:'quick.dev'};
  if(!q.host)return {msg:'请填写新盘所在的服务器',field:'quick.host'};
  if(state.settings.confirm&&!q.confirmed)return {msg:'请先勾选确认',field:'quick.confirmed'};
  if(state.settings.confirm&&q.phrase!=='osd.'+q.osdId)
   return {msg:'二次确认未通过：请输入 osd.'+q.osdId,field:'quick.phrase'};
 }else if(q.kind==='retire'){
  /* ① 清退不需要选新盘；down 与否由后端执行前硬校验，这里只收确认短语。 */
  if(state.settings.confirm&&!q.confirmed)return {msg:'请勾选清退确认（旧编号删除不可恢复）',field:'quick.confirmed'};
  if(state.settings.confirm&&q.phrase!=='osd.'+q.osdId)
   return {msg:'二次确认未通过：请输入 osd.'+q.osdId,field:'quick.phrase'};
 }else{
  if(!q.confirmed)return {msg:'请勾选盘位确认',field:'quick.confirmed'};
  if(q.phrase!=='osd.'+q.osdId)return {msg:'二次确认未通过：请输入 osd.'+q.osdId,field:'quick.phrase'};
 }
 return null;
}
/* 把出错的控件标红、滚进视野并聚焦。focus() 本身会把该栏带进视线，
   所以即使弹窗内容已经很长、需要滚动，也一定能看到是哪一栏。 */
function qMarkBad(path){
 if(!path)return;
 var el=document.querySelector('#modal-root [data-bind="'+path+'"]');
 if(!el)return;
 try{if(el.classList)el.classList.add('inp-bad');}catch(e){}
 try{el.focus();}catch(e){}
}
/* 执行前检查清单：「还差几项」常驻在按钮上方，不用点也知道。
   每项都是 qValidate 同一个判据（同一份真值），不会出现「清单全绿但点不动」。 */
function qChips(q){
 if(q.kind==='init'||q.kind==='replace'||q.kind==='deploy'||q.kind==='retire'){
  var chips=[];
  if(q.kind!=='retire')chips.push([!!q.dev,'设备路径',q.dev||'未填']);
  chips.push([!!q.host,'服务器',q.host||'未填']);
  if(state.settings.confirm){
   chips.push([!!q.confirmed,'盘位核对',q.confirmed?'已勾选':'未勾选']);
   var okPhr=q.kind==='retire'?q.phrase==='osd.'+q.osdId:q.phrase===q.dev;
   chips.push([!!okPhr,'二次确认',okPhr?'已输入':'未输入']);
  }
  return chips;
 }
 return [];
}
function qStatusBar(q){
 if(q.inputError)return '<div class="modal-err" role="alert">'+ic('alert',15)+
  '<div><b>还不能执行</b>　<span class="err-msg">'+esc(q.inputError)+'</span></div></div>';
 var chips=q.phase==='confirm'?qChips(q):[];
 /* 没有清单可显示时，至少把「上一次点击发生了什么」写在按钮上方，
    否则 loading 阶段点下去仍然像什么都没发生。 */
 if(!chips.length)return q.status?'<div class="modal-chk">'+ic('info',14)+
  '<div class="chk-wrap"><b>'+esc(q.status)+'</b></div></div>':'';
 var left=chips.filter(function(c){return !c[0];}).length;
 return '<div class="modal-chk'+(left?'':' ok')+'">'+ic(left?'info':'check',14)+
  '<div class="chk-wrap"><b>'+(left?'执行前还差 '+left+' 项':'全部就绪，点右侧按钮即开始')+'</b>'+
  '<div class="chk-row">'+chips.map(function(c){
    return '<span class="chip'+(c[0]?' on':'')+'">'+(c[0]?'✓':'✗')+' '+esc(c[1])+
     (c[2]?' <span class="mono">'+esc(c[2])+'</span>':'')+'</span>';}).join('')+'</div>'+
  (q.status?'<div class="chk-note">'+esc(q.status)+'</div>':'')+
  '</div></div>';
}
/* 就地更新提示条（不重绘整个弹窗，避免打断输入 / 丢失滚动位置）。 */
function qRefreshBar(){
 var q=state.quick;if(!q)return;
 var html=qStatusBar(q);
 var host=document.querySelector('#modal-root .modal-err, #modal-root .modal-chk');
 if(!host){
  if(!html)return;
  var f=document.querySelector('#modal-root .modal-f');
  if(!f||!f.parentNode)return;
  var box=document.createElement('div');box.innerHTML=html;
  f.parentNode.insertBefore(box.firstChild,f);
  return;}
 if(!html){if(host.parentNode)host.parentNode.removeChild(host);return;}
 var tmp=document.createElement('div');tmp.innerHTML=html;
 host.parentNode.replaceChild(tmp.firstChild,host);
}
/* 用户开始补填后就地更新红条 / 清单（不重绘，避免打断输入）：
   - 原来标红的那栏填上了，就撤掉红框
   - 还有没满足的，就把文案换成新的那一条（不抢焦点，别在打字时跳走） */
function qErrRefresh(){
 var q=state.quick;if(!q)return;
 if(q.errorField){
  var cur=document.querySelector('#modal-root [data-bind="'+q.errorField+'"]');
  if(cur&&cur.classList){
   var filled=cur.type==='checkbox'?!!cur.checked:!!String(cur.value||'').length;
   if(filled)cur.classList.remove('inp-bad');
  }
 }
 var v=qValidate(q);
 if(!v){
  q.inputError='';q.errorField='';
  qRefreshBar();
  return;
 }
 /* 已经点了执行、正在报错 → 文案跟着变；还没点过 → 只更新清单，不凭空报红。 */
 if(q.inputError){q.inputError=v.msg;q.errorField=v.field;}
 qRefreshBar();
}
function qHead(){var q=state.quick;
 var tail=q.kind==='init'?' · '+esc(q.dev||'选择新盘'):
  q.kind==='retire'?' · osd.'+q.osdId+' @ '+esc(q.host||'—'):
  (q.kind==='replace'||q.kind==='deploy')?' · osd.'+q.osdId+' → '+esc(q.dev||'选择新盘'):
  ' · osd.'+q.osdId;
 return modalHead(quickTitle(q.kind)+tail,
 '后端按 Ceph 版本自动选择命令模板 · '+(q.dryRun?'DRY-RUN 只生成命令':'真实执行'));}
function qRemoteHosts(q){
 var seen={},out=[];(q.steps||[]).forEach(function(s){
  if(s.host&&s.remote&&!seen[s.host]){seen[s.host]=1;out.push(s.host);}});
 return out;}
function qRemoteWarn(q){
 var hosts=qRemoteHosts(q);if(!hosts.length)return '';
 var ssh=state.settings.ssh||{},far=hosts;
 var nCmd=(q.steps||[]).filter(function(s){return s.host&&s.remote;}).length;
 var dest=(ssh.user||'root')+'@'+far[0];
 if(ssh.ready!==false){
  return '<div class="warnbox" style="margin-bottom:10px">'+ic('link')+
   '<div>这 '+nCmd+' 条命令要在 '+far.length+' 台目标主机上执行（ssh）：<b class="mono">'+esc(far.join('、'))+'</b>'+
   '<br><span class="note">执行时后端会 ssh 到该主机（'+(ssh.user||'root')+'@host:'+(ssh.port||22)+'），'+
   '不是在这台控制台上跑。本机步骤照旧本地执行。</span></div></div>';}
 return '<div class="dangerbox" style="margin-bottom:10px">'+ic('alert')+
  '<div><b>远程执行未就绪，真实下发会被后端拒绝</b><br>目标主机（'+far.length+' 台，'+nCmd+' 条命令）：<b class="mono">'+esc(far.join('、'))+
  '</b><br><span class="note">'+esc(ssh.reason||'控制台未配置 SSH')+
  '。默认前提是各节点已配好 ssh 免密（一般 root 直连）：先确认控制台能 '+
  '<b class="mono">ssh '+esc(dest)+' hostname</b> 直接登进去；'+
  '要换用户 / 端口 / 私钥再到「系统设置 → 远程执行」保存。'+
  '现在可以先用 DRY-RUN 生成命令，拿到目标主机上手工执行。</span></div></div>';
}
function cmdLines(q){
 if(!q.steps.length)return '<div class="cm"># 还没有可预览的命令：先在下面填好设备路径，点「重新生成命令」即可预览；'+
  '直接点「立即执行」也行，后端会按当前参数现算。</div>';
 return qRemoteWarn(q)+q.steps.map(function(s,i){
  var tag=(s.host&&s.remote)?'<span class="tag info" title="在 '+esc(s.host)+' 上执行">@'+esc(s.host)+'</span> ':'';
  return '<div class="'+(s.manual?'tw':'')+'"><span class="cm">'+('0'+(i+1)).slice(-2)+'</span> '+tag+esc(s.c)+
   (s.note?' <span class="cm"># '+esc(s.note)+'</span>':'')+'</div>';}).join('');
}
function quickPaintModal(){
 var q=state.quick;if(!q)return;
 var o=state.osds.filter(function(x){return x.id===q.osdId;})[0]||{},b='',foot='';
 if(q.phase==='loading'){
  b='<div class="empty">'+ic('refresh',34)+'<div>正在向后端请求该版本的命令序列…</div></div>';
  /* 按钮照旧存在：点下去会记住意图，命令生成完自动开始。
     以前这里只给「取消」，用户点到 footer 位置没任何反馈，看起来就是"点了没反应"。 */
  foot='<div class="sp"></div><button class="btn" data-act="q-close">取消</button>'+
   '<button class="btn pri" data-act="q-run">'+ic('zap',14)+' 立即执行（等命令生成完自动开始）</button>';
 }else if(q.phase==='error'){
  b='<div class="dangerbox">'+ic('alert')+'<div>'+esc(q.error)+'</div></div>'+
    '<div class="note" style="margin-top:12px">请确认已登录、后端为 CLI 通道且 /api/plan 可访问。</div>';
  foot='<div class="sp"></div><button class="btn" data-act="q-close">关闭</button><button class="btn" data-act="q-retry">重试</button>';
 }else if(q.phase==='confirm'&&(q.kind==='init'||q.kind==='replace'||isPhase(q.kind))){
  /* 三个「动盘」入口共用一块表单，语义完全不同：
     - retire：① 换盘前，确认故障盘已 down，purge 彻底删除旧编号（不碰新盘）
     - deploy：② 换盘后，把新盘接回集群，mon 分配一个新编号
     - replace：高级向导的完整流程预览（① + 人工换盘 + ②）
     - init：额外加一块盘扩容，也会分配一个新编号，但不删任何旧 OSD */
  var isRetire=q.kind==='retire',isDeploy=q.kind==='deploy';
  var isRep=q.kind==='replace'||isRetire||isDeploy;
  var pre=q.precheck||null,preBox='';
  if(pre){
   preBox='<div class="'+(pre.ok?'warnbox':'dangerbox')+'" style="margin-bottom:12px">'+ic(pre.ok?'check':'alert')+
    '<div><b>'+(isRetire?'① 清退前只读预检':'② 入群前只读预检')+'：'+
    (pre.ok?'前提已满足':'前提未满足，执行会被拒绝')+'</b><br>'+
    esc(pre.message||'')+
    ((pre.blockers||[]).length?'<br>'+pre.blockers.map(function(x){return '· '+esc(x);}).join('<br>'):'')+
    ((pre.warnings||[]).length?'<br><b>风险提示（不阻断，请务必看清）</b><br>'+
      pre.warnings.map(function(x){return '· '+esc(x);}).join('<br>'):'')+
    '<br><span class="note">执行时后端会重新核验一次；只有「目标盘正被健康 OSD 使用」会拒绝，绝不会误 zap 正在用的盘。</span></div></div>';
  }
  var devOpts=q.devices.map(function(d){
   return '<option value="'+esc(d.dev)+'"'+(d.dev===q.dev?' selected':'')+'>'+esc(d.dev)+' · '+bytes(d.size||0)+
    ' · '+esc(d.host||'本机')+(isRep&&d.dev===q.oldDev?' · 原盘位':'')+
    (d.available?'':' · 需先清理')+(d.note?' · '+esc(d.note):'')+'</option>';}).join('');
  /* 多节点包安装：盘是逐台 ssh 采的。有主机没采到就明说，
     避免「列表里没有新盘」被误判成「盘没插好 / 平台坏了」。 */
  var scan=state.deviceScan||{},badHosts=(scan.hosts||[]).filter(function(h){return !h.ok;});
  var scanWarn=badHosts.length?'<div class="warnbox" style="margin-bottom:10px">'+ic('alert')+
   '<div><b>'+badHosts.length+' 台主机没采到磁盘清单</b><br>'+
   badHosts.map(function(h){return '· <b class="mono">'+esc(h.host)+'</b>：'+esc(h.err||'原因未知');}).join('<br>')+
   '<br><span class="note">这些主机上的盘不会出现在下拉里。到「系统设置 → 远程执行」检查该主机的 ssh 连通性。</span></div></div>':'';
  var flowTitle=isRetire?'把 osd.'+q.osdId+' 从集群彻底删除（编号不保留，现场再换盘）':
   isDeploy?'把换好的新盘接回集群，由 mon 分配一个新 OSD 编号':
   q.kind==='init'?'把新插入的磁盘初始化并加入集群（会新增一个 OSD 编号）':
   '完整换盘预览：删掉 osd.'+q.osdId+' 的旧编号，再用新盘以新编号入群';
  var flowText=isRetire?
    '① 流程：只读确认 osd.'+q.osdId+' <b>确实 down</b>（仍 up 会被后端拒绝）→ 清掉旧版 <b>--replace</b> 僵尸队列 → OUT 把 PG 迁走 → <b>mon 命令式 ceph osd purge 删除旧编号</b>（CRUSH / auth / osdmap 一并删除）→ 回读 osd dump 复核。purge <b>不经过 cephadm 队列、不检查 osd safe-to-destroy</b>，不会再卡在 waiting for purge。此阶段<b>不 zap、不碰新盘</b>。':
   isDeploy?
    '② 流程：校验目标盘没被健康 OSD 占用 → 清理新盘残留签名 → <b>ceph orch daemon add osd 命令式创建</b>（不传 --osd-id，mon 分配新编号）→ 回读新盘归属 / up/in 复核 → 健康验证。不依赖 destroyed / OSDSpec / osd_id_claims。':
   q.kind==='init'?
    '流程：预检设备（是否空闲 / 可加入）→ 清理旧元数据（分区表 / LVM / 文件系统签名）→ 创建 OSD → 等待上线 → 健康验证。':
    '流程：① 清退（确认 down → OUT → purge 删除旧编号）→ <b>现场换盘（人工）</b> → ② 新盘入群（清理签名 → 以新编号创建 → 回读 osd dump 复核）。';
  var flowNote=isRetire?
    '⚠️ 这一步<b>不可逆</b>：旧编号消失、旧盘数据放弃。做完再现场按 SN / 盘位换盘，回来点「② 换盘后·新盘入群」。两个按钮互不依赖，中间关掉页面、隔几天再操作都没关系。':
   isDeploy?
    '前提：新盘已装回原盘位、① 的旧编号已删除。新编号由 mon 分配，<b>不保证等于 osd.'+q.osdId+'</b>；历史告警 / 监控里引用旧编号的地方会断。':
   q.kind==='init'?
    '不改动任何已有 OSD 的数据，也不做退役。':
    '适用于「盘坏了、硬件层已经换成新盘」的硬件替换；要扩容加盘请用「新增磁盘」。';
  b='<div class="warnbox" style="margin-bottom:14px">'+ic(isRep?'disk':'zap')+
   '<div><b>'+flowTitle+'</b><br>'+flowText+
   '<br>'+flowNote+
   '<br>当前为 <b>'+(q.dryRun?'DRY-RUN 演示（命令不下发）':'真实 EXECUTE 模式')+'</b>。</div></div>'+preBox+scanWarn+
   (isRep?'<div class="grid g2" style="margin-bottom:14px"><div>'+
     '<div class="stat-line"><span>目标 OSD</span><b class="mono tp">osd.'+q.osdId+'</b></div>'+
     '<div class="stat-line"><span>原设备</span><b class="mono">'+esc(q.oldDev||'未采集')+'</b></div></div><div>'+
     '<div class="stat-line"><span>服务器</span><b class="mono">'+esc(q.host||'未采集')+'</b></div>'+
     '<div class="stat-line"><span>原序列号</span><b class="mono">'+esc(q.serial||'未采集')+'</b></div></div></div>':'')+
   (isRetire
    ?'<div class="warnbox" style="margin-bottom:12px">'+ic('disk')+'<div>清退阶段<b>不需要选新盘</b>：故障盘还在机器上，新盘要等本步完成后现场更换。目标主机 <span class="mono">'+esc(q.host||'—')+'</span>，原设备 <span class="mono">'+esc(q.oldDev||'未采集')+'</span>。<br>做完这一步、确认 <span class="mono">ceph osd tree</span> 里已没有 osd.'+q.osdId+'，再按 SN / 盘位换盘并点第 ② 个按钮。</div></div>'
    :'<div class="fgrp" style="margin-bottom:12px"><label class="fld">'+
    (isRep?'新盘所在服务器（装回原盘位，便于按 SN 核对）':'目标服务器')+'</label>'+
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
    '<button class="btn sm" data-act="q-dev-refresh">'+ic('disk',12)+' 重新探测</button></div>')+
   '<div class="tiny" style="margin-bottom:8px;font-weight:600;color:var(--muted)">后端生成的命令序列（'+esc(liveProfile().version||'')+' / '+esc(liveProfile().orchestrator||'')+'）</div>'+
   '<div class="cmdbox" style="max-height:190px;overflow:auto">'+cmdLines(q)+'</div>';
  if(state.settings.confirm){
   b+=isRep
    ?'<div class="hr"></div><div class="fgrp"><label class="fld">输入 <span class="mono" style="color:var(--accent2)">osd.'+q.osdId+'</span> '+
     (isRetire?'确认要删除的旧编号':isDeploy?'确认要替换的旧编号':'确认要替换的旧编号')+'</label>'+
     '<input class="inp" data-bind="quick.phrase" value="'+esc(q.phrase)+'" placeholder="osd.'+q.osdId+'" autocomplete="off"></div>'+
     '<label class="chk"><input type="checkbox" data-bind="quick.confirmed"'+(q.confirmed?' checked':'')+'><span>'+
     (isRetire?'我已确认 osd.'+q.osdId+' 确实 down（ceph osd tree 里 up=0），并接受<b>永久删除旧编号且不可恢复</b>':
      isDeploy?'我已现场换好新盘 <span class="mono">'+esc(q.dev||'-')+'</span>，并接受新 OSD 使用 <b>mon 分配的新编号</b>':
      '我已确认 <span class="mono">'+esc(q.oldDev||'原盘')+'</span> 已换成新盘 <span class="mono">'+esc(q.dev||'-')+'</span>，并接受新 OSD 使用新编号')+
     '</span></label>'
    :'<div class="hr"></div><div class="fgrp"><label class="fld">输入设备路径 <span class="mono" style="color:var(--accent2)">'+esc(q.dev||'/dev/sdb')+'</span> 确认</label>'+
     '<input class="inp mono" data-bind="quick.phrase" value="'+esc(q.phrase)+'" placeholder="'+esc(q.dev)+'" autocomplete="off"></div>'+
     '<label class="chk"><input type="checkbox" data-bind="quick.confirmed"'+(q.confirmed?' checked':'')+'><span>我已现场核对盘位与设备名 <span class="mono">'+esc(q.dev)+'</span></span></label>';
  }else b+='<div class="hint" style="margin-top:10px">已在设置中关闭二次确认：点击「立即执行」将直接开始。</div>';
  if(state.mode==='live'&&state.auth.role!=='admin')b+='<div class="dangerbox" style="margin-top:12px">'+ic('lock')+'<div>当前为只读账号，后端会拒绝写操作。请用管理员账号登录。</div></div>';
  foot='<button class="btn" data-act="q-close">取消</button><div class="sp"></div>'+
   '<button class="btn pri" data-act="q-run">'+ic(isRep?'wrench':'zap',14)+' '+
   (isRetire?'立即执行清退（删除旧编号）':isDeploy?'立即执行新盘入群（新编号）':
    '立即执行'+(isRep?'换盘':'初始化'))+'</button>';
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
   '<div class="cmdbox" style="max-height:190px;overflow:auto">'+cmdLines(q)+'</div>';
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
   b+='<div class="warnbox" style="margin-top:12px">'+ic('wrench')+'<div><b>请现场更换磁盘</b>：按 SN <span class="mono">'+esc(q.serial||'-')+'</span> 与盘位把 <span class="mono">'+esc(q.oldDev||'原盘')+'</span> 换成新盘，装回<b>原盘位</b>。'+
    '平台已暂停，后续 '+q.pending.length+' 条命令（清理新盘签名 / 以新编号创建 / 复核 up·in）将在确认后继续下发。</div></div>';
   if(q.prereq&&q.prereq.ok===false){
    b+='<div class="dangerbox" style="margin-top:10px">'+ic('alert')+'<div><b>新盘归属校验未通过，先别急着继续</b><br>'+
     (q.prereq.blockers||[]).map(function(x){return '· '+esc(x);}).join('<br>')+
     '<br>点「继续执行」时平台会重新只读核验：目标盘仍被 <b>up/in 的健康 OSD</b> 使用就拒绝 zap。'+
     '请用 <span class="mono">lsblk -o NAME,FSTYPE,LABEL</span> / '+
     '<span class="mono">ceph orch device ls</span> 核对盘位与设备名。</div></div>';
   }
   foot='<div class="sp"></div><button class="btn" data-act="q-abort">中止流程</button>'+
    '<button class="btn pri" data-act="q-resume">'+ic('check',14)+' 磁盘已换好，继续执行</button>';
  }else foot='<div class="sp"></div><button class="btn dan" data-act="q-abort">中止</button>';
 }else if(q.phase==='done'){
  var v=q.verify||null,badVerify=(q.kind==='kick'||q.kind==='replace'||isPhase(q.kind))&&v&&v.ok===false;
  /* 复核结论分三种：明确失败（等也没用）、新 OSD 还在部署（可自动复核）、成功。
     1.1.24 起不再校验编号是否复用，只看新盘有没有被 up/in 的 OSD 接管。 */
  var pending=!!(badVerify&&v.pending),hardFail=badVerify&&!pending;
  var stateColor=hardFail?'td':pending?'tw':'t';
  var staleFix=!!(v&&v.stale&&v.fix&&v.fix.command);
  var headline=hardFail?(staleFix?'守护进程起不来（可一键修复）':
                 (v&&v.blocked?'清退未完成（不会自动完成）':'未完全生效')):
               pending?(q.kind==='retire'?'等待旧编号从 osdmap 消失':'已提交，等待新 OSD 上线'):'流程已完成';
  b='<div style="text-align:center;padding:12px 0 18px"><div style="font-size:38px" class="'+stateColor+'">'+
   ic(badVerify?'alert':'check',38)+'</div>'+
   '<div style="font-size:16px;font-weight:700;margin-top:8px">'+
   (isPhase(q.kind)?(q.kind==='retire'?'① 清退':'② 新盘入群'):quickTitle(q.kind))+headline+'</div>'+
   '<div class="note" style="margin-top:6px">'+
   (q.kind==='init'?esc(q.dev)+' @ '+esc(q.host):
    q.kind==='replace'?'osd.'+q.osdId+' · '+esc(q.oldDev||'原盘')+' → '+esc(q.dev||'新盘'):'osd.'+q.osdId)+' · '+
   (q.dryRun?'DRY-RUN：命令仅生成并写入审计，未下发集群':
    q.kind==='init'?'已初始化并加入集群，数据开始回填；新 OSD 会在 OSD 列表出现':
    q.kind==='kick'?(badVerify?'复核结论见下方':'已停服务并标记 DOWN + OUT，数据回填中；需要恢复时点「IN」即可重新加入集群'):
    q.kind==='replace'?(badVerify?'新盘入群未完成，详见下方复核结论':'旧编号已删除，新盘以新编号上线，数据开始回填'):
    q.kind==='retire'?(badVerify?'清退未完成，详见下方复核结论':'osd.'+q.osdId+' 已从 osdmap 删除，可以现场换盘了'):
    q.kind==='deploy'?(badVerify?'新盘入群未完成，详见下方复核结论':'新盘已由 osd.'+((v&&v.newOsd!=null)?v.newOsd:'?')+' 接管并上线，数据开始回填'):
    '命令已下发，请在概览确认 HEALTH_OK 与 PG active+clean')+'</div></div>'+
   (hardFail?'<div class="dangerbox" style="margin-bottom:12px">'+ic('alert')+'<div><b>'+
     (staleFix?'OSD 守护进程处于 error，等不会自愈':
      q.kind==='retire'?(v&&v.blocked?'清退被阻塞，等也不会自动完成':'清退复核未通过'):'换盘复核未通过')+
     (v.newOsd?'：新盘当前归属 osd.'+v.newOsd:'')+'</b><br>'+
     esc(v.message).replace(/\n/g,'<br>')+
     ((v.fix&&v.fix.map)?'<div class="cmdbox" style="margin-top:8px;max-height:190px;overflow:auto">'+
       v.fix.map(function(x){return '<div>'+esc(x)+'</div>';}).join('')+'</div>':'')+
     (staleFix?'<div class="cmdbox" style="margin-top:8px" title="只重建 unit 与容器，不 zap、不删数据">'+
       esc(v.fix.command)+'</div><div class="tiny" style="margin-top:6px">'+esc(v.fix.why||'')+
       '</div>':'')+
     (v.newOsd?'<br>新编号由 mon 分配，与旧编号不同属正常；若复核失败请按下方结论处理。':'')+
     '</div></div>':
    pending?'<div class="warnbox" style="margin-bottom:12px">'+ic('alert')+'<div><b>'+
     (q.kind==='retire'?'等待回读 osd dump，不是失败':'新 OSD 仍在部署 / 设备信息未采到，不是失败')+'</b><br>'+esc(v.message)+
     '<br>每 5 秒自动复核一次'+(q.recheckLeft?'（已复核 '+q.recheckLeft+' 次）':'')+
     (q.recheckDone?'，自动复核已结束，可手动点「重新复核」。':'。')+'</div></div>':'')+
   '<div class="grid g2"><div><div class="stat-line"><span>执行步骤</span><b class="mono">'+q.steps.length+'</b></div>'+
   '<div class="stat-line"><span>集群版本</span><b class="mono">'+esc(liveProfile().version||'-')+'</b></div></div>'+
   '<div><div class="stat-line"><span>'+(q.kind==='init'?'新 OSD':'入群复核')+'</span><b class="'+
   (hardFail?'td':pending?'tw':'t')+'">'+
   (q.kind==='init'?'待同步（列表刷新后可见）':
    (q.kind==='replace'||q.kind==='deploy')?(v&&v.ok?'新盘由 osd.'+((v.newOsd!=null)?v.newOsd:'?')+' 接管（up/in）':
     pending?'等待新 OSD 上线':'待复核'):
    q.kind==='retire'?(v&&v.ok?'osd.'+q.osdId+' 已删除':pending?'等待回读':'待复核'):
    q.kind==='kick'?'待复核（后端已回读 osd dump）':'已自动恢复')+'</b></div>'+
   '<div class="stat-line"><span>审计记录</span><b class="t">已写入</b></div></div></div>'+
   '<div class="warnbox" style="margin-top:12px">'+ic('shield')+'<div>真实环境请回到「告警中心」确认告警已清除，并在「变更审计」复核完整命令序列与返回码。</div></div>';
  foot='<div class="sp"></div>'+
   (badVerify?'<button class="btn" data-act="q-recheck"'+(q.recheckBusy?' disabled':'')+'>'+ic('refresh',14)+
    (q.recheckBusy?' 复核中…':' 重新复核')+'</button>':'')+
   (staleFix?'<button class="btn pri" data-act="q-fix"'+(q.fixBusy?' disabled':'')+'>'+ic('wrench',14)+
    (q.fixBusy?' 修复中…':' 修复守护进程')+'</button>':'')+
   '<button class="btn" data-act="q-alerts">查看告警</button>'+
   '<button class="btn" data-act="q-audit">变更审计</button><button class="btn pri" data-act="q-close">完成</button>';
 }
 /* 提示条固定在 body 之外、按钮正上方，内容再长也不会被滚出视野。
    没有错误时也常驻一条检查清单：「还差几项」写在按钮上方，
    用户根本不用点就知道点了会不会生效。 */
 var errBar=qStatusBar(q);
 openModal(qHead()+'<div class="modal-b">'+b+'</div>'+errBar+'<div class="modal-f">'+foot+'</div>','lg');
 /* 给 DOM 留一份「我是谁」的最小身份：万一 state.quick 被清掉，还能靠它
    把用户已经填好的值读回来继续（见 quickRecover）。 */
 var __m=document.querySelector('#modal-root .modal');
 if(__m){__m.setAttribute('data-qkind',q.kind);__m.setAttribute('data-qosd',q.osdId==null?'':String(q.osdId));}
 if(q.inputError)qMarkBad(q.errorField);
 if(q.phase==='running'||q.phase==='paused')quickPaintLogs();
}
/* 弹窗还开着、state.quick 却被清空了：从界面上把用户已经填好的值读回来，
   拼一个最小状态直接继续。与其让用户「关掉重开再填一遍」，不如就用他
   刚才填的东西把事做完——这也是「第一次点没反应」最直接的止损。 */
function quickRecover(){
 var m=document.querySelector('#modal-root .modal');if(!m)return null;
 var val=function(sel){var el=m.querySelector(sel);return el?(el.value||''):'';};
 var chk=function(sel){var el=m.querySelector(sel);return !!(el&&el.checked);};
 var kind=m.getAttribute('data-qkind')||'';
 if(!kind)return null;
 var oid=m.getAttribute('data-qosd');
 var q={kind:kind,osdId:(oid===''||oid==null)?null:Number(oid),
  host:val('[data-bind="quick.host"]'),dev:val('[data-bind="quick.dev"]'),
  serial:val('[data-bind="quick.serial"]'),phrase:val('[data-bind="quick.phrase"]'),
  confirmed:chk('[data-bind="quick.confirmed"]'),
  devices:[],phase:'confirm',steps:[],logs:[],progress:0,busy:false,error:'',
  stage:'auto',aborted:false,pending:[],hasManual:false,
  dryRun:!state.settings.allowWrite,role:state.auth.role||'admin',recovered:true};
 /* 只有「清退」这类不涉及新盘的动作必须知道 osd.id；设备路径留空也照样恢复
    ——空着只是让 qValidate 给出「请先填写设备路径」，而不是把整个会话判死。 */
 var needOid=(kind==='retire'||kind==='kick'||kind==='in');
 if(needOid&&q.osdId==null)return null;
 return q;
}
/* 每次动弹窗里的控件之前先要一个活会话：state.quick 没了、但弹窗还在，
   就从界面上把用户已经填好的内容读回来继续。这样「重启后第一次登录」
   那种偶发的状态丢失，用户填的东西一格都不会丢，也不用关掉重开。
   返回 null 表示确实没有弹窗（调用方该报错就报错）。 */
function quickLive(){
 if(state.quick)return state.quick;
 var m=null;
 try{m=document.querySelector('#modal-root .modal[data-qkind]');}catch(e){}
 if(!m)return null;
 var rec=quickRecover();
 if(!rec)return null;
 state.quick=rec;
 var lr=state.quickLastReset||null;
 try{if(typeof qTrace==='function')qTrace(rec,'recover-bind',
  lr?('lastReset='+lr.where+' @'+new Date(lr.at).toLocaleTimeString()):'no-reset-record');}catch(e){}
 return rec;
}
/* 只读重新复核：zap 后创建 OSD，守护进程起来有延迟。
   不重跑流程、不下发任何写命令，只回读 osd dump / metadata 看新盘归谁、是否 up/in。 */
function qRecheck(q,cb){
 if(!state.quick||state.quick!==q)return;
 if(state.mode!=='live'||!state.auth.authenticated){toast('演示模式没有后端可复核','w');if(cb)cb();return;}
 q.recheckBusy=true;quickPaintModal();
 apiFetch('POST','/api/osd/verify',{osd_id:q.osdId,dev:q.dev||'',
  phase:q.kind==='retire'?'retire':'deploy'}).then(function(r){
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
/* 修复守护进程：唯一会下发写命令的动作，但只重建 unit / 容器。
   走与其它写操作同一套闸门（写权限 + 二次确认），执行后回读 up/in。 */
function qFixDaemon(q){
 if(!state.quick||state.quick!==q||q.fixBusy)return;
 if(state.mode!=='live'||!state.auth.authenticated){toast('演示模式无法连接后端','w');return;}
 if(!state.settings.allowWrite){
  toast('当前是只读模式，请先打开 系统设置 → 允许真实写操作','e');return;}
 var oid=(q.verify&&q.verify.fix&&q.verify.fix.osd!=null)?q.verify.fix.osd:q.osdId;
 q.fixBusy=true;quickPaintModal();
 qLog('p','$ ceph orch daemon redeploy osd.'+oid);
 apiFetch('POST','/api/osd/redeploy',{osd_id:oid,confirm_phrase:'osd.'+oid,allow_write:true})
  .then(function(r){
   if(!state.quick||state.quick!==q)return;
   q.fixBusy=false;
   (r.commands||[]).forEach(function(c){qLog('p','$ '+c);});
   (r.results||[]).forEach(function(x){qLog('d','  '+String(x).slice(0,240));});
   if(r.dry_run){qLog('w','  dry-run：未下发');}
   qLog('c','  '+(r.verify?(r.verify.message||''):'已提交 redeploy'));
   /* 修复后立即走一次只读复核，把 down/up 的真实结果带回来。 */
   qRecheck(q,null);
  }).catch(function(e){
   if(!state.quick||state.quick!==q)return;
   q.fixBusy=false;qLog('e','! '+e.message);
   toast('修复失败：'+e.message,'e');quickPaintModal();
  });
}
function qAutoRecheck(q,left){ if(!state.quick||state.quick!==q||q.phase!=='done'||!q.verify||!q.verify.pending)return;
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
 else if(q.kind==='replace'||q.kind==='deploy'){
  /* 新盘入群：编号由 mon 重新分配，本地列表里的旧行不该被写成 up/in
     （它已被 purge 删除，新 OSD 是另一个编号）；真实状态由随后强制刷新回读覆盖。
     ① 清退阶段同样不改本地状态。 */ }
 else if(isIn){if(o){o.inn=true;o.up=true;}
  state.cluster.osdsIn=Math.min(state.cluster.osds,(state.cluster.osdsIn||0)+1);}
 state.alerts.forEach(function(a){if(a.osd!==q.osdId||a.status==='resolved')return;
  /* 踢盘后 OSD 是 down+out，告警还在不在由后端真实健康检查决定，本地不假装恢复；
     IN 只清掉「被标记 OUT」类告警；盘仍 down 的硬件告警永远不假装恢复。 */
  if(q.kind==='kick'||q.kind==='retire')return;
  if(isIn&&a.code!=='OSD_OUT'&&a.code!=='OSD_IN')return;
  a.status='resolved';});
 state.cluster.osdsUp=state.osds.filter(function(x){return x.up;}).length+
  Math.max(0,state.cluster.osds-state.osds.length);
 state.cluster.health=healthInfo().t;state.lastRefresh=Date.now();
 addAudit(q.kind==='kick'?'OSD_KICK_1CLICK':isIn?'OSD_IN_1CLICK':
  q.kind==='retire'?'OSD_RETIRE_1CLICK':q.kind==='deploy'?'OSD_DEPLOY_1CLICK':'OSD_REPLACE_1CLICK','osd.'+q.osdId,
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
   q.kind==='init'?'/api/quick/init':q.kind==='retire'?'/api/quick/retire':
   q.kind==='deploy'?'/api/quick/deploy':'/api/quick/replace',body);
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
     else toast('复核未通过：'+(r.verify.message||'新盘还没被 OSD 接管'),'e');
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
 qc();
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
  case 'q-close':qc();closeModal();render();return;
  case 'q-retry':if(q)quickOpen(q.kind,q.osdId);return;
  case 'q-wizard':if(q){if(q.kind==='in'){toast('IN 盘只涉及 osd in 与回填观察，直接执行即可','w');return;}
   var k=q.kind,id=q.osdId;qc();closeModal();startWizard(id,k==='kick'?'remove':'replace');}return;
  case 'q-dev':/* 选了另一块新盘：重新生成命令序列 */
   if(q&&(q.kind==='init'||q.kind==='replace'||q.kind==='deploy')){q.dev=el.value||q.dev;replanQuick(q);}return;
  case 'q-replan':
   if(q&&(q.kind==='init'||q.kind==='replace'||q.kind==='deploy')){replanQuick(q);}return;
  case 'q-dev-refresh':
   if(q&&(q.kind==='init'||q.kind==='replace'||q.kind==='deploy')){
    var keep=q;
    loadFreeDevices(keep).then(function(list){
     if(state.quick!==keep)return;
     var usable=pickDevices(keep,list,keep.host);
     keep.devices=usable;
     if(usable.length)keep.dev=usable[0].dev;
     if(keep.dev)replanQuick(keep);else{keep.steps=[];keep.phase='confirm';quickPaintModal();}
    });}return;
  case 'q-run':
   /* 每一层判定都必须留下痕迹（弹窗内红条 + 后端日志），
      否则「点了没反应」只能靠猜。qTrace 同时写进 q.trace，
      弹窗底部的状态行会显示最近一次点击的结果。 */
   if(!q){
    /* 走到这里说明弹窗和状态已经不一致了。先自救：弹窗还开着就把界面上
       用户已经填好的值读回来继续（省掉「关掉重开再填一遍」）；连弹窗都
       没了才报错。两条路都留埋点。 */
    var zombie=document.querySelector('#modal-root .modal');
    var lr=state.quickLastReset;
    qTrace(null,'no-state','state.quick 为空'+(zombie?'，但弹窗仍在 DOM 里':'')+
     (lr?('；最后一次清空 '+new Date(lr.at).toLocaleTimeString()+' 来自 '+lr.where):'；本次会话没有记录到清空动作'));
    q=quickLive();
    if(q){
     qTrace(q,'recover','从弹窗 DOM 读回已填内容继续');
    }else{
     if(zombie&&typeof closeModal==='function')closeModal();
     toast('弹窗状态已失效（页面可能刚同步过），已关闭，请重新打开','e');return;}
   }
   /* 幂等：一次点击可能被重复绑定 / 冒泡触发两次，写操作绝不能跑两遍
      （实测会连发两个 POST /api/quick/init，等于把盘初始化两次）。 */
   if(q.phase==='running'||q.phase==='paused'){
    qTrace(q,'busy','已经在执行中，忽略重复点击');
    toast('正在执行中，请稍候（进度见日志）','w');return;}
   /* 命令序列还在生成：记住意图，生成完自动开始，而不是把点击吞掉。 */
   if(q.phase==='loading'){
    qTrace(q,'loading-queue','命令生成中，已排队');
    q.pendingRun=true;
    q.status='命令序列还在生成，已记住这次点击——生成完会自动开始，不用再点。';
    quickPaintModal();toast('命令序列还在生成，生成完会自动开始','w');return;}
   /* 校验失败必须留下痕迹：只弹 toast 太容易被忽略（尤其是弹窗盖住屏幕时），
      同时在弹窗里写一条红字，并记住是哪一步没填。 */
   var bad=qValidate(q);
   if(bad){
    qTrace(q,'validate-fail',bad.field+' :: '+bad.msg);
    q.inputError=bad.msg;q.errorField=bad.field;
    q.status='';quickPaintModal();toast(bad.msg,'e');return;}
   q.inputError='';q.errorField='';q.status='';
   if(state.mode==='live'&&state.auth.role!=='admin'){
    qTrace(q,'readonly-user','role='+(state.auth.role||'-'));
    q.inputError='当前是只读账号，后端会拒绝写操作，请用管理员登录';q.errorField='';
    quickPaintModal();toast(q.inputError,'e');return;}
   qTrace(q,'exec','stage='+((q.kind==='init'||isPhase(q.kind))?'auto':'pre')+' dev='+(q.dev||'-'));
   quickExec((q.kind==='init'||isPhase(q.kind))?'auto':'pre');return;
  case 'q-resume':if(q)quickExec('post');return;
  case 'q-abort':if(q){q.aborted=true;toast('已发送中止请求','w');}return;
  case 'q-recheck':if(q)qRecheck(q,null);return;
  /* 修复 daemon：编号复用后 cephadm 的 unit.run 还指向上一次的 --osd-uuid，
     OSD 起来就 error/down。redeploy 只重建 unit 与容器，不 zap、不删数据。 */
  case 'q-fix':if(q)qFixDaemon(q);return;
  case 'q-alerts':qc();closeModal();state.view='alerts';render();return;
  case 'q-audit':qc();closeModal();state.view='audit';render();return;
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
 /* 只读闸门必须放在最前面：q-*（踢盘 / 换盘 / 新增盘）与 pool-*（建池）
    在这下面就被分流到 quickAction / poolAction，根本到不了 __baseOnAct，
    所以写在 app-wizard.js 的 onAct 里永远不生效——1.1.25 的提示框就是这样
    被绕过去的。 */
 if(typeof roBlocked==='function'&&roBlocked(act,el))return;
 if(act.indexOf('auth-')===0)return authAction(act,el);
 if(act.indexOf('q-')===0)return quickAction(act,el);
 if(act.indexOf('pool-')===0)return poolAction(act,el);
 if(act==='diag-retry'){__histAt=0;syncState(true).then(function(){return loadHistory(true);}).then(function(){render();});return;}
 if(act==='diag-run'){runDiag();return;}
 if(act==='logout')return doLogout();
 if(act==='change-password')return changePassword();
 if(act==='ssh-save')return sshSave();
 if(act==='ssh-test')return sshTest();
 if(act==='overlay'){
  if(state.quick&&(state.quick.phase==='running'||state.quick.phase==='paused')){
   toast('操作进行中，请先完成或中止','w');return;}
  if(state.pool&&state.pool.busy){toast('建池命令正在下发，请稍候','w');return;}
  qc();state.pool=null;return __baseOnAct(act,el);}
 if(act==='modal-close'&&(state.quick||state.pool)){
  if(state.pool&&state.pool.busy){toast('建池命令正在下发，请稍候','w');return;}
  qc();state.pool=null;return __baseOnAct(act,el);}
 if(act==='nav'&&(state.quick||state.pool)){qc();state.pool=null;}
 return __baseOnAct(act,el);
};

/* app-wizard.js may have booted before this file was evaluated (readyState
   !== 'loading'), so make sure the login/link initialisation always runs. */
if(document.readyState==='loading'){
 document.addEventListener('DOMContentLoaded',function(){liveBoot();});
}else{
 liveBoot();
}

/* 页面一加载就报到一次：日志里能直接看到「这个浏览器实际跑的是哪个构建」。
   排查「改了代码但现象没变」时，这一条比问用户 Ctrl+F5 有用得多。 */
(function(){
 var tries=0,t=setInterval(function(){
  tries++;
  if(state.mode==='live'&&state.auth&&state.auth.authenticated){
   clearInterval(t);
   qTrace(null,'boot','ui='+UI_BUILD+' view='+state.view+' role='+(state.auth.role||'-')+
    ' allowWrite='+!!state.settings.allowWrite+' confirm='+!!state.settings.confirm);
   return;}
  if(tries>90)clearInterval(t);
 },1000);
})();
