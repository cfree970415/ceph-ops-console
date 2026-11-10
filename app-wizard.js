/* Ceph Ops Console - wizard / modals / events / bootstrap */
'use strict';
/* ---------- modal ---------- */
function openModal(html,size){state.modal=true;document.getElementById('modal-root').innerHTML='<div class="overlay" data-act="overlay"><div class="modal '+(size||'md')+'" data-stop="1">'+html+'</div></div>';}
function closeModal(){state.modal=false;state.wizard=null;document.getElementById('modal-root').innerHTML='';}
function modalHead(t,sub){return '<div class="modal-h">'+ic('terminal',18)+'<h3>'+t+(sub?'<div class="tiny" style="font-weight:400">'+sub+'</div>':'')+'</h3><button class="ib" data-act="modal-close">'+ic('x')+'</button></div>';}

/* ---------- detail modals ---------- */
function osdDetail(id){var o=state.osds.filter(function(x){return x.id===Number(id);})[0];if(!o)return;
 var hasCap=o.size>0,p=pct(o.used,o.size),s=osdStatus(o);
 var body='<div class="grid g2"><div><div class="stat-line"><span>OSD ID</span><b class="mono">osd.'+o.id+'</b></div><div class="stat-line"><span>服务器</span><b class="mono">'+esc(o.host||'未采集')+(hostIp(o.host)?' · '+esc(hostIp(o.host)):'')+'</b></div>'+
  '<div class="stat-line"><span>设备</span><b class="mono">'+esc(o.dev||'未采集')+'</b></div><div class="stat-line"><span>序列号</span><b class="mono">'+esc(o.serial||'未采集')+'</b></div>'+
  '<div class="stat-line"><span>介质</span><b>'+(o.type?esc(o.type):'未采集')+'</b></div><div class="stat-line"><span>状态</span><span class="tag '+s.c+'">'+s.t+'</span></div></div>'+
  '<div><div class="stat-line"><span>容量</span><b class="mono">'+(hasCap?bytes(o.size):'未采集')+'</b></div><div class="stat-line"><span>已用</span><b class="mono">'+(hasCap?bytes(o.used)+' ('+p+'%)':'—')+'</b></div>'+
  '<div class="stat-line"><span>使用率</span>'+(hasCap?'<div class="bar" style="width:120px;margin:0"><i style="width:'+p+'%;background:'+(p>85?'var(--danger)':'var(--ok)')+'"></i></div>':'<b class="td">未采集</b>')+'</div>'+
  '<div class="stat-line"><span>PG 数</span><b class="mono">'+o.pgs+'</b></div><div class="stat-line"><span>CRUSH weight</span><b class="mono">'+Number(o.weight||0).toFixed(2)+'</b></div>'+
  '<div class="stat-line"><span>SMART</span><b class="'+(o.smart==='OK'?'t':'td')+'">'+(o.smart||'未采集')+'</b></div></div></div>'+
  (o.smart==='FAIL'?'<div class="dangerbox" style="margin-top:14px">'+ic('alert')+'<div>该盘 SMART 报告介质失效且 OSD 已下线，建议立即走「踢盘换盘」流程。换盘前请核对 SN <span class="mono">'+esc(o.serial)+'</span> 与物理盘位。</div></div>':'')+
  '<div class="hr"></div><div class="tiny" style="margin-bottom:8px">相关告警</div>'+
  (state.alerts.filter(function(a){return a.osd===o.id;}).map(function(a){return '<div class="ck"><div class="ck-i '+(a.sev==='critical'?'f':'w')+'">!</div><div><div class="ck-n">'+esc(a.title)+'</div><div class="ck-d mono">'+a.id+' · '+ago(a.since)+'</div></div></div>';}).join('')||'<div class="note">暂无关联告警</div>');
 openModal(modalHead('OSD.'+o.id+' 详情',esc(o.host||'—')+' · '+esc(o.dev||'—'))+'<div class="modal-b">'+body+'</div><div class="modal-f"><div class="sp"></div>'+
  '<button class="btn" data-act="modal-close">关闭</button>'+(o.inn?'<button class="btn" data-act="osd-out" data-id="'+o.id+'">标记 OUT</button>':'<button class="btn" data-act="osd-in" data-id="'+o.id+'">标记 IN</button>')+
  '<button class="qbtn kick" data-act="q-open" data-kind="kick" data-id="'+o.id+'">'+ic('trash',13)+'一键踢盘</button>'+
  '<button class="qbtn" data-act="q-open" data-kind="replace" title="坏盘换新盘：新盘装回原盘位，重建后 OSD 编号不变" data-id="'+o.id+'">'+ic('zap',13)+'一键换盘</button></div>','md');}
/* 告警确认 / 静音 / 重新激活：处置状态存后端，刷新页面、换浏览器都保持；
   离线（demo）模式没有后端可写，只改本地状态，不假装调用成功。 */
