/* Портал «Решения» базы solutions (issue #5643). Каталог, страница решения, форма заявки.
   Данные — object/<таблица>/?JSON_OBJ&NAMED (гость видит только опубликованное: маска роли guest),
   заявка — один _m_new на таблицу «Заявка». Чистая логика — в Core, проверяется experiments/solutions-5643.test.js. */
(function (root) {
  'use strict';

  var Core = {
    // «a\nb\r\n\n c» → ['a','b','c']; маркеры списка в начале строки отбрасываются
    splitLines: function (s) {
      return String(s == null ? '' : s).split(/\r?\n/).map(function (l) {
        return l.replace(/^\s*(?:[-•*–—]|\d+[.)])\s+/, '').trim();
      }).filter(Boolean);
    },
    isOn: function (v) { return v === 1 || v === '1' || v === true; },
    // только http(s)-ссылки; всё остальное (javascript:, data:) — пусто
    safeUrl: function (u) {
      var s = String(u == null ? '' : u).trim();
      return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
    },
    refs: function (v) { // null | {id,val} | [{id,val}] → массив
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    },
    normalize: function (row) {
      var cat = Core.refs(row['Категория'])[0] || null;
      return {
        id: Number(row.id),
        title: row['Решение'] || '',
        short: row['Кратко'] || '',
        pain: row['Боль'] || '',
        features: Core.splitLines(row['Что умеет']),
        steps: Core.splitLines(row['Как переезжаем']),
        category: cat ? { id: Number(cat.id), val: cat.val } : null,
        industries: Core.refs(row['Отрасль']).map(function (x) { return { id: Number(x.id), val: x.val }; }),
        platforms: Core.refs(row['Надстройка над']).map(function (x) { return { id: Number(x.id), val: x.val }; }),
        demo: Core.safeUrl(row['Демо ссылка']),
        demoSoon: Core.isOn(row['Демо скоро']),
        published: Core.isOn(row['Опубликовано']),
        order: row['Порядок'] === '' || row['Порядок'] == null ? 1e9 : Number(row['Порядок'])
      };
    },
    sortSolutions: function (a) {
      return a.slice().sort(function (x, y) { return (x.order - y.order) || x.title.localeCompare(y.title, 'ru'); });
    },
    // f: {cat, ind, plat — id или '', q — строка}
    filter: function (list, f) {
      var q = String(f.q || '').trim().toLowerCase();
      return list.filter(function (s) {
        if (!s.published) return false;
        if (f.cat && !(s.category && String(s.category.id) === String(f.cat))) return false;
        if (f.ind && !s.industries.some(function (x) { return String(x.id) === String(f.ind); })) return false;
        if (f.plat && !s.platforms.some(function (x) { return String(x.id) === String(f.plat); })) return false;
        if (q && (s.title + ' ' + s.short + ' ' + s.pain).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    },
    parseHash: function (h) {
      var s = String(h || '').replace(/^#\/?/, '');
      var qi = s.indexOf('?'), path = qi < 0 ? s : s.slice(0, qi), qs = qi < 0 ? '' : s.slice(qi + 1);
      var q = {};
      qs.split('&').forEach(function (p) {
        if (!p) return;
        var kv = p.split('=');
        try { q[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); } catch (e) { /* битый адрес — пропускаем */ }
      });
      var seg = path.split('/').filter(Boolean);
      if (seg[0] === 's' && /^\d+$/.test(seg[1] || '')) return { view: 'solution', id: Number(seg[1]) };
      if (seg[0] === 'apply') return { view: 'apply', id: /^\d+$/.test(seg[1] || '') ? Number(seg[1]) : 0 };
      return { view: 'catalog', q: q };
    },
    buildHash: function (f) {
      var p = [];
      ['cat', 'ind', 'plat', 'q'].forEach(function (k) { if (f[k]) p.push(k + '=' + encodeURIComponent(f[k])); });
      return '#/' + (p.length ? '?' + p.join('&') : '');
    },
    // Поля заявки для _m_new; пустые необязательные не шлём
    buildRequest: function (v) {
      var f = { 'Заявка': String(v.name || '').trim().slice(0, 200), 'Контакт': String(v.contact || '').trim().slice(0, 200) };
      if (!f['Заявка'] || !f['Контакт']) return null;
      if (String(v.company || '').trim()) f['Компания заявителя'] = String(v.company).trim().slice(0, 200);
      if (v.solution) f['Решение'] = Number(v.solution);
      if (String(v.comment || '').trim()) f['Комментарий'] = String(v.comment).trim().slice(0, 3000);
      return f;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.SolutionsCore = Core;
  if (typeof document === 'undefined') return;

  var DB = (location.pathname.match(/^\/([^\/]+)\//) || [])[1] || 'solutions';
  var app = document.getElementById('sl-app');
  var state = { list: null, cats: [], inds: [], plats: [], error: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c];
    });
  }
  function api(path) {
    return fetch('/' + DB + '/' + path, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function ord(x, key) { return x[key] === '' || x[key] == null ? 1e9 : Number(x[key]); }
  function load() {
    if (state.list) return Promise.resolve();
    return Promise.all([
      api('object/Решение/?JSON_OBJ&NAMED&LIMIT=0,500'),
      api('object/Категория/?JSON_OBJ&NAMED&LIMIT=0,200'),
      api('object/Отрасль/?JSON_OBJ&NAMED&LIMIT=0,200'),
      api('object/Платформа/?JSON_OBJ&NAMED&LIMIT=0,200')
    ]).then(function (r) {
      if (!Array.isArray(r[0])) throw new Error('bad response');
      state.list = Core.sortSolutions(r[0].map(Core.normalize).filter(function (s) { return s.published; }));
      state.cats = r[1].map(function (x) { return { id: Number(x.id), val: x['Категория'], order: ord(x, 'Порядок категории') }; })
        .sort(function (a, b) { return a.order - b.order; });
      state.inds = r[2].map(function (x) { return { id: Number(x.id), val: x['Отрасль'] }; });
      state.plats = r[3].map(function (x) { return { id: Number(x.id), val: x['Платформа'] }; });
    });
  }
  function tags(arr) {
    return arr.length ? '<div class="sl-tags">' + arr.map(function (x) { return '<span class="sl-tag">' + esc(x.val) + '</span>'; }).join('') + '</div>' : '';
  }
  function opts(arr, cur, all) {
    return '<option value="">' + esc(all) + '</option>' + arr.map(function (x) {
      return '<option value="' + x.id + '"' + (String(x.id) === String(cur) ? ' selected' : '') + '>' + esc(x.val) + '</option>';
    }).join('');
  }

  function viewCatalog(q) {
    var f = { cat: q.cat || '', ind: q.ind || '', plat: q.plat || '', q: q.q || '' };
    var items = Core.filter(state.list, f);
    var h = '<h1 class="sl-h">Готовые решения на Интеграме</h1><p class="sl-muted">Берём то, что вы уже ведёте в Excel и учётных системах, и собираем рабочий продукт. Выберите решение или отфильтруйте каталог.</p>';
    h += '<div class="sl-chips"><button class="sl-chip' + (f.cat ? '' : ' on') + '" data-cat="">Все</button>' +
      state.cats.map(function (c) { return '<button class="sl-chip' + (String(c.id) === String(f.cat) ? ' on' : '') + '" data-cat="' + c.id + '">' + esc(c.val) + '</button>'; }).join('') + '</div>';
    h += '<div class="sl-filters"><input id="sl-q" type="search" placeholder="Поиск по названию и описанию" value="' + esc(f.q) + '">' +
      '<select id="sl-ind" aria-label="Отрасль">' + opts(state.inds, f.ind, 'Все отрасли') + '</select>' +
      '<select id="sl-plat" aria-label="Надстройка над">' + opts(state.plats, f.plat, 'Надстройка над: любая') + '</select></div>';
    if (!items.length) h += '<p class="sl-muted">По этим условиям ничего не нашлось. Сбросьте фильтры или <a href="#/apply">опишите задачу в заявке</a>.</p>';
    h += '<div class="sl-grid">' + items.map(function (s) {
      return '<a class="sl-card" href="#/s/' + s.id + '"><h3>' + esc(s.title) + '</h3><p>' + esc(s.short) + '</p>' +
        tags((s.category ? [s.category] : []).concat(s.platforms)) + '</a>';
    }).join('') + '</div>';
    app.innerHTML = h;
    function go() { location.hash = Core.buildHash(f); }
    app.querySelectorAll('.sl-chip').forEach(function (b) { b.onclick = function () { f.cat = b.getAttribute('data-cat'); go(); }; });
    app.querySelector('#sl-ind').onchange = function (e) { f.ind = e.target.value; go(); };
    app.querySelector('#sl-plat').onchange = function (e) { f.plat = e.target.value; go(); };
    var qi = app.querySelector('#sl-q'), t;
    qi.oninput = function () { clearTimeout(t); t = setTimeout(function () { f.q = qi.value; go(); }, 400); };
    if (f.q) { var n = qi.value.length; qi.focus(); qi.setSelectionRange(n, n); }
  }

  function viewSolution(id) {
    var s = state.list.filter(function (x) { return x.id === id; })[0];
    if (!s) { app.innerHTML = '<p>Такого решения нет в каталоге. <a href="#/">Вернуться к каталогу</a></p>'; return; }
    var demo = s.demo && !s.demoSoon ? '<a class="sl-btn" href="' + esc(s.demo) + '" target="_blank" rel="noopener">Попробовать демо</a>'
      : s.demoSoon ? '<span class="sl-btn alt" aria-disabled="true">Демо скоро</span>' : '';
    var h = '<a class="sl-back" href="#/">← Каталог</a><h1 class="sl-h">' + esc(s.title) + '</h1><p class="sl-muted">' + esc(s.short) + '</p>' +
      tags((s.category ? [s.category] : []).concat(s.industries, s.platforms));
    h += '<div class="sl-actions">' + demo + '<a class="sl-btn' + (demo ? ' alt' : '') + '" href="#/apply/' + s.id + '">' + (s.demo && !s.demoSoon ? 'Оставить заявку' : 'Запросить демо') + '</a></div>';
    h += '<h2 class="sl-h2">Какую боль закрывает</h2><p>' + esc(s.pain).replace(/\n+/g, '</p><p>') + '</p>';
    if (s.features.length) h += '<h2 class="sl-h2">Что умеет</h2><ul class="sl-list">' + s.features.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (s.steps.length) h += '<h2 class="sl-h2">Как переезжаем</h2><ol class="sl-steps">' + s.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    app.innerHTML = h;
    document.title = s.title + ' — Решения';
  }

  function viewApply(id) {
    var h = '<a class="sl-back" href="#/">← Каталог</a><h1 class="sl-h">Заявка</h1><p class="sl-muted">Оставьте контакт: мы покажем демо или обсудим вашу задачу.</p>' +
      '<form class="sl-form" id="sl-form" novalidate>' +
      '<label>Ваше имя<input name="name" maxlength="200" required autocomplete="name"></label>' +
      '<label>Компания<input name="company" maxlength="200" autocomplete="organization"></label>' +
      '<label>Как с вами связаться (почта или телефон)<input name="contact" maxlength="200" required autocomplete="email"></label>' +
      '<label>Решение<select name="solution">' + opts(state.list.map(function (s) { return { id: s.id, val: s.title }; }), id, 'Не выбрано, расскажу в комментарии') + '</select></label>' +
      '<label>Комментарий<textarea name="comment" maxlength="3000" placeholder="Что сейчас используете, что хотите получить"></textarea></label>' +
      '<div class="sl-hp" aria-hidden="true"><label>Сайт<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div><button class="sl-btn" type="submit">Отправить заявку</button></div><p class="sl-err" id="sl-msg" role="alert"></p></form>';
    app.innerHTML = h;
    var form = app.querySelector('#sl-form'), msg = app.querySelector('#sl-msg'), busy = false;
    form.onsubmit = function (e) {
      e.preventDefault();
      if (busy) return;
      var v = {};
      ['name', 'company', 'contact', 'solution', 'comment', 'website'].forEach(function (k) { v[k] = form.elements[k].value; });
      var fields = Core.buildRequest(v);
      if (!fields) { msg.textContent = 'Укажите имя и контакт.'; return; }
      if (v.website) { form.outerHTML = '<p class="sl-ok">Спасибо, заявка принята.</p>'; return; } // ловушка для ботов
      busy = true; msg.textContent = '';
      api('xsrf?JSON').then(function (x) {
        var body = new URLSearchParams();
        body.set('_xsrf', x._xsrf); body.set('fields', JSON.stringify(fields)); body.set('up', '1');
        return fetch('/' + DB + '/_m_new/Заявка?JSON', { method: 'POST', credentials: 'same-origin', body: body });
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || (j && (j.error || (Array.isArray(j) && j[0] && j[0].error)))) throw new Error('fail');
        });
      }).then(function () {
        app.innerHTML = '<h1 class="sl-h">Спасибо, заявка принята</h1><p>Мы свяжемся с вами по указанному контакту.</p><p><a href="#/">Вернуться к каталогу</a></p>';
      }).catch(function () { busy = false; msg.textContent = 'Не удалось отправить заявку. Попробуйте ещё раз чуть позже.'; });
    };
  }

  function route() {
    var r = Core.parseHash(location.hash);
    document.title = 'Решения на Интеграме';
    if (state.error) { app.innerHTML = '<p class="sl-err">' + esc(state.error) + '</p>'; return; }
    if (r.view === 'solution') viewSolution(r.id);
    else if (r.view === 'apply') viewApply(r.id);
    else viewCatalog(r.q);
    document.getElementById('sl-root').scrollTop = 0;
  }
  window.addEventListener('hashchange', route);
  load().catch(function () { state.error = 'Каталог сейчас недоступен. Попробуйте обновить страницу позже.'; }).then(route);
})(typeof window !== 'undefined' ? window : globalThis);
