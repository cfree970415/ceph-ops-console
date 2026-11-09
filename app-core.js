/* Ceph Ops Console - core: utils / state / api / shell / overview */
'use strict';
var UI_BUILD='1.0.4-20261109';
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
 {v:'15.x',name:'Octopus',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph orch osd rm <id> --replace',note:'首个 cephadm 正式版，支持 orch device zap'},
 {v:'16.x',name:'Pacific',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph orch osd rm <id> --replace',note:'Dashboard REST 结构变化，已做字段归一化'},
 {v:'17.x',name:'Quincy',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph orch osd rm <id> --replace',note:'全功能支持'},
 {v:'18.x',name:'Reef',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph orch osd rm <id> --replace',note:'全功能支持'},
 {v:'19.x',name:'Squid',osd:'cephadm + ceph-volume',purge:true,orch:true,replace:'ceph orch osd rm <id> --replace',note:'全功能支持，已适配新字段'}];
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
var HOSTS=['node-ceph-01','node-ceph-02','node-ceph-03','node-ceph-04','node-ceph-05','node-ceph-06','node-ceph-07','node-ceph-08'];
var DEVS=['/dev/sdb','/dev/sdc','/dev/sdd','/dev/sde','/dev/sdf','/dev/nvme0n1','/dev/nvme1n1'];
var T=Date.now();
function mkOsds(){var a=[];for(var i=0;i<36;i++){var h=HOSTS[i%HOSTS.length],dev=DEVS[Math.floor(i/HOSTS.length)],nv=dev.indexOf('nvme')>=0;
 var size=nv?3.84e12:(i%7===0?8e12:4e12),used=Math.round(size*(0.42+((i*37)%47)/100)),up=true,inn=true,smart='OK';
 if(i===7){up=false;smart='FAIL';}if(i===19){up=false;smart='WARN';}if(i===23){inn=false;}if(i===3||i===16||i===28){used=Math.round(size*(0.87+(i%4)/100));}
 a.push({id:i,host:h,dev:dev,type:nv?'NVMe':(i%7===0?'HDD':'SSD'),size:size,used:used,up:up,inn:inn,pgs:180+((i*53)%260),weight:1,smart:smart,serial:'S3X'+('000000'+i).slice(-6)+((i*7919)%10000)});}return a;}
function mkAlerts(){return [
 {id:'A-1042',sev:'critical',code:'OSD_DOWN',title:'OSD.7 已下线，PG 处于降级状态',msg:'node-ceph-08 上的 /dev/sdb 无响应，SMART 报告介质错误。该 OSD 承载 312 个 PG，副本集当前为 2/3。',src:'osd.7',osd:7,since:T-42*60000,status:'active',count:3},
 {id:'A-1041',sev:'critical',code:'SMART_FAIL',title:'磁盘 SMART 预失效：osd.7',msg:'Reallocated_Sector_Ct 超过阈值，建议立即安排换盘。',src:'/dev/sdb @ node-ceph-08',osd:7,since:T-45*60000,status:'active',count:1},
 {id:'A-1039',sev:'warning',code:'OSD_NEARFULL',title:'osd.3 使用率 87%，接近 nearfull 阈值',msg:'当前 87.0%，阈值 85%。持续写入可能触发 backfill 停止。',src:'osd.3',osd:3,since:T-3*3600000,status:'active',count:7},
 {id:'A-1038',sev:'warning',code:'OSD_DOWN',title:'OSD.19 心跳超时',msg:'node-ceph-04 报告 osd.19 心跳丢失 13 分钟，等待现场确认。',src:'osd.19',osd:19,since:T-13*60000,status:'acked',count:1},
 {id:'A-1036',sev:'warning',code:'PG_DEGRADED',title:'12 个 PG 处于 degraded 状态',msg:'pg 3.4f / 3.1a2 等处于 active+undersized+degraded，与 osd.7 下线相关。',src:'pg',osd:null,since:T-40*60000,status:'active',count:12},
 {id:'A-1032',sev:'warning',code:'SLOW_OPS',title:'检测到 4 个慢请求',msg:'osd.28 提交延迟 1.8s，超过 1s 告警阈值。',src:'osd.28',osd:28,since:T-2*3600000,status:'silenced',count:4},
 {id:'A-1028',sev:'info',code:'POOL_NEARFULL',title:'存储池 cephfs_data 使用率 71%',msg:'已用 312 TiB / 440 TiB，建议评估扩容计划。',src:'cephfs_data',osd:null,since:T-8*3600000,status:'active',count:1},
 {id:'A-1021',sev:'info',code:'MON_CLOCK_SKEW',title:'MON 时钟偏移已恢复',msg:'node-ceph-02 与 mon leader 偏移 0.08s，已自动恢复。',src:'mon.b',osd:null,since:T-26*3600000,status:'resolved',count:1}];}
var state={
 view:'overview',theme:'dark',mode:'demo',apiBase:'',token:'',autoRefresh:true,lastRefresh:T,
 cluster:{name:'prod-ceph-01',fsid:'c8f3a1d2-4b67-11ee-a2c1-005056b8e3f0',version:'18.2.4',codename:'Reef',total:1.18e15,used:7.82e14,health:'HEALTH_WARN',mons:3,monInQuorum:3,osds:96,osdsUp:94,osdsIn:95,pools:6,pgs:4096,iops:18420,throughput:2.64e9,deploy:'cephadm'},
 osds:mkOsds(),alerts:mkAlerts(),
 pools:[{name:'rbd',type:'replicated',size:3,minSize:2,pgs:1024,used:4.12e14,pct:66,app:'rbd'},{name:'cephfs_data',type:'replicated',size:3,minSize:2,pgs:1024,used:3.12e14,pct:71,app:'cephfs'},{name:'cephfs_metadata',type:'replicated',size:3,minSize:2,pgs:128,used:1.8e12,pct:1,app:'cephfs'},{name:'backup',type:'erasure',size:'4+2',minSize:5,pgs:512,used:5.4e13,pct:15,app:'rgw'},{name:'.rgw.root',type:'replicated',size:3,minSize:2,pgs:32,used:2.1e9,pct:1,app:'rgw'},{name:'k8s-csi',type:'replicated',size:3,minSize:2,pgs:256,used:9.6e13,pct:18,app:'csi'}],
 hosts:HOSTS.map(function(h,i){return {name:h,ip:'192.168.27.'+(141+i),mons:i<3,osds:12,up:i===7?11:12,mem:62+((i*13)%28),cpu:18+((i*7)%45),ver:'18.2.4'};}),
 audit:[{id:uid(),ts:T-5*3600000,user:'admin@ops',act:'ALERT_ACK',target:'A-1038',cmd:'-',result:'OK',note:'确认 osd.19 心跳超时告警'},
  {id:uid(),ts:T-9*3600000,user:'admin@ops',act:'OSD_OUT',target:'osd.23',cmd:'ceph orch osd rm 23',result:'DRY-RUN',note:'演示模式，未下发真实命令'},
  {id:uid(),ts:T-27*3600000,user:'svc-deploy',act:'CONFIG',target:'alert rule',cmd:'-',result:'OK',note:'nearfull 阈值由 90% 调整为 85%'}],
 metrics:{cap:Array.from({length:24},function(_,i){return 62+i*0.42+Math.sin(i/2.4)*1.4;}),iops:Array.from({length:24},function(_,i){return 11+Math.sin(i/1.7)*4+((i*13)%7);})},
 filters:{alertSev:'all',alertStatus:'all',alertQ:'',osdStatus:'all',osdQ:''},
 settings:{nearfull:85,full:95,downMin:10,pgDegraded:1,slowOps:1000,webhook:'',notifyWebhook:true,notifyMail:false,notifyWecom:false,notifyDing:false,deployMode:'auto',forceVersion:'auto',allowWrite:false,confirm:true},
 deploy:{host:'192.168.27.134',user:'root',port:'8780',dir:'/opt/ceph-console',keytype:'full',restUrl:''},
 profile:null,wizard:null,modal:null,
 link:{apiBase:'',stateOk:false,stateError:'',stateHttp:0,stateAt:0,diag:null,diagBusy:false,diagError:''}};

/* ---- shared helpers (must exist before the first render) ---- */
function backendBase(){return state.apiBase||(state.link&&state.link.apiBase)||'';}
function faultOsd(){
 var bad=state.osds.filter(function(o){return o.smart==='FAIL'||!o.up;});
 if(bad.length){bad.sort(function(a,b){return (b.smart==='FAIL'?1:0)-(a.smart==='FAIL'?1:0);});return bad[0];}
 return state.osds[0]||null;}

/* ---- API layer ---- */
var API={token:function(){return state.token||sessionStorage.getItem('cc_token')||'';},
 call:function(m,p,b){
  if(state.mode==='demo')return sleep(120).then(function(){return {ok:true,demo:true};});
  var h={'Content-Type':'application/json'},tk=API.token();if(tk)h['X-Console-Token']=tk;
  if(b&&b._confirm)h['X-Confirm-Token']=b._confirm;
  return fetch((state.apiBase||'')+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}).then(function(r){
   if(!r.ok)return r.json().catch(function(){return {};}).then(function(j){throw new Error(j.error||('HTTP '+r.status));});return r.json();});}};
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
function activeAlerts(){if(liveNoData())return [];return state.alerts.filter(function(a){return a.status!=='resolved';});}
function healthInfo(){
 if(liveNoData())return {t:'UNKNOWN',cl:'',dot:'off',txt:'数据未就绪'};
 if(state.mode==='live'&&state.cluster.health&&state.cluster.health.indexOf('HEALTH_')===0){
  var h=state.cluster.health;
  if(h==='HEALTH_ERR')return {t:'HEALTH_ERR',cl:'err',dot:'err',txt:'集群错误'};
  if(h==='HEALTH_WARN')return {t:'HEALTH_WARN',cl:'warn',dot:'warn',txt:'存在警告'};
  return {t:'HEALTH_OK',cl:'ok',dot:'ok',txt:'集群健康'};
 }
 var a=activeAlerts(),c=a.filter(function(x){return x.sev==='critical'&&x.status==='active';}).length;
 if(c)return {t:'HEALTH_ERR',cl:'err',dot:'err',txt:'存在严重告警'};
 if(a.filter(function(x){return x.sev==='warning'&&x.status==='active';}).length)return {t:'HEALTH_WARN',cl:'warn',dot:'warn',txt:'存在警告'};
 return {t:'HEALTH_OK',cl:'ok',dot:'ok',txt:'集群健康'};}
function renderNav(){var h='';NAV.forEach(function(n){if(n.cap){h+='<div class="nav-cap">'+n.cap+'</div>';return;}var b=n.badge?n.badge():0;
 h+='<button class="nav-i '+(state.view===n.v?'on':'')+'" data-act="nav" data-view="'+n.v+'">'+ic(n.i)+'<span>'+n.t+'</span>'+(b?'<span class="nav-badge">'+b+'</span>':'')+'</button>';});
 document.getElementById('nav').innerHTML=h;var c=state.cluster,nd=liveNoData();
 document.getElementById('side-foot').innerHTML='<div class="row"><span>集群</span><b class="mono tm">'+esc(nd?'—':c.name)+'</b></div><div class="row"><span>Ceph</span><b class="mono" style="color:var(--accent2)">'+esc(nd?'—':c.version+' '+c.codename)+'</b></div><div class="row"><span>OSD</span><b class="mono '+(nd?'':(c.osdsUp<c.osds?'tw':'t'))+'">'+(nd?'—':c.osdsUp+' / '+c.osds)+'</b></div><div class="row" style="margin-top:9px"><span><span class="dot '+(nd?'off':(state.mode==='live'?'ok':'off'))+'"></span>'+(nd?'数据未就绪':(state.mode==='live'?'已对接集群':'演示数据'))+'</span><span class="mono">:'+state.deploy.port+'</span></div>';}
var TITLES={overview:'集群概览',alerts:'告警中心',osds:'OSD / 磁盘',pools:'存储池',hosts:'主机与 MON',audit:'变更审计',deploy:'部署与对接',settings:'系统设置'};
function renderTop(){var H=healthInfo(),c=state.cluster,
 liveLabel=(state.link&&state.link.stateOk)?'LIVE · '+esc(c.name):'LIVE · 等待后端数据';
 document.getElementById('topbar').innerHTML='<div class="crumb">'+TITLES[state.view]+'<small>'+(state.mode==='demo'?'DEMO 数据 · 可直接体验全部流程':liveLabel)+'</small></div><div class="sp"></div>'+
  '<span class="pill '+H.cl+'"><span class="dot '+H.dot+'"></span>'+H.t+'</span><span class="pill '+(state.mode==='live'?'ok':'acc')+'">'+ic(state.mode==='live'?'link':'db',13)+' '+(state.mode==='live'?'LIVE':'DEMO')+'</span>'+
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
 return !!a.value;
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
function pageH(t,s,right){return '<div class="page-h"><div><h2>'+t+'</h2><p>'+s+'</p></div><div class="btn-row">'+(right||'')+'</div></div>';}
function card(title,body,right,noPad){return '<div class="card"><div class="card-h"><h3>'+title+'</h3><div class="sp"></div>'+(right||'')+'</div><div class="'+(noPad===false?'':'card-b')+'">'+body+'</div></div>';}

/* ---- view: LIVE but no real backend data ---- */
function noDataPage(){
 var L=state.link||{},err=L.stateError||'',http=L.stateHttp||0,d=L.diag||null;
 var pending=!L.stateAt;
 var authGone=http===401||/not authenticated|sign in|请登录/i.test(err);
 var reason=pending?'正在向后端请求集群状态（首次同步尚未完成）':
  (authGone?'登录会话已失效，请重新登录':
   (http?('请求返回 HTTP '+http+(err?'：'+esc(err):'')):
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
  '<button class="btn" data-act="nav" data-view="settings">系统设置</button>'+
  '<button class="btn gho" data-act="diag-demo">切换到 DEMO 演示</button></div>';
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
  '<div class="note" style="margin-top:12px">只想体验界面和流程可点「切换到 DEMO 演示」——DEMO 会明确标注，且不会向后端下发任何写操作。</div>'+
  '</div></div>';
}

/* ---- view: overview ---- */
function vOverview(){if(liveNoData())return noDataPage();
 var c=state.cluster,H=healthInfo(),up=pct(c.used,c.total),active=activeAlerts(),crit=active.filter(function(a){return a.sev==='critical';}).length;
 var K=[{l:'集群健康',i:'activity',v:H.t.replace('HEALTH_',''),s:'<b class="'+(H.cl==='err'?'td':H.cl==='warn'?'tw':'t')+'">'+H.txt+'</b> · '+esc(c.codename)+' '+esc(c.version)},
  {l:'已用容量',i:'db',v:bytes(c.used),s:'共 '+bytes(c.total)+' · <b>'+up+'%</b> 已用',bar:up,color:up>85?'var(--warn)':'var(--ok)'},
  {l:'OSD 状态',i:'disk',v:c.osdsUp+'<small>/ '+c.osds+'</small>',s:'<b class="tw">'+(c.osds-c.osdsUp)+' 个 down</b> · '+(c.osds-c.osdsIn)+' 个 out',bar:pct(c.osdsUp,c.osds),color:'var(--warn)'},
  {l:'活跃告警',i:'bell',v:String(active.length),s:'<b class="td">'+crit+' 严重</b> · '+(active.length-crit)+' 其他'}];
 var kh=K.map(function(k){return '<div class="card kpi"><div class="kpi-l">'+ic(k.i,14)+k.l+'</div><div class="kpi-v">'+k.v+'</div><div class="kpi-s">'+k.s+'</div>'+(k.bar!=null?'<div class="bar"><i style="width:'+k.bar+'%;background:'+k.color+'"></i></div>':'')+'</div>';}).join('');
 var donutCard=card('容量分布','<div class="donut-wrap">'+donut(up,'var(--accent)','已用')+'<div class="legend"><div><i style="background:var(--accent)"></i>已用 <b class="mono" style="float:right">'+bytes(c.used)+'</b></div><div><i style="background:var(--panel3)"></i>可用 <b class="mono" style="float:right">'+bytes(c.total-c.used)+'</b></div><div><i style="background:var(--warn)"></i>nearfull 阈值 <b class="mono" style="float:right">'+state.settings.nearfull+'%</b></div><div style="margin-top:8px;color:var(--faint)">原始容量 '+bytes(c.total)+' · 副本 3<br>逻辑可用约 '+bytes((c.total-c.used)/3)+'</div></div></div>');
 var trend=card('近 24 小时容量使用率','<div style="font-size:11px;color:var(--muted);margin-bottom:6px">当前 <b class="mono" style="color:var(--accent2)">'+state.metrics.cap[23].toFixed(1)+'%</b> · 24h 增长 +'+(state.metrics.cap[23]-state.metrics.cap[0]).toFixed(1)+' pt</div>'+spark(state.metrics.cap,'var(--accent)',true)+'<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--faint)"><span>-24h</span><span>-18h</span><span>-12h</span><span>-6h</span><span>现在</span></div>','<span class="tag info">容量趋势</span>');
 var io=card('集群 IO 性能','<div class="grid g2" style="gap:10px;margin-bottom:14px"><div><div class="tiny">IOPS</div><div class="kpi-v" style="font-size:21px;margin:2px 0">'+c.iops.toLocaleString()+'</div></div><div><div class="tiny">吞吐</div><div class="kpi-v" style="font-size:21px;margin:2px 0">'+bytes(c.throughput)+'<small>/s</small></div></div></div>'+spark(state.metrics.iops,'var(--info)',true)+'<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--faint)"><span>-24h</span><span>现在</span></div>');
 var pg=card('PG 与 MON 状态','<div class="stat-line"><span>PG 总数</span><b class="mono">'+c.pgs.toLocaleString()+'</b></div><div class="stat-line"><span>active + clean</span><b class="mono t">4084</b></div><div class="stat-line"><span>undersized / degraded</span><b class="mono tw">12</b></div><div class="stat-line"><span>MON 法定人数</span><b class="mono t">'+c.monInQuorum+' / '+c.mons+'</b></div><div class="stat-line"><span>存储池</span><b class="mono">'+c.pools+'</b></div><div class="stat-line"><span>部署方式</span><b class="mono tp">'+esc(c.deploy)+'</b></div>');
 var fq=faultOsd();
 var quickOps=fq?'<div class="warnbox" style="margin-bottom:12px">'+ic('alert')+'<div>检测到待处置磁盘 <b class="mono">osd.'+fq.id+'</b> @ '+esc(fq.host)+' '+esc(fq.dev)+'，可从平台直接一键处置。</div></div>'+
  '<div class="btn-row" style="margin-bottom:14px"><button class="qbtn kick lg" data-act="q-open" data-kind="kick" data-id="'+fq.id+'">'+ic('trash',14)+'一键踢盘</button>'+
  '<button class="qbtn lg" data-act="q-open" data-kind="replace" data-id="'+fq.id+'">'+ic('zap',14)+'一键换盘</button>'+
  '<button class="btn" data-act="nav" data-view="alerts">'+ic('bell',14)+'查看告警页面</button></div><div class="hr"></div>':'';
 /* Unreachable while liveNoData() is true (vOverview returns noDataPage()
    above); kept empty so no stale "placeholder numbers" banner survives. */
 var noData='';
 var p=liveProfile(),recent=card('告警速览 · 点击查看全部',state.alerts.slice(0,5).map(function(a){return alertRow(a,true);}).join(''),'<button class="btn sm" data-act="nav" data-view="alerts">查看全部 '+ic('arrow',12)+'</button>',false);
 var quick=card('快捷运维',quickOps+'<div class="note" style="margin-bottom:12px">磁盘故障处理推荐走「踢盘换盘向导」：自动完成版本适配、预检、二次确认、执行与回填观察。</div><div class="btn-row"><button class="btn pri" data-act="wizard" data-intent="replace">'+ic('wrench',14)+' 发起踢盘换盘</button><button class="btn" data-act="simulate">'+ic('zap',14)+' 模拟一次磁盘故障</button><button class="btn" data-act="nav" data-view="deploy">'+ic('rocket',14)+' 部署 / 对接集群</button></div><div class="hr"></div><div class="tiny" style="margin-bottom:8px;font-weight:600;color:var(--muted)">当前适配档案</div><div class="stat-line"><span>Ceph 版本</span><b class="mono">'+esc(p.version||c.version)+' '+esc(c.codename)+'</b></div><div class="stat-line"><span>编排器</span><b class="mono">'+esc(p.orchestrator)+'</b></div><div class="stat-line"><span>能力探测</span><b class="mono t">'+(p.detected?'已自动完成':'按版本推断')+'</b></div>');
 return pageH('集群概览','多版本 Ceph 统一视图 · 监控告警 · Web 一键踢盘换盘','<button class="btn" data-act="nav" data-view="alerts">'+ic('bell',14)+' 查看告警页面</button><button class="btn pri" data-act="q-open" data-kind="replace">'+ic('zap',14)+' 一键换盘</button>')+
  noData+'<div class="grid g4" style="margin-bottom:14px">'+kh+'</div><div class="grid g21" style="margin-bottom:14px">'+trend+donutCard+'</div><div class="grid g2" style="margin-bottom:14px">'+io+pg+'</div><div class="grid g2">'+recent+quick+'</div>';}
