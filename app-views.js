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
    '<button class="qbtn" data-act="q-open" data-kind="replace" data-id="'+a.osd+'">'+ic('zap',12)+'一键换盘</button>':'')+'</div>')+'</div>';}
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
   '<button class="qbtn" data-act="q-open" data-kind="replace" data-id="'+a.osd+'">'+ic('zap',12)+'一键换盘</button></span></div>';}).join(''),
  '<span class="tag err">'+faultAlerts.length+' 块待处置</span>',false):'';
 var nh=notify.map(function(n){return '<div class="setrow"><div><div class="l">'+n[1]+'</div><div class="d">'+n[2]+'</div></div><button class="switch '+(state.settings[n[0]]?'on':'')+'" data-act="toggle" data-key="settings.'+n[0]+'"></button></div>';}).join('');
 return pageH('告警中心 · 查看与处置','实时监控告警 · 分级查看 / 确认 / 静音 · 一键踢盘换盘','<button class="btn" data-act="refresh">'+ic('refresh',14)+' 刷新告警</button><button class="btn" data-act="simulate">'+ic('zap',14)+' 注入模拟告警</button><button class="btn pri" data-act="nav" data-view="settings">'+ic('settings',14)+' 阈值设置</button>')+
   statsHtml+faultCard+filter+card('告警列表',list.length?list.map(function(a){return alertRow(a);}).join(''):'<div class="empty">当前筛选条件下没有告警</div>','<span class="tiny">「一键踢盘 / 一键换盘」直接从本页执行，无需走向导</span>',false)+
  '<div class="grid g2" style="margin-top:14px">'+card('告警规则',ruleTbl,'<span class="tag info">版本自适应</span>',false)+card('通知渠道',nh+'<div class="fgrp" style="margin-top:14px"><label class="fld">Webhook 地址</label><input class="inp" data-bind="settings.webhook" value="'+esc(state.settings.webhook)+'" placeholder="https://alert.example.com/hook"></div>','<span class="tag ok">自动推送</span>')+'</div>';}

/* ---- OSD ---- */
function osdStatus(o){if(!o.up&&!o.inn)return {t:'down / out',c:'err'};if(!o.up)return {t:'down / in',c:'err'};if(!o.inn)return {t:'up / out',c:'warn'};return {t:'up / in',c:'ok'};}
function osdRow(o){var s=osdStatus(o),p=pct(o.used,o.size),pc=p>=85?'var(--danger)':p>=75?'var(--warn)':'var(--ok)';
 return '<tr><td class="mono"><b>osd.'+o.id+'</b></td><td>'+esc(o.host)+'</td><td class="mono">'+esc(o.dev)+'</td><td><span class="tag mute">'+o.type+'</span></td><td class="mono">'+bytes(o.size)+'</td>'+
  '<td style="min-width:130px"><div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+p+'%;background:'+pc+'"></i></div><span class="mono mini" style="width:32px;text-align:right;color:'+pc+'">'+p+'%</span></div></td>'+
  '<td><span class="tag '+s.c+'"><span class="dot '+(s.c==='err'?'err':s.c==='warn'?'warn':'ok')+'"></span>'+s.t+'</span></td><td class="mono mini">'+o.pgs+'</td>'+
  '<td>'+(o.smart==='OK'?'<span class="tag ok">OK</span>':o.smart==='WARN'?'<span class="tag warn">WARN</span>':'<span class="tag err">FAIL</span>')+'</td>'+
 '<td><div class="btn-row" style="flex-wrap:nowrap;gap:5px"><button class="btn sm" data-act="osd-detail" data-id="'+o.id+'">详情</button>'+
 (o.inn?'<button class="btn sm" data-act="osd-out" data-id="'+o.id+'">OUT</button>':'<button class="btn sm" data-act="osd-in" data-id="'+o.id+'">IN</button>')+
 '<button class="qbtn kick" data-act="q-open" data-kind="kick" data-id="'+o.id+'">'+ic('trash',12)+'一键踢盘</button>'+
 '<button class="qbtn" data-act="q-open" data-kind="replace" data-id="'+o.id+'">'+ic('zap',12)+'一键换盘</button></div></td></tr>';}