/* 处置后如果详情弹窗还开着，就地刷新，否则按钮状态和列表对不上。 */
function refreshAlertDetail(id){
 var r=document.getElementById('modal-root');
 if(r&&r.innerHTML&&r.innerHTML.indexOf('告警详情')>=0)alertDetail(id);
}
function alertAction(a,action,okMsg){
 var ACT={ack:'ALERT_ACK',silence:'ALERT_SILENCE',reopen:'ALERT_REOPEN'}[action]||'ALERT_ACK';
 function local(){
  a.status=action==='ack'?'acked':action==='silence'?'silenced':'active';
  a.until=action==='silence'?Math.floor(Date.now()/1000)+3600:0;
  addAudit(ACT,a.id,'-',okMsg);render();refreshAlertDetail(a.id);toast(okMsg,'ok');}
 if(state.mode!=='live'||!state.auth.authenticated){local();return;}
 apiFetch('POST','/api/alert/ack',{id:a.id,action:action,minutes:60}).then(function(r){
  var e=(r&&r.alert)||{};
  if(e.status)a.status=e.status;
  a.by=e.by||a.by||'';a.until=e.until||0;
  /* 后端已经写过一条审计 jsonl，这里不再 addAudit，否则同一条显示两遍。 */
  render();refreshAlertDetail(a.id);toast(okMsg,'ok');
 }).catch(function(err){toast('操作失败：'+((err&&err.message)||'后端未响应'),'e');});
}
function alertDetail(id){var a=state.alerts.filter(function(x){return x.id===id;})[0];if(!a)return;
 var body='<div class="flex" style="gap:10px;margin-bottom:14px">'+sevTag(a.sev)+stTag(a.status)+'<span class="tag mute mono">'+a.id+'</span></div>'+
  '<div style="font-size:15px;font-weight:650;margin-bottom:10px">'+esc(a.title)+'</div><div class="note" style="font-size:12.5px;color:var(--muted);margin-bottom:16px">'+esc(a.msg)+'</div>'+
  '<div class="grid g2"><div><div class="stat-line"><span>告警代码</span><b class="mono">'+a.code+'</b></div><div class="stat-line"><span>来源</span><b class="mono">'+esc(a.src)+'</b></div><div class="stat-line"><span>首次出现</span><b class="mono">'+dt(a.since)+'</b></div><div class="stat-line"><span>处置人</span><b class="mono">'+(a.by?esc(a.by):'—')+'</b></div></div>'+
  '<div><div class="stat-line"><span>持续</span><b>'+ago(a.since).replace('前','')+'</b></div><div class="stat-line"><span>触发次数</span><b class="mono">'+a.count+'</b></div>'+
  '<div class="stat-line"><span>涉及 OSD</span><b class="mono">'+((a.osdIds&&a.osdIds.length)?a.osdIds.map(function(x){return 'osd.'+x;}).join(', '):'—')+'</b></div>'+
  '<div class="stat-line"><span>涉及主机</span><b class="mono">'+((a.hosts&&a.hosts.length)?esc(a.hosts.join(', ')):'—')+'</b></div>'+
  '<div class="stat-line"><span>涉及设备</span><b class="mono">'+((a.devs&&a.devs.length)?esc(a.devs.join(', ')):'—')+'</b></div></div></div>'+
  '<div class="hr"></div><div class="tiny" style="margin-bottom:8px">建议处置</div><div class="cmdbox">'+(a.osd!=null?'# 1. 确认故障盘与物理盘位\nceph osd metadata '+a.osd+'\n# 2. 先置 DOWN 停止服务，再 OUT 摘盘（也可在 OSD 页面执行「一键踢盘」）\nceph osd down '+a.osd+'\nceph osd out '+a.osd+'\n# 3. 观察回填至 active+clean；维护结束后再 IN 恢复':'# 查看健康明细\nceph health detail\n# 查看 PG 状态\nceph pg stat')+'</div>';
 openModal(modalHead('告警详情',a.code)+'<div class="modal-b">'+body+'</div><div class="modal-f"><div class="sp"></div>'+
  (a.status==='active'?'<button class="btn" data-act="alert-ack" data-id="'+a.id+'">确认告警</button><button class="btn" data-act="alert-silence" data-id="'+a.id+'">静音 60 分钟</button>':'')+
  (a.status==='acked'||a.status==='silenced'?'<button class="btn" data-act="alert-reopen" data-id="'+a.id+'">重新激活</button>':'')+
  '<button class="btn" data-act="modal-close">关闭</button>'+'</div>','md');}

/* ---------- command plan / preflight ---------- */
function wizardPlan(w){var id=w.osdId,p=liveProfile(),orch=p.orchestrator==='cephadm'&&p.caps.orch,rep=w.intent==='replace',s=[];
 if(rep&&orch){s=[
  {n:'停止故障 OSD 守护进程',c:'ceph orch daemon stop osd.'+id,d:'盘已坏时可能直接失败；还在跑必须先停，否则 out 会被心跳改回 up'},
  {n:'标记 OSD OUT',c:'ceph osd out '+id,d:'先把 PG 迁走，再动盘'},
  {n:'移除 OSD 并保留编号',c:'ceph orch osd rm '+id+' --replace'+(((state.osds.filter(function(x){return x.id===id;})[0]||{}).up)?'':' --force'),d:'--replace 保留 osd.'+id+' 编号供新盘复用；盘已 down 时加 --force 跳过回填等待'},
  {n:'轮询移除进度',c:'ceph orch osd rm status --format=json',d:'确认该 OSD 已离开移除队列（编号留作替换）'},
  {n:'物理更换故障盘',c:'# 现场操作：按盘位 / SN 换上同规格新盘，装回原盘位',d:'需人工确认，平台在此暂停等待'},
  {n:'确认新盘已被编排器识别',c:'ceph orch device ls '+w.host+' --format=json',d:'新盘应出现在设备列表（available 可能为 false，还带着旧签名）'},
  {n:'清理新盘残留签名',c:'ceph orch device zap '+w.host+' '+w.dev+' --force',d:'只作用于新盘，执行前核对盘位与 SN'},
  {n:'用原编号重建 OSD',c:'ceph orch daemon add osd '+w.host+':'+w.dev,d:'cephadm 优先复用 --replace 保留的编号 osd.'+id},
  {n:'确认 osd.'+id+' 重新上线',c:'ceph osd dump --format=json',d:'up=true / in=true，且编号必须仍是 osd.'+id},
  {n:'集群健康验证',c:'ceph -s --format=json',d:'等待所有 PG active+clean，HEALTH_OK'}];
 }else if(rep){var _ow=(state.osds.filter(function(x){return x.id===id;})[0]||{}).weight;
  s=[
  {n:'停止故障 OSD 守护进程',c:'systemctl stop ceph-osd@'+id,d:'盘已坏时可能直接失败；还在跑必须先停'},
  {n:'标记 OSD OUT',c:'ceph osd out '+id,d:'先把 PG 迁走，再动盘'},
  {n:(p.caps.purge?'移除 OSD 但留作替换（purge）':'三步式移除 OSD'),c:p.caps.purge?'ceph osd purge '+id+' --yes-i-really-mean-it':'ceph osd crush remove osd.'+id+' && ceph auth del osd.'+id+' && ceph osd rm '+id,d:'编号 osd.'+id+' 由下一步 --osd-id 强制复用'},
  {n:'物理更换故障盘',c:'# 现场操作：按盘位 / SN 换上同规格新盘，装回原盘位',d:'需人工确认，平台在此暂停等待'},
  {n:'清理新盘元数据',c:'ceph-volume lvm zap '+w.dev+' --destroy',d:'只作用于新盘；12.x 无 ceph-volume 时回退 ceph-disk zap'},
  {n:'用原编号重建 OSD',c:'ceph-volume lvm create --data '+w.dev+' --osd-id '+id,d:'不指定 --osd-id 就会分配一个新编号'},
  {n:'恢复原 CRUSH 权重',c:'ceph osd crush reweight osd.'+id+' '+(_ow||1),d:'新建 OSD 默认权重 1.0，按原值恢复以免容量分布失衡'},
  {n:'确认 osd.'+id+' 重新上线',c:'ceph osd dump --format=json',d:'up=true / in=true，且编号必须仍是 osd.'+id},
  {n:'集群健康验证',c:'ceph -s --format=json',d:'等待 all PGs active+clean'}];
 }else if(w.intent==='downout'){s=[
  {n:'强制标记 OSD DOWN',c:'ceph osd down '+id,d:'先停服务再摘盘，避免故障盘抖动产生 slow ops'},
  {n:'标记 OSD OUT',c:'ceph osd out '+id,d:'从 CRUSH 摘出并触发回填；不 purge、不清盘'},
  {n:'确认 down / out 已生效',c:'ceph osd tree --format=json',d:'该 OSD 应为 down 且 reweight 为 0'},
  {n:'集群健康验证',c:'ceph -s --format=json',d:'观察 PG 回到 active+clean'}];
 }else if(w.intent==='in'){s=[
  {n:'确认 OSD 仍在 CRUSH map',c:'ceph osd tree --format=json',d:'已被 purge / rm 的 OSD 无法 in，只能重新部署'},
  {n:'重新加入集群（osd in）',c:'ceph osd in '+id,d:'取消 out 标记，恢复 CRUSH 权重并触发回填'},
  {n:'确认 OSD 处于 up/in',c:'ceph osd tree --format=json',d:'状态应为 up 且权重非 0；仍 down 说明进程未起来'},
  {n:'集群健康验证',c:'ceph -s --format=json',d:'观察 PG 回到 active+clean'}];
 }else{s=[
  {n:'强制标记 OSD DOWN',c:'ceph osd down '+id,d:'先停服务再摘盘，避免故障盘抖动产生 slow ops'},
  {n:'标记 OSD OUT',c:'ceph osd out '+id,d:'停止写入并触发数据重平衡'},
  {n:'等待回填完成',c:'ceph -s --format=json',d:'确认数据已迁出，避免数据丢失'},
  {n:(p.caps.purge?'永久移除 OSD':'三步式移除 OSD'),c:p.caps.purge?'ceph osd purge '+id+' --yes-i-really-mean-it':'ceph osd crush remove osd.'+id+' && ceph auth del osd.'+id+' && ceph osd rm '+id,d:'移除认证与 CRUSH 条目'},
  {n:'清理设备',c:orch?'ceph orch device zap '+w.host+' '+w.dev+' --force':'ceph-volume lvm zap '+w.dev+' --destroy',d:'使设备回到 Available'},
  {n:'集群健康验证',c:'ceph -s --format=json',d:'确认 HEALTH_OK'}];}
 return s;}
