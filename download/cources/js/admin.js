/* LMS: админ-вкладки куратора: выдача доступа, заявки, оплата. */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data;

  function field(label, attrs) { var i = E('input', Object.assign({ class: 'inp', type: 'text' }, attrs || {})); return { i: i, w: E('label', { class: 'fld' }, [E('span', { class: 'lbl', text: label }), i]) }; }
  function courseSel() {
    return E('select', { class: 'inp' }, D.courses.map(function (c) { return E('option', { value: c.code, text: c.title + ' (' + c.code + ')' }); }));
  }

  function grant(pane, pre) {
    var u = field('ID пользователя', { inputmode: 'numeric', value: (pre && pre.user) || '' });
    var c = courseSel(); if (pre && pre.course) c.value = pre.course;
    var k = field('Ключ курса (из приватного файла)', { value: A.curatorKey(c.value) });
    var base = E('select', { class: 'inp' }, ['админ', 'оплата', 'промокод', 'бесплатно'].map(function (x) { return E('option', { text: x }); }));
    var msg = E('span', { class: 'muted' });
    c.addEventListener('change', function () { k.i.value = A.curatorKey(c.value); });
    var go = E('button', { class: 'btn btn-primary', type: 'button', text: 'Выдать доступ', onclick: function () {
      if (!/^\d+$/.test(u.i.value.trim()) || !k.i.value.trim()) { msg.textContent = 'Нужны ID пользователя и ключ'; return; }
      A.setCuratorKey(c.value, k.i.value.trim()); go.disabled = true;
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
        var row = E('div', { class: 'card req' }, [E('b', { text: A.refText(r['Пользователь']) + ' → ' + r['Курс'] }), E('div', { class: 'muted', text: 'Промокод: ' + (r['Код промокода'] || '—') + ' · ' + (r['Дата и время'] || '') })]);
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
