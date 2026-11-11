/* Ceph Ops Console - core: utils / state / api / shell / overview */
'use strict';
var UI_BUILD='1.1.28-20261111';
var P={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
 disk:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
 layers:'<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
 server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
 history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
 rocket:'<path d="M5 13c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3c1-4 4-8 10-9 0 6-4 9-8 10"/><circle cx="14.5" cy="7.5" r="1.5"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2h-3v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1-2.1-2.1.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2v-3h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 2.9-1.2v-.2h3v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2v3h-.2a1.7 1.7 0 0 0-1.6 1z"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
 refresh:'<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7L21 16"/><path d="M21 21v-5h-5"/>',
 check:'<path d="m4 12 5 5L20 6"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
 copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
 terminal:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 8 3 3-3 3M12 15h5"/>',
 shield:'<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/>',
 activity:'<path d="M2 12h4l3-8 4 16 3-8h6"/>',
 db:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
 arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',zap:'<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
 wrench:'<path d="M21 3a6 6 0 0 1-8 5.7L5.7 16a2.5 2.5 0 1 0 2.3 2.3l7.3-7.3A6 6 0 0 1 21 3z"/>',
 link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
 file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
 hd:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 18h.01M10 18h.01"/>',
 trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
 lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 network:'<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/>'};
function ic(n,s){return '<svg width="'+(s||16)+'" height="'+(s||16)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(P[n]||'')+'</svg>';}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function bytes(n){if(n==null)return '-';var u=['B','KiB','MiB','GiB','TiB','PiB','EiB'],i=0,x=Number(n);while(Math.abs(x)>=1024&&i<u.length-1){x/=1024;i++;}return (i<=1?Math.round(x):x.toFixed(x>=100?0:1))+' '+u[i];}
function ago(ts){var s=Math.max(0,Math.floor((Date.now()-ts)/1000));if(s<60)return s+' 秒前';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前';}
function dt(ts){var d=new Date(ts);function p(x){return x<10?'0'+x:''+x;}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function uid(){return Math.random().toString(36).slice(2,9);}
function pct(a,b){return b?Math.round(a/b*100):0;}
function copy(t){try{if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t);}else{var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}toast('已复制到剪贴板','ok');}catch(e){toast('复制失败，请手动选择','e');}}
function toast(m,t){var r=document.getElementById('toast-root'),d=document.createElement('div');d.className='toast '+(t||'');d.innerHTML='<div style="font-weight:600">'+esc(m)+'</div>';r.appendChild(d);setTimeout(function(){d.style.opacity='0';d.style.transition='.3s';setTimeout(function(){d.remove();},320);},3200);}

