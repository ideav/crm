/* ИНТЕГРАМ FC — ядро рабочих мест. Чтение/запись через API Интеграм. */
(function(){
  var DB = location.pathname.split('/').filter(Boolean)[0] || '';
  var FC = window.FC = { DB: DB, _xsrf: null };

  // ---- ID таблиц и индексы колонок в r[] (r[0] = первая колонка) ----
  FC.T = { TUR:471, POS:481, VID:484, BADGE:489, MST:496, BST:497,
           MEM:498, TEAM:523, PLR:548, MATCH:564, BET:584,
           EV:597, MSG:603, TX:611, AWD:619 };
  // индексы внутри массива r[]
  FC.I = {
    TUR:{name:0,state:1,start:2,end:3,kind:4,desc:5},
    VID:{name:0,cat:1,note:2},
    BADGE:{name:0,icon:1,cond:2,rew:3},
    MEM:{nick:0,ava:1,bal:2,ref:3,inv:4,bets:5,win:6,lose:7,roi:8,streak:9,reg:10,crown:11,rank:12},
    TEAM:{name:0,tur:1,owner:2,emb:3,kind:4,tr:5,w:6,d:7,l:8,gf:9,ga:10,pts:11,form:12},
    PLR:{name:0,team:1,pos:2,user:3,kind:4,pr:5,g:6,a:7,card:8},
    MATCH:{name:0,tur:1,home:2,away:3,stat:4,win:5,dt:6,kind:7,sh:8,sa:9,bank:10,view:11},
    BET:{num:0,match:1,mem:2,vid:3,stat:4,sum:5,win:6,dt:7},
    EV:{min:0,type:1,txt:2},
    MSG:{author:0,trib:1,txt:2,time:3},
    TX:{op:0,amt:1,kind:2,dt:3},
    AWD:{name:0,badge:1,dt:2}
  };
  // reqId колонок для записи (_m_new/_m_set)
  FC.W = {
    BET:{match:586,mem:587,vid:588,stat:590,sum:592,win:594,dt:596},
    MEM:{nick:498,bal:502,crown:520},
    MATCH:{home:566,away:567,stat:569,win:571,sh:577,sa:579,bank:581,view:583},
    MSG:{trib:605,txt:607,time:609}
  };

  // ---- утилиты ----
  FC.refId = function(v){ if(v==null) return null; var s=String(v); var i=s.indexOf(':'); return i<0?(s||null):s.slice(0,i); };
  FC.refLabel = function(v){ if(v==null) return ''; var s=String(v); var i=s.indexOf(':'); return i<0?s:s.slice(i+1); };
  FC.num = function(v){ var n=parseFloat(v); return isNaN(n)?0:n; };
  FC.esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
  FC.fmtDT = function(v){ var n=parseInt(v,10); if(!n||isNaN(n)) return '—';
    var d=new Date(n*1000); var p=function(x){return(x<10?'0':'')+x;};
    return p(d.getDate())+'.'+p(d.getMonth()+1)+'.'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes()); };
  FC.fmtDate = function(s){ if(!s) return '—'; var m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m?m[3]+'.'+m[2]+'.'+m[1]:s; };
  FC.gpos = function(n){ n=FC.num(n); var c=n>0?'gpos':(n<0?'gneg':''); return '<span class="'+c+'">'+(n>0?'+':'')+n+' Ǥ</span>'; };

  // ---- API ----
  FC.get = function(path){
    return fetch('/'+DB+'/'+path, {credentials:'include', headers:{'Accept':'application/json'}})
      .then(function(r){ return r.text(); })
      .then(function(t){ try{ return JSON.parse(t); }catch(e){ return null; } });
  };
  // список записей таблицы: rows -> [{i,u,o,r}]
  FC.list = function(typeId, qs){ return FC.get('object/'+typeId+'/?JSON_OBJ'+(qs?'&'+qs:'&LIMIT=0,300'))
      .then(function(d){ return Array.isArray(d)?d:[]; }); };
  FC.children = function(typeId, parentId){ return FC.list(typeId, 'F_U='+parentId+'&LIMIT=0,200'); };
  FC.xsrf = function(){ if(FC._xsrf) return Promise.resolve(FC._xsrf);
    return FC.get('xsrf?JSON=1').then(function(d){ FC._xsrf=d&&d._xsrf; return FC._xsrf; }); };
  FC.post = function(endpoint, fields){
    return FC.xsrf().then(function(x){
      var fd=new FormData(); fd.append('_xsrf',x);
      for(var k in fields){ if(fields[k]!=null) fd.append(k, fields[k]); }
      return fetch('/'+DB+'/'+endpoint+'?JSON=1', {method:'POST', credentials:'include', body:fd})
        .then(function(r){ return r.json().catch(function(){return{};}); });
    });
  };
  FC.create = function(typeId, fields, up){ fields=fields||{}; fields.up=(up||1); return FC.post('_m_new/'+typeId, fields); };
  FC.update = function(objId, fields){ return FC.post('_m_set/'+objId, fields); };

  // эффективные права роли (если оболочка их прокинула)
  FC.grants = (function(){ try{ return JSON.parse(atob(window.__FC_GRANTS||'')); }catch(e){ return {}; } })();
  FC.canWrite = function(typeId){ var g=FC.grants; return g['1']==='WRITE' || g[String(typeId)]==='WRITE'; };

  // ---- UI helpers ----
  FC.toast = function(msg, red){ var t=document.querySelector('.toast'); if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t);}
    t.className='toast'+(red?' red':''); t.textContent=msg; t.style.display='block'; setTimeout(function(){t.style.display='none';},2600); };
  FC.hero = function(title, subtitle){
    return '<div class="fc-hero"><div class="fc-logo"><span class="b">Ǥ</span>ИНТЕГРАМ FC</div>'+
      '<div class="sp"></div><div style="text-align:right"><h1>'+FC.esc(title)+'</h1><p>'+FC.esc(subtitle||'')+'</p></div></div>';
  };
  FC.matchStatusChip = function(label){
    var l=(label||'').toLowerCase();
    if(l.indexOf('идёт')>=0||l.indexOf('идет')>=0) return '<span class="chip live">'+FC.esc(label)+'</span>';
    if(l.indexOf('открыт')>=0) return '<span class="chip green">'+FC.esc(label)+'</span>';
    if(l.indexOf('заверш')>=0) return '<span class="chip">'+FC.esc(label)+'</span>';
    return '<span class="chip gold">'+FC.esc(label)+'</span>';
  };
  // загрузить участников/матчи/виды как словари {id->row}
  FC.index = function(rows){ var m={}; rows.forEach(function(x){ m[x.i]=x; }); return m; };

  // ---- Виральные карточки достижений и хуки конструктора (issue #3932) ----
  FC.CONSTRUCTOR_URL = 'https://integram.io';

  // счётчик побед/поражений участника из его ставок
  FC.winStats = function(memberId, bets){
    var w=0,l=0,p=0;
    (bets||[]).forEach(function(b){
      if(String(FC.refId(b.r[FC.I.BET.mem]))!==String(memberId)) return;
      var st=FC.refLabel(b.r[FC.I.BET.stat]);
      if(st==='Выиграла') w++; else if(st==='Проиграла') l++; else p++;
    });
    return {w:w,l:l,p:p};
  };

  // ссылки шеринга в мессенджеры
  FC.shareUrls = function(url, text){
    var u=encodeURIComponent(url||''), t=encodeURIComponent(text||'');
    return {
      tg:'https://t.me/share/url?url='+u+'&text='+t,
      wa:'https://wa.me/?text='+t+'%20'+u,
      vk:'https://vk.com/share.php?url='+u+'&title='+t
    };
  };
  // кнопки шеринга: Telegram / WhatsApp / VK + копировать
  FC.shareButtons = function(url, text){
    var s=FC.shareUrls(url, text);
    return '<div class="fc-share">'+
      '<a class="btn fc-sh-tg" target="_blank" rel="noopener" href="'+s.tg+'">Telegram</a>'+
      '<a class="btn fc-sh-wa" target="_blank" rel="noopener" href="'+s.wa+'">WhatsApp</a>'+
      '<a class="btn fc-sh-vk" target="_blank" rel="noopener" href="'+s.vk+'">VK</a>'+
      '<button class="btn ghost" type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText('+JSON.stringify(url)+');FC.toast(\'Ссылка скопирована\')"><i class="pi pi-copy"></i> Копировать</button>'+
    '</div>';
  };

  // персональная карточка достижений (аватар, ник, счётчик побед, значки) — для шеринга
  FC.achievementCard = function(m, awards, stats){
    var IE=FC.I.MEM; awards=awards||[]; stats=stats||{w:0,l:0,p:0};
    var badges = awards.length
      ? awards.map(function(a){ return '<span class="chip gold">🏅 '+FC.esc(a.r[FC.I.AWD.name])+'</span>'; }).join(' ')
      : '<span class="fc-muted" style="font-size:12px">Значков пока нет — играй активнее!</span>';
    var crown = String(m.r[IE.crown])==='1' ? '<span class="chip red">👑 Капитан Очевидность</span>' : '';
    var roi=FC.num(m.r[IE.roi]);
    return '<div class="fc-share-card">'+
      '<div class="fcc-head"><div class="fcc-brand"><span class="b">Ǥ</span> ИНТЕГРАМ FC</div>'+
        '<div class="fcc-sub">Антитотализатор пророков</div></div>'+
      '<div class="fcc-body">'+
        '<div class="fcc-ava">'+FC.esc(m.r[IE.ava]||'👤')+'</div>'+
        '<div class="fcc-nick">'+FC.esc(m.r[IE.nick])+'</div>'+
        '<div class="fcc-rank"><span class="chip">'+FC.esc(m.r[IE.rank]||'Новичок')+'</span> '+crown+'</div>'+
        '<div class="fcc-score"><span class="gpos">'+stats.w+'</span><span class="fcc-dash">:</span><span class="gneg">'+stats.l+'</span></div>'+
        '<div class="fcc-score-l">побед : поражений</div>'+
        '<div class="fcc-kpis">'+
          '<div><b class="g">'+m.r[IE.bal]+'</b><span>баланс</span></div>'+
          '<div><b style="color:'+(roi>=0?'var(--fc-green)':'var(--fc-cringe)')+'">'+(roi>=0?'+':'')+roi+'%</b><span>ROI</span></div>'+
          '<div><b>🔥 '+m.r[IE.streak]+'</b><span>серия</span></div>'+
        '</div>'+
        '<div class="fcc-badges">'+badges+'</div>'+
      '</div>'+
      '<div class="fcc-foot">Сделано на <b>Интеграм</b> — конструкторе приложений</div>'+
    '</div>';
  };

  // публичная ссылка на карточку участника
  FC.cardUrl = function(m){
    var ref=m.r[FC.I.MEM.ref];
    return location.origin+'/'+FC.DB+'/share?me='+m.i+(ref?'&ref='+encodeURIComponent(ref):'');
  };

  // крупный баннер конструктора (для публичного лендинга карточки)
  FC.constructorBanner = function(){
    return '<div class="fc-card fc-constructor">'+
      '<div class="fcn-title">Интеграм — конструктор, на котором создан этот тотализатор</div>'+
      '<div class="fcn-text">Хотите так же собрать свою игру под любой спорт или киберспорт? Сделайте свой за 10 минут без кода.</div>'+
      '<div class="fcn-steps">'+
        '<div class="fcn-step"><span>1</span>Выбери шаблон</div>'+
        '<div class="fcn-step"><span>2</span>Добавь события</div>'+
        '<div class="fcn-step"><span>3</span>Опубликуй</div>'+
      '</div>'+
      '<a class="btn gold" target="_blank" rel="noopener" href="'+FC.CONSTRUCTOR_URL+'"><i class="pi pi-bolt"></i> Создать своё приложение</a>'+
    '</div>';
  };

  // ненавязчивая контекстная плашка про конструктор: не чаще 1 раза в 3 дня (issue #3932)
  FC.constructorNudge = function(target, text){
    var KEY='fc_nudge_'+FC.DB;
    try{ if(Date.now()-parseInt(localStorage.getItem(KEY)||'0',10) < 3*24*3600*1000) return; }catch(e){}
    var host = typeof target==='string'?document.getElementById(target):target;
    if(!host) return;
    var box=document.createElement('div'); box.className='fc-nudge';
    box.innerHTML='<i class="pi pi-info-circle"></i>'+
      '<div class="fc-nudge-t">'+(text||'Кстати, весь этот тотализатор — пример возможностей Интеграм. Хотите собрать свою игру под любой спорт?')+
      ' <a target="_blank" rel="noopener" href="'+FC.CONSTRUCTOR_URL+'">Открыть конструктор →</a></div>'+
      '<button class="fc-nudge-x" type="button" aria-label="Закрыть">×</button>';
    box.querySelector('.fc-nudge-x').onclick=function(){ box.remove(); };
    host.appendChild(box);
    try{ localStorage.setItem(KEY, String(Date.now())); }catch(e){}
  };

  // ---- Битва друзей (дуэль пророков) — issue #3932 ----
  // Нужны две таблицы: «Дуэль» и подчинённая «Участник дуэли». ID типов/реквизитов
  // подставляются после создания таблиц: вставьте JSON из мастера настройки в
  // FC.DUEL_CFG (или он подхватится из localStorage у настроившего администратора).
  FC.DUEL_CFG = null;
  FC.I.DUEL  = {name:0, cap:1, match:2, vid:3, stake:4, stat:5, res:6, dt:7};
  FC.I.DUELP = {name:0, mem:1, pred:2, result:3};
  FC.DUEL_ST = {OPEN:'Открыта', LIVE:'Идёт', DONE:'Завершена'};
  (function(){
    var cfg=FC.DUEL_CFG;
    if(!cfg){ try{ cfg=JSON.parse(localStorage.getItem('fc_duel_cfg_'+FC.DB)||'null'); }catch(e){} }
    if(cfg){ FC.T.DUEL=cfg.t; FC.T.DUELP=cfg.tp; FC.W.DUEL=cfg.w; FC.W.DUELP=cfg.wp; }
  })();
  FC.duelReady = function(){ return FC.T.DUEL>0 && FC.T.DUELP>0 && !!(FC.W&&FC.W.DUEL&&FC.W.DUELP); };

  // подведение итогов (чистая функция) — кто пророк / дивергент / афоня / оракул.
  // preds: [{mem, pred:'Да'|'Нет', cap:bool}]; actual:'Да'|'Нет'
  FC.duelOutcome = function(preds, actual){
    var cap = preds.filter(function(p){return p.cap;})[0];
    var capRight = !!(cap && cap.pred===actual);
    var allRight = preds.length>0 && preds.every(function(p){ return p.pred===actual; });
    return preds.map(function(p){
      var right = p.pred===actual, result='Афоня';
      if(right) result = p.cap ? 'Пророк' : (capRight ? 'Пророк' : 'Дивергент');
      if(allRight) result='Футбольный Оракул';   // вся команда угадала — коллективный значок
      return { mem:p.mem, cap:!!p.cap, pred:p.pred, right:right, result:result };
    });
  };

  // разовое создание таблиц дуэлей через схемные команды _d_* (только для админа).
  // Идемпотентно (повторный вызов вернёт существующие id). log(msg) — колбэк прогресса.
  FC.duelProvision = async function(log){
    log=log||function(){};
    async function newType(code,val,uniq){ var f={t:code,val:val}; if(uniq)f.unique=1; var r=await FC.post('_d_new',f); return r&&r.obj; }
    async function addReq(table,typeId,alias){ var r=await FC.post('_d_req/'+table,{t:typeId}); var id=r&&r.id; if(id&&alias) await FC.post('_d_alias/'+id,{val:alias}); return id; }
    async function refCol(table,targetTable,alias){ var r=await FC.post('_d_ref/'+targetTable,{}); var rt=r&&(r.obj||r.id); return await addReq(table,rt,alias); }

    log('Создаю таблицу «Дуэль»…');
    var t=await newType(3,'Дуэль'); if(!t) throw new Error('не удалось создать таблицу Дуэль');
    var w={};
    w.cap  =await refCol(t, FC.T.MEM,  'Капитан');                        log('  + Капитан');
    w.match=await refCol(t, FC.T.MATCH,'Матч');                          log('  + Матч');
    w.vid  =await refCol(t, FC.T.VID,  'Событие');                       log('  + Событие');
    w.stake=await addReq(t, await newType(13,'Ставка грамы'),'Ставка Ǥ'); log('  + Ставка');
    w.stat =await addReq(t, await newType(3,'Статус дуэли'),'Статус');    log('  + Статус');
    w.res  =await addReq(t, await newType(3,'Итог события'),'Итог');      log('  + Итог');
    w.dt   =await addReq(t, await newType(4,'Создана дуэль'),'Создана');  log('  + Создана');

    log('Создаю таблицу «Участник дуэли»…');
    var tp=await newType(3,'Участник дуэли'); if(!tp) throw new Error('не удалось создать таблицу Участник');
    var wp={};
    wp.mem   =await refCol(tp, FC.T.MEM,'Участник');                      log('  + Участник');
    wp.pred  =await addReq(tp, await newType(3,'Прогноз'),'Прогноз');     log('  + Прогноз');
    wp.result=await addReq(tp, await newType(3,'Результат дуэли'),'Результат'); log('  + Результат');

    log('Связываю как подчинённую таблицу…');
    await addReq(t, tp, 'Участники');   // id дочерней таблицы как реквизит родителя → подчинённая

    var cfg={t:t, tp:tp, w:w, wp:wp};
    try{ localStorage.setItem('fc_duel_cfg_'+FC.DB, JSON.stringify(cfg)); }catch(e){}
    FC.T.DUEL=t; FC.T.DUELP=tp; FC.W.DUEL=w; FC.W.DUELP=wp;
    log('Готово! Таблицы созданы и подключены.');
    return cfg;
  };

  document.addEventListener('DOMContentLoaded', function(){ document.body.classList.add('fc-loaded'); });
})();