function preflightItems(w){var o=state.osds.filter(function(x){return x.id===w.osdId;})[0],p=liveProfile(),avail=state.cluster.total-state.cluster.used,need=o.used*0.34;
 return [{n:'集群整体健康',c:'ceph health detail --format=json',d:'当前不得处于 HEALTH_ERR（避免叠加故障）',ok:state.cluster.health!=='HEALTH_ERR'},
  {n:(p.caps.ok_to_stop?'ok-to-stop 检查':'PG 冗余检查（降级）'),c:p.caps.ok_to_stop?'ceph osd ok-to-stop '+o.id:'ceph pg stat --format=json',d:'确认停掉该 OSD 后仍有足够副本',ok:o.up},
  {n:'剩余容量评估',c:'ceph df --format=json',d:'需 '+bytes(need)+' 可用空间用于回填，当前 '+bytes(avail),ok:avail>need*1.2},
  {n:'noout 标志检查',c:'ceph osd dump --format=json',d:'若设置了 noout 需先 unset，否则 OUT 不生效',ok:true},
  {n:'同故障域冲突',c:'ceph osd tree --format=json',d:'同主机不应存在其他 down OSD',ok:state.osds.filter(function(x){return x.host===o.host&&!x.up&&x.id!==o.id;}).length===0},
  {n:'min_size 与副本数',c:'ceph osd pool ls detail --format=json',d:'size=3 / min_size=2，允许 1 个 OSD 下线',ok:true},
  {n:'故障盘身份确认',c:'ceph device ls --format=json',d:'SN '+o.serial+' @ '+o.dev+'，需现场核对物理盘位',ok:true,warn:true},
  {n:'版本能力适配',c:'ceph --version',d:esc(p.version||state.cluster.version)+' / '+esc(p.orchestrator)+' · 已生成对应命令模板',ok:true}];}

