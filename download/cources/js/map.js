/* LMS: карта курсов (#/map). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data;
  A.views = A.views || {};

  function status(course, l) {
    if (D.isDone(course.code, l.id)) return 'done';
    return D.progress[course.code + '/' + l.id] ? 'open' : 'new';
  }
  var LABEL = { done: 'Пройден', open: 'В процессе', new: '' };

  // Возврат со страницы оплаты Точки: ?paid=<код> / ?payfail=<код> (cources-pay.php, courses#92)
  function payReturn() {
    var m = /[?&](paid|payfail)=([a-z0-9_-]+)/.exec(location.search);
    return m ? { ok: m[1] === 'paid', code: m[2] } : null;
  }
  var payWait = 0;
  function payBanner(root) {
    var r = payReturn(), c = r && D.course(r.code);
    if (!r) return;
    if (!r.ok) {
      root.appendChild(E('p', { class: 'card warn', text: 'Оплата не прошла' + (c ? ' («' + c.title + '»)' : '') + '. Попробуйте ещё раз или напишите в поддержку.' }));
      return;
    }
    if (c && D.hasAccess(c)) {
      root.appendChild(E('p', { class: 'card good', text: 'Оплата получена, курс «' + c.title + '» открыт.' }));
      return;
    }
    // доступ выдаёт вебхук Точки — обычно через несколько секунд после оплаты
    root.appendChild(E('p', { class: 'card good', text: 'Оплата получена. Открываем доступ к курсу — это займёт до минуты, страница обновится сама.' }));
    if (payWait++ < 20) setTimeout(function () { D.init().then(function () { A.route(); }); }, 3000);
  }

  A.views.map = function (root) {
    root.appendChild(E('h1', { class: 'page-title', text: 'Карта курсов' }));
    payBanner(root);
    root.appendChild(E('p', { class: 'muted' }, ['Больше курсов — в ', E('a', { href: '#/catalog', text: 'каталоге' }), '.']));
    D.myCourses().forEach(function (c) {
      var access = D.hasAccess(c), ls = c.lessons || [];
      var doneN = ls.filter(function (l) { return D.isDone(c.code, l.id); }).length;
      var card = E('section', { class: 'card course' + (access ? '' : ' locked') }, [
        E('div', { class: 'course-head' }, [E('h2', {}, [E('a', { href: '#/course/' + encodeURIComponent(c.code), class: 'course-link', text: c.title })]),
          E('span', { class: 'badge', text: access ? doneN + ' из ' + ls.length : (c.price ? 'Закрыт · ' + c.price + ' ₽' : 'Закрыт') })])]);
      if (!access) {
        if (A.isGuest()) { card.appendChild(E('p', { class: 'muted', text: 'Войдите, чтобы получить доступ к курсу.' })); card.appendChild(E('div', { class: 'row' }, A.loginButtons())); }
        var req = A.isGuest() ? null : D.requests.filter(function (r) { return r['Курс'] === c.code; })[0];
        if (!A.isGuest() && c.price) card.appendChild(E('div', { class: 'row' }, [E('a', { class: 'btn btn-primary', href: '/cources-pay.php?course=' + encodeURIComponent(c.code),
          text: 'Оплатить ' + Number(c.price).toLocaleString('ru-RU') + ' ₽' })]));
        if (!A.isGuest()) card.appendChild(E('p', { class: 'muted', text: 'Курс откроется сразу после оплаты картой или СБП. Если у вас есть промокод — введите его, и мы откроем курс.' }));
        if (req && req['Статус'] !== 'reject') {
          card.appendChild(E('p', { class: 'good', text: 'Заявка отправлена' + (req['Статус'] === 'done' ? ' и обработана — обновите страницу.' : ', ждите открытия доступа.') }));
        } else if (!A.isGuest()) card.appendChild(promoForm(c));
      }
      var list = E('ol', { class: 'lessons' }, ls.map(function (l) {
        var s = status(c, l);
        var inner = [E('span', { class: 'ln', text: /^(Урок|Модуль|Кейс|Практикум)\s*[0-9П]/i.test(l.title || '') ? '' : String(l.n || '') }), E('span', { class: 'lt', text: l.title }), E('span', { class: 'ls', text: LABEL[s] })];
        return E('li', { class: 'l-' + s }, [access ? E('a', { href: '#/c/' + c.code + '/' + l.id }, inner) : E('span', { class: 'l-lock' }, inner)]);
      }));
      card.appendChild(list);
      root.appendChild(card);
    });
  };

  function promoForm(c) {
    var inp = E('input', { class: 'inp', type: 'text', placeholder: 'Промокод', autocomplete: 'off' });
    var msg = E('span', { class: 'muted' });
    var btn = E('button', { class: 'btn btn-primary', type: 'button', text: 'Ввести промокод' });
    btn.addEventListener('click', function () {
      if (!inp.value.trim()) { msg.textContent = 'Введите промокод'; return; }
      btn.disabled = true;
      D.requestPromo(c.code, inp.value.trim()).then(function () { A.route(); },
        function () { msg.textContent = 'Не удалось отправить, попробуйте ещё раз'; btn.disabled = false; });
    });
    return E('div', { class: 'row promo' }, [inp, btn, msg]);
  }
})();
