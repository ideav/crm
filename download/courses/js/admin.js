/* LMS: админ-вкладки куратора: выдача доступа, заявки, оплата. */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data;

  function field(label, attrs) { var i = E('input', Object.assign({ class: 'inp', type: 'text' }, attrs || {})); return { i: i, w: E('label', { class: 'fld' }, [E('span', { class: 'lbl', text: label }), i]) }; }
  // встроенные курсы + опубликованные авторские (#93: у них ключ доступа = URL манифеста из «Курса автора»)
  var authored = {};
  function courseSel(onReady) {
    var s = E('select', { class: 'inp' }, D.courses.map(function (c) { return E('option', { value: c.code, text: c.title + ' (' + c.code + ')' }); }));
    A.list('Курс автора', {}).then(function (rows) {
      rows.filter(function (r) { return /^a\d+$/.test(r['Код'] || ''); }).forEach(function (r) {
        authored[r['Код']] = r['Манифест'] || '';
        s.appendChild(E('option', { value: r['Код'], text: (r._main || r['Код']) + ' (' + r['Код'] + ', автор)' }));
      });
      if (onReady) onReady();
    }, function () { /* нет таблицы — только встроенные */ });
    return s;
  }
  function keyFor(code) { return /^a\d+$/.test(code) ? (authored[code] || '') : A.curatorKey(code); }

  function grant(pane, pre) {
    var u = field('ID пользователя', { inputmode: 'numeric', value: (pre && pre.user) || '' });
    var k = field('Ключ курса (из приватного файла; у авторского курса — URL манифеста, подставляется сам)');
    var c = courseSel(function () { if (pre && pre.course) c.value = pre.course; k.i.value = keyFor(c.value); });
    if (pre && pre.course) c.value = pre.course;
    k.i.value = keyFor(c.value);
    var base = E('select', { class: 'inp' }, ['админ', 'оплата', 'промокод', 'бесплатно'].map(function (x) { return E('option', { text: x }); }));
    var msg = E('span', { class: 'muted' });
    c.addEventListener('change', function () { k.i.value = keyFor(c.value); });
    var go = E('button', { class: 'btn btn-primary', type: 'button', text: 'Выдать доступ', onclick: function () {
      if (!/^\d+$/.test(u.i.value.trim()) || !k.i.value.trim()) { msg.textContent = 'Нужны ID пользователя и ключ'; return; }
      if (!/^a\d+$/.test(c.value)) A.setCuratorKey(c.value, k.i.value.trim());
      go.disabled = true;
      A.create('Доступ', u.i.value.trim() + ':' + c.value, { 'Пользователь': u.i.value.trim(), 'Курс': c.value, 'Ключ': k.i.value.trim(), 'Основание': base.value, 'Дата и время': A.nowStr() })
        .then(function () { msg.textContent = 'Доступ выдан'; go.disabled = false; if (pre && pre.done) pre.done(); }, function (e) { msg.textContent = 'Ошибка: ' + e.message; go.disabled = false; });
    } });
    pane.innerHTML = '';
    pane.appendChild(E('div', { class: 'card' }, [E('h3', { text: 'Выдача доступа' }), u.w, E('label', { class: 'fld' }, [E('span', { class: 'lbl', text: 'Курс' }), c]), k.w,
      E('label', { class: 'fld' }, [E('span', { class: 'lbl', text: 'Основание' }), base]), E('div', { class: 'row' }, [go, msg])]));
  }

  function requests(pane) {
    pane.appendChild(E('p', { class: 'muted', text: 'Загружаем…' }));
    A.list('Заявка', {}).then(function (rows) {
      pane.innerHTML = '';
      rows = rows.filter(function (r) { return r['Статус'] === 'new'; });
      if (!rows.length) { pane.appendChild(E('p', { class: 'lms-empty', text: 'Новых заявок нет.' })); return; }
      rows.forEach(function (r) {
        var row = E('div', { class: 'card req' }, [E('b', { text: A.refText(r['Пользователь']) + ' → ' + r['Курс'] }), E('div', { class: 'muted', text: (r['Код промокода'] ? 'Промокод: ' + r['Код промокода'] : 'Без промокода: «Я оплатил», сверьте оплату') + ' · ' + (r['Дата и время'] || '') })]);
        function setS(s) { A.update('Заявка', r._id, { 'Статус': s }).then(function () { row.remove(); }); }
        row.appendChild(E('div', { class: 'row' }, [
          E('button', { class: 'btn', type: 'button', text: 'Выдать доступ…', onclick: function () { grant(pane, { user: A.refId(r['Пользователь']), course: r['Курс'], done: function () { setS('done'); } }); } }),
          E('button', { class: 'btn', type: 'button', text: 'Отклонить', onclick: function () { setS('reject'); } })]));
        pane.appendChild(row);
      });
    }, function (e) { pane.innerHTML = ''; pane.appendChild(E('p', { class: 'warn', text: e.message })); });
  }

  function payment(pane) {
    var u = field('ID пользователя', { inputmode: 'numeric' }), c = courseSel(), s = field('Сумма', { inputmode: 'numeric' }), n = field('Номер платежа');
    var msg = E('span', { class: 'muted' });
    var go = E('button', { class: 'btn btn-primary', type: 'button', text: 'Записать оплату', onclick: function () {
      if (!/^\d+$/.test(u.i.value.trim()) || !s.i.value.trim()) { msg.textContent = 'Нужны ID и сумма'; return; }
      var d = new Date(), dd = ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
      A.create('Оплата', u.i.value.trim() + ':' + c.value + ':' + Date.now(), { 'Пользователь': u.i.value.trim(), 'Курс': c.value, 'Сумма': s.i.value.trim(), 'Дата': dd, 'Номер': n.i.value.trim() })
        .then(function () { msg.textContent = 'Записано'; }, function (e) { msg.textContent = 'Ошибка: ' + e.message; });
    } });
    pane.appendChild(E('div', { class: 'card' }, [E('h3', { text: 'Ввод оплаты' }), u.w, E('label', { class: 'fld' }, [E('span', { class: 'lbl', text: 'Курс' }), c]), s.w, n.w, E('div', { class: 'row' }, [go, msg])]));
  }

  A.views = A.views || {};
  A.views.admin = [['grant', 'Выдать доступ', function (p) { grant(p); }], ['req', 'Заявки', requests], ['pay', 'Оплата', payment]];
})();