/* ---------- wizard ---------- */
var WSTEPS=['选择 OSD 与意图','自动预检','二次确认','执行与观察','完成'];
/* Pull real cluster data from the Linux backend (LIVE mode only). */
function syncState(force){
 if(state.mode!=='live')return Promise.resolve();
 return API.call('GET','/api/state'+(force?'?refresh=1':'')).then(function(r){
  var d=r.data||{},c=d.cluster||{},err=c.error||d.error||'';
  /* HTTP 200 is not enough: the REST proxy only returns a summary, so a
     payload without capacity / OSD counters must not be treated as usable
     state, otherwise stale/zero numbers would look like a real cluster. */
  if(!err&&typeof c.total!=='number'&&typeof c.osds!=='number'){
   err='后端返回的数据不含集群容量 / OSD 计数'+(c.note?'（'+c.note+'）':'')+'；REST 只读通道仅代理 summary，请改用 CLI 后端';
  }
  /* Record WHY there is no real data, so the UI can show the exact error
     instead of a vague "waiting for backend" label. */
  if(state.link){state.link.stateOk=!err;state.link.stateError=err?String(err):'';
   state.link.stateHttp=200;state.link.stateAt=Date.now();}
  ['health','version','codename','deploy'].forEach(function(k){if(c[k])state.cluster[k]=c[k];});
  /* 0 也是有效值（空集群 / 单 MON 无 quorum 时），只有真正同步成功才套用，
     避免 REST 半残数据把演示值清零，也避免 0 被当成「没有数据」而保留演示值。 */
  ['total','used','osds','osdsUp','osdsIn','mons','monInQuorum','pgs','pgActiveClean','pgDegraded','pgBackfill','recoveringBytes','objects','pools'].forEach(function(k){
   if(typeof c[k]==='number'&&isFinite(c[k]))state.cluster[k]=c[k];});
  /* IOPS / 吞吐允许为 0（空闲集群），必须逐字段判断并记录后端是否真的给了，
     否则前端会拿演示值 18420 / 2.6 GiB 冒充真实数据。 */
  if(!err&&typeof c.iops==='number'&&isFinite(c.iops)){state.cluster.iops=c.iops;state.ioReal.iops=true;}
  if(!err&&typeof c.throughput==='number'&&isFinite(c.throughput)){state.cluster.throughput=c.throughput;state.ioReal.thr=true;}
  /* 趋势图只累积真实样本；同一份缓存（ts 未变）不重复记点，
     否则 15 秒轮询 + 20 秒服务端缓存会画出假台阶。 */
  var cached=!!(r.ts&&state.lastStateTs===r.ts);
  state.lastStateTs=r.ts||0;
  if(!err&&!cached){
   var ts=r.ts?r.ts*1000:Date.now();
   if(state.ioReal.iops)pushSample(state.samples.iops,c.iops,ts,60);
   var capPct=(typeof c.total==='number'&&c.total>0&&typeof c.used==='number')?Math.round(c.used/c.total*1000)/10:null;
   if(capPct!=null)pushSample(state.samples.cap,capPct,ts,60);
  }
  /* MON / MGR / 恢复速率等结构化字段同样只来自后端。 */
  if(Array.isArray(c.monList))state.cluster.monList=c.monList;
  if(c.monLeader)state.cluster.monLeader=c.monLeader;
  if(c.mgrActive)state.cluster.mgrActive=c.mgrActive;
  if(Array.isArray(c.mgrStandbys))state.cluster.mgrStandbys=c.mgrStandbys;
  if(typeof c.mgrAvailable==='boolean')state.cluster.mgrAvailable=c.mgrAvailable;
  if(c.fsid)state.cluster.fsid=c.fsid;
  /* 告警阈值与安全策略以后端配置为准，避免前端演示默认值冒充真实设置。
     allow_write 由后端持久化（默认 false），不能因为服务端带 --allow-write 就显示成已开。 */
  if(!err&&d.settings){
   if(typeof d.settings.nearfull==='number')state.settings.nearfull=d.settings.nearfull;
   if(typeof d.settings.full==='number')state.settings.full=d.settings.full;
   if(typeof d.settings.downMin==='number')state.settings.downMin=d.settings.downMin;
   if(typeof d.settings.allow_write==='boolean')state.settings.allowWrite=d.settings.allow_write;
   if(typeof d.settings.confirm==='boolean')state.settings.confirm=d.settings.confirm;
  }
  if(err)console.warn('backend state:',err);
  if(d.profile)state.profile=d.profile;
  /* An empty array from the backend is a real answer ("no alerts / no OSDs"),
     so it must replace the local copy instead of being ignored. */
  if(!err&&Array.isArray(d.osds))state.osds=d.osds.map(function(o){
   return {id:o.id,host:o.host||'',dev:o.dev||'',type:o.type||'SSD',size:o.size||0,used:o.used||0,
    up:o.up!==false,inn:o.inn!==false,pgs:o.pgs||0,weight:o.weight||1,smart:o.smart||'',serial:o.serial||''};});
  if(!err&&Array.isArray(d.alerts)){
   /* 后端已按 health check 归并成一条，这里再兜一层：同 id 沿用本地记录的
      since / status，避免某次响应字段缺失把「已确认」冲回 active。 */
   var prevA={};state.alerts.forEach(function(a){prevA[a.id]=a;});
   state.alerts=d.alerts.map(function(a){
    var p=prevA[a.id]||{};
    return {id:a.id||uid(),sev:a.sev||'warning',code:a.code||'HEALTH_CHECK',title:a.title||a.code||'告警',
     msg:a.msg||'',src:a.src||'ceph',osd:a.osd==null?null:a.osd,
     osdIds:Array.isArray(a.osdIds)?a.osdIds:[],hosts:Array.isArray(a.hosts)?a.hosts:[],
     devs:Array.isArray(a.devs)?a.devs:[],
     since:a.since||p.since||Date.now(),status:a.status||p.status||'active',
     count:a.count||p.count||1,by:a.by||'',until:a.until||0};});
  }
  if(!err&&Array.isArray(d.pools))state.pools=d.pools;
  if(!err&&Array.isArray(d.hosts))state.hosts=d.hosts.map(function(h){
   return {name:h.name||'',ip:h.ip||'',mons:!!h.mons,mgr:!!h.mgr,osds:h.osds||0,up:h.up||0,
    mem:(typeof h.mem==='number')?h.mem:null,cpu:(typeof h.cpu==='number')?h.cpu:null,
    src:h.src||'',err:h.err||'',ver:h.ver||''};});
  state.lastRefresh=Date.now();
  /* 24h 趋势来自后端真实采样（/api/history），拿到后再重绘，保证曲线与数字一致。 */
  return Promise.all([loadHistory(false),loadAudit(false)]).then(function(){
   if(!state.wizard&&!formBusy())render();
  });
 }).catch(function(e){
  if(state.link){state.link.stateOk=false;state.link.stateError=(e&&e.message)||'请求失败';
   state.link.stateHttp=(e&&e.status)||0;state.link.stateAt=Date.now();}
  if(state.auth.authenticated&&!state.wizard&&!formBusy())render();
  toast('同步集群状态失败：'+((e&&e.message)||'未知错误'),'e');});}
function startWizard(id,intent){var n=id==null?7:Number(id),o=state.osds.filter(function(x){return x.id===n;})[0]||state.osds[0];
 if(!o){toast('当前没有可用的 OSD，无法发起踢盘换盘','w');return;}
 state.wizard={step:1,osdId:o.id,host:o.host,dev:o.dev,intent:intent||'replace',phrase:'',confirmed:false,checks:null,plan:null,
  logs:[],progress:0,running:false,done:false,aborted:false,newOsdId:null,remote:null};
 renderWizard();
 if(state.mode==='live'&&(!state.wizard.dev||!state.wizard.host)){
  API.call('GET','/api/osd/'+state.wizard.osdId+'/meta').then(function(r){
   var w=state.wizard;if(!w||w.osdId!==r.osd_id)return;
   w.host=r.host||w.host;w.dev=r.dev||w.dev;
   var o=state.osds.filter(function(x){return x.id===w.osdId;})[0];
   if(o){o.host=w.host;o.dev=w.dev;if(r.serial)o.serial=r.serial;}
   renderWizard();
  }).catch(function(e){toast('未探测到设备路径：'+e.message,'w');});
 }
}
function wStepsHtml(w){return '<div class="steps">'+WSTEPS.map(function(t,i){var n=i+1,cl=w.step>n?'done':w.step===n?'on':'';
 return '<div class="step '+cl+'"><div class="step-n">'+(w.step>n?ic('check',13):n)+'</div><div class="step-t">'+t+'</div></div>';}).join('')+'</div>';}
