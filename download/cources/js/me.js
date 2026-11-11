/* LMS: кабинет (#/me) и ненавязчивая подсказка «поделиться». */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data, L = window.LMS || {};
  A.views = A.views || {};

  A.refLink = function () { var id = A.myId(); return id ? 'https://ideav.ru/cources/?aff=' + id : null; };

  A.views.me = function (root) {
    root.appendChild(E('h1', { class: 'page-title', text: 'Кабинет' }));
    var name = E('input', { class: 'inp', type: 'text', placeholder: 'Как к вам обращаться' });
    name.value = (D.profile && D.profile['Имя']) || '';
    var msg = E('span', { class: 'muted' });
    var save = E('button', { class: 'btn', type: 'button', text: 'Сохранить', onclick: function () {
      D.saveProfile({ 'Имя': name.value.trim() }).then(function () { msg.textContent = 'Сохранено'; }, function () { msg.textContent = 'Ошибка'; });
    } });
    root.appendChild(E('section', { class: 'card' }, [E('div', { class: 'muted small', text: 'Логин: ' + (L.user || '') }),
      E('label', { class: 'lbl', text: 'Имя' }), name, E('div', { class: 'row' }, [save, msg])]));
    var link = A.refLink();
    if (link) {
      var inp = E('input', { class: 'inp', type: 'text', readonly: true, value: link });
      inp.addEventListener('focus', function () { inp.select(); });
      root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'Ваша ссылка для друзей' }),
        E('p', { class: 'muted', text: 'Поделитесь ею — и вы получите вознаграждение за тех, кто начнёт учиться.' }),
        E('div', { class: 'row' }, [inp, E('button', { class: 'btn btn-primary', type: 'button', text: 'Копировать', onclick: function () { A.copy(link); } })])]));
    }
    accruals(root, link);
  };

  var LEVEL = { 40: 'с первой оплаты, 40%', 15: 'с повторной оплаты, 15%', 5: 'от приглашённого агента, 5%' };
  function accruals(root, link) {
    var card = E('section', { class: 'card accruals' }, [E('h2', { text: 'Комиссия с продаж курсов' })]);
    root.appendChild(card);
    A.list('Начисление', {}).then(function (rows) {
      if (!rows.length) {
        card.appendChild(E('p', { class: 'muted', text: 'Пока начислений нет. Комиссия с продаж курсов появится здесь, когда по вашей ссылке оплатят курс.' }));
        if (link) card.appendChild(E('div', { class: 'row' }, [E('button', { class: 'btn btn-primary', type: 'button', text: 'Копировать ссылку', onclick: function () { A.copy(link); } })]));
        return;
      }
      var sum = { 'начислено': 0, 'доступно': 0, 'выплачено': 0 };
      rows.forEach(function (r) { if (sum[r['Статус']] != null) sum[r['Статус']] += Number(r['Сумма']) || 0; });
      card.appendChild(E('div', { class: 'sums' }, Object.keys(sum).map(function (k) {
        return E('div', { class: 'sum' }, [E('div', { class: 'sum-v', text: Math.round(sum[k]).toLocaleString('ru-RU') + ' ₽' }), E('div', { class: 'muted small', text: k })]);
      })));
      card.appendChild(E('div', { class: 'acc-list' }, rows.sort(function (a, b) { return Number(b._id) - Number(a._id); }).map(function (r) {
        var who = A.refText(r['Ученик']) || '';
        var lvl = LEVEL[Number(r['Ставка'])] || r['Уровень'] || '';
        return E('div', { class: 'acc-row' }, [
          E('div', { class: 'acc-main' }, [E('b', { text: 'Ученик ' + (who ? who.charAt(0) + '…' : '') + ' · ' + (r['Курс'] || '') }), E('div', { class: 'muted small', text: lvl + (r['Доступно с'] ? ' · доступно с ' + r['Доступно с'] : '') })]),
          E('div', { class: 'acc-sum' }, [E('b', { text: (Number(r['Сумма']) || 0).toLocaleString('ru-RU') + ' ₽' }), E('div', { class: 'muted small', text: r['Статус'] || '' })])]);
      })));
    }, function () { card.appendChild(E('p', { class: 'muted', text: 'Начисления временно недоступны.' })); });
  }

  // kind: 'lesson1' | 'course:<code>'; каждый показывается один раз, закрывается крестиком
  A.share = {
    show: function (kind) {
      var link = A.refLink(), key = 'lms_share_' + kind;
      if (!link || A.store.get(key)) return;
      A.store.set(key, '1');
      var card = E('div', { class: 'lms-share', role: 'status' }, [
        E('div', { class: 'ls-text', text: kind === 'lesson1' ? 'Нравится? Поделитесь курсом с коллегой — ссылка с вашим кодом:' : 'Поздравляем с завершением курса! Расскажите друзьям — ваша ссылка:' }),
        E('div', { class: 'row' }, [E('button', { class: 'btn btn-primary', type: 'button', text: 'Копировать ссылку', onclick: function () { A.copy(link); } })]),
        E('button', { class: 'ls-x', type: 'button', 'aria-label': 'Закрыть', text: '×', onclick: function () { card.remove(); } })]);
      document.body.appendChild(card);
    }
  };
})();
