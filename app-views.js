/* Ceph Ops Console - views: alerts / osds / pools / hosts / audit / deploy / settings */
'use strict';
function sevTag(s){return s==='critical'?'<span class="tag err">严重</span>':s==='warning'?'<span class="tag warn">警告</span>':'<span class="tag info">提示</span>';}
function stTag(s){return {active:'<span class="tag err">活跃</span>',acked:'<span class="tag warn">已确认</span>',silenced:'<span class="tag mute">已静音</span>',resolved:'<span class="tag ok">已恢复</span>'}[s]||'';}
function alertRow(a,compact){var cls=a.sev==='critical'?'c':a.sev==='warning'?'w':'i';
 return '<div class="alert-i"><div class="alert-ic '+cls+'">'+ic(a.sev==='info'?'info':'alert')+'</div><div style="flex:1;min-width:0"><div class="alert-tt">'+sevTag(a.sev)+esc(a.title)+stTag(a.status)+'</div>'+
  (compact?'':'<div class="alert-ms">'+esc(a.msg)+'</div>')+'<div class="alert-meta"><span class="mono">'+a.id+'</span><span>'+esc(a.code)+'</span><span>'+esc(a.src)+'</span><span>'+ago(a.since)+'</span><span>触发 '+a.count+' 次</span></div></div>'+
  (compact?'':'<div style="display:flex;gap:5px;align-items:flex-start;flex-wrap:wrap;justify-content:flex-end">'+(a.status==='active'?'<button class="btn sm" data-act="alert-ack" data-id="'+a.id+'">确认</button>':'')+
   (a.status==='active'||a.status==='acked'?'<button class="btn sm" data-act="alert-silence" data-id="'+a.id+'">静音</button>':'')+'<button class="btn sm" data-act="alert-detail" data-id="'+a.id+'">详情</button>'+
   (a.osd!=null?'<button class="qbtn kick" data-act="q-open" data-kind="kick" data-id="'+a.osd+'">'+ic('trash',12)+'一键踢盘</button>'+
    '<button class="qbtn" data-act="q-open" data-kind="replace" title="坏盘换新盘：新盘装回原盘位，重建后 OSD 编号不变" data-id="'+a.osd+'">'+ic('zap',12)+'一键换盘</button>':'')+'</div>')+'</div>';}