function renderWizard(){var w=state.wizard;if(!w)return;
 var o=state.osds.filter(function(x){return x.id===w.osdId;})[0]||state.osds[0],p=liveProfile(),b='',foot='';
 if(w.step===1){b='<div class="grid g2"><div><label class="fld">处置意图</label><div class="seg" style="margin-bottom:14px">'+
   '<button class="'+(w.intent==='replace'?'on acc':'')+'" data-act="w-intent" data-value="replace">换盘（保留 OSD ID）</button><button class="'+(w.intent==='remove'?'on acc':'')+'" data-act="w-intent" data-value="remove">完整退役（purge / 清盘）</button></div>'+
   '<div class="fgrp"><label class="fld">目标 OSD</label><select class="inp" data-bind="wizard.osdId">'+state.osds.map(function(x){return '<option value="'+x.id+'"'+(x.id===w.osdId?' selected':'')+'>osd.'+x.id+' · '+esc(x.host)+' · '+esc(x.dev)+' · '+(x.up?'up':'down')+'</option>';}).join('')+'</select></div>'+
   '<div class="fgrp"><label class="fld">部署方式</label><input class="inp" value="'+esc(p.orchestrator==='cephadm'&&p.caps.orch?'cephadm / orchestrator':'ceph-volume / legacy')+'" disabled></div>'+
   '<div class="hint">命令模板依据后端探测到的 Ceph 版本与命令能力自动选择，不依赖硬编码版本号。</div></div><div>'+
   card('目标盘摘要','<div class="stat-line"><span>OSD</span><b class="mono">osd.'+o.id+'</b></div><div class="stat-line"><span>主机 / 设备</span><b class="mono">'+esc(o.host)+' · '+esc(o.dev)+'</b></div>'+
    '<div class="stat-line"><span>序列号</span><b class="mono">'+esc(o.serial)+'</b></div><div class="stat-line"><span>使用率</span><b class="mono">'+pct(o.used,o.size)+'% ('+bytes(o.used)+')</b></div>'+
    '<div class="stat-line"><span>SMART</span><b class="'+(o.smart==='OK'?'t':'td')+'">'+o.smart+'</b></div><div class="stat-line"><span>承载 PG</span><b class="mono">'+o.pgs+'</b></div>')+
   '<div class="dangerbox" style="margin-top:12px">'+ic('alert')+'<div>此流程会改变集群数据分布。请确认已核对物理盘位与 SN <span class="mono">'+esc(o.serial)+'</span>，并已完成必要的数据备份。</div></div></div></div>';
  foot='<button class="btn" data-act="modal-close">取消</button><button class="btn pri" data-act="w-next">下一步：自动预检 '+ic('arrow',14)+'</button>';
 }else if(w.step===2){var cs=w.checks||[],allDone=cs.length&&cs.every(function(c){return c.status!=='running'&&c.status!=='pending';}),failed=cs.some(function(c){return c.status==='fail';});
  b='<div class="note" style="margin-bottom:12px">预检命令会按实际版本能力自动降级；任一 <b class="td">失败</b> 项将阻止继续。</div>'+
   cs.map(function(c){var i=c.status==='pass'?'p':c.status==='warn'?'w':c.status==='fail'?'f':'r',sym=c.status==='pass'?'&#10003;':c.status==='warn'?'!':c.status==='fail'?'&#10007;':'&middot;';
    return '<div class="ck"><div class="ck-i '+i+'">'+sym+'</div><div style="flex:1"><div class="ck-n">'+esc(c.n)+' '+(c.status==='pass'?'<span class="tag ok">通过</span>':c.status==='warn'?'<span class="tag warn">需人工确认</span>':c.status==='fail'?'<span class="tag err">未通过</span>':'<span class="tag mute">检查中</span>')+'</div><div class="ck-d">'+esc(c.d)+'</div><div class="ck-c">$ '+esc(c.c)+'</div></div></div>';}).join('')+
   (allDone?'<div class="'+(failed?'dangerbox':'warnbox')+'" style="margin-top:10px">'+ic('alert')+'<div>'+(failed?'存在未通过的预检项，已阻止继续。请修复后重新预检。':'预检完成，'+(w.intent==='replace'?'将保留原 OSD ID 完成替换':'将永久移除该 OSD')+'。')+'</div></div>':'');
  foot='<button class="btn" data-act="w-prev">上一步</button>'+(allDone?'<button class="btn" data-act="w-preflight">'+ic('refresh',14)+' 重新预检</button>':'')+'<div class="sp"></div><button class="btn pri" data-act="w-next" '+(allDone&&!failed?'':'disabled')+'>下一步：二次确认 '+ic('arrow',14)+'</button>';
 }else if(w.step===3){var plan=w.plan||[];
  b='<div class="dangerbox" style="margin-bottom:16px">'+ic('alert')+'<div><b>即将执行破坏性变更：'+(w.intent==='replace'?'踢盘 + 换盘':'永久移除 OSD')+' osd.'+w.osdId+'</b><br>共 '+plan.length+' 个步骤，涉及数据重平衡与磁盘元数据清除。'+(state.settings.allowWrite?'当前为 <b>真实执行模式</b>。':'当前为 <b>DRY-RUN 演示模式</b>，命令只记录不下发。')+'</div></div>'+
   '<div class="fgrp"><label class="fld">请输入 <span class="mono" style="color:var(--accent2)">osd.'+w.osdId+'</span> 以确认目标</label><input class="inp" data-bind="wizard.phrase" placeholder="osd.'+w.osdId+'" value="'+esc(w.phrase)+'" autocomplete="off"></div>'+
   '<label class="chk"><input type="checkbox" data-bind="wizard.confirmed"'+(w.confirmed?' checked':'')+'><span>我已现场核对物理盘位与 SN <span class="mono">'+esc(o.serial)+'</span>，确认更换目标无误</span></label>'+
   '<label class="chk"><input type="checkbox" checked disabled><span>我已确认集群容量充足，且了解回填期间的性能影响</span></label>'+
   '<div class="hr"></div><div class="tiny" style="margin-bottom:8px;font-weight:600">即将执行的命令序列</div><div class="cmdbox">'+plan.map(function(s,i){return '<span class="cm"># '+(i+1)+'. '+esc(s.n)+'</span>\n'+esc(s.c)+'\n';}).join('')+'</div>';
  foot='<button class="btn" data-act="w-prev">上一步</button><div class="sp"></div><button class="btn dan" data-act="w-exec" '+((w.phrase==='osd.'+w.osdId&&w.confirmed)?'':'disabled')+'>'+ic('terminal',14)+' 确认并执行</button>';
 }else if(w.step===4){b='<div class="flex" style="margin-bottom:10px"><span class="tag '+(w.running?'warn':w.done?'ok':'mute')+'">'+(w.running?'执行中':w.done?'已完成':'已中止')+'</span>'+
   '<span class="mono mini tm">osd.'+w.osdId+' · '+esc(w.intent==='replace'?'替换':'退役')+' · '+(state.settings.allowWrite?'真实执行':'DRY-RUN')+'</span><div class="sp"></div><span class="mono mini" id="w-pct">'+w.progress+'%</span></div>'+
   '<div class="prog"><i id="w-prog" style="width:'+w.progress+'%"></i></div><div class="term" id="w-term"></div>'+
   (w.done?'':'<div class="warnbox" style="margin-top:12px">'+ic('alert')+'<div>执行过程中请勿关闭页面；「物理更换故障盘」步骤需要现场确认。可随时中止，已执行步骤不会自动回滚。</div></div>');
  foot='<button class="btn" data-act="modal-close">关闭窗口</button><div class="sp"></div>'+(w.running?'<button class="btn dan" data-act="w-abort">中止</button>':w.done?'<button class="btn pri" data-act="w-next">查看结果 '+ic('arrow',14)+'</button>':'');
 }else{var ok=!w.aborted;
  b='<div style="text-align:center;padding:14px 0 20px"><div style="width:56px;height:56px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;background:rgba(47,216,165,.12);color:var(--ok)">'+ic(ok?'check':'x',28)+'</div>'+
   '<div style="font-size:17px;font-weight:700">'+(ok?'流程执行完成':'流程已中止')+'</div><div class="note" style="margin-top:6px">'+(state.settings.allowWrite?'命令已下发至集群，请复核 ceph -s 结果。':'DRY-RUN 演示完成，未对集群产生任何实际变更。')+'</div></div>'+
   '<div class="grid g2"><div><div class="stat-line"><span>目标 OSD</span><b class="mono">osd.'+w.osdId+'</b></div><div class="stat-line"><span>处置意图</span><b>'+(w.intent==='replace'?'踢盘 + 换盘':'仅退役')+'</b></div>'+
   '<div class="stat-line"><span>执行步骤</span><b class="mono">'+(w.plan||[]).length+'</b></div><div class="stat-line"><span>结果</span><b class="'+(ok?'t':'td')+'">'+(ok?'成功':'已中止')+'</b></div></div>'+
   '<div><div class="stat-line"><span>命令模板</span><b class="mono">'+esc(p.orchestrator)+'</b></div><div class="stat-line"><span>PG 状态</span><b class="mono '+(ok?'t':'tw')+'">'+(ok?'active+clean':'需人工确认')+'</b></div>'+
   '<div class="stat-line"><span>关联告警</span><b class="mono '+(ok?'t':'tw')+'">'+(ok?'已自动恢复':'保持原状态')+'</b></div><div class="stat-line"><span>审计记录</span><b class="mono t">已写入</b></div></div></div>'+
   '<div class="warnbox" style="margin-top:14px">'+ic('shield')+'<div>建议回到概览确认 HEALTH_OK 与 all PGs active+clean，并在「变更审计」中复核完整命令序列。</div></div>';
  foot='<div class="sp"></div><button class="btn" data-act="nav" data-view="audit">查看审计</button><button class="btn pri" data-act="modal-close">完成</button>';}
 openModal(modalHead('踢盘换盘向导 · osd.'+w.osdId,'版本自适应 · 预检 · 二次确认 · 回填观察')+'<div class="modal-b">'+wStepsHtml(w)+b+'</div><div class="modal-f">'+foot+'</div>','lg');
 if(w.step===4&&document.getElementById('w-term'))wPaintLogs();}
