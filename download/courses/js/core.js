/* LMS на новом ядре (python2node, ideav/courses#145): сессия, вход и загрузка скриптов портала.
   Страница core.html задаёт LMS.core = true и LMS.z (база), этот файл узнаёт пользователя и только потом
   подгружает остальные скрипты: data.js читает LMS.userId при загрузке.
   /api/v1/<база>/session отдаёт имя; id и роль — из своей строки таблицы «Пользователь» (18), найденной
   по логину (нужен грант READ на «Пользователь» с маской [USER]). Если /session сам вернёт user_id и role,
   берутся они. Нет доступа к строке — вход остаётся, id и роль пустые (портал ученика без записи). */
(function () {
  'use strict';
  var S = window.LMSCore = {};
  var USER = 18;
  var same = { credentials: 'same-origin' };
  var ME = document.currentScript || null;

  function body(r) {
    return r.text().then(function (t) {
      var d = null; try { d = JSON.parse(t); } catch (e) { /* не JSON */ }
      var e = d && (Array.isArray(d) ? d[0] && d[0].error : d.error);
      if (e && typeof e === 'object') e = e.message || e.code;
      if (!r.ok || e) throw new Error(e || ('HTTP ' + r.status));
      return d;
    });
  }
  S.cookie = function (name) {
    var m = new RegExp('(?:^|; )' + name + '=([^;]*)').exec(document.cookie || '');
    return m ? decodeURIComponent(m[1]) : '';
  };

  S.login = function (f, db, user, password) {
    return f('/api/v1/' + db + '/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user, password: password }) }).then(body);
  };
  S.logout = function (f, db) {
    return f('/api/v1/' + db + '/logout', { method: 'POST', credentials: 'same-origin',
      headers: { 'X-XSRF-Token': S.cookie('idx_' + db) } }).then(body);
  };

  // -> {user, userId, role}; без сессии user = 'guest'
  S.session = function (f, db) {
    return f('/api/v1/' + db + '/session', same).then(body).then(function (s) {
      if (!s || !s.user) return { user: 'guest', userId: '', role: '' };
      if (s.admin) return { user: s.user, userId: '', role: 'admin' };
      if (s.user_id != null && s.role != null) return { user: s.user, userId: String(s.user_id), role: String(s.role) };
      return Promise.all([
        f('/nav-api/' + db + '/metadata/' + USER, same).then(body),
        f('/nav-api/' + db + '/object/' + USER + '/?F_' + USER + '=' + encodeURIComponent(s.user) + '&LIMIT=0,20', same).then(body)
      ]).then(function (r) {
        var reqs = (r[0] && r[0].reqs) || [], ri = -1;
        reqs.forEach(function (q, i) { if (q.val === 'Роль') ri = i; });
        var row = (Array.isArray(r[1]) ? r[1] : []).filter(function (x) { return x.r && x.r[0] === s.user; })[0];
        var role = row && ri >= 0 ? String(row.r[ri + 1] || '').replace(/^[\d,]+:/, '') : '';
        return { user: s.user, userId: row ? String(row.i) : '', role: role };
      }, function (e) {
        if (window.console) console.warn('LMS: строка «Пользователь» недоступна —', e.message || e);
        return { user: s.user, userId: '', role: '' };
      });
    });
  };

  // Вход из ЛК ideav.ru/my (python2node#1288, crm /my/coresso): кабинет выпускает JWT и POST-ит его в
  // /api/v1/<база>/login/crm, ядро ставит cookie-сессию и возвращает на back (только путь).
  // Нет сессии my — кабинет сначала просит войти и сам возвращается сюда же.
  S.CABINET = 'https://ideav.ru';
  S.cabinetUrl = function (db, back) {
    return S.CABINET + '/my/coresso?db=' + encodeURIComponent(db) + '&back=' + encodeURIComponent(back || '/');
  };

  // форма входа поверх портала; A — LMSApp (для A.el)
  S.showLogin = function (A, db) {
    var E = A.el, old = document.getElementById('lms-login');
    if (old) { old.querySelector('input').focus(); return; }
    var user = E('input', { type: 'text', name: 'user', autocomplete: 'username', placeholder: 'Логин', required: true });
    var pwd = E('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Пароль', required: true });
    var msg = E('p', { class: 'muted' });
    var btn = E('button', { class: 'btn btn-primary', type: 'submit', text: 'Войти' });
    var box = E('div', { id: 'lms-login', class: 'lms-modal' }, [E('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault(); btn.disabled = true; msg.textContent = '';
      S.login(fetch.bind(window), db, user.value.trim(), pwd.value).then(function () { location.reload(); }, function (err) {
        btn.disabled = false; msg.textContent = String(err.message || err);
      });
    } }, [E('h2', { text: 'Вход' }),
      E('a', { class: 'btn btn-primary', href: S.cabinetUrl(db, location.pathname + location.search), text: 'Войти через личный кабинет ideav.ru' }),
      E('p', { class: 'muted', text: 'или логином и паролем базы:' }),
      user, pwd, msg, E('div', { class: 'row' }, [btn,
      E('button', { class: 'btn', type: 'button', text: 'Отмена', onclick: function () { box.remove(); } })])])]);
    (document.getElementById('lms-shell') || document.body).appendChild(box);
    user.focus();
  };

  // загрузка: сессия → window.LMS → скрипты из data-scripts страницы по порядку
  function boot() {
    var L = window.LMS, me = ME || document.querySelector('script[data-scripts]');
    var list = String((me && me.getAttribute('data-scripts')) || '').split(/\s+/).filter(Boolean);
    function load(i) {
      if (i >= list.length) return;
      var s = document.createElement('script');
      s.src = list[i]; s.async = false;
      s.onload = function () { load(i + 1); };
      document.body.appendChild(s);
    }
    S.session(fetch.bind(window), L.z).then(function (s) {
      L.user = s.user; L.userId = s.userId; L.role = s.role;
    }, function (e) { if (window.console) console.warn('LMS: сессия не определена —', e.message || e); L.user = 'guest'; L.userId = ''; L.role = ''; }).then(function () { load(0); });
  }
  if (window.LMS && window.LMS.core && typeof fetch === 'function' && document.createElement) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