/* ---- compatibility matrices ---- */
var CEPH_VERSIONS=[
 {v:'12.x',name:'Luminous',osd:'ceph-disk',purge:false,orch:false,replace:'ceph-disk zap / prepare / activate',note:'mgr dashboard 需手动启用；REST 通道只读'},
 {v:'13.x',name:'Mimic',osd:'ceph-volume lvm',purge:false,orch:false,replace:'ceph-volume lvm create --osd-id',note:'支持 ceph device ls / osd perf'},
 {v:'14.x',name:'Nautilus',osd:'ceph-volume lvm',purge:true,orch:false,replace:'osd purge + ceph-volume lvm create',note:'支持 osd purge / ok-to-stop / safe-to-destroy'},
 {v:'15.x',name:'Octopus',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph osd purge <id>',note:'首个 cephadm 正式版，支持 orch device zap'},
 {v:'16.x',name:'Pacific',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph osd purge <id>',note:'Dashboard REST 结构变化，已做字段归一化'},
 {v:'17.x',name:'Quincy',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph osd purge <id>',note:'全功能支持'},
 {v:'18.x',name:'Reef',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph osd purge <id>',note:'全功能支持'},
 {v:'19.x',name:'Squid',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph osd purge <id>',note:'全功能支持，已适配新字段'}];
var DISTROS=[
 ['RHEL / CentOS 7','Python 3.6（EPEL / SCL）','systemd 219','firewalld','需装 python3；后端按 3.6 语法约束'],
 ['RHEL / Rocky / Alma 8-9','Python 3.6 / 3.9 / 3.11','systemd','firewalld','platform-python 亦可'],
 ['Ubuntu 18.04 / 20.04','Python 3.6 / 3.8','systemd','ufw','默认 python3 可用'],
 ['Ubuntu 22.04 / 24.04','Python 3.10 / 3.12','systemd','ufw','已验证'],
 ['Debian 10 / 11 / 12','Python 3.7 / 3.9 / 3.11','systemd','iptables / nft','已验证'],
 ['openEuler 20.03 / 22.03','Python 3.7 / 3.9','systemd','firewalld','已验证'],
 ['麒麟 V10 / 统信 UOS','Python 3.7+','systemd','firewalld','按 /etc/os-release 识别，走通用分支'],
 ['SUSE / openSUSE Leap','Python 3.6+','systemd','firewalld','通用分支，不依赖包管理器'],
 ['其他 / 老旧 SysVinit','Python 3.6+','SysV init','iptables','自动生成 /etc/init.d 脚本']];

/* ---- state ---- */
var T=Date.now();
var state={
 view:'overview',theme:'dark',mode:'live',apiBase:'',token:'',autoRefresh:true,lastRefresh:T,
 /* 没有任何内置集群数据：所有数值都来自后端 /api/state，未同步前显示诊断页。 */
 cluster:{name:'',fsid:'',version:'',codename:'',total:0,used:0,health:'UNKNOWN',mons:null,monInQuorum:null,
  osds:0,osdsUp:0,osdsIn:0,pools:0,pgs:0,iops:0,throughput:0,deploy:'',
  monList:[],monLeader:'',mgrActive:'',mgrStandbys:[],mgrAvailable:false,
  pgActiveClean:null,pgDegraded:null,pgBackfill:null,recoveringBytes:0,objects:0},
 osds:[],alerts:[],pools:[],hosts:[],audit:[],
 /* 告警明细是否真的读到了：alertsOk=false 时列表是上一次的快照（stale），
    不能据此断言「没有告警」，健康状态也不能因此显示成 OK。 */
 alertsOk:true,alertsErr:'',alertsAt:0,
 ioReal:{iops:false,thr:false},samples:{iops:[],cap:[]},lastStateTs:0,
 /* 真实 24h 历史：来自后端 /api/history（后端每分钟采样并落盘）。 */
 history:{points:[],at:0,span:0,interval:60,loaded:false,err:'',unsupported:false},
 filters:{alertSev:'all',alertStatus:'all',alertQ:'',osdStatus:'all',osdQ:''},
 settings:{nearfull:85,full:95,downMin:10,pgDegraded:1,slowOps:1000,webhook:'',notifyWebhook:true,notifyMail:false,notifyWecom:false,notifyDing:false,deployMode:'auto',forceVersion:'auto',allowWrite:false,confirm:true},
 deploy:{host:'',user:'root',port:'8780',dir:'/opt/ceph-console',keytype:'full',restUrl:''},
 profile:null,wizard:null,modal:null,
 /* 登录态：未登录时不渲染任何集群数值（由 app-live.js 的 render 包装处理）。 */
 auth:{required:true,authenticated:false,user:'',role:'viewer',allowWrite:false,writeCapability:false,
  readOnly:false,backend:'cli',session:'',tab:'password',error:'',busy:false},
 link:{apiBase:'',stateOk:false,stateError:'',stateHttp:0,stateAt:0,diag:null,diagBusy:false,diagError:''}};

/* ---- shared helpers (must exist before the first render) ---- */
function backendBase(){return state.apiBase||(state.link&&state.link.apiBase)||'';}
function faultOsd(){
 /* 只有真的故障（SMART FAIL / down）才算「待处置」。以前没有故障盘时
    fallback 到 state.osds[0]，会把健康的 osd.0 当成故障盘弹处置横幅。 */
 var bad=state.osds.filter(function(o){return o.smart==='FAIL'||!o.up;});
 if(!bad.length)return null;
 bad.sort(function(a,b){return (b.smart==='FAIL'?1:0)-(a.smart==='FAIL'?1:0);});
 return bad[0];}
/* First OSD that is marked OUT: the one-click "in" target. */
function inOsd(){return state.osds.filter(function(o){return !o.inn;})[0]||null;}

/* ---- real sample buffers (LIVE only) ----
   /api/state 只给当前快照，没有历史。趋势图由前端按同步间隔累积真实样本
   （带时间戳，便于算出真实跨度），样本不足时明确显示「采集中」，
   绝不回落到内置演示曲线。 */
function pushSample(arr,v,t,cap){
 if(typeof v!=='number'||!isFinite(v))return;
 arr.push({v:v,t:t||Date.now()});
 if(arr.length>(cap||60))arr.splice(0,arr.length-cap);
}
function seriesOf(arr){return arr.map(function(p){return p.v;});}
function sampleSpan(arr){
 if(arr.length<2)return '0 秒';
 var s=Math.max(0,Math.round((arr[arr.length-1].t-arr[0].t)/1000));
 return spanText(s);
}
/* Human readable duration used for trend axes ("4 分钟" / "3.5 小时"). */
function spanText(sec){
 sec=Math.max(0,Math.round(sec||0));
 if(sec>=3600){var h=sec/3600;return (h>=10?Math.round(h):Math.round(h*10)/10)+' 小时';}
 if(sec>=60)return Math.round(sec/60)+' 分钟';
 return sec+' 秒';
}
/* Axis ticks are derived from the REAL sample span, never from a fixed -24h. */
function axisFromSpan(sec){
 if(!(sec>0))return '<span>现在</span>';
 var out=[];
 [0,0.25,0.5,0.75,1].forEach(function(f){
  out.push(f===1?'<span>现在</span>':'<span>'+spanText(sec*(1-f))+'前</span>');});
 return out.join('');
}
function resetSamples(){state.samples={iops:[],cap:[]};state.ioReal={iops:false,thr:false};state.lastStateTs=0;
 state.history={points:[],at:0,span:0,interval:60,loaded:false,err:'',unsupported:false};}
function chartEmpty(txt){
 return '<div style="height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;'+
  'border:1px dashed var(--border);border-radius:8px;color:var(--faint);font-size:11px;line-height:1.6;text-align:center;padding:0 14px">'+
  ic('activity',22)+'<div>'+txt+'</div></div>';}

/* ---- API layer ---- */
var API={token:function(){return state.token||sessionStorage.getItem('cc_token')||'';},
 call:function(m,p,b){

  var h={'Content-Type':'application/json'},tk=API.token();if(tk)h['X-Console-Token']=tk;
  if(b&&b._confirm)h['X-Confirm-Token']=b._confirm;
  return fetch((state.apiBase||'')+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}).then(function(r){
   if(!r.ok)return r.json().catch(function(){return {};}).then(function(j){var er=new Error(j.error||('HTTP '+r.status));er.status=r.status;throw er;});return r.json();});}};
/* 真实 24 小时趋势：后端每分钟采样并落盘（/api/history），不是前端画出来的。
   节流 45 秒拉一次；后端版本太旧（404）或字段缺失时如实标注，绝不回落到演示曲线。 */
var __histAt=0;
function loadHistory(force){
 if(state.mode!=='live')return Promise.resolve(false);
 var now=Date.now();
 if(!force&&state.history.loaded&&now-__histAt<45000)return Promise.resolve(false);
 __histAt=now;
 return API.call('GET','/api/history?hours=24').then(function(r){
  var d=(r&&r.data)||{};
  var pts=(d.points||[]).filter(function(p){return p&&typeof p.t==='number';});
  state.history={points:pts,at:now,span:d.span_sec||0,interval:d.interval||60,
   loaded:true,err:d.error||'',unsupported:false};
  return true;
 }).catch(function(e){
  __histAt=0;
  var st=(e&&e.status)||0;
  state.history={points:[],at:now,span:0,interval:60,loaded:true,
   err:(e&&e.message)||'请求失败',unsupported:(st===404||/HTTP 404/.test((e&&e.message)||''))};
  return false;
 });
}
/* 变更审计在 LIVE 下必须读后端 jsonl，不能展示内置的 3 条演示记录。 */
var __auditAt=0;
function loadAudit(force){
 if(state.mode!=='live')return Promise.resolve(false);
 var now=Date.now();
 if(!force&&__auditAt&&now-__auditAt<30000)return Promise.resolve(false);
 __auditAt=now;
 return API.call('GET','/api/audit').then(function(r){
  var items=(r&&r.items)||[];
  state.audit=items.map(function(a,i){
   var ms=a.epoch?a.epoch*1000:(Date.parse(a.ts)||Date.now());
   return {id:String(a.epoch||ms)+'-'+i,ts:ms,user:a.user||'console',
    act:a.action||'-',target:a.target||'-',cmd:a.command||'-',
    result:a.result||'-',note:(a.note||'')+(a.remote?' · '+a.remote:'')};
  }).reverse();
  return true;
 }).catch(function(){__auditAt=0;return false;});
}
function liveProfile(){return state.profile||{version:state.cluster.version,codename:state.cluster.codename,major:18,orchestrator:'cephadm',backend:'cli',os:'自动识别',python:'3.6+',init:'systemd',detected:false,caps:{orch:true,purge:true,ok_to_stop:true,safe_to_destroy:true,device_ls:true,mgr_services:true}};}

/* ---- charts ---- */
function spark(data,color,fill){var w=560,h=140,pad=8,mn=Math.min.apply(null,data),mx=Math.max.apply(null,data),rg=(mx-mn)||1;
 var pts=data.map(function(v,i){return [pad+i*(w-2*pad)/(data.length-1),h-pad-(v-mn)/rg*(h-2*pad-14)];});
 var line=pts.map(function(p,i){return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);}).join(' '),grid='';
 for(var i=0;i<4;i++){var y=pad+i*(h-2*pad)/3;grid+='<line x1="'+pad+'" y1="'+y+'" x2="'+(w-pad)+'" y2="'+y+'" stroke="var(--border)" stroke-dasharray="3 5" opacity=".6"/>';}
 return '<svg class="chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+grid+(fill?'<path d="'+line+' L'+(w-pad)+' '+(h-pad)+' L'+pad+' '+(h-pad)+' Z" fill="'+color+'" opacity=".10"/>':'')+'<path d="'+line+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/><circle cx="'+pts[pts.length-1][0].toFixed(1)+'" cy="'+pts[pts.length-1][1].toFixed(1)+'" r="3.5" fill="'+color+'"/></svg>';}
function donut(p,color,label){var r=44,c=2*Math.PI*r;
 return '<svg width="118" height="118" viewBox="0 0 118 118"><circle cx="59" cy="59" r="'+r+'" fill="none" stroke="var(--panel3)" stroke-width="11"/><circle cx="59" cy="59" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="11" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+(c*(1-p/100)).toFixed(1)+'" transform="rotate(-90 59 59)"/><text x="59" y="55" text-anchor="middle" fill="var(--text)" font-size="20" font-weight="700">'+p+'%</text><text x="59" y="72" text-anchor="middle" fill="var(--faint)" font-size="10">'+esc(label||'')+'</text></svg>';}

/* ---- shell ---- */
var NAV=[{cap:'监控'},{v:'overview',t:'集群概览',i:'grid'},{v:'alerts',t:'告警中心',i:'bell',badge:function(){if(liveNoData())return 0;return state.alerts.filter(function(a){return a.status==='active'&&a.sev==='critical';}).length;}},{cap:'存储资源'},{v:'osds',t:'OSD / 磁盘',i:'disk'},{v:'pools',t:'存储池',i:'layers'},{v:'hosts',t:'主机与 MON',i:'server'},{cap:'运维'},{v:'audit',t:'变更审计',i:'history'},{v:'deploy',t:'部署与对接',i:'rocket'},{v:'settings',t:'系统设置',i:'settings'}];
/* LIVE without a valid /api/state response must never render the built-in
   demo fixtures. All cluster views are replaced by an explicit diagnostic
   page instead of showing fabricated numbers as if they were real. */
function liveNoData(){return state.mode==='live'&&!!state.link&&!state.link.stateOk;}
var CLUSTER_VIEWS=['overview','alerts','osds','pools','hosts'];
/* 概览只提醒「未处置」的告警：已确认 / 已静音的仍然保留在告警中心，
   但不再反复出现在首页和角标上。 */
function activeAlerts(){if(liveNoData())return [];return state.alerts.filter(function(a){return a.status==='active';});}
function healthInfo(){
 if(liveNoData())return {t:'UNKNOWN',cl:'',dot:'off',txt:'数据未就绪'};
 if(state.mode==='live'&&state.cluster.health&&state.cluster.health.indexOf('HEALTH_')===0){
  var h=state.cluster.health;
  if(h==='HEALTH_ERR')return {t:'HEALTH_ERR',cl:'err',dot:'err',txt:'集群错误'};
  if(h==='HEALTH_WARN')return {t:'HEALTH_WARN',cl:'warn',dot:'warn',txt:'存在警告'};
  /* ceph status 说 OK，但这一轮 health detail 没取到：告警明细未核实，
     不能凭一次成功/失败就把结论改成「一切正常」。 */
  if(state.alertsOk===false)return {t:'HEALTH_OK?',cl:'warn',dot:'warn',txt:'健康明细未核实'};
  /* ceph 已经报 OK，但本地还有未处置的告警：要么刚做过 OUT/IN 还在观察期，
     要么距最后一次出现不足 60 秒。此时仍显示黄色，等确认后再变绿。
     否则 IN 一下、Ceph 还没来得及报 PG_DEGRADED 的那几十秒，界面就像被治好了。
     已确认 / 已静音的告警不算，那是处置过的。 */
  var live=state.alerts.filter(function(x){return x.status==='active';}).length;
  if(live)return {t:'HEALTH_OK?',cl:'warn',dot:'warn',txt:live+' 项告警待核实'};
  return {t:'HEALTH_OK',cl:'ok',dot:'ok',txt:'集群健康'};
 }
 var a=activeAlerts(),c=a.filter(function(x){return x.sev==='critical'&&x.status==='active';}).length;
 if(c)return {t:'HEALTH_ERR',cl:'err',dot:'err',txt:'存在严重告警'};
 if(a.filter(function(x){return x.sev==='warning'&&x.status==='active';}).length)return {t:'HEALTH_WARN',cl:'warn',dot:'warn',txt:'存在警告'};
 return {t:'HEALTH_OK',cl:'ok',dot:'ok',txt:'集群健康'};}
function renderNav(){var h='';NAV.forEach(function(n){if(n.cap){h+='<div class="nav-cap">'+n.cap+'</div>';return;}var b=n.badge?n.badge():0;
 h+='<button class="nav-i '+(state.view===n.v?'on':'')+'" data-act="nav" data-view="'+n.v+'">'+ic(n.i)+'<span>'+n.t+'</span>'+(b?'<span class="nav-badge">'+b+'</span>':'')+'</button>';});
 document.getElementById('nav').innerHTML=h;var c=state.cluster,nd=liveNoData();
 document.getElementById('side-foot').innerHTML='<div class="row"><span>集群</span><b class="mono tm">'+esc(nd?'—':(c.fsid?String(c.fsid).slice(0,8):'—'))+'</b></div><div class="row"><span>Ceph</span><b class="mono" style="color:var(--accent2)">'+esc(nd?'—':c.version+' '+c.codename)+'</b></div><div class="row"><span>OSD</span><b class="mono '+(nd?'':(c.osdsUp<c.osds?'tw':'t'))+'">'+(nd?'—':c.osdsUp+' / '+c.osds)+'</b></div><div class="row" style="margin-top:9px"><span><span class="dot '+(nd?'off':'ok')+'"></span>'+(nd?'数据未就绪':'已对接集群')+'</span><span class="mono">:'+state.deploy.port+'</span></div>';}
var TITLES={overview:'集群概览',alerts:'告警中心',osds:'OSD / 磁盘',pools:'存储池',hosts:'主机与 MON',audit:'变更审计',deploy:'部署与对接',settings:'系统设置'};
function renderTop(){var H=healthInfo(),c=state.cluster,
 liveLabel=(state.link&&state.link.stateOk)?'LIVE · '+esc(c.fsid?('集群 '+String(c.fsid).slice(0,8)):'已连接后端'):'LIVE · 等待后端数据';
 document.getElementById('topbar').innerHTML='<div class="crumb">'+TITLES[state.view]+'<small>'+liveLabel+'</small></div><div class="sp"></div>'+
  '<span class="pill '+H.cl+'"><span class="dot '+H.dot+'"></span>'+H.t+'</span><span class="pill ok">'+ic('link',13)+' LIVE</span>'+
  (state.settings.allowWrite?'':'<span class="pill warn">'+ic('shield',13)+' DRY-RUN</span>')+'<span class="tiny mono">'+dt(state.lastRefresh).slice(11)+'</span>'+
  '<button class="ib" data-act="refresh" title="刷新">'+ic('refresh')+'</button><button class="ib" data-act="theme" title="切换主题">'+ic(state.theme==='dark'?'sun':'moon')+'</button>';}
/* ---- keep unsaved form input across re-renders ----
   The auto-refresh rebuilds #content with innerHTML. Without a snapshot every
   input (old/new password, token, thresholds, login fields) was silently
   wiped while the user was still typing. */
function formKey(el){return el.id||el.getAttribute('data-bind')||el.getAttribute('name')||'';}
function formBusy(){
 var a=document.activeElement;
 if(!a||!/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return false;
 if(!a.value)return false;
 /* Hold the re-render only while the user is actively typing. Merely being
    focused on a pre-filled field used to block auto-refresh indefinitely. */
 return (Date.now()-(state.lastInputAt||0))<4000;
}
function snapshotForm(root){
 var out=[],els=root?root.querySelectorAll('input,textarea,select'):[],i,e,r;
 for(i=0;i<els.length;i++){
  e=els[i];r={k:formKey(e),tag:e.tagName,type:(e.type||'').toLowerCase(),
   val:e.value,checked:e.checked===true,focus:document.activeElement===e};
  if(!r.k)continue;
  if(r.focus){try{r.ss=e.selectionStart;r.se=e.selectionEnd;}catch(err){}}
  out.push(r);
 }
 return out;
}
function restoreForm(root,snap){
 if(!root||!snap||!snap.length)return;
 var map={},i,els,e,s,k,focus=null;
 for(i=0;i<snap.length;i++)map[snap[i].k]=snap[i];
 els=root.querySelectorAll('input,textarea,select');
 for(i=0;i<els.length;i++){
  e=els[i];k=formKey(e);s=k?map[k]:null;
  if(!s||e.tagName!==s.tag||(e.type||'').toLowerCase()!==s.type)continue;
  try{e.value=s.val;}catch(err){}
  if(s.type==='checkbox'||s.type==='radio')e.checked=s.checked;
  if(s.focus)focus={el:e,ss:s.ss,se:s.se};
 }
 if(focus){try{focus.el.focus();
  if(focus.ss!=null&&focus.el.setSelectionRange)focus.el.setSelectionRange(focus.ss,focus.se);
 }catch(err){}}
}
function render(){document.documentElement.setAttribute('data-theme',state.theme);
 var f={overview:vOverview,alerts:vAlerts,osds:vOsds,pools:vPools,hosts:vHosts,audit:vAudit,deploy:vDeploy,settings:vSettings}[state.view],
     content=document.getElementById('content'),snap=snapshotForm(content);
 renderNav();renderTop();
 content.innerHTML=f();
 restoreForm(content,snap);}
/* 页面头部只留标题与操作按钮：副标题属于装饰性文案，统一不再渲染。
   第二参数保留在签名里只是为了不改动调用方。 */
function pageH(t,s,right){return '<div class="page-h"><div><h2>'+t+'</h2></div><div class="btn-row">'+(right||'')+'</div></div>';}
function card(title,body,right,noPad){return '<div class="card"><div class="card-h"><h3>'+title+'</h3><div class="sp"></div>'+(right||'')+'</div><div class="'+(noPad===false?'':'card-b')+'">'+body+'</div></div>';}

/* ---- view: LIVE but no real backend data ---- */
function noDataPage(){
 var L=state.link||{},err=L.stateError||'',http=L.stateHttp||0,d=L.diag||null;
 var pending=!L.stateAt;
 var authGone=http===401||/not authenticated|sign in|请登录/i.test(err);
 var reason=pending?'正在向后端请求集群状态（首次同步尚未完成）':
  (authGone?'登录会话已失效，请重新登录':
   (http&&http!==200?('请求返回 HTTP '+http+(err?'：'+esc(err):'')):
    (err?('后端返回：'+esc(err)):'请求未完成（网络不可达 / CORS 被拦截 / 后端无响应）')));
 var rows='<div class="stat-line"><span>失败原因</span><b>'+reason+'</b></div>'+
  '<div class="stat-line"><span>后端地址</span><b class="mono">'+esc(backendBase()||'同源 · 由后端托管')+'</b></div>'+
  '<div class="stat-line"><span>登录账号</span><b class="mono">'+esc(state.auth.authenticated?state.auth.user:'未登录')+'</b></div>'+
  '<div class="stat-line"><span>前端构建</span><b class="mono">'+esc(UI_BUILD)+'</b></div>'+
  '<div class="stat-line"><span>最近尝试</span><b class="mono">'+(L.stateAt?dt(L.stateAt):'—')+'</b></div>';
 var btns='<div class="btn-row" style="margin:14px 0">'+
  '<button class="btn pri" data-act="diag-retry">'+ic('refresh',14)+' 重新同步</button>'+
  '<button class="btn" data-act="diag-run">'+ic('wrench',14)+' 运行后端自检</button>'+
  (authGone?'<button class="btn" data-act="logout">重新登录</button>':'')+
  '<button class="btn" data-act="nav" data-view="settings">系统设置</button></div>';
 var diagHtml='';
 if(L.diagBusy)diagHtml='<div class="empty" style="padding:18px">'+ic('refresh',26)+'<div>正在运行后端自检…</div></div>';
 else if(L.diagError)diagHtml='<div class="warnbox">'+ic('alert')+'<div>自检请求失败：'+esc(L.diagError)+'</div></div>';
 else if(d){
  var st=d.status||{},pr=d.probe||{};
  diagHtml='<div class="grid g2" style="gap:0 20px">'+
   '<div><div class="stat-line"><span>后端版本</span><b class="mono">'+esc(d.version||'-')+'</b></div>'+
   '<div class="stat-line"><span>ceph 可执行文件</span><b class="mono '+(d.ceph_bin?'t':'td')+'">'+esc(d.ceph_bin||'未在 PATH 中找到')+'</b></div>'+
   '<div class="stat-line"><span>ceph status</span><b class="mono '+(st.ok?'t':'td')+'">'+(st.ok?'执行成功（rc=0）':'失败 rc='+esc(st.rc))+'</b></div>'+
   '<div class="stat-line"><span>客户端 / keyring</span><b class="mono">'+esc(d.ceph_name||'-')+'</b></div>'+
   '<div class="stat-line"><span>keyring 文件</span><b class="mono '+(d.keyring_exists?'t':'td')+'">'+esc(d.ceph_keyring||'-')+(d.keyring_exists?' · '+esc(d.keyring_mode||''):' · 不存在')+'</b></div></div>'+
   '<div><div class="stat-line"><span>探测版本</span><b class="mono">'+esc(pr.version||'-')+' '+(pr.detected?'· 已探测':'· 推断')+'</b></div>'+
   '<div class="stat-line"><span>探测错误</span><b class="mono">'+esc(pr.error||'无')+'</b></div>'+
   '<div class="stat-line"><span>写操作</span><b class="mono">'+(d.allow_write?'已启用':'DRY-RUN')+'</b></div>'+
   '<div class="stat-line"><span>后端平台</span><b class="mono">'+esc(d.python||'-')+'</b></div>'+
   (d.history?'<div class="stat-line"><span>历史采样</span><b class="mono">'+esc(d.history.points||0)+' 点 · '+(d.history.window_hours||24)+'h 窗口'+(d.history.error?' · '+esc(d.history.error):'')+'</b></div>':'')+
   '<div class="stat-line"><span>执行命令</span><b class="mono mini">'+esc(st.command||'-')+'</b></div></div></div>'+
   (st.error?'<div class="warnbox" style="margin-top:12px">'+ic('alert')+'<div><b>ceph 报错原文</b><br><span class="mono">'+esc(st.error)+'</span></div></div>':'')+
   '<div class="note" style="margin-top:12px"><b>自检结论</b> · '+esc(d.hint||'-')+'</div>';
 }
 var cmds='# 在【Ceph 节点】执行\nsystemctl status ceph-console --no-pager\nceph -s\nceph auth get client.ceph-console\nls -l /etc/ceph/ceph.client.ceph-console.keyring\ngrep -E "CEPH_CONSOLE|CEPH_ARGS" /etc/ceph-console/env\ncurl -H "X-Console-Token: <token>" http://127.0.0.1:8780/api/diag | python3 -m json.tool\njournalctl -u ceph-console -n 50 --no-pager';
 var cmdCard='<div class="card" style="margin-top:14px"><div class="card-h"><h3>在后端主机上排查</h3><div class="sp"></div><button class="btn sm" data-act="copy" data-target="diag-cmd">复制</button></div><div class="card-b"><pre class="mono" id="diag-cmd" style="white-space:pre-wrap;font-size:11px;line-height:1.7;margin:0">'+esc(cmds)+'</pre></div></div>';
 return pageH(pending?'正在同步集群状态':'集群数据未就绪','LIVE 控制台 · 后端未返回真实集群状态',
   '<button class="btn" data-act="diag-retry">'+ic('refresh',14)+' 重新同步</button>')+
  '<div class="card"><div class="card-b">'+
  '<div class="warnbox" style="margin-bottom:14px">'+ic('alert')+'<div><b>暂未链接任何存储集群，链接并同步成功后自动恢复。</b></div></div>'+
  rows+btns+'<div class="hr"></div>'+diagHtml+cmdCard+

  '</div></div>';
}

/* ---- view: overview ---- */
function vOverview(){if(liveNoData())return noDataPage();
 var c=state.cluster,H=healthInfo(),up=pct(c.used,c.total),active=activeAlerts(),crit=active.filter(function(a){return a.sev==='critical';}).length;
 var K=[{l:'集群健康',i:'activity',v:H.t.replace('HEALTH_',''),vc:H.cl==='err'?'var(--danger)':H.cl==='warn'?'var(--warn)':'',s:'<b class="'+(H.cl==='err'?'td':H.cl==='warn'?'tw':'t')+'">'+H.txt+'</b> · '+esc(c.codename)+' '+esc(c.version)},
  {l:'已用容量',i:'db',v:bytes(c.used),s:'共 '+bytes(c.total)+' · <b>'+up+'%</b> 已用',bar:up,color:up>85?'var(--warn)':'var(--ok)'},
  {l:'OSD 状态',i:'disk',v:c.osdsUp+'<small>/ '+c.osds+'</small>',s:'<b class="tw">'+(c.osds-c.osdsUp)+' 个 down</b> · '+(c.osds-c.osdsIn)+' 个 out',bar:pct(c.osdsUp,c.osds),color:'var(--warn)'},
  {l:'活跃告警',i:'bell',v:String(active.length),s:'<b class="td">'+crit+' 严重</b> · '+(active.length-crit)+' 其他'}];
 var kh=K.map(function(k){return '<div class="card kpi"><div class="kpi-l">'+ic(k.i,14)+k.l+'</div><div class="kpi-v"'+(k.vc?' style="color:'+k.vc+'"':'')+'>'+k.v+'</div><div class="kpi-s">'+k.s+'</div>'+(k.bar!=null?'<div class="bar"><i style="width:'+k.bar+'%;background:'+k.color+'"></i></div>':'')+'</div>';}).join('');
 var donutCard=card('容量分布','<div class="donut-wrap">'+donut(up,'var(--accent)','已用')+'<div class="legend"><div><i style="background:var(--accent)"></i>已用 <b class="mono" style="float:right">'+bytes(c.used)+'</b></div><div><i style="background:var(--panel3)"></i>可用 <b class="mono" style="float:right">'+bytes(c.total-c.used)+'</b></div><div><i style="background:var(--warn)"></i>nearfull 阈值 <b class="mono" style="float:right">'+state.settings.nearfull+'%</b></div></div></div>');
 var live=true;
 /* 趋势只有一种数据来源：真实采样。优先后端 /api/history（每分钟落盘，
    能给出真实时间轴），其次本次会话的本地采样；不足 2 点就显示空态。 */
 var hp=(state.history&&state.history.points)||[];
 var useHist=hp.length>=2;
 var useHistIo=useHist&&state.ioReal.iops;
 var locCap=state.samples.cap.slice(-24),locIo=state.samples.iops.slice(-24);
 var capV=useHist?hp.map(function(p){return p.pct;}):seriesOf(locCap);
 var ioV=useHistIo?hp.map(function(p){return p.iops;}):seriesOf(locIo);
 var capSec=useHist?(hp[hp.length-1].t-hp[0].t):(locCap.length>=2?Math.round((locCap[locCap.length-1].t-locCap[0].t)/1000):0);
 var ioSec=useHistIo?capSec:(locIo.length>=2?Math.round((locIo[locIo.length-1].t-locIo[0].t)/1000):0);
 var capCur=capV.length?capV[capV.length-1]:null;
 var capDelta=capV.length>=2?(capV[capV.length-1]-capV[0]):null;
 var histErr=(state.history&&state.history.unsupported)?'后端未提供 /api/history，请升级后端到 1.0.7+ 后重启服务':'';
 var waitTxt=histErr||'暂无真实历史数据（后端每 60 秒采样一次，至少 2 个点后绘制）';
 var trendTitle=useHist?'容量使用率（近 '+spanText(capSec)+' 真实历史）':'容量使用率（本地真实采样）';
 var trendSub=useHist
  ?'当前 <b class="mono" style="color:var(--accent2)">'+capCur.toFixed(1)+'%</b> · 近 '+spanText(capSec)+' '+(capDelta>=0?'+':'')+capDelta.toFixed(2)+' pt'
  :(histErr?esc(histErr):(capV.length?'近期 '+spanText(capSec):''));
 var trend=card(trendTitle,
  '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">'+trendSub+'</div>'+
  (capV.length>=2?spark(capV,'var(--accent)',true):chartEmpty(waitTxt))+
  '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--faint)">'+axisFromSpan(capSec)+'</div>');
 var iopsTxt=state.ioReal.iops?c.iops.toLocaleString():'—';
 var thrTxt=state.ioReal.thr?bytes(c.throughput)+'<small>/s</small>':'—';
 var ioSub=useHistIo?'最近 '+spanText(ioSec)
  :(state.ioReal.iops?(ioV.length>=2?'最近 '+spanText(ioSec):''):'');
 var io=card('集群 IO 性能',
  '<div class="grid g2" style="gap:10px;margin-bottom:14px"><div><div class="tiny">IOPS</div><div class="kpi-v" style="font-size:21px;margin:2px 0">'+iopsTxt+'</div></div><div><div class="tiny">吞吐</div><div class="kpi-v" style="font-size:21px;margin:2px 0">'+thrTxt+'</div></div></div>'+
  (ioV.length>=2?spark(ioV,'var(--info)',true):chartEmpty(waitTxt))+
  '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--faint)">'+axisFromSpan(ioSec)+'</div>'+
  (ioSub?'<div class="note" style="margin-top:8px">'+ioSub+'</div>':''));
 /* PG / MON 卡片全部来自后端真实字段；后端没给的（例如 REST 只读通道）
    显示 “—”，不再用 4084 / 12 / 6 之类的演示常量冒充。 */
 var pgAC=(typeof c.pgActiveClean==='number')?c.pgActiveClean.toLocaleString():'—';
 var pgBadN=(typeof c.pgDegraded==='number')?c.pgDegraded:null;
 var poolN=(typeof c.pools==='number')?c.pools:((state.pools&&state.pools.length)||0);
 var monQ=(typeof c.monInQuorum==='number')?c.monInQuorum:'—';
 var monN=(typeof c.mons==='number')?c.mons:'—';
 var pgTotal=(typeof c.pgs==='number')?c.pgs.toLocaleString():'—';
 var pg=card('PG 与 MON 状态','<div class="stat-line"><span>PG 总数</span><b class="mono">'+pgTotal+'</b></div>'+
  '<div class="stat-line"><span>active + clean</span><b class="mono '+(pgAC==='—'?'':'t')+'">'+pgAC+'</b></div>'+
  '<div class="stat-line"><span>undersized / degraded</span><b class="mono '+(pgBadN?(pgBadN>0?'tw':'t'):'')+'">'+(pgBadN==null?'—':pgBadN)+'</b></div>'+
  '<div class="stat-line"><span>MON 法定人数</span><b class="mono '+((typeof c.monInQuorum==='number'&&typeof c.mons==='number'&&c.monInQuorum<c.mons)?'tw':'t')+'">'+monQ+' / '+monN+'</b></div>'+
  '<div class="stat-line"><span>存储池</span><b class="mono">'+poolN+'</b></div>'+
  '<div class="stat-line"><span>部署方式</span><b class="mono tp">'+esc(c.deploy)+'</b></div>');
 var fq=faultOsd();
 var quickOps=fq?'<div class="warnbox" style="margin-bottom:12px">'+ic('alert')+'<div>待处置磁盘 <b class="mono">osd.'+fq.id+'</b> @ '+esc(fq.host)+' '+esc(fq.dev)+'</div></div>'+
  '<div class="btn-row" style="margin-bottom:14px"><button class="qbtn kick lg" data-act="q-open" data-kind="kick" data-id="'+fq.id+'">'+ic('trash',14)+'一键踢盘</button>'+
  '<button class="qbtn lg" data-act="q-open" data-kind="init" data-id="'+fq.id+'">'+ic('zap',14)+'一键换盘</button>'+
  '<button class="btn" data-act="nav" data-view="alerts">'+ic('bell',14)+'查看告警页面</button></div><div class="hr"></div>':'';
 /* An OSD left in OUT state (maintenance / drained) can be put back with one click. */
 var iq=liveNoData()?null:inOsd();
 if(iq)quickOps+='<div class="btn-row" style="margin-bottom:12px;align-items:center"><button class="qbtn lg" data-act="osd-in" data-id="'+iq.id+'">'+ic('refresh',14)+'IN</button>'+
  '<span class="tiny mono">osd.'+iq.id+' 当前为 OUT · 重新 IN 后恢复 CRUSH 权重并开始回填</span></div><div class="hr"></div>';
 /* Unreachable while liveNoData() is true (vOverview returns noDataPage()
    above); kept empty so no stale "placeholder numbers" banner survives. */
 var noData='';
 var p=liveProfile(),recentList=activeAlerts().slice(0,5),
  recent=card('告警速览 · 点击查看全部',
   recentList.length?recentList.map(function(a){return alertRow(a,true);}).join('')
    :'<div class="empty" style="padding:16px">'+ic('check',22)+'<div>当前没有活跃告警</div></div>',
   '<button class="btn sm" data-act="nav" data-view="alerts">查看全部 '+ic('arrow',12)+'</button>',false);
 var quick=card('快捷运维',quickOps+'<div class="btn-row"><button class="btn pri" data-act="wizard" data-intent="replace">'+ic('wrench',14)+' 发起踢盘换盘</button><button class="btn" data-act="nav" data-view="deploy">'+ic('rocket',14)+' 部署 / 对接集群</button></div><div class="hr"></div><div class="tiny" style="margin-bottom:8px;font-weight:600;color:var(--muted)">当前适配档案</div><div class="stat-line"><span>Ceph 版本</span><b class="mono">'+esc(p.version||c.version)+' '+esc(c.codename)+'</b></div><div class="stat-line"><span>编排器</span><b class="mono">'+esc(p.orchestrator)+'</b></div><div class="stat-line"><span>能力探测</span><b class="mono t">'+(p.detected?'已自动完成':'按版本推断')+'</b></div>');
 return pageH('集群概览','多版本 Ceph 统一视图 · 监控告警 · Web 一键踢盘换盘','<button class="btn" data-act="nav" data-view="alerts">'+ic('bell',14)+' 查看告警页面</button><button class="btn pri" data-act="q-open" data-kind="init">'+ic('zap',14)+' 一键换盘</button>')+
  noData+alertsStaleBox()+'<div class="grid g4" style="margin-bottom:14px">'+kh+'</div><div class="grid g21" style="margin-bottom:14px">'+trend+donutCard+'</div><div class="grid g2" style="margin-bottom:14px">'+io+pg+'</div><div class="grid g2">'+recent+quick+'</div>';}