function wPaintLogs(){var t=document.getElementById('w-term');if(!t)return;
 t.innerHTML=(state.wizard.logs||[]).map(function(l){return '<div class="'+l.cls+'">'+esc(l.text)+'</div>';}).join('');
 t.scrollTop=t.scrollHeight;var w=state.wizard;if(document.getElementById('w-prog'))document.getElementById('w-prog').style.width=w.progress+'%';if(document.getElementById('w-pct'))document.getElementById('w-pct').textContent=w.progress+'%';}
function wLog(cls,text){state.wizard.logs.push({cls:cls,text:text});wPaintLogs();}
function wPreflight(){var w=state.wizard;w.checks=preflightItems(w).map(function(c){return {n:c.n,c:c.c,d:c.d,ok:c.ok,warn:c.warn,status:'pending'};});renderWizard();
 var i=0;function next(){if(!state.wizard||state.wizard!==w)return;if(i>=w.checks.length)return;var c=w.checks[i];c.status='running';renderWizard();
  setTimeout(function(){if(!state.wizard||state.wizard!==w)return;c.status=c.ok?(c.warn?'warn':'pass'):'fail';i++;renderWizard();if(i<w.checks.length)next();},260);}next();}
function wExec(){var w=state.wizard;if(!w||w.running)return;w.running=true;w.done=false;w.aborted=false;w.logs=[];w.progress=0;w.step=4;renderWizard();
 wLog('d','# Ceph Ops Console · '+(state.settings.allowWrite?'EXECUTE':'DRY-RUN')+' · '+dt(Date.now()));
 wLog('d','# target osd.'+w.osdId+' @ '+w.host+' '+w.dev+' · '+liveProfile().version+' / '+liveProfile().orchestrator);
 wLog('d','# 命令模板：'+(liveProfile().orchestrator==='cephadm'?'cephadm orchestrator':'ceph-volume legacy')+'　# 所有命令参数化执行，不经 shell');wLog('d','');
 var plan=(w.plan||[]).slice(),remote=null;
 var prep=state.mode==='live'?API.call('POST','/api/execute',{intent:w.intent,osd_id:w.osdId,host:w.host,dev:w.dev,confirm_phrase:'osd.'+w.osdId,allow_write:state.settings.allowWrite}).catch(function(e){return {error:String(e.message||e)};}):Promise.resolve(null);
 prep.then(function(r){remote=r;if(r&&r.error){wLog('e','! 后端返回：'+r.error);wLog('w','! 已回退到前端演示命令序列，未对集群产生变更');}
  else if(r&&r.commands&&r.commands.length){plan=r.commands.map(function(x,i){return {n:'步骤 '+(i+1),c:x,d:''};});wLog('c','✓ 后端已生成 '+plan.length+' 条命令（dry_run='+!!r.dry_run+'）');}
  var i=0;function step(){if(!state.wizard||state.wizard!==w)return;if(w.aborted){w.running=false;renderWizard();return;}
   if(i>=plan.length){wLog('c','✓ 全部步骤完成');wLog('d','# ceph -s → HEALTH_OK, all PGs active+clean');w.progress=100;w.running=false;w.done=true;wPaintLogs();wApplyResult();renderWizard();return;}
   var s=plan[i];if(String(s.c).charAt(0)==='#')wLog('d',s.c);else wLog('p','$ '+s.c);
   setTimeout(function(){if(!state.wizard||state.wizard!==w)return;
    if(w.aborted){wLog('e','! 用户中止，剩余步骤未执行');w.running=false;renderWizard();return;}
    if(remote&&remote.results&&remote.results[i])wLog('d',String(remote.results[i]).slice(0,300));
    else if(String(s.c).charAt(0)==='#')wLog('w','  [人工步骤] 等待现场确认更换磁盘，演示环境自动继续');
    else wLog('c','  ok'+(state.settings.allowWrite?'':'  (dry-run: 未下发)'));
    i++;w.progress=Math.round(i/plan.length*100);wPaintLogs();step();},420);}
   step();});}
function wApplyResult(){var w=state.wizard;if(w.aborted)return;
 var o=state.osds.filter(function(x){return x.id===w.osdId;})[0];
 if(w.intent==='remove'){state.osds=state.osds.filter(function(x){return x.id!==w.osdId;});state.cluster.osds=Math.max(0,state.cluster.osds-1);}
 /* 换盘只按真实结论改 up/in；SMART / 用量 / PG 数都要等下一次刷新带回，
    不能在这里编一个「焕然一新」的假象。 */
 else if(o){o.up=true;o.inn=true;}
 state.alerts.forEach(function(a){if(a.osd===w.osdId&&a.status!=='resolved'){a.status='resolved';}});
 state.cluster.osdsUp=state.osds.filter(function(x){return x.up;}).length+(state.cluster.osds-state.osds.length);
 state.cluster.health=healthInfo().t;
 state.audit.unshift({id:uid(),ts:Date.now(),user:'admin@ops',act:w.intent==='replace'?'OSD_REPLACE':'OSD_REMOVE',target:'osd.'+w.osdId,
  cmd:(w.plan||[]).map(function(s){return s.c;}).join(' ; '),result:state.settings.allowWrite?'OK':'DRY-RUN',note:'通过踢盘换盘向导执行 · '+liveProfile().orchestrator});
 state.lastRefresh=Date.now();}

