/* LMS ideav.ru/cources: общие помощники (issue ideav/courses#84). Ванильный JS, без сборки. */
(function () {
  'use strict';
  var A = window.LMSApp = window.LMSApp || {};
  var L = window.LMS || {};

  A.mock = /[?&]mock=1(&|$)/.test(location.search);
  A.root = A.mock ? '/download/cources/dev/' : '/download/cources/';
  A.contentRoot = A.root + 'content/';
  A.z = L.z || 'cources';

  A.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // el('div', {class:'x', onclick:fn}, [children|text])
  A.el = function (tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids == null ? [] : [].concat(kids)).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  };

  A.getJSON = function (url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.json();
    });
  };

  A.sha256 = function (str) {
    if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error('crypto.subtle недоступен'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  };

  A.debounce = function (fn, ms) {
    var t;
    var d = function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
    d.flush = function () { clearTimeout(t); };
    return d;
  };

  function p2(n) { return ('0' + n).slice(-2); }
  A.fmtUnix = function (v) {
    var d = new Date(Number(v) * 1000);
    return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  A.nowStr = function () {
    var d = new Date();
    return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
      p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  };

  // Внешние ссылки только в новой вкладке: проставляем target/rel и перехватываем клики.
  function isExternal(a) {
    var h = a.getAttribute('href') || '';
    if (!/^(https?:)?\/\//i.test(h)) return false;
    try { return new URL(h, location.href).origin !== location.origin; } catch (e) { return false; }
  }
  A.fixLinks = function (root) {
    root.querySelectorAll('a[href]').forEach(function (a) {
      if (isExternal(a)) { a.target = '_blank'; a.rel = 'noopener'; }
    });
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || e.defaultPrevented || !isExternal(a)) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  });

  var toastEl;
  A.toast = function (msg, ms) {
    if (!toastEl) { toastEl = A.el('div', { class: 'lms-toast', role: 'status' }); (document.getElementById('lms-shell') || document.body).appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 2500);
  };

  A.copy = function (text) {
    var done = function () { A.toast('Скопировано'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var t = A.el('textarea', { style: 'position:fixed;opacity:0' });
      t.value = text; (document.getElementById('lms-shell') || document.body).appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { A.toast('Не удалось скопировать'); }
      t.remove();
    }
  };

  A.store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  A.myId = function () {
    var m = /^my(\d+)$/i.exec(L.user || '');
    return m ? m[1] : null;
  };
  // --- гость: куки перед входом (sso_back возвращает в портал, _aff — реферал) ---
  function setCookie(n, v, age) { document.cookie = n + '=' + v + '; path=/; max-age=' + age + '; secure; samesite=lax'; }
  A.hasCookie = function (n) { return new RegExp('(?:^|; )' + n + '=').test(document.cookie); };
  A.rememberAff = function () {
    var m = /[?&]aff=([0-9]+)/.exec(location.search);
    if (m && !A.hasCookie('_aff')) setCookie('_aff', m[1], 15552000);
  };
  A.beforeLogin = function () { setCookie('sso_back', 'cources', 86400); A.rememberAff(); };
  A.loginYandex = function () {
    A.beforeLogin();
    location.href = 'https://oauth.yandex.ru/authorize?response_type=code&client_id=959da92b09364e42bf4c7704db0b992f&redirect_uri=' +
      encodeURIComponent(location.origin + '/auth.asp') + '&state=yandex';
  };
  A.loginMail = function () { A.beforeLogin(); location.href = '/start.html?db=my&uri=%2Fcources%2F'; };
  A.loginButtons = function () {
    return [A.el('button', { class: 'btn btn-primary', type: 'button', text: 'Войти через Яндекс', onclick: A.loginYandex }),
      A.el('button', { class: 'btn', type: 'button', text: 'Войти по почте', onclick: A.loginMail })];
  };
  A.isCurator = function () { return /куратор|curator/i.test(L.role || '') || A.isAdmin(); };
  A.isGuest = function () { return L.user === 'guest'; };
  A.isAdmin = function () { return /^(admin|админ)/i.test(L.role || ''); };
})();