function vAlerts(){var f=state.filters;
 var list=state.alerts.filter(function(a){if(f.alertSev!=='all'&&a.sev!==f.alertSev)return false;if(f.alertStatus!=='all'&&a.status!==f.alertStatus)return false;
  if(f.alertQ&&(a.title+a.msg+a.code+a.src+a.id).toLowerCase().indexOf(f.alertQ.toLowerCase())<0)return false;return true;});
 var c=state.alerts.filter(function(a){return a.sev==='critical'&&a.status!=='resolved';}).length,w=state.alerts.filter(function(a){return a.sev==='warning'&&a.status!=='resolved';}).length,i=state.alerts.filter(function(a){return a.sev==='info'&&a.status!=='resolved';}).length;
 var filter='<div class="flex" style="gap:9px;flex-wrap:wrap;margin-bottom:14px"><div class="seg">'+[['all','全部'],['critical','严重 '+c],['warning','警告 '+w],['info','提示 '+i]].map(function(x){return '<button class="'+(f.alertSev===x[0]?'on acc':'')+'" data-act="filter" data-key="alertSev" data-value="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>'+
  '<select class="inp" style="width:130px" data-bind="filters.alertStatus"><option value="all"'+(f.alertStatus==='all'?' selected':'')+'>全部状态</option><option value="active"'+(f.alertStatus==='active'?' selected':'')+'>活跃</option><option value="acked"'+(f.alertStatus==='acked'?' selected':'')+'>已确认</option><option value="silenced"'+(f.alertStatus==='silenced'?' selected':'')+'>已静音</option><option value="resolved"'+(f.alertStatus==='resolved'?' selected':'')+'>已恢复</option></select>'+
  '<input class="inp" style="width:220px" placeholder="搜索告警 / 代码 / 资源…" value="'+esc(f.alertQ)+'" data-bind="filters.alertQ"><div class="sp"></div><span class="tiny">共 '+list.length+' 条</span></div>';
 var s=state.settings,rules=[['OSD_NEARFULL','单盘使用率','≥ '+s.nearfull+' %','warning','每 60s 评估 osd df'],['OSD_FULL','单盘使用率','≥ '+s.full+' %','critical','触发前自动锁写入保护'],
  ['OSD_DOWN','OSD 心跳丢失','≥ '+s.downMin+' 分钟','critical','排除设置了 noout 的维护窗口'],['PG_DEGRADED','degraded PG 数','≥ '+s.pgDegraded,'warning','与 OSD_DOWN 关联去重'],
  ['SLOW_OPS','慢请求提交延迟','≥ '+s.slowOps+' ms','warning','取 osd perf 最大值'],['SMART_FAIL','SMART 预失效','任意 FAIL','critical','来源 ceph device ls / smartctl']];
 var ruleTbl='<div class="tbl-wrap"><table class="matrix"><thead><tr><th>规则</th><th>指标</th><th>阈值</th><th>级别</th><th>说明</th></tr></thead><tbody>'+rules.map(function(r){return '<tr><td class="mono">'+r[0]+'</td><td>'+r[1]+'</td><td class="mono">'+r[2]+'</td><td>'+(r[3]==='critical'?'<span class="tag err">严重</span>':'<span class="tag warn">警告</span>')+'</td><td class="tm">'+r[4]+'</td></tr>';}).join('')+'</tbody></table></div>';
 var notify=[['notifyWebhook','Webhook','通用 HTTP 回调，支持任意告警平台'],['notifyMail','邮件','SMTP 投递到运维组'],['notifyWecom','企业微信机器人','群机器人 Webhook'],['notifyDing','钉钉机器人','支持加签校验']];
 var resolved=state.alerts.filter(function(a){return a.status==='resolved';}).length;
 var statsHtml='<div class="grid g4" style="margin-bottom:14px">'+
  [['严重告警',c,'td','alert'],['警告',w,'tw','alert'],['提示',i,'ti','info'],['已恢复',resolved,'t','check']].map(function(x){
   return '<div class="qstat">'+ic(x[3],20)+'<div><div class="v '+x[2]+'">'+x[1]+'</div><div class="l">'+x[0]+'</div></div></div>';}).join('')+'</div>';
 var faultAlerts=state.alerts.filter(function(a){return a.osd!=null&&a.status!=='resolved'&&(a.sev==='critical'||a.code==='SMART_FAIL'||a.code==='OSD_DOWN');});
 var faultCard=faultAlerts.length?card('待处置故障盘 · 从告警页直接一键操作',
  faultAlerts.slice(0,6).map(function(a){var o=state.osds.filter(function(x){return x.id===a.osd;})[0]||{};
   return '<div class="stat-line"><span>'+sevTag(a.sev)+' <b class="mono">osd.'+a.osd+'</b> <span class="tm">'+esc(o.host||'')+' · '+esc(o.dev||'')+' · '+esc(a.title)+'</span></span>'+
   '<span class="btn-row" style="flex-wrap:nowrap"><button class="qbtn kick" data-act="q-open" data-kind="kick" data-id="'+a.osd+'">'+ic('trash',12)+'一键踢盘</button>'+
   '<button class="qbtn" data-act="q-open" data-kind="replace" title="坏盘换新盘：新盘装回原盘位，重建后 OSD 编号不变" data-id="'+a.osd+'">'+ic('zap',12)+'一键换盘</button></span></div>';}).join(''),
  '<span class="tag err">'+faultAlerts.length+' 块待处置</span>',false):'';
 var nh=notify.map(function(n){return '<div class="setrow"><div><div class="l">'+n[1]+'</div><div class="d">'+n[2]+'</div></div><button class="switch '+(state.settings[n[0]]?'on':'')+'" data-act="toggle" data-key="settings.'+n[0]+'"></button></div>';}).join('');
 return pageH('告警中心 · 查看与处置','实时监控告警 · 分级查看 / 确认 / 静音 · 一键踢盘换盘','<button class="btn" data-act="refresh">'+ic('refresh',14)+' 刷新告警</button><button class="btn pri" data-act="nav" data-view="settings">'+ic('settings',14)+' 阈值设置</button>')+
   statsHtml+faultCard+filter+card('告警列表',list.length?list.map(function(a){return alertRow(a);}).join(''):'<div class="empty">当前筛选条件下没有告警</div>','',false)+
  '<div class="grid g2" style="margin-top:14px">'+card('告警规则',ruleTbl,'',false)+card('通知渠道',nh+'<div class="fgrp" style="margin-top:14px"><label class="fld">Webhook 地址</label><input class="inp" data-bind="settings.webhook" value="'+esc(state.settings.webhook)+'" placeholder="https://alert.example.com/hook"></div>')+'</div>';}

/* ---- OSD ---- */
function osdStatus(o){if(!o.up&&!o.inn)return {t:'down / out',c:'err'};if(!o.up)return {t:'down / in',c:'err'};if(!o.inn)return {t:'up / out',c:'warn'};return {t:'up / in',c:'ok'};}
function hostIp(h){if(!h)return '';var r=(state.hosts||[]).filter(function(x){return x.name===h;})[0];return (r&&r.ip)||'';}
/* 服务器列：主机名 + IP，保证能定位到具体机器；后端没给就说明未采集。 */
function hostCell(h){
 if(!h)return '<span class="tag mute" title="后端未采集主机名">未采集</span>';
 var ip=hostIp(h);
 return '<span class="mono">'+esc(h)+'</span>'+(ip?'<div class="tiny mono" style="color:var(--faint)">'+esc(ip)+'</div>':'');
}
/* 设备列：只显示后端按 osd id 精确映射到的真实设备，拿不到就显示未采集。 */
function devCell(d){
 if(!d)return '<span class="tag mute" title="后端未采集设备名">未采集</span>';
 return '<span class="mono">'+esc(d)+'</span>';
}
function osdRow(o){var s=osdStatus(o),hasCap=o.size>0,p=pct(o.used,o.size),pc=p>=85?'var(--danger)':p>=75?'var(--warn)':'var(--ok)';
 return '<tr><td class="mono"><b>osd.'+o.id+'</b></td><td>'+hostCell(o.host)+'</td><td>'+devCell(o.dev)+'</td><td>'+(o.type?'<span class="tag mute">'+esc(o.type)+'</span>':'<span class="tag mute" title="osd df 尚未统计该 OSD">未采集</span>')+'</td><td class="mono">'+(hasCap?bytes(o.size):'—')+'</td>'+
  '<td style="min-width:130px">'+(hasCap?'<div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+p+'%;background:'+pc+'"></i></div><span class="mono mini" style="width:32px;text-align:right;color:'+pc+'">'+p+'%</span></div>':'<span class="mono mini" title="osd df 尚未统计该 OSD">—</span>')+'</td>'+
  '<td><span class="tag '+s.c+'"><span class="dot '+(s.c==='err'?'err':s.c==='warn'?'warn':'ok')+'"></span>'+s.t+'</span></td><td class="mono mini">'+o.pgs+'</td>'+
  '<td>'+(o.smart==='OK'?'<span class="tag ok">OK</span>':o.smart==='WARN'?'<span class="tag warn">WARN</span>':o.smart==='FAIL'?'<span class="tag err">FAIL</span>':'<span class="tag mute" title="后端未采集 SMART">未采集</span>')+'</td>'+
 '<td><div class="btn-row" style="flex-wrap:nowrap;gap:5px"><button class="btn sm" data-act="osd-detail" data-id="'+o.id+'">详情</button>'+
 (o.inn?'<button class="btn sm" data-act="osd-out" data-id="'+o.id+'">OUT</button>':'<button class="btn sm" data-act="osd-in" data-id="'+o.id+'">IN</button>')+
 '<button class="qbtn kick" data-act="q-open" data-kind="kick" data-id="'+o.id+'">'+ic('trash',12)+'一键踢盘</button>'+
 '<button class="qbtn" data-act="q-open" data-kind="replace" title="坏盘换新盘：新盘装回原盘位，重建后 OSD 编号不变" data-id="'+o.id+'">'+ic('zap',12)+'一键换盘</button></div></td></tr>';}
function osdTable(){var f=state.filters,list=state.osds.filter(function(o){
  if(f.osdStatus==='down'&&o.up)return false;if(f.osdStatus==='out'&&o.inn)return false;if(f.osdStatus==='nearfull'&&pct(o.used,o.size)<85)return false;
  if(f.osdStatus==='smart'&&o.smart!=='FAIL'&&o.smart!=='WARN')return false;if(f.osdQ&&(('osd.'+o.id)+o.host+o.dev+o.type+o.serial+hostIp(o.host)).toLowerCase().indexOf(f.osdQ.toLowerCase())<0)return false;return true;});
 return '<div class="tbl-wrap"><table><thead><tr><th>OSD</th><th>服务器</th><th>设备</th><th>介质</th><th>容量</th><th>使用率</th><th>状态</th><th>PG</th><th>SMART</th><th>操作</th></tr></thead><tbody>'+
  (list.length?list.map(osdRow).join(''):'<tr><td colspan="10"><div class="empty">没有匹配的 OSD</div></td></tr>')+'</tbody></table></div>';}
function vOsds(){var f=state.filters,down=state.osds.filter(function(o){return !o.up;}).length,out=state.osds.filter(function(o){return !o.inn;}).length,
 nf=state.osds.filter(function(o){return pct(o.used,o.size)>=85;}).length,sm=state.osds.filter(function(o){return o.smart==='FAIL'||o.smart==='WARN';}).length,p=liveProfile();
 var filter='<div class="flex" style="gap:9px;flex-wrap:wrap;margin-bottom:14px"><div class="seg">'+[['all','全部 '+state.osds.length],['down','Down '+down],['out','Out '+out],['nearfull','近满 '+nf],['smart','SMART 异常 '+sm]].map(function(x){return '<button class="'+(f.osdStatus===x[0]?'on acc':'')+'" data-act="filter" data-key="osdStatus" data-value="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>'+
  '<input class="inp" style="width:250px" placeholder="搜索 OSD / 主机 / 设备 / SN…" value="'+esc(f.osdQ)+'" data-bind="filters.osdQ"><div class="sp"></div><button class="btn" data-act="q-open" data-kind="init" title="额外插入一块盘做扩容：会新增一个 OSD 编号">'+ic('layers',14)+' 新增磁盘</button><button class="btn pri" data-act="wizard" data-intent="replace">'+ic('wrench',14)+' 踢盘换盘向导</button></div>';
 var fO=faultOsd();
 var quickBar=fO?'<div class="card" style="margin-bottom:14px"><div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
  '<div><div class="tiny">检测到待处置磁盘</div><div style="font-size:14px;font-weight:650" class="mono">osd.'+fO.id+' · '+esc(fO.host||'—')+' · '+esc(fO.dev||'—')+'</div>'+
  '<div class="tiny">'+(fO.smart==='FAIL'?'SMART FAIL':fO.smart==='WARN'?'SMART WARN':'磁盘状态异常（'+(fO.up?'up':'down')+' / '+(fO.inn?'in':'out')+'）')+' · SN '+esc(fO.serial||'未采集')+'</div></div><div class="sp"></div>'+
  '<button class="qbtn kick lg" data-act="q-open" data-kind="kick" data-id="'+fO.id+'">'+ic('trash',14)+'一键踢盘</button>'+
  '<button class="qbtn lg" data-act="q-open" data-kind="replace" title="坏盘换新盘：新盘装回原盘位，重建后 OSD 编号不变" data-id="'+fO.id+'">'+ic('zap',14)+'一键换盘</button>'+
  '<button class="btn" data-act="wizard" data-id="'+fO.id+'" data-intent="replace">'+ic('wrench',14)+' 高级向导</button></div></div>':'';
 return pageH('OSD / 磁盘管理','一键踢盘（停服务 + DOWN + OUT）／一键换盘（坏盘换新盘，OSD 编号不变）／新增磁盘（扩容，新编号）')+quickBar+filter+
  card('OSD 列表','<div id="osd-table-wrap">'+osdTable()+'</div>','<span class="tag info">共 '+state.osds.length+' 台</span>',false)+
  '<div style="margin-top:14px">'+card('版本命令适配','<div class="grid g2" style="gap:0 34px">'+
   '<div class="stat-line"><span>编排器</span><b class="mono tp">'+esc(p.orchestrator)+'</b></div>'+
   '<div class="stat-line"><span>osd purge</span><b class="mono '+(p.caps.purge?'t':'td')+'">'+(p.caps.purge?'可用':'不可用 → 三步式移除')+'</b></div>'+
   '<div class="stat-line"><span>ok-to-stop</span><b class="mono '+(p.caps.ok_to_stop?'t':'tw')+'">'+(p.caps.ok_to_stop?'可用':'降级为 PG 冗余检查')+'</b></div>'+
   '<div class="stat-line"><span>orch osd rm --replace</span><b class="mono '+(p.caps.orch?'t':'td')+'">'+(p.caps.orch?'可用':'不可用 → ceph-volume')+'</b></div></div>')+'</div>';}

/* ---- pools / hosts / audit ---- */
function sizeRange(key,onlyType){
 /* EC 池的 size 是 k+m，和副本数不是一个量纲，不混在一起统计 */
 var src=state.pools;
 if(onlyType){
  var f=src.filter(function(p){return p.type===onlyType;});
  if(f.length)src=f;
 }
 var xs=src.map(function(p){return p[key];}).filter(function(v){return typeof v==='number';});
 if(!xs.length)return '—';
 var mn=Math.min.apply(null,xs),mx=Math.max.apply(null,xs);
 return mn===mx?String(mn):mn+' ~ '+mx;
}
/* 容量增长只从后端真实采样算，样本不足就明确说“累积中”。 */
function capTrend(){
 var pts=(state.history&&state.history.points)||[];
 if(pts.length<3)return {g:null,eta:null,span:0,cur:null};
 var a=pts[0],b=pts[pts.length-1],hrs=(b.t-a.t)/3600;
 if(!(hrs>0.1))return {g:null,eta:null,span:hrs,cur:b.pct};
 var g=(b.pct-a.pct)/hrs,nf=(typeof state.settings.nearfull==='number')?state.settings.nearfull:85;
 return {g:g,eta:(g>0.001?((nf-b.pct)/g):null),span:hrs,cur:b.pct};
}
function vPools(){var rows=state.pools.map(function(p){
 var pctN=(typeof p.pct==='number')?p.pct:null;
 var pc=pctN==null?'var(--muted)':pctN>=80?'var(--danger)':pctN>=65?'var(--warn)':'var(--ok)';
 var w=pctN==null?0:Math.min(100,Math.max(pctN>0?1:0,pctN));
 var pctTxt=pctN==null?'—':((pctN>0&&pctN<1?'<1':String(Math.round(pctN)))+'%');
 var cfg=(p.size==null?'—':p.size)+' / '+(p.minSize==null?'—':p.minSize);
 var tp=p.type?(p.type==='erasure'?'erasure':'replicated'):'';
 var pgTip=[(p.pgp!=null&&p.pgp!==p.pgs?'pgp_num='+p.pgp:''),(p.autoscale?'autoscale='+p.autoscale:'')].filter(Boolean).join(' · ');
 var usedTxt=(p.used==null)?'<span class="tag mute" title="ceph df detail 中没有该池的用量">未采集</span>':bytes(p.used);
 var usedTip=((p.stored!=null&&p.stored!==p.used)?' title="物理占用（含副本 / EC 冗余）；逻辑写入 '+bytes(p.stored)+'"':'');
 return '<tr><td class="mono"><b>'+esc(p.name)+'</b></td><td>'+(tp?'<span class="tag '+(tp==='erasure'?'pur':'info')+'">'+tp+'</span>':'<span class="tag mute">—</span>')+'</td><td class="mono">'+cfg+'</td>'+
  '<td class="mono"'+(pgTip?' title="'+esc(pgTip)+'"':'')+'>'+((p.pgs==null)?'<span class="tag mute" title="ceph osd pool ls detail 未返回 pg_num">未采集</span>':p.pgs)+'</td>'+
  '<td class="mono"'+usedTip+'>'+usedTxt+'</td>'+
  '<td style="min-width:140px"><div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+w+'%;background:'+pc+'"></i></div><span class="mono mini" style="width:32px;text-align:right;color:'+pc+'">'+pctTxt+'</span></div></td><td><span class="tag mute">'+esc(p.app||'—')+'</span></td></tr>';}).join('');
 if(!rows)rows='<tr><td colspan="7"><div class="empty" style="padding:22px 0">'+ic('db',30)+
   '<div>尚未读取到存储池</div>'+
   '<div style="margin-top:12px"><button class="btn pri sm" data-act="pool-open">'+ic('plus',13)+' 创建存储池</button></div></div></td></tr>';
 var ec=state.pools.filter(function(p){return p.type==='erasure';}).length,ct=capTrend();
 var typed=state.pools.filter(function(p){return p.type==='replicated'||p.type==='erasure';}).length;
 var repTxt=typed?((typed-ec)+' / '+ec):'—';
 var gTxt=ct.g==null?'累积中（需 ≥3 个采样点）':((ct.g>=0?'+':'')+ct.g.toFixed(3)+' pt/小时');
 var etaTxt=ct.eta==null?'—':(ct.eta>48?Math.round(ct.eta/24)+' 天':Math.round(ct.eta)+' 小时');
 var bf=(typeof state.cluster.pgBackfill==='number')?state.cluster.pgBackfill:'—';
 var rec=(typeof state.cluster.recoveringBytes==='number')?bytes(state.cluster.recoveringBytes)+'/s':'—';
 var deg=(typeof state.cluster.pgDegraded==='number')?state.cluster.pgDegraded:'—';
 return pageH('存储池','副本 / EC 配置、容量水位与恢复状态',
   '<button class="btn pri" data-act="pool-open">'+ic('plus',14)+' 创建存储池</button>')+
  card('存储池列表','<div class="tbl-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>size / min_size</th><th>PG 数</th><th>已用</th><th>水位</th><th>应用</th></tr></thead><tbody>'+rows+'</tbody></table></div>','',false)+
  '<div class="grid g3" style="margin-top:14px">'+card('副本与冗余','<div class="stat-line"><span>池数量</span><b class="mono">'+state.pools.length+'</b></div><div class="stat-line"><span>副本 / EC 池</span><b class="mono"'+(typed<state.pools.length?' title="'+(state.pools.length-typed)+' 个池的类型未采集"':'')+'>'+repTxt+'</b></div><div class="stat-line"><span>size 范围（副本）</span><b class="mono">'+sizeRange('size','replicated')+'</b></div><div class="stat-line"><span>min_size 范围</span><b class="mono">'+sizeRange('minSize','replicated')+'</b></div>')+
  card('回填 / 恢复','<div class="stat-line"><span>PG 总数 / active+clean</span><b class="mono">'+((typeof state.cluster.pgs==='number')?state.cluster.pgs:'—')+' / '+((typeof state.cluster.pgActiveClean==='number')?state.cluster.pgActiveClean:'—')+'</b></div>'+
   '<div class="stat-line"><span>回填 / 恢复中 PG</span><b class="mono '+(typeof bf==='number'&&bf>0?'tw':'t')+'">'+bf+'</b></div>'+
   '<div class="stat-line"><span>degraded / undersized</span><b class="mono '+((typeof deg==='number'&&deg>0)?'tw':'t')+'"'+
   ((typeof deg==='number'&&deg>0&&typeof bf==='number'&&bf===0)?' title="这些 PG 异常但不在回填：通常是 OSD 仍 in 只是 down，PG 在等它回来；标 out 后才会真正触发回填"':'')+'>'+deg+'</b></div>'+
   '<div class="stat-line"><span>恢复速率</span><b class="mono">'+rec+'</b></div>'+
   '<div class="stat-line"><span>数据来源</span><b class="mono">pgmap 实时</b></div>')+
  card('容量增长（真实采样）','<div class="stat-line"><span>采样跨度</span><b class="mono">'+(ct.span>0?spanText(ct.span*3600):'累积中')+'</b></div><div class="stat-line"><span>增长速率</span><b class="mono">'+gTxt+'</b></div><div class="stat-line"><span>预计达到 nearfull</span><b class="mono tw">'+etaTxt+'</b></div><div class="stat-line"><span>nearfull / full</span><b class="mono">'+state.settings.nearfull+'% / '+state.settings.full+'%</b></div>')+'</div>';}
function vHosts(){var c=state.cluster;
 var rows=state.hosts.map(function(h){var cpu=(typeof h.cpu==='number')?h.cpu:null,mem=(typeof h.mem==='number')?h.mem:null;
  return '<tr><td class="mono"><b>'+esc(h.name)+'</b></td><td class="mono">'+esc(h.ip||'—')+'</td>'+
   '<td>'+(h.mons?'<span class="tag info">MON</span> ':'')+(h.mgr?'<span class="tag pur">MGR</span>':'')+(!h.mons&&!h.mgr?'<span class="tag mute">OSD</span>':'')+'</td>'+
   '<td class="mono '+(h.up<h.osds?'tw':'t')+'">'+h.up+' / '+h.osds+'</td>'+
   '<td style="min-width:110px">'+(cpu==null?'<span class="tag mute" title="未接入 node_exporter">未采集</span>':'<div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+cpu+'%;background:var(--info)"></i></div><span class="mono mini">'+cpu+'%</span></div>')+'</td>'+
   '<td style="min-width:110px">'+(mem==null?'<span class="tag mute" title="未接入 node_exporter">未采集</span>':'<div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+mem+'%;background:'+(mem>80?'var(--warn)':'var(--ok)')+'"></i></div><span class="mono mini">'+mem+'%</span></div>')+'</td>'+
   '<td class="mono mini">'+esc(h.ver||c.version||'—')+'</td></tr>';}).join('');
 var monList=(c.monList||[]);
 var monTxt=monList.length?monList.map(function(m){return esc(m.name)+(m.inQuorum?'':'（离线）');}).join(' · '):'—';
 var qTxt=(typeof c.monInQuorum==='number'&&typeof c.mons==='number')?(c.monInQuorum+' / '+c.mons):'—';
 var stbys=(c.mgrStandbys||[]);
 return pageH('主机与 MON','集群节点、服务角色与资源水位')+card('节点列表','<div class="tbl-wrap"><table><thead><tr><th>主机</th><th>地址</th><th>角色</th><th>OSD up</th><th>CPU</th><th>内存</th><th>Ceph 版本</th></tr></thead><tbody>'+rows+'</tbody></table></div>','',false)+
  '<div class="grid g3" style="margin-top:14px">'+card('MON 法定人数','<div class="stat-line"><span>MON 成员</span><b class="mono">'+monTxt+'</b></div><div class="stat-line"><span>法定人数</span><b class="mono '+((typeof c.monInQuorum==='number'&&typeof c.mons==='number'&&c.monInQuorum<c.mons)?'tw':'t')+'">'+qTxt+'</b></div><div class="stat-line"><span>leader</span><b class="mono">'+esc(c.monLeader||'—')+'</b></div>')+
  card('MGR 服务','<div class="stat-line"><span>active</span><b class="mono">'+esc(c.mgrActive||'—')+'</b></div><div class="stat-line"><span>standby</span><b class="mono">'+(stbys.length?stbys.map(esc).join(' · '):'无')+'</b></div><div class="stat-line"><span>mgr 可用</span><b class="mono '+(c.mgrAvailable?'t':'tw')+'">'+(c.mgrAvailable?'是':'否 / 未上报')+'</b></div>')+
  card('集群标识','<div class="stat-line"><span>FSID</span><b class="mono mini">'+esc(c.fsid||'—')+'</b></div><div class="stat-line"><span>Ceph 版本</span><b class="mono">'+esc((c.version||'—')+' '+(c.codename||''))+'</b></div><div class="stat-line"><span>部署方式</span><b class="mono tp">'+esc(c.deploy||'—')+'</b></div><div class="stat-line"><span>对象数</span><b class="mono">'+((typeof c.objects==='number')?c.objects.toLocaleString():'—')+'</b></div>')+'</div>';}
function vAudit(){var rows=state.audit.slice().sort(function(a,b){return b.ts-a.ts;}).map(function(a){var c=a.result==='OK'?'ok':a.result==='DRY-RUN'?'warn':'err';
 return '<tr><td class="mono mini">'+dt(a.ts)+'</td><td class="mono">'+esc(a.user)+'</td><td><span class="tag '+(a.act.indexOf('OSD')>=0?'pur':'info')+'">'+esc(a.act)+'</span></td><td class="mono">'+esc(a.target)+'</td>'+
  '<td class="mono mini" style="max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.cmd)+'</td><td><span class="tag '+c+'">'+esc(a.result)+'</span></td><td class="tm">'+esc(a.note)+'</td></tr>';}).join('');
 return pageH('变更审计','所有踢盘 / 换盘 / 配置变更均留痕，含执行命令与结果','<button class="btn" data-act="export-audit">'+ic('file',14)+' 导出 JSONL</button>')+
  card('审计日志','<div class="tbl-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标</th><th>命令 / 参数</th><th>结果</th><th>备注</th></tr></thead><tbody>'+rows+'</tbody></table></div>','<span class="tag mute">'+state.audit.length+' 条记录</span>',false)+
  '';}

/* ---- deploy ---- */
function genCmds(){var d=state.deploy,t=state.token||'<TOKEN>',h=d.host||'<目标IP>';
 return {scp:'scp ceph-console.py ceph-dashboard.html app-core.js app-views.js app-wizard.js deploy.sh '+(d.user||'root')+'@'+h+':/tmp/',
 run:'sudo bash /tmp/deploy.sh --local \\\n  --host '+h+' \\\n  --port '+d.port+' \\\n  --dir '+d.dir+' \\\n  --keyring '+d.keytype+' \\\n  --token '+t+' \\\n  --install',
 rest:'python3 ceph-console.py --backend rest \\\n  --rest-url '+d.restUrl+' \\\n  --port '+d.port+' \\\n  --token '+t,
 check:'curl -fsS http://'+h+':'+d.port+'/api/probe -H "X-Console-Token: '+t+'" | python3 -m json.tool'};}
function cmdBox(id,title,code){return '<div style="margin-bottom:14px"><label class="fld">'+esc(title)+'</label><div class="cmdbox" id="'+id+'">'+esc(code)+'<button class="btn sm cp" data-act="copy" data-target="'+id+'">'+ic('copy',12)+' 复制</button></div></div>';}
function vDeploy(){var cm=genCmds(),d=state.deploy,p=liveProfile();
 var cephRows=CEPH_VERSIONS.map(function(v){return '<tr'+(v.v===state.cluster.version.split('.')[0]+'.x'?' style="background:rgba(255,107,69,.06)"':'')+'><td class="mono"><b>'+v.v+'</b></td><td>'+v.name+'</td><td>'+v.osd+'</td><td>'+(v.orch?'<span class="tag ok">cephadm</span>':'<span class="tag mute">legacy</span>')+'</td><td class="mono mini">'+esc(v.replace)+'</td><td class="tm">'+v.note+'</td></tr>';}).join('');
 var osRows=DISTROS.map(function(x){return '<tr><td><b>'+x[0]+'</b></td><td class="mono mini">'+x[1]+'</td><td>'+x[2]+'</td><td>'+x[3]+'</td><td class="tm">'+x[4]+'</td></tr>';}).join('');
 return pageH('部署与对接','')+
  card('① 生成一键部署命令','<div class="grid g4">'+
   '<div><label class="fld">目标节点 IP / 主机名</label><input class="inp" data-bind="deploy.host" value="'+esc(d.host)+'"></div>'+
   '<div><label class="fld">SSH 用户</label><input class="inp" data-bind="deploy.user" value="'+esc(d.user)+'"></div>'+
   '<div><label class="fld">服务端口</label><input class="inp" data-bind="deploy.port" value="'+esc(d.port)+'"></div>'+
   '<div><label class="fld">安装目录</label><input class="inp" data-bind="deploy.dir" value="'+esc(d.dir)+'"></div>'+
   '<div><label class="fld">凭证权限</label><select class="inp" data-bind="deploy.keytype"><option value="full"'+(d.keytype==='full'?' selected':'')+'>读写（可踢盘换盘）</option><option value="readonly"'+(d.keytype==='readonly'?' selected':'')+'>只读（仅监控告警）</option></select></div>'+
   '<div><label class="fld">访问令牌</label><input class="inp" data-bind="token" value="'+esc(state.token)+'" placeholder="留空则脚本自动生成"></div>'+
   '<div><label class="fld">REST 地址（方案 C）</label><input class="inp" data-bind="deploy.restUrl" value="'+esc(d.restUrl)+'" placeholder="https://192.168.27.134:8443"></div>'+
   '<div><label class="fld">当前探测档案</label><input class="inp" value="'+esc((p.version||state.cluster.version)+' / '+p.orchestrator+(p.detected?' · 已探测':' · 推断'))+'" disabled></div></div>'+
   '<div class="hr"></div>'+cmdBox('cmd-1','1. 从本机拷贝文件到目标 Linux 节点',cm.scp)+cmdBox('cmd-2','2. 在目标节点执行一键部署（自动识别发行版 / Python / init / 防火墙）',cm.run)+
   cmdBox('cmd-3','3. 方案 C 备选：REST 只读代理（无需 ceph CLI）',cm.rest)+cmdBox('cmd-4','4. 验证对接',cm.check)+
   '<div class="btn-row"><button class="btn pri" data-act="test-conn">'+ic('link',14)+' 测试当前连接</button><button class="btn" data-act="copy" data-target="cmd-2">'+ic('copy',14)+' 复制部署命令</button><button class="btn" data-act="nav" data-view="settings">'+ic('settings',14)+' 连接设置</button></div>')+
  '<div style="margin-top:14px">'+card('② 已探测的运行环境','<div class="grid g2" style="gap:0 34px">'+
    '<div><div class="stat-line"><span>操作系统</span><b class="mono">'+esc(p.os||'自动识别 /etc/os-release')+'</b></div><div class="stat-line"><span>Python</span><b class="mono">'+esc(p.python||'3.6+')+'</b></div>'+
    '<div class="stat-line"><span>init 系统</span><b class="mono">'+esc(p.init||'systemd')+'</b></div></div>'+
    '<div><div class="stat-line"><span>Ceph 版本</span><b class="mono tp">'+esc(p.version||state.cluster.version)+'</b></div><div class="stat-line"><span>编排器</span><b class="mono">'+esc(p.orchestrator||'cephadm')+'</b></div>'+
    '<div class="stat-line"><span>后端通道</span><b class="mono">'+esc(p.backend||'cli')+'</b></div></div></div>')+'</div>'+
  '<div style="margin-top:14px">'+card('③ Ceph 版本兼容矩阵（12.x ~ 19.x）','<div class="tbl-wrap"><table class="matrix"><thead><tr><th>版本</th><th>代号</th><th>OSD 部署</th><th>编排</th><th>换盘命令模板</th><th>说明</th></tr></thead><tbody>'+cephRows+'</tbody></table></div>','',false)+'</div>'+
  '<div style="margin-top:14px">'+card('④ Linux 发行版兼容矩阵','<div class="tbl-wrap"><table class="matrix"><thead><tr><th>发行版</th><th>Python</th><th>init</th><th>防火墙</th><th>说明</th></tr></thead><tbody>'+osRows+'</tbody></table></div>','',false)+'</div>';}

/* ---- settings ---- */
function vSettings(){var s=state.settings,a=state.auth||{},canPw=state.mode==='live'&&a.authenticated;
 var pwdBody=canPw?
  '<div class="stat-line"><span>当前账号</span><b class="mono">'+esc(a.user)+' · '+(a.role==='admin'?'管理员':'只读')+'</b></div>'+
  '<div class="fgrp" style="margin-top:10px"><label class="fld">当前密码</label><input class="inp" id="pw-old" type="password" autocomplete="current-password" placeholder="输入当前登录密码"></div>'+
  '<div class="grid g2" style="gap:10px"><div class="fgrp"><label class="fld">新密码（至少 8 位）</label><input class="inp" id="pw-new" type="password" autocomplete="new-password" placeholder="不能与当前密码相同"></div>'+
  '<div class="fgrp"><label class="fld">确认新密码</label><input class="inp" id="pw-new2" type="password" autocomplete="new-password" placeholder="再输入一次"></div></div>'+
  '<div id="pw-msg" class="hint" style="margin-top:8px"></div>'+
  '<div class="btn-row" style="margin-top:12px"><button class="btn pri" data-act="change-password">'+ic('lock',14)+' 修改密码</button></div>':
  '<div class="warnbox">'+ic('lock')+'<div>请先连接后端、用账号密码登录后，才能修改 <b class="mono">admin</b> 密码。</div></div>';
 var connInfo='<div class="stat-line"><span>后端地址</span><b class="mono">'+esc(backendBase()||'同源')+'</b></div>'+
  '<div class="stat-line"><span>登录状态</span><b class="'+(state.auth.authenticated?'t':'tw')+'">'+
   (state.auth.authenticated?esc(state.auth.user)+' · '+(state.auth.role==='admin'?'管理员':'只读'):'未登录')+'</b></div>'+
  '<div class="stat-line"><span>执行模式</span><b class="mono '+(state.settings.allowWrite?'td':'t')+'">'+(state.settings.allowWrite?'EXECUTE 真实执行':'DRY-RUN 只生成命令')+'</b></div><div class="hr"></div>';
 var sw=function(k,l,d){var v=k.split('.').reduce(function(o,x){return o[x];},state);return '<div class="setrow"><div><div class="l">'+l+'</div><div class="d">'+d+'</div></div><button class="switch '+(v?'on':'')+'" data-act="toggle" data-key="'+k+'"></button></div>';};
 return pageH('系统设置','数据源、安全策略、告警阈值与版本适配')+'<div class="grid g2">'+
  card('连接与数据源',connInfo+
   '<div class="fgrp"><label class="fld">API 基地址（留空为同源）</label><input class="inp" data-bind="apiBase" value="'+esc(state.apiBase)+'" placeholder="http://192.168.27.134:8780"></div>'+
   '<div class="fgrp"><label class="fld">访问令牌 X-Console-Token</label><input class="inp" type="password" data-bind="token" value="'+esc(state.token)+'" placeholder="由部署脚本生成"></div>'+
   '<div class="btn-row"><button class="btn pri" data-act="test-conn">'+ic('link',14)+' 测试连接 / 重新探测</button></div><div class="hr"></div>'+sw('autoRefresh','自动刷新','每 15 秒拉取集群状态与告警'))+
  card('安全策略',sw('settings.allowWrite','允许真实写操作','关闭时为 DRY-RUN：只生成命令与日志，不下发到 Ceph 集群。生产环境首次上线请保持关闭。')+
   sw('settings.confirm','危险操作二次确认','踢盘 / 换盘 / 删除前必须手工输入 OSD 编号并勾选确认项。')+
   '<div class="fgrp" style="margin-top:14px"><label class="fld">强制版本覆盖（用于命令模板）</label><select class="inp" data-bind="settings.forceVersion">'+[['auto','自动探测（推荐）']].concat(CEPH_VERSIONS.map(function(v){return [v.v,v.v+' '+v.name];})).map(function(o){return '<option value="'+o[0]+'"'+(s.forceVersion===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></div>'+
   '<div class="fgrp"><label class="fld">部署方式覆盖</label><select class="inp" data-bind="settings.deployMode">'+[['auto','自动探测'],['cephadm','cephadm / orchestrator'],['legacy','ceph-volume / 传统']].map(function(o){return '<option value="'+o[0]+'"'+(s.deployMode===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></div>'+
   '')+'</div>'+
  '<div class="grid g2" style="margin-top:14px">'+card('告警阈值','<div class="grid g2">'+
   '<div class="fgrp"><label class="fld">OSD nearfull（%）</label><input class="inp" type="number" data-bind="settings.nearfull" value="'+s.nearfull+'"></div>'+
   '<div class="fgrp"><label class="fld">OSD full（%）</label><input class="inp" type="number" data-bind="settings.full" value="'+s.full+'"></div>'+
   '<div class="fgrp"><label class="fld">OSD down 判定时长（分钟）</label><input class="inp" type="number" data-bind="settings.downMin" value="'+s.downMin+'"></div>'+
   '<div class="fgrp"><label class="fld">degraded PG 阈值</label><input class="inp" type="number" data-bind="settings.pgDegraded" value="'+s.pgDegraded+'"></div>'+
   '<div class="fgrp"><label class="fld">慢请求阈值（ms）</label><input class="inp" type="number" data-bind="settings.slowOps" value="'+s.slowOps+'"></div></div>'+
   '')+
  card('关于','<div class="stat-line"><span>后端版本</span><b class="mono">'+esc((state.profile&&state.profile.console_version)||'未获取')+'</b></div>'+
   '<div class="stat-line"><span>前端构建</span><b class="mono t">'+esc(UI_BUILD)+'</b></div>'+
   '<div class="stat-line"><span>运行模式</span><b class="mono t">LIVE · 对接真实集群</b></div>'+
   '<div class="stat-line"><span>登录状态</span><b class="mono '+(state.auth.authenticated?'t':'tw')+'">'+(state.auth.authenticated?esc(state.auth.user)+' · 已登录':'未登录')+'</b></div>'+
   '<div class="stat-line"><span>集群数据同步</span><b class="mono '+((state.link&&state.link.stateOk)?'t':'tw')+'">'+((state.link&&state.link.stateOk)?'已同步':'未取到数据')+'</b></div>'+
   (liveNoData()?'<div class="stat-line"><span>同步失败原因</span><b class="mono td">'+esc((state.link.stateError||'无有效响应')+(state.link.stateHttp&&state.link.stateHttp!==200?' · HTTP '+state.link.stateHttp:''))+'</b></div>'+
    '<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="diag-retry">重新同步</button><button class="btn sm" data-act="diag-run">运行后端自检</button><button class="btn sm" data-act="nav" data-view="overview">查看诊断页</button></div>':'')+
   '<div class="stat-line"><span>前端依赖</span><b class="mono t">0（纯原生 HTML/CSS/JS）</b></div>'+
   '<div class="stat-line"><span>后端依赖</span><b class="mono t">0（Python 3.6+ 标准库）</b></div><div class="stat-line"><span>支持 Ceph</span><b class="mono">12.x ~ 19.x</b></div>'+
   '<div class="stat-line"><span>支持 Linux</span><b class="mono">systemd / SysV · 主流发行版</b></div>')+'</div>'+
  '<div class="grid g2" style="margin-top:14px">'+
  card('账号与密码 · 修改登录密码',pwdBody,'<span class="tag info">PBKDF2</span>')+
  card('密码策略与找回','<div class="stat-line"><span>存储方式</span><b class="mono t">PBKDF2-SHA256 · 120000 轮 + 随机 salt</b></div>'+
   '<div class="stat-line"><span>明文 / 日志</span><b class="mono t">不保存、不记录</b></div>'+
   '<div class="stat-line"><span>修改后</span><b class="mono">同账号其他会话立即失效</b></div><div class="hr"></div>'+
   cmdBox('pw-cli','离线重置命令',"sudo python3 ~/ceph-ops-console/ceph-console.py --set-password admin --users-file /etc/ceph-console/users.json"))+
  '</div>';}