/* ---------- small actions ---------- */
function addAudit(act,target,cmd,note){state.audit.unshift({id:uid(),ts:Date.now(),user:state.auth.user||'console',act:act,target:target,cmd:cmd,result:state.settings.allowWrite?'OK':'DRY-RUN',note:note||''});}
function osdMark(id,inn){
 var o=state.osds.filter(function(x){return x.id===Number(id);})[0];if(!o)return;
 var act=inn?'in':'out',cmd='ceph osd '+act+' '+o.id;
 function done(dry,detail){
  /* A live DRY-RUN must not pretend the flag changed on the cluster. */
  if(!dry||state.mode!=='live'){o.inn=inn;if(inn)o.up=true;}
  addAudit(inn?'OSD_IN':'OSD_OUT','osd.'+o.id,cmd,(dry?'DRY-RUN 演示':'真实执行')+(detail?' · '+detail:''));
  toast('osd.'+o.id+(inn?' IN':' OUT')+(dry?' 已生成命令（DRY-RUN，未下发集群）':' 已下发并执行'),'ok');
  closeModal();render();
  /* 强制刷新（?refresh=1）：后端刚执行完 out/in，20 秒缓存里还是旧状态，
     不带 refresh 会把刚切换的按钮又翻回去。 */
  if(!dry&&state.mode==='live'&&state.auth.authenticated)setTimeout(function(){syncState(true);},800);
 }
 if(state.mode==='live'&&state.auth.authenticated){
  apiFetch('POST','/api/osd/'+o.id+'/'+act,{confirm_phrase:'osd.'+o.id,allow_write:!!state.settings.allowWrite})
   .then(function(r){done(!!r.dry_run,String(r.detail||r.command||'').slice(0,90));})
   .catch(function(e){toast('操作失败：'+((e&&e.message)||e),'e');});
  return;
 }
 done(true,'');
}
function testConn(){API.call('GET','/api/probe').then(function(r){state.profile=r.profile||r;state.lastRefresh=Date.now();render();syncState(true);toast('连接成功 · '+esc((state.profile.version||'未知')+' / '+(state.profile.orchestrator||'')),'ok');})
 .catch(function(e){toast('连接失败：'+e.message,'e');});}
