// Пора — публичная афиша базы timepad (issue #5461), страница /timepad/afisha (templates/timepad/afisha.html).
// Данные читаются и пишутся от имени гостя базы (пользователь guest, токен гостя ниже).
// Права гостя: READ на «Категория» и «Событие» (маска «Опубликовано» = 1), READ на отчёт
// «Занятость», WRITE на «Билет» только для записей с первым полем «~%»: гость создаёт билет
// с кодом «~XXXX», триггер колонки «Выдача билета» сразу снимает «~», и запись пропадает
// из видимости гостя.
(function(){
'use strict';
var DB = 'timepad';
var GUEST = 'gtuoeksetn';          // фиксированный токен гостя ядра (index.php, Validate_Token)
var T = { cat: 469, event: 470, ticket: 494, sold: 'Занятость' };
var EV = { start: 472, end: 474, place: 476, addr: 478, city: 480, desc: 481, price: 483,
           cap: 485, org: 487, cover: 489, pub: 491, cat: 493 };
var TK = { event: 496, name: 546, email: 609, phone: 611 };
var TZ = 'Europe/Moscow';
var GRADS = [
  ['#ff5a36','#ff9a3c'], ['#5b5bd6','#8e7cf0'], ['#0ea5a4','#34d399'], ['#e11d74','#f472b6'],
  ['#2563eb','#38bdf8'], ['#a16207','#f59e0b'], ['#7c3aed','#ec4899']
];

var app = typeof document !== 'undefined' ? document.getElementById('app') : null;
var state = { events: null, sold: {}, cats: [], cat: '', city: '', q: '' };

// ---------- API ----------
function api(path, body){
  var opt = { headers: { 'X-Authorization': GUEST }, credentials: 'omit' };
  if(body){
    opt.method = 'POST';
    opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opt.body = new URLSearchParams(body).toString();
  }
  return fetch('/' + DB + '/' + path, opt).then(function(r){
    return r.text().then(function(t){
      var j;
      try { j = JSON.parse(t); } catch(e){ throw new Error('Сервер ответил не JSON (' + r.status + ')'); }
      if(Array.isArray(j) && j[0] && j[0].error) throw new Error(stripTags(j[0].error));
      return j;
    });
  });
}
function stripTags(s){ return String(s).replace(/<[^>]*>/g, ''); }

function loadAll(){
  return Promise.all([
    api('metadata/' + T.event + '?JSON=1'),
    api('object/' + T.event + '/?JSON_OBJ&LIMIT=0,500'),
    loadSold()
  ]).then(function(res){
    var meta = res[0], rows = res[1] || [];
    var pos = {};
    (meta.reqs || []).forEach(function(r){ pos[r.id] = r.num; });
    var cats = {};
    state.events = rows.map(function(o){
      var r = o.r, g = function(id){ return pos[id] != null ? r[pos[id]] : ''; };
      var cat = String(g(EV.cat) || ''), ci = cat.indexOf(':');
      var ev = {
        id: o.i, title: r[0],
        start: +g(EV.start) || 0, end: +g(EV.end) || 0,
        place: g(EV.place), addr: g(EV.addr), city: g(EV.city), desc: g(EV.desc),
        price: +g(EV.price) || 0, cap: +g(EV.cap) || 0, org: g(EV.org), cover: g(EV.cover),
        pub: g(EV.pub), catId: ci > 0 ? cat.slice(0, ci) : '', cat: ci > 0 ? cat.slice(ci + 1) : cat
      };
      if(ev.cat) cats[ev.cat] = 1;
      return ev;
    }).filter(function(e){ return String(e.pub) === '1'; })
      .sort(function(a, b){ return a.start - b.start; });
    state.cats = Object.keys(cats).sort();
  });
}
function loadSold(){
  return api('report/' + encodeURIComponent(T.sold) + '?JSON_KV').then(function(rows){
    var m = {};
    (rows || []).forEach(function(x){ m[x.event] = +x.sold || 0; });
    state.sold = m;
  });
}

// ---------- Форматирование ----------
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(ts, o){ return new Intl.DateTimeFormat('ru-RU', Object.assign({ timeZone: TZ }, o)).format(new Date(ts * 1000)); }
function dayMonth(ts){ return fmt(ts, { day: 'numeric', month: 'long' }); }
function weekday(ts){ return fmt(ts, { weekday: 'long' }); }
function hm(ts){ return fmt(ts, { hour: '2-digit', minute: '2-digit' }); }
function when(e){
  if(!e.start) return 'Дата уточняется';
  var s = weekday(e.start) + ', ' + dayMonth(e.start) + ', ' + hm(e.start);
  if(e.end) s += dayMonth(e.end) === dayMonth(e.start) ? '–' + hm(e.end) : ' — ' + dayMonth(e.end) + ', ' + hm(e.end);
  return s;
}
function price(e){ return e.price > 0 ? e.price.toLocaleString('ru-RU') + ' ₽' : 'Бесплатно'; }
function left(e){ return e.cap > 0 ? Math.max(0, e.cap - (state.sold[e.id] || 0)) : Infinity; }
function leftText(e){
  var l = left(e);
  if(l === Infinity) return '';
  if(l === 0) return 'Мест нет';
  return 'Осталось ' + l + ' ' + plural(l, 'место', 'места', 'мест');
}
function plural(n, a, b, c){ var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : (m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); }
function grad(e){
  // Цвет обложки — по категории: у каждой категории свой градиент, пока категорий не больше палитры
  var k = state.cats.indexOf(e.cat), s = e.cat || e.title;
  if(k < 0){ k = 0; for(var i = 0; i < s.length; i++) k = (k * 31 + s.charCodeAt(i)) >>> 0; }
  var g = GRADS[k % GRADS.length];
  return 'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')';
}
function coverStyle(e){
  return /^https:\/\//.test(e.cover)
    ? 'background-image:url(&quot;' + esc(e.cover) + '&quot;),' + grad(e)
    : 'background-image:' + grad(e);
}
function paras(t){
  return String(t || '').split(/\n\s*\n|\r\n\s*\r\n/).map(function(p){
    return '<p>' + esc(p).replace(/\r?\n/g, '<br>') + '</p>';
  }).join('');
}

// ---------- Мои билеты (в браузере посетителя) ----------
function myTickets(){ try { return JSON.parse(localStorage.getItem('pora.tickets') || '[]'); } catch(e){ return []; } }
function saveTicket(t){ try { var a = myTickets(); a.unshift(t); localStorage.setItem('pora.tickets', JSON.stringify(a.slice(0, 50))); } catch(e){} }
function navBadge(){
  var n = myTickets().length, a = document.getElementById('nav-tickets');
  a.innerHTML = 'Мои билеты' + (n ? '<span class="badge">' + n + '</span>' : '');
}

// ---------- Экраны ----------
function viewList(){
  if(!state.events){ app.innerHTML = '<div class="hero"><div class="skeleton"></div></div>'; return; }
  var cities = {};
  state.events.forEach(function(e){ if(e.city) cities[e.city] = 1; });
  app.innerHTML =
    '<section class="hero"><h1>Куда пойти</h1><p>Концерты, лекции и мастер-классы. Регистрация за минуту — билет сразу на экране.</p>' +
    '<div class="search"><input id="q" type="search" placeholder="Название, место, организатор" value="' + esc(state.q) + '">' +
    '<select id="city"><option value="">Все города</option>' + Object.keys(cities).sort().map(function(c){
      return '<option' + (c === state.city ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="chips"><button class="chip' + (state.cat ? '' : ' on') + '" data-cat="">Все</button>' +
    state.cats.map(function(c){ return '<button class="chip' + (c === state.cat ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') +
    '</div></section><section id="grid"></section>';
  document.getElementById('q').addEventListener('input', function(){ state.q = this.value; drawGrid(); });
  document.getElementById('city').addEventListener('change', function(){ state.city = this.value; drawGrid(); });
  Array.prototype.forEach.call(app.querySelectorAll('.chip'), function(b){
    b.addEventListener('click', function(){
      state.cat = b.getAttribute('data-cat');
      Array.prototype.forEach.call(app.querySelectorAll('.chip'), function(x){ x.classList.toggle('on', x === b); });
      drawGrid();
    });
  });
  drawGrid();
}
function drawGrid(){
  var q = state.q.trim().toLowerCase(), now = Date.now() / 1000;
  var list = state.events.filter(function(e){
    if(state.cat && e.cat !== state.cat) return false;
    if(state.city && e.city !== state.city) return false;
    if((e.end || e.start) && (e.end || e.start) < now) return false;
    return !q || [e.title, e.place, e.org, e.addr, e.cat].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var g = document.getElementById('grid');
  if(!list.length){ g.innerHTML = '<div class="empty">Ничего не нашлось. Попробуйте другой запрос или город.</div>'; return; }
  g.innerHTML = '<div class="grid">' + list.map(card).join('') + '</div>';
}
function card(e){
  var l = left(e);
  return '<a class="card" href="#/e/' + e.id + '">' +
    '<div class="cover" style="' + coverStyle(e) + '">' +
      (e.start ? '<div class="date-badge"><b>' + fmt(e.start, { day: 'numeric' }) + '</b><span>' + fmt(e.start, { month: 'short' }).replace('.', '') + '</span></div>' : '') +
      (e.cat ? '<span class="cover-cat">' + esc(e.cat) + '</span>' : '') +
    '</div><div class="card-body"><h3>' + esc(e.title) + '</h3>' +
    '<div class="meta">' + esc(e.start ? weekday(e.start) + ', ' + hm(e.start) : 'Дата уточняется') + (e.city ? ' · ' + esc(e.city) : '') + '</div>' +
    (e.place ? '<div class="meta">' + esc(e.place) + '</div>' : '') +
    '<div class="card-foot"><span class="price' + (e.price > 0 ? '' : ' free') + '">' + price(e) + '</span>' +
    '<span class="left' + (l !== Infinity && l <= 5 ? ' low' : '') + '">' + leftText(e) + '</span></div></div></a>';
}

function findEvent(id){ return (state.events || []).filter(function(e){ return String(e.id) === String(id); })[0]; }

function viewEvent(id){
  var e = findEvent(id);
  if(!e){ app.innerHTML = '<a class="back" href="#/">← Афиша</a><div class="empty">Событие не найдено или снято с публикации.</div>'; return; }
  document.title = e.title + ' — Пора';
  var l = left(e), sold = state.sold[e.id] || 0, past = (e.end || e.start) && (e.end || e.start) < Date.now() / 1000;
  var fill = e.cap > 0 ? Math.min(100, Math.round(sold / e.cap * 100)) : 0;
  app.innerHTML = '<a class="back" href="#/">← Афиша</a><div class="event"><article>' +
    '<div class="cover" style="' + coverStyle(e) + '">' + (e.cat ? '<span class="cover-cat">' + esc(e.cat) + '</span>' : '') + '</div>' +
    '<h1>' + esc(e.title) + '</h1><ul class="facts">' +
    '<li><span class="k">Когда</span><span>' + esc(when(e)) + '</span></li>' +
    (e.place || e.addr ? '<li><span class="k">Где</span><span>' + esc(e.place) + (e.addr ? '<br><span class="meta">' + esc([e.city, e.addr].filter(Boolean).join(', ')) + '</span>' : '') + '</span></li>' : '') +
    (e.org ? '<li><span class="k">Организатор</span><span>' + esc(e.org) + '</span></li>' : '') +
    '</ul><div class="desc">' + paras(e.desc) + '</div></article>' +
    '<aside class="panel"><div class="price' + (e.price > 0 ? '' : ' free') + '">' + price(e) + '</div>' +
    (e.cap > 0 ? '<div class="bar"><i style="width:' + fill + '%"></i></div><div class="left' + (l <= 5 ? ' low' : '') + '">' + leftText(e) + '</div>' : '') +
    (past ? '<p class="note">Событие уже прошло.</p>' : l === 0 ? '<p class="note">Регистрация закрыта: все места заняты.</p>' :
    '<form class="form" id="reg" novalidate>' +
      '<label>Имя и фамилия<input type="text" name="name" maxlength="80" autocomplete="name" required></label>' +
      '<label>Email<input type="email" name="email" maxlength="80" autocomplete="email" required></label>' +
      '<label>Телефон <span class="note">необязательно</span><input type="tel" name="phone" maxlength="30" autocomplete="tel"></label>' +
      '<label class="check"><input type="checkbox" name="agree" required> Согласен на обработку персональных данных для участия в событии</label>' +
      '<div class="err" id="err"></div>' +
      '<button class="btn" type="submit">' + (e.price > 0 ? 'Забронировать билет' : 'Зарегистрироваться') + '</button>' +
      (e.price > 0 ? '<p class="note">Оплата — на месте, у организатора.</p>' : '') +
    '</form>') + '</aside></div>';
  var f = document.getElementById('reg');
  if(f) f.addEventListener('submit', function(ev){ ev.preventDefault(); register(e, f); });
}

function register(e, f){
  var err = document.getElementById('err'), btn = f.querySelector('button'), el = f.elements;
  var name = el.name.value.trim(), email = el.email.value.trim(), phone = el.phone.value.trim();
  err.textContent = '';
  if(name.length < 2){ err.textContent = 'Укажите имя.'; el.name.focus(); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent = 'Проверьте email.'; el.email.focus(); return; }
  if(phone && !/^[0-9+()\-\s]{5,30}$/.test(phone)){ err.textContent = 'Телефон — только цифры, +, скобки и дефисы.'; el.phone.focus(); return; }
  if(!el.agree.checked){ err.textContent = 'Нужно согласие на обработку данных.'; return; }
  btn.disabled = true; btn.textContent = 'Оформляем…';
  loadSold().then(function(){
    if(left(e) <= 0) throw new Error('Пока вы заполняли форму, места закончились.');
    return api('xsrf?JSON');
  }).then(function(x){ return create(e, x._xsrf, name, email, phone, 0); })
    .then(function(code){
      var t = { code: code, event: e.id, title: e.title, start: e.start, end: e.end, place: e.place,
                addr: [e.city, e.addr].filter(Boolean).join(', '), name: name, price: e.price, cat: e.cat };
      saveTicket(t);
      state.sold[e.id] = (state.sold[e.id] || 0) + 1;
      navBadge();
      location.hash = '#/t/' + code;
    })
    .catch(function(x){
      err.textContent = x.message || 'Не получилось. Попробуйте ещё раз.';
      btn.disabled = false; btn.textContent = 'Попробовать ещё раз';
    });
}
function newCode(){
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = 'TP', b = new Uint8Array(8);
  crypto.getRandomValues(b);
  for(var i = 0; i < 8; i++) s += a[b[i] % a.length];
  return s;
}
function create(e, xsrf, name, email, phone, attempt){
  var code = newCode(), body = { _xsrf: xsrf, up: 1 };
  body['t' + T.ticket] = '~' + code;
  body['t' + TK.event] = e.id;
  body['t' + TK.name] = name;
  body['t' + TK.email] = email;
  if(phone) body['t' + TK.phone] = phone;
  return api('_m_new/' + T.ticket + '?JSON', body).then(function(r){
    // Таблица «Билет» уникальна по коду: совпадение кода сервер возвращает предупреждением
    if(r.warning || !r.id){
      if(attempt < 3) return create(e, xsrf, name, email, phone, attempt + 1);
      throw new Error('Не удалось выдать билет. Попробуйте ещё раз.');
    }
    return code;
  });
}

function viewTicket(code){
  var t = myTickets().filter(function(x){ return x.code === code; })[0];
  if(!t){ app.innerHTML = '<a class="back" href="#/tickets">← Мои билеты</a><div class="empty">Билет не найден в этом браузере.</div>'; return; }
  var e = findEvent(t.event) || { cat: t.cat, title: t.title };
  app.innerHTML = '<div class="ticket"><div class="ticket-head" style="background:' + grad(e) + '">' +
    '<div class="ok">✓ Вы зарегистрированы</div><h2>' + esc(t.title) + '</h2></div>' +
    '<div class="ticket-body"><div class="note">Код билета — назовите его на входе</div><div class="code">' + esc(t.code) + '</div>' +
    '<ul class="facts"><li><span class="k">Участник</span><span>' + esc(t.name) + '</span></li>' +
    '<li><span class="k">Когда</span><span>' + esc(when(t)) + '</span></li>' +
    (t.place || t.addr ? '<li><span class="k">Где</span><span>' + esc(t.place) + (t.addr ? '<br><span class="meta">' + esc(t.addr) + '</span>' : '') + '</span></li>' : '') +
    '<li><span class="k">Стоимость</span><span>' + (t.price > 0 ? esc(t.price.toLocaleString('ru-RU')) + ' ₽, оплата на месте' : 'Бесплатно') + '</span></li></ul>' +
    '<p class="note">Билет сохранён в разделе «Мои билеты» этого браузера. Сделайте скриншот, чтобы не потерять код.</p>' +
    '<div class="actions">' + (t.start ? '<button class="btn" id="ics">Добавить в календарь</button>' : '') +
    '<a class="btn ghost" href="#/e/' + esc(t.event) + '">К событию</a></div></div></div>';
  var b = document.getElementById('ics');
  if(b) b.addEventListener('click', function(){ downloadIcs(t); });
}
function downloadIcs(t){
  function d(ts){ return new Date(ts * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); }
  function txt(s){ return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
  var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pora//RU', 'BEGIN:VEVENT',
    'UID:' + t.code + '@ideav.ru', 'DTSTAMP:' + d(Date.now() / 1000), 'DTSTART:' + d(t.start),
    'DTEND:' + d(t.end || t.start + 7200), 'SUMMARY:' + txt(t.title),
    'LOCATION:' + txt([t.place, t.addr].filter(Boolean).join(', ')),
    'DESCRIPTION:' + txt('Билет ' + t.code), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'bilet-' + t.code + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
}

function viewTickets(){
  var a = myTickets();
  app.innerHTML = '<section class="hero"><h1>Мои билеты</h1><p>Билеты, оформленные в этом браузере.</p></section>' +
    (a.length ? '<div class="list">' + a.map(function(t){
      return '<a class="row" href="#/t/' + esc(t.code) + '"><span><b>' + esc(t.title) + '</b><br><span class="meta">' +
        esc(t.start ? dayMonth(t.start) + ', ' + hm(t.start) : '') + '</span></span><span class="code-s">' + esc(t.code) + '</span></a>';
    }).join('') + '</div>' : '<div class="empty">Билетов пока нет. <a href="#/">Выбрать событие</a></div>');
}

// ---------- Маршруты ----------
function route(){
  var h = location.hash.replace(/^#\/?/, ''), p = h.split('/');
  document.title = 'Пора — афиша событий';
  Array.prototype.forEach.call(document.querySelectorAll('.top-nav a'), function(a){
    a.classList.toggle('on', a.getAttribute('href') === '#/' + (p[0] === 'tickets' || p[0] === 't' ? 'tickets' : ''));
  });
  if(!state.events && p[0] !== 'tickets' && p[0] !== 't') app.innerHTML = '<div class="hero"><div class="skeleton"></div></div>';
  else if(p[0] === 'e') viewEvent(p[1]);
  else if(p[0] === 't') viewTicket(decodeURIComponent(p[1] || ''));
  else if(p[0] === 'tickets') viewTickets();
  else viewList();
  // Страница рисуется поверх оболочки Интеграма: прокручивается контейнер приложения, а не окно
  var root = document.getElementById('tp-root');
  if(root && (p[0] !== '' || !state.events)) root.scrollTop = 0;
}

// Ядро для мерки experiments/timepad-afisha-5461.test.js; в браузере (есть #app) — запуск страницы
if(typeof module === 'object' && module && module.exports)
  module.exports = { create: create, left: left, plural: plural, state: state };
if(app){
  window.addEventListener('hashchange', route);
  navBadge();
  route();
  loadAll().then(route).catch(function(x){
    app.innerHTML = '<div class="empty">Афиша не загрузилась: ' + esc(x.message) + '</div>';
  });
}
})();
