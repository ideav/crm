/* LMS ideav.ru/cources: оболочка и hash-роутер (#/c/<курс>/<урок>, #/map, #/me, #/curator). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data, L = window.LMS || {};
  var root, nav;

  function entry() {
    if (!D.hasAnyProgress()) return '#/c/mini/00-start';
    var c = D.lastCourse() || D.course('mini');
    var l = c && D.firstOpen(c);
    return l ? '#/c/' + c.code + '/' + l.id : '#/map';
  }

  function render() {
    if (A.cleanup) A.cleanup();
    var h = location.hash.replace(/^#/, '');
    var m;
    if (!h || h === '/') { location.replace(entry()); return; }
    root.innerHTML = '';
    [].forEach.call(nav.querySelectorAll('a'), function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + h.split('/').slice(0, 2).join('/')); });
    if ((m = /^\/c\/([^/]+)\/([^/]+)$/.exec(h))) A.views.lesson(root, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    else if ((m = /^\/c\/([^\/]+)\/?$/.exec(h))) { var cc = D.course(decodeURIComponent(m[1])), fl = cc && (D.firstOpen(cc) || (cc.lessons || [])[0]); if (fl) location.replace('#/c/' + cc.code + '/' + fl.id); else location.replace('#/map'); return; }
    else if (h === '/map') A.views.map(root);
    else if (h === '/me') A.views.me(root);
    else if (h === '/curator') A.views.curator(root);
    else root.appendChild(E('p', { class: 'lms-empty', text: 'Страница не найдена.' }));
    if (!/^\/c\//.test(h)) { var sh = document.getElementById('lms-shell'); if (sh) sh.scrollTop = 0; else window.scrollTo(0, 0); }
  }
  A.route = render;

  function start() {
    var app = document.getElementById('lms-app');
    nav = E('nav', { class: 'lms-nav' }, [E('a', { class: 'brand', href: '#/' }, [E('span', { class: 'dot' }), 'Курсы Интеграм']),
      E('div', { class: 'links' }, [E('a', { href: '#/map', text: 'Карта' }), E('a', { href: '#/me', text: 'Кабинет' }),
        A.isCurator() ? E('a', { href: '#/curator', text: 'Куратор' }) : null,
        A.isAdmin() ? E('a', { href: '/' + L.z + '/dict', target: '_self', text: 'Интерфейс базы' }) : null]),
      E('span', { class: 'who', text: L.user || '' })]);
    root = E('main', { class: 'lms-main' });
    app.innerHTML = '';
    app.appendChild(nav); app.appendChild(root);
    root.appendChild(E('p', { class: 'lms-empty', text: 'Загрузка…' }));
    D.init().then(function () {
      window.addEventListener('hashchange', render);
      render();
    }, function (e) {
      root.innerHTML = '';
      root.appendChild(E('div', { class: 'card' }, [E('h2', { text: 'Не удалось загрузить данные' }), E('p', { class: 'muted', text: String(e.message || e) }),
        E('button', { class: 'btn', type: 'button', text: 'Повторить', onclick: function () { location.reload(); } })]));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