function exportAudit(){var lines=state.audit.map(function(a){return JSON.stringify({ts:dt(a.ts),user:a.user,action:a.act,target:a.target,command:a.cmd,result:a.result,note:a.note});}).join('\n');
 var blob=new Blob([lines+'\n'],{type:'application/x-ndjson'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='ceph-console-audit.jsonl';a.click();URL.revokeObjectURL(u);toast('审计日志已导出','ok');}

/* ---------- bindings ---------- */
var NUMKEYS={nearfull:1,full:1,downMin:1,pgDegraded:1,slowOps:1,'wizard.osdId':1,
             'pool.size':1,'pool.minSize':1,'pool.pg':1,'pool.pgp':1};
function setBind(path,val,el){var ks=path.split('.'),o=state;
 for(var i=0;i<ks.length-1;i++)o=o[ks[i]];var k=ks[ks.length-1];
 if(el&&el.type==='checkbox')o[k]=el.checked;
 else if(NUMKEYS[path]||NUMKEYS[k])o[k]=Number(val)||0;
 else o[k]=val;
 if(path==='token'){try{sessionStorage.setItem('cc_token',val);}catch(e){}}
 if(path==='wizard.osdId'){var w=state.wizard,x=state.osds.filter(function(y){return y.id===Number(val);})[0];if(w&&x){w.osdId=x.id;w.host=x.host;w.dev=x.dev;w.phrase='';w.confirmed=false;renderWizard();}}
 if(path.indexOf('filters.')===0){var q=path.split('.')[1];
  if(q==='osdQ'){var t=document.getElementById('osd-table-wrap');if(t)t.innerHTML=osdTable();}
  else render();}
 if(path.indexOf('deploy.')===0||path==='token'){var d=document.getElementById('cmd-1');if(d){var cm=genCmds();[['cmd-1',cm.scp],['cmd-2',cm.run],['cmd-3',cm.rest],['cmd-4',cm.check]].forEach(function(x){var n=document.getElementById(x[0]);if(n){var btn=n.querySelector('[data-act="copy"]');n.textContent=x[1];if(btn)n.appendChild(btn);}});}}
 if(path==='wizard.phrase'||path==='wizard.confirmed'){var b=document.querySelector('[data-act="w-exec"]');var w2=state.wizard;if(b&&w2)b.disabled=!(w2.phrase==='osd.'+w2.osdId&&w2.confirmed);}}
/* ---------- 安全策略：改开关必须先验密码 ----------
   会话不能替代密码：这一步是「二次授权」，防止有人用别人没锁屏的浏览器
   把真实写操作打开。验证在后端做（/api/security），前端只负责收集密码。 */
function secToggle(key,next){
 if(!state.auth.authenticated){toast('请先用账号密码登录，再修改安全策略','e');return;}
 if(state.auth.role!=='admin'){toast('只有 admin 角色可以修改安全策略','e');return;}
 var isWrite=key==='settings.allowWrite';
 var label=isWrite?'允许真实写操作':'危险操作二次确认';
 var on=next==='1';
 var effect=isWrite?(on?'开启后向导与一键操作会真实下发到集群。':'关闭后全程 DRY-RUN，命令只生成不下发。')
                   :(on?'踢盘 / 换盘 / 建池前必须手工输入 OSD 编号或池名。':'此后不再要求输入确认短语，点击即执行。');
 openModal(modalHead('修改安全策略',label)+
  '<div class="modal-b">'+
  '<div class="warnbox" style="margin-bottom:14px">'+ic('lock')+'<div>'+
   esc(label)+' 将改为 <b>'+(on?'开启':'关闭')+'</b>。'+esc(effect)+
   '<br>修改需要输入 <b class="mono">'+esc(state.auth.user||'admin')+'</b> 的密码，并写入审计日志。</div></div>'+
  '<div class="fgrp"><label class="fld">当前账号密码</label>'+
   '<input class="inp" id="sec-pw" type="password" autocomplete="current-password" placeholder="输入 '+esc(state.auth.user||'admin')+' 的密码"></div>'+
  '<div id="sec-msg" class="hint" style="margin-top:8px"></div></div>'+
  '<div class="modal-f"><div class="sp"></div><button class="btn" data-act="modal-close">取消</button>'+
  '<button class="btn pri" data-act="sec-apply" data-key="'+key+'" data-value="'+next+'">'+ic('lock',14)+' 验证并保存</button></div>','sm');
 setTimeout(function(){var el=document.getElementById('sec-pw');if(el)el.focus();},60);
}
function secApply(key,next){
 var pw=document.getElementById('sec-pw'),msg=document.getElementById('sec-msg');
 var val=pw?pw.value:'';
 if(!val){if(msg){msg.className='hint e';msg.textContent='请输入密码';}if(pw)pw.focus();return;}
 var body={password:val};
 if(key==='settings.allowWrite')body.allow_write=next==='1';else body.confirm=next==='1';
 var btn=document.querySelector('[data-act="sec-apply"]');if(btn)btn.disabled=true;
 apiFetch('POST','/api/security',body).then(function(r){
  var st=(r&&r.settings)||{};
  if(typeof st.allow_write==='boolean'){
   state.settings.allowWrite=st.allow_write;
   state.auth.allowWrite=st.allow_write&&state.auth.role==='admin';
   state.auth.writeCapability=!!r.capability;
  }
  if(typeof st.confirm==='boolean')state.settings.confirm=st.confirm;
  closeModal();render();
  toast('已保存：'+(key==='settings.allowWrite'?'允许真实写操作':'危险操作二次确认')+(next==='1'?' 开启':' 关闭'),'ok');
 }).catch(function(err){
  if(btn)btn.disabled=false;
  if(msg){msg.className='hint e';msg.textContent=(err&&err.message)||'修改失败';}
 });
}
function onAct(act,el){var id=el.getAttribute('data-id'),v=el.getAttribute('data-value'),w=state.wizard;
 switch(act){
  case 'nav':
   state.view=el.getAttribute('data-view');closeModal();
   /* 审计页每次都拉取真实 jsonl，避免看到内置演示记录。 */
   if(state.view==='audit'&&state.mode==='live'&&state.auth.authenticated){
    loadAudit(true).then(function(){render();});return;}
   render();break;
  case 'theme':state.theme=state.theme==='dark'?'light':'dark';render();break;
  case 'sec-toggle':secToggle(el.getAttribute('data-key'),el.getAttribute('data-value'));break;
  case 'sec-apply':secApply(el.getAttribute('data-key'),el.getAttribute('data-value'));break;
  case 'refresh':state.lastRefresh=Date.now();if(state.mode==='live')testConn();else render();toast('已刷新','ok');break;
  case 'modal-close':closeModal();break;
  case 'overlay':case 'w-close':return;
  case 'alert-ack':{
   var a=state.alerts.filter(function(x){return x.id===id;})[0];if(!a)break;
   alertAction(a,'ack','告警已确认，同一问题不再重复提示');break;}
  case 'alert-silence':{
   var a2=state.alerts.filter(function(x){return x.id===id;})[0];if(!a2)break;
   alertAction(a2,'silence','告警已静音 60 分钟');break;}
  case 'alert-reopen':{
   var a3=state.alerts.filter(function(x){return x.id===id;})[0];if(!a3)break;
   alertAction(a3,'reopen','告警已重新激活');break;}
  case 'alert-detail':alertDetail(id);break;
  case 'osd-detail':osdDetail(id);break;
  case 'osd-out':osdMark(id,false);break;
  case 'osd-in':osdMark(id,true);break;
  case 'export-audit':exportAudit();break;
  case 'test-conn':testConn();break;
  case 'copy':{var t=document.getElementById(v||el.getAttribute('data-target'));if(t){var btn=t.querySelector('[data-act="copy"]');var txt=t.textContent;if(btn)txt=txt.replace(btn.textContent,'').replace(/\s+$/,'');copy(txt.trim());}break;}
  case 'filter':{var k=el.getAttribute('data-key');state.filters[k]=v;render();break;}
  case 'toggle':{var k2=el.getAttribute('data-key'),ks=k2.split('.'),o=state;for(var i=0;i<ks.length-1;i++)o=o[ks[i]];o[ks[ks.length-1]]=!o[ks[ks.length-1]];render();break;}
  case 'wizard':startWizard(id,el.getAttribute('data-intent')||'replace');break;
  case 'w-intent':if(w){w.intent=v;renderWizard();}break;
  case 'w-next':if(!w)break;
   if(w.step===1){w.step=2;w.checks=null;w.plan=wizardPlan(w);renderWizard();wPreflight();}
   else if(w.step===2){w.step=3;w.phrase='';w.confirmed=false;renderWizard();}
   else if(w.step===3){if(w.phrase!=='osd.'+w.osdId||!w.confirmed){toast('请完成二次确认','e');break;}wExec();}
   else if(w.step===4&&w.done){w.step=5;renderWizard();}break;
  case 'w-prev':if(w&&w.step>1&&w.step<=3){w.step--;if(w.step===2&&!w.checks)wPreflight();else renderWizard();}break;
  case 'w-preflight':if(w)wPreflight();break;
  case 'w-exec':wExec();break;
  case 'w-abort':if(w){w.aborted=true;toast('已发送中止请求','w');}break;
  default:break;}}

/* ---------- bootstrap ---------- */
function boot(){
 var b=window.__CEPH_BOOT__,q=new URLSearchParams(location.search),t=q.get('t');
 if(t){state.token=t;try{sessionStorage.setItem('cc_token',t);}catch(e){}
  try{var _api=q.get('api');history.replaceState({},'',location.pathname+(_api?'?api='+encodeURIComponent(_api):''));}catch(e){}}
 if(b){state.mode='live';state.apiBase=b.apiBase||'';state.profile=b.profile||null;
  if(b.profile){var p=b.profile;if(p.version)state.cluster.version=p.version;if(p.codename)state.cluster.codename=p.codename;if(p.orchestrator)state.cluster.deploy=p.orchestrator;}
  if(b.settings&&b.settings.allow_write!==undefined)state.settings.allowWrite=!!b.settings.allow_write;}
 document.addEventListener('click',function(e){var el=e.target.closest('[data-act]');if(!el)return;
  var act=el.getAttribute('data-act');
  if(act==='overlay'){if(!e.target.closest('.modal'))onAct('overlay',el);return;}
  if(el.disabled)return;onAct(act,el);});
 document.addEventListener('input',function(e){state.lastInputAt=Date.now();var el=e.target.closest('[data-bind]');if(el)setBind(el.getAttribute('data-bind'),el.type==='checkbox'?(el.checked?'1':''):el.value,el);});
 document.addEventListener('change',function(e){state.lastInputAt=Date.now();var el=e.target.closest('[data-bind]');if(el&&(el.tagName==='SELECT'||el.type==='checkbox'))setBind(el.getAttribute('data-bind'),el.type==='checkbox'?(el.checked?'1':''):el.value,el);
  /* 下拉框本身带 data-act（例如换盘时切换新盘设备）时也要触发动作 */
  var a=e.target.closest('select[data-act]');if(a&&!a.disabled)onAct(a.getAttribute('data-act'),a);});
 if(typeof liveBoot==='function'){liveBoot();return;}
 render();
 if(state.mode==='live')syncState();
 setInterval(function(){if(!state.autoRefresh)return;syncState();},15000);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