function osdTable(){var f=state.filters,list=state.osds.filter(function(o){
  if(f.osdStatus==='down'&&o.up)return false;if(f.osdStatus==='out'&&o.inn)return false;if(f.osdStatus==='nearfull'&&pct(o.used,o.size)<85)return false;
  if(f.osdStatus==='smart'&&o.smart==='OK')return false;if(f.osdQ&&(('osd.'+o.id)+o.host+o.dev+o.type+o.serial).toLowerCase().indexOf(f.osdQ.toLowerCase())<0)return false;return true;});
 return '<div class="tbl-wrap"><table><thead><tr><th>OSD</th><th>主机</th><th>设备</th><th>介质</th><th>容量</th><th>使用率</th><th>状态</th><th>PG</th><th>SMART</th><th>操作</th></tr></thead><tbody>'+
  (list.length?list.map(osdRow).join(''):'<tr><td colspan="10"><div class="empty">没有匹配的 OSD</div></td></tr>')+'</tbody></table></div>';}
function vOsds(){var f=state.filters,down=state.osds.filter(function(o){return !o.up;}).length,out=state.osds.filter(function(o){return !o.inn;}).length,
 nf=state.osds.filter(function(o){return pct(o.used,o.size)>=85;}).length,sm=state.osds.filter(function(o){return o.smart!=='OK';}).length,p=liveProfile();
 var filter='<div class="flex" style="gap:9px;flex-wrap:wrap;margin-bottom:14px"><div class="seg">'+[['all','全部 '+state.osds.length],['down','Down '+down],['out','Out '+out],['nearfull','近满 '+nf],['smart','SMART 异常 '+sm]].map(function(x){return '<button class="'+(f.osdStatus===x[0]?'on acc':'')+'" data-act="filter" data-key="osdStatus" data-value="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</div>'+
  '<input class="inp" style="width:250px" placeholder="搜索 OSD / 主机 / 设备 / SN…" value="'+esc(f.osdQ)+'" data-bind="filters.osdQ"><div class="sp"></div><button class="btn pri" data-act="wizard" data-intent="replace">'+ic('wrench',14)+' 踢盘换盘向导</button></div>';
 var fO=faultOsd();
 var quickBar=fO?'<div class="card" style="margin-bottom:14px"><div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
  '<div><div class="tiny">检测到待处置磁盘</div><div style="font-size:14px;font-weight:650" class="mono">osd.'+fO.id+' · '+esc(fO.host)+' · '+esc(fO.dev)+'</div>'+
  '<div class="tiny">'+(fO.smart!=='OK'?'SMART '+esc(fO.smart):'状态异常')+' · SN '+esc(fO.serial||'-')+'</div></div><div class="sp"></div>'+
  '<button class="qbtn kick lg" data-act="q-open" data-kind="kick" data-id="'+fO.id+'">'+ic('trash',14)+'一键踢盘</button>'+
  '<button class="qbtn lg" data-act="q-open" data-kind="replace" data-id="'+fO.id+'">'+ic('zap',14)+'一键换盘</button>'+
  '<button class="btn" data-act="wizard" data-id="'+fO.id+'" data-intent="replace">'+ic('wrench',14)+' 高级向导</button></div></div>':'';
 return pageH('OSD / 磁盘管理','从 Web 一键踢盘 / 一键换盘，含版本适配、人工换盘暂停与回填观察')+quickBar+filter+
  '<div class="warnbox" style="margin-bottom:14px">'+ic('shield')+'<div><b>安全策略已生效</b>：默认 DRY-RUN，所有变更命令只生成不下发。真实执行需在「系统设置」开启写权限，并在向导中通过二次确认。当前版本档案 <span class="mono">'+esc(p.version||state.cluster.version)+' / '+esc(p.orchestrator)+'</span>，命令模板按实际能力探测结果选择。</div></div>'+
  card('OSD 列表','<div id="osd-table-wrap">'+osdTable()+'</div>','<span class="tag info">共 '+state.osds.length+' 台（演示切片）</span>',false)+
  '<div class="grid g2" style="margin-top:14px">'+card('处置流程说明','<div class="timeline">'+
   '<div class="tl-i ok"><b>1. 选择 OSD 与意图</b><div class="tm">仅踢盘（退役）或踢盘+换盘（保留 OSD ID）</div></div>'+
   '<div class="tl-i"><b>2. 自动预检</b><div class="tm">集群健康 / ok-to-stop / 剩余容量 / noout / 同故障域冲突 / min_size</div></div>'+
   '<div class="tl-i"><b>3. 二次确认</b><div class="tm">手工输入 OSD 编号 + 确认物理盘位，防止误操作</div></div>'+
   '<div class="tl-i w"><b>4. 执行与回填观察</b><div class="tm">逐条下发命令、终端日志、PG 回填进度、可中止</div></div>'+
   '<div class="tl-i ok"><b>5. 收尾验证</b><div class="tm">等待 active+clean，写入变更审计，关联告警自动恢复</div></div></div>')+
   card('版本命令适配','<div class="stat-line"><span>编排器</span><b class="mono tp">'+esc(p.orchestrator)+'</b></div>'+
   '<div class="stat-line"><span>osd purge</span><b class="mono '+(p.caps.purge?'t':'td')+'">'+(p.caps.purge?'可用':'不可用 → 三步式移除')+'</b></div>'+
   '<div class="stat-line"><span>ok-to-stop</span><b class="mono '+(p.caps.ok_to_stop?'t':'tw')+'">'+(p.caps.ok_to_stop?'可用':'降级为 PG 冗余检查')+'</b></div>'+
   '<div class="stat-line"><span>orch osd rm --replace</span><b class="mono '+(p.caps.orch?'t':'td')+'">'+(p.caps.orch?'可用':'不可用 → ceph-volume')+'</b></div>'+
   '<div class="hr"></div><div class="note">后端启动时执行 <span class="code-inline">ceph --version</span> 与命令能力探测，不依赖硬编码版本号；低版本自动回退到等价命令序列。详见「部署与对接」页的兼容矩阵。</div>')+'</div>';}

/* ---- pools / hosts / audit ---- */
function vPools(){var rows=state.pools.map(function(p){var pc=p.pct>=80?'var(--danger)':p.pct>=65?'var(--warn)':'var(--ok)';
 return '<tr><td class="mono"><b>'+esc(p.name)+'</b></td><td><span class="tag '+(p.type==='erasure'?'pur':'info')+'">'+p.type+'</span></td><td class="mono">'+p.size+' / '+p.minSize+'</td><td class="mono">'+p.pgs+'</td><td class="mono">'+bytes(p.used)+'</td>'+
  '<td style="min-width:140px"><div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+p.pct+'%;background:'+pc+'"></i></div><span class="mono mini" style="width:32px;text-align:right;color:'+pc+'">'+p.pct+'%</span></div></td><td><span class="tag mute">'+esc(p.app)+'</span></td></tr>';}).join('');
 return pageH('存储池','副本 / EC 配置、容量水位与 PG 分布')+card('存储池列表','<div class="tbl-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>size / min_size</th><th>PG</th><th>已用</th><th>水位</th><th>应用</th></tr></thead><tbody>'+rows+'</tbody></table></div>','',false)+
  '<div class="grid g3" style="margin-top:14px">'+card('副本与冗余','<div class="stat-line"><span>默认副本数</span><b class="mono">3</b></div><div class="stat-line"><span>min_size</span><b class="mono">2</b></div><div class="stat-line"><span>故障域</span><b class="mono">host</b></div><div class="stat-line"><span>CRUSH rule</span><b class="mono">replicated_rule</b></div>')+
  card('回填 / 恢复','<div class="stat-line"><span>回填 PG</span><b class="mono tw">12</b></div><div class="stat-line"><span>恢复速率</span><b class="mono">168 MiB/s</b></div><div class="stat-line"><span>osd_recovery_max_active</span><b class="mono">3</b></div><div class="stat-line"><span>noout 标志</span><b class="mono t">未设置</b></div>')+
  card('容量规划','<div class="stat-line"><span>近 30 天增长</span><b class="mono">+42 TiB</b></div><div class="stat-line"><span>预计满容</span><b class="mono tw">约 14 个月</b></div><div class="stat-line"><span>nearfull</span><b class="mono">'+state.settings.nearfull+'%</b></div><div class="stat-line"><span>full</span><b class="mono">'+state.settings.full+'%</b></div>')+'</div>';}
function vHosts(){var rows=state.hosts.map(function(h){return '<tr><td class="mono"><b>'+esc(h.name)+'</b></td><td class="mono">'+h.ip+'</td>'+
 '<td>'+(h.mons?'<span class="tag info">MON</span> <span class="tag mute">MGR</span>':'<span class="tag mute">OSD</span>')+'</td><td class="mono '+(h.up<h.osds?'tw':'t')+'">'+h.up+' / '+h.osds+'</td>'+
 '<td style="min-width:120px"><div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+h.cpu+'%;background:var(--info)"></i></div><span class="mono mini">'+h.cpu+'%</span></div></td>'+
 '<td style="min-width:120px"><div class="flex" style="gap:7px"><div class="bar" style="flex:1;margin:0"><i style="width:'+h.mem+'%;background:'+(h.mem>80?'var(--warn)':'var(--ok)')+'"></i></div><span class="mono mini">'+h.mem+'%</span></div></td><td class="mono mini">'+h.ver+'</td></tr>';}).join('');
 return pageH('主机与 MON','集群节点、服务角色与资源水位')+card('节点列表','<div class="tbl-wrap"><table><thead><tr><th>主机</th><th>地址</th><th>角色</th><th>OSD up</th><th>CPU</th><th>内存</th><th>Ceph 版本</th></tr></thead><tbody>'+rows+'</tbody></table></div>','',false)+
  '<div class="grid g3" style="margin-top:14px">'+card('MON 法定人数','<div class="stat-line"><span>mon.a / b / c</span><b class="mono t">3 / 3 在线</b></div><div class="stat-line"><span>leader</span><b class="mono">mon.a</b></div><div class="stat-line"><span>时钟偏移</span><b class="mono t">&lt; 0.1s</b></div>')+
  card('MGR 服务','<div class="stat-line"><span>active</span><b class="mono">node-ceph-01</b></div><div class="stat-line"><span>dashboard 模块</span><b class="mono t">已启用</b></div><div class="stat-line"><span>prometheus 模块</span><b class="mono t">已启用</b></div>')+
  card('网络','<div class="stat-line"><span>cluster_network</span><b class="mono">10.10.27.0/24</b></div><div class="stat-line"><span>public_network</span><b class="mono">192.168.27.0/24</b></div><div class="stat-line"><span>msgr2</span><b class="mono t">v2 优先</b></div>')+'</div>';}
function vAudit(){var rows=state.audit.slice().sort(function(a,b){return b.ts-a.ts;}).map(function(a){var c=a.result==='OK'?'ok':a.result==='DRY-RUN'?'warn':'err';
 return '<tr><td class="mono mini">'+dt(a.ts)+'</td><td class="mono">'+esc(a.user)+'</td><td><span class="tag '+(a.act.indexOf('OSD')>=0?'pur':'info')+'">'+esc(a.act)+'</span></td><td class="mono">'+esc(a.target)+'</td>'+
  '<td class="mono mini" style="max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.cmd)+'</td><td><span class="tag '+c+'">'+esc(a.result)+'</span></td><td class="tm">'+esc(a.note)+'</td></tr>';}).join('');
 return pageH('变更审计','所有踢盘 / 换盘 / 配置变更均留痕，含执行命令与结果','<button class="btn" data-act="export-audit">'+ic('file',14)+' 导出 JSONL</button>')+
  card('审计日志','<div class="tbl-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标</th><th>命令 / 参数</th><th>结果</th><th>备注</th></tr></thead><tbody>'+rows+'</tbody></table></div>','<span class="tag mute">'+state.audit.length+' 条记录</span>',false)+
  '<div class="warnbox" style="margin-top:14px">'+ic('shield')+'<div>生产环境审计日志由后端写入 <span class="mono">/var/log/ceph-console/audit.jsonl</span>，包含操作者、来源 IP、时间戳、完整命令与返回码；前端仅在会话内展示，不持久化敏感令牌。</div></div>';}

/* ---- deploy ---- */
function genCmds(){var d=state.deploy,t=state.token||'<TOKEN>';
 return {scp:'scp ceph-console.py ceph-dashboard.html app-core.js app-views.js app-wizard.js deploy.sh '+d.user+'@'+d.host+':/tmp/',
 run:'sudo bash /tmp/deploy.sh --local \\\n  --host '+d.host+' \\\n  --port '+d.port+' \\\n  --dir '+d.dir+' \\\n  --keyring '+d.keytype+' \\\n  --token '+t+' \\\n  --install',
 rest:'python3 ceph-console.py --backend rest \\\n  --rest-url '+d.restUrl+' \\\n  --port '+d.port+' \\\n  --token '+t,
 check:'curl -fsS http://'+d.host+':'+d.port+'/api/probe -H "X-Console-Token: '+t+'" | python3 -m json.tool'};}
function cmdBox(id,title,code){return '<div style="margin-bottom:14px"><label class="fld">'+esc(title)+'</label><div class="cmdbox" id="'+id+'">'+esc(code)+'<button class="btn sm cp" data-act="copy" data-target="'+id+'">'+ic('copy',12)+' 复制</button></div></div>';}
function vDeploy(){var cm=genCmds(),d=state.deploy,p=liveProfile();
 var cephRows=CEPH_VERSIONS.map(function(v){return '<tr'+(v.v===state.cluster.version.split('.')[0]+'.x'?' style="background:rgba(255,107,69,.06)"':'')+'><td class="mono"><b>'+v.v+'</b></td><td>'+v.name+'</td><td>'+v.osd+'</td><td>'+(v.orch?'<span class="tag ok">cephadm</span>':'<span class="tag mute">legacy</span>')+'</td><td class="mono mini">'+esc(v.replace)+'</td><td class="tm">'+v.note+'</td></tr>';}).join('');
 var osRows=DISTROS.map(function(x){return '<tr><td><b>'+x[0]+'</b></td><td class="mono mini">'+x[1]+'</td><td>'+x[2]+'</td><td>'+x[3]+'</td><td class="tm">'+x[4]+'</td></tr>';}).join('');
 var plan=[
  ['方案 A · 推荐','MON / 管理节点常驻','在已有 ceph.conf 与 keyring 的节点运行部署脚本，创建专用 client 凭证并注册 systemd 服务。全功能：监控 + 告警 + 踢换盘。','<span class="tag ok">全功能</span> <span class="tag mute">离线可用</span>'],
  ['方案 B','管理跳板机','跳板机只要装了 ceph-common、能读到 ceph.conf / keyring 即可，无需跑在集群节点上，同样支持写操作。','<span class="tag info">全功能</span> <span class="tag mute">需 ceph CLI</span>'],
  ['方案 C','REST 只读代理','无 ceph CLI 的机器，通过 mgr dashboard API 代理只读监控，跨版本字段归一化；写操作仍需方案 A/B。','<span class="tag warn">只读</span> <span class="tag mute">无需 ceph CLI</span>'],
  ['安全性','默认不改动集群','安装默认 DRY-RUN 与最小权限 keyring；真实写操作需显式开启 --allow-write，并经令牌 + 二次确认。','<span class="tag ok">DRY-RUN</span> <span class="tag ok">审计留痕</span>']];
 return pageH('部署与对接','一键接入现有 Ceph 集群 · 多版本 / 多发行版 Linux 适配')+
  '<div class="grid g4" style="margin-bottom:14px">'+plan.map(function(x,i){return card('<span class="tag '+(i===0?'ok':i===2?'pur':i===3?'mute':'info')+'">'+x[0]+'</span>','<div style="font-size:13px;font-weight:650;margin-bottom:7px">'+x[1]+'</div><div class="note">'+x[2]+'</div><div style="margin-top:10px">'+x[3]+'</div>',null,true);}).join('')+'</div>'+
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
   '<div class="btn-row"><button class="btn pri" data-act="test-conn">'+ic('link',14)+' 测试当前连接</button><button class="btn" data-act="copy" data-target="cmd-2">'+ic('copy',14)+' 复制部署命令</button><button class="btn" data-act="nav" data-view="settings">'+ic('settings',14)+' 连接设置</button></div>',
   '<span class="tag ok">离线安装 · 零 pip 依赖</span>')+
  '<div class="grid g2" style="margin-top:14px">'+
   card('② 已探测的运行环境','<div class="stat-line"><span>操作系统</span><b class="mono">'+esc(p.os||'自动识别 /etc/os-release')+'</b></div><div class="stat-line"><span>Python</span><b class="mono">'+esc(p.python||'3.6+')+'</b></div>'+
    '<div class="stat-line"><span>init 系统</span><b class="mono">'+esc(p.init||'systemd')+'</b></div><div class="stat-line"><span>后端通道</span><b class="mono">'+esc(p.backend||'cli')+'</b></div>'+
    '<div class="stat-line"><span>Ceph 版本</span><b class="mono tp">'+esc(p.version||state.cluster.version)+'</b></div><div class="stat-line"><span>编排器</span><b class="mono">'+esc(p.orchestrator||'cephadm')+'</b></div>'+
    '<div class="hr"></div><div class="note">部署脚本读取 <span class="code-inline">/etc/os-release</span>，探测 python3 解释器、systemd/SysV、firewalld/ufw 与 SELinux 状态，据此生成服务单元与防火墙规则；无需联网、不安装任何 pip 包。</div>')+
   card('③ 对接前检查清单','<label class="chk"><input type="checkbox" disabled checked><span>目标节点可解析集群 MON，<span class="code-inline">ceph -s</span> 能正常返回</span></label>'+
    '<label class="chk"><input type="checkbox" disabled checked><span><span class="code-inline">/etc/ceph/ceph.conf</span> 与 admin keyring 可用，或由脚本创建受限 client</span></label>'+
    '<label class="chk"><input type="checkbox" disabled checked><span>防火墙放行服务端口（默认 8780），仅建议内网访问</span></label>'+
    '<label class="chk"><input type="checkbox" disabled checked><span>已确认 DRY-RUN 观察期结果，再决定是否开启写权限</span></label>'+
    '<label class="chk"><input type="checkbox" disabled checked><span>换盘前已核对物理盘位 / SN，避免拔错盘</span></label>'+
    '<div class="dangerbox" style="margin-top:10px">'+ic('alert')+'<div>踢盘换盘属于不可逆的破坏性操作。务必先在 DRY-RUN 模式跑通一次完整流程，确认命令序列与现场操作流程后再开启写权限。</div></div>')+'</div>'+
  '<div style="margin-top:14px">'+card('④ Ceph 版本兼容矩阵（12.x ~ 19.x）','<div class="tbl-wrap"><table class="matrix"><thead><tr><th>版本</th><th>代号</th><th>OSD 部署</th><th>编排</th><th>换盘命令模板</th><th>说明</th></tr></thead><tbody>'+cephRows+'</tbody></table></div>','<span class="tag info">能力探测优先于版本号</span>',false)+'</div>'+
  '<div style="margin-top:14px">'+card('⑤ Linux 发行版兼容矩阵','<div class="tbl-wrap"><table class="matrix"><thead><tr><th>发行版</th><th>Python</th><th>init</th><th>防火墙</th><th>说明</th></tr></thead><tbody>'+osRows+'</tbody></table></div>','<span class="tag ok">Python 3.6+ 语法约束</span>',false)+'</div>'+
   '<div style="margin-top:14px">'+card('⑥ 两种部署形态',
    '<div class="grid g2" style="gap:14px"><div><div style="font-size:13px;font-weight:650;margin-bottom:6px">A · Ceph 管理节点一键启动（推荐）</div>'+
    '<div class="note">后端与前端同一台机器，脚本自动创建服务、受限 keyring、登录账号并放行端口。命令：'+
    '<span class="code-inline">sudo bash deploy.sh --local --install</span></div></div>'+
    '<div><div style="font-size:13px;font-weight:650;margin-bottom:6px">B · 前后端分离部署</div>'+
    '<div class="note">后端跑在 Ceph 管理节点（<span class="code-inline">--mode backend</span>），前端是 4 个静态文件，可放任意 Web 服务器（nginx / Apache / python -m http.server）。'+
    '在登录页填后端地址 <span class="code-inline">http://后端IP:8780</span>，或直接用带 <span class="code-inline">?api=</span> 参数的链接打开。会话走 X-Console-Session 头，不依赖跨站 Cookie。</div></div></div>')+'</div>'+
   '<div style="margin-top:14px">'+isolationCard()+'</div>';}

/* ---- settings ---- */
function vSettings(){var s=state.settings,a=state.auth||{},canPw=state.mode==='live'&&a.authenticated;
 var pwdBody=canPw?
  '<div class="stat-line"><span>当前账号</span><b class="mono">'+esc(a.user)+' · '+(a.role==='admin'?'管理员':'只读')+'</b></div>'+
  '<div class="fgrp" style="margin-top:10px"><label class="fld">当前密码</label><input class="inp" id="pw-old" type="password" autocomplete="current-password" placeholder="输入当前登录密码"></div>'+
  '<div class="grid g2" style="gap:10px"><div class="fgrp"><label class="fld">新密码（至少 8 位）</label><input class="inp" id="pw-new" type="password" autocomplete="new-password" placeholder="不能与当前密码相同"></div>'+
  '<div class="fgrp"><label class="fld">确认新密码</label><input class="inp" id="pw-new2" type="password" autocomplete="new-password" placeholder="再输入一次"></div></div>'+
  '<div id="pw-msg" class="hint" style="margin-top:8px"></div>'+
  '<div class="btn-row" style="margin-top:12px"><button class="btn pri" data-act="change-password">'+ic('lock',14)+' 修改密码</button></div>':
  '<div class="warnbox">'+ic('lock')+'<div>请先连接后端、用账号密码登录后，才能修改 <b class="mono">admin</b> 密码。离线演示模式不涉及真实账号。</div></div>';
 var connInfo='<div class="stat-line"><span>后端地址</span><b class="mono">'+esc(backendBase()||'同源 / 离线演示')+'</b></div>'+
  '<div class="stat-line"><span>登录状态</span><b class="'+(state.auth.authenticated?'t':'tw')+'">'+
   (state.auth.authenticated?esc(state.auth.user)+' · '+(state.auth.role==='admin'?'管理员':'只读'):'未登录 / 演示模式')+'</b></div>'+
  '<div class="stat-line"><span>执行模式</span><b class="mono '+(state.settings.allowWrite?'td':'t')+'">'+(state.settings.allowWrite?'EXECUTE 真实执行':'DRY-RUN 只生成命令')+'</b></div><div class="hr"></div>';
 var sw=function(k,l,d){var v=k.split('.').reduce(function(o,x){return o[x];},state);return '<div class="setrow"><div><div class="l">'+l+'</div><div class="d">'+d+'</div></div><button class="switch '+(v?'on':'')+'" data-act="toggle" data-key="'+k+'"></button></div>';};
 return pageH('系统设置','数据源、安全策略、告警阈值与版本适配')+'<div class="grid g2">'+
  card('连接与数据源',connInfo+'<div class="fgrp"><label class="fld">运行模式</label><div class="seg"><button class="'+(state.mode==='demo'?'on acc':'')+'" data-act="mode" data-value="demo">DEMO 演示</button><button class="'+(state.mode==='live'?'on acc':'')+'" data-act="mode" data-value="live">LIVE 对接集群</button></div><div class="hint">LIVE 模式由 Linux 后端托管页面时自动启用，也可在此手动切换。</div></div>'+
   '<div class="fgrp"><label class="fld">API 基地址（留空为同源）</label><input class="inp" data-bind="apiBase" value="'+esc(state.apiBase)+'" placeholder="http://192.168.27.134:8780"></div>'+
   '<div class="fgrp"><label class="fld">访问令牌 X-Console-Token</label><input class="inp" type="password" data-bind="token" value="'+esc(state.token)+'" placeholder="由部署脚本生成"></div>'+
   '<div class="btn-row"><button class="btn pri" data-act="test-conn">'+ic('link',14)+' 测试连接 / 重新探测</button></div><div class="hr"></div>'+sw('autoRefresh','自动刷新','每 15 秒拉取集群状态与告警'))+
  card('安全策略',sw('settings.allowWrite','允许真实写操作','关闭时为 DRY-RUN：只生成命令与日志，不下发到 Ceph 集群。生产环境首次上线请保持关闭。')+
   sw('settings.confirm','危险操作二次确认','踢盘 / 换盘 / 删除前必须手工输入 OSD 编号并勾选确认项。')+
   '<div class="fgrp" style="margin-top:14px"><label class="fld">强制版本覆盖（用于命令模板）</label><select class="inp" data-bind="settings.forceVersion">'+[['auto','自动探测（推荐）']].concat(CEPH_VERSIONS.map(function(v){return [v.v,v.v+' '+v.name];})).map(function(o){return '<option value="'+o[0]+'"'+(s.forceVersion===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></div>'+
   '<div class="fgrp"><label class="fld">部署方式覆盖</label><select class="inp" data-bind="settings.deployMode">'+[['auto','自动探测'],['cephadm','cephadm / orchestrator'],['legacy','ceph-volume / 传统']].map(function(o){return '<option value="'+o[0]+'"'+(s.deployMode===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></div>'+
   '<div class="dangerbox">'+ic('shield')+'<div>后端对 OSD ID 强制整数校验、设备路径白名单校验，所有命令走参数化 subprocess（不经 shell），并写入 jsonl 审计日志。</div></div>')+'</div>'+
  '<div class="grid g2" style="margin-top:14px">'+card('告警阈值','<div class="grid g2">'+
   '<div class="fgrp"><label class="fld">OSD nearfull（%）</label><input class="inp" type="number" data-bind="settings.nearfull" value="'+s.nearfull+'"></div>'+
   '<div class="fgrp"><label class="fld">OSD full（%）</label><input class="inp" type="number" data-bind="settings.full" value="'+s.full+'"></div>'+
   '<div class="fgrp"><label class="fld">OSD down 判定时长（分钟）</label><input class="inp" type="number" data-bind="settings.downMin" value="'+s.downMin+'"></div>'+
   '<div class="fgrp"><label class="fld">degraded PG 阈值</label><input class="inp" type="number" data-bind="settings.pgDegraded" value="'+s.pgDegraded+'"></div>'+
   '<div class="fgrp"><label class="fld">慢请求阈值（ms）</label><input class="inp" type="number" data-bind="settings.slowOps" value="'+s.slowOps+'"></div></div>'+
   '<div class="hint">阈值保存在浏览器会话内；生产环境由后端读取 /etc/ceph-console/config.json 并周期评估。</div>')+
  card('关于','<div class="stat-line"><span>控制台版本</span><b class="mono">1.0.0</b></div><div class="stat-line"><span>前端依赖</span><b class="mono t">0（纯原生 HTML/CSS/JS）</b></div>'+
   '<div class="stat-line"><span>后端依赖</span><b class="mono t">0（Python 3.6+ 标准库）</b></div><div class="stat-line"><span>支持 Ceph</span><b class="mono">12.x ~ 19.x</b></div>'+
   '<div class="stat-line"><span>支持 Linux</span><b class="mono">systemd / SysV · 主流发行版</b></div><div class="hr"></div>'+
   '<div class="note">所有图表为原生 SVG 绘制，无 CDN、无外部字体，可直接放进内网离线环境。页面既可用浏览器直接打开体验 DEMO，也可由后端托管为 LIVE 控制台。</div>')+'</div>'+
  '<div class="grid g2" style="margin-top:14px">'+
  card('账号与密码 · 修改登录密码',pwdBody,'<span class="tag info">PBKDF2</span>')+
  card('密码策略与找回','<div class="stat-line"><span>存储方式</span><b class="mono t">PBKDF2-SHA256 · 120000 轮 + 随机 salt</b></div>'+
   '<div class="stat-line"><span>明文 / 日志</span><b class="mono t">不保存、不记录</b></div>'+
   '<div class="stat-line"><span>修改后</span><b class="mono">同账号其他会话立即失效</b></div><div class="hr"></div>'+
   '<div class="note">忘记密码或账号被锁时，可在【Ceph 节点】离线重置，无需登录、无需重启服务（不回显、输入两次）：</div>'+
   cmdBox('pw-cli','离线重置命令',"sudo python3 ~/ceph-ops-console/ceph-console.py --set-password admin --users-file /etc/ceph-console/users.json"))+
  '</div>';}
