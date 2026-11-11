/* LMS: лендинг для гостя (LMS.user === 'guest'). Тексты — из лендингов курсов (ideav/courses pricing/pages/site). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data;
  A.views = A.views || {};

  var DESC = {
    mini: 'Вводный мини-курс. За один-два вечера превратите рабочую таблицу в приложение и поймёте, что ИИ-агент делает сам, а где нужен человек.',
    adept: 'Делать приложения для заказчиков: от первого разговора до сданного проекта и ежемесячной поддержки. 8 модулей и практикум.',
    partner: 'Находить компании, которым нужно приложение вместо таблиц, доводить их до оплаты и получать партнёрский процент.'
  };
  var STEPS = [
    ['Вход в один клик', 'Через Яндекс или по почте: без анкет и пароля для запоминания.'],
    ['Сразу урок', 'После входа вы попадаете прямо в первый урок мини-курса.'],
    ['Задания проверяются сразу', 'Тесты и практикум в вашей базе проверяются на месте, без ожидания.'],
    ['Куратор помогает, но не тормозит', 'Вы идёте дальше сразу, а куратор оставляет комментарии к вашим ответам.']
  ];
  var FAQ = [
    ['Нужно ли уметь программировать?', 'Нет. Приложение собирает ИИ-агент, а вы учитесь ставить ему задачи и читать результат.'],
    ['Сколько стоит начать?', 'Мини-курс бесплатный. «Адепт» и «Партнёр-продавец» платные, цены указаны выше.'],
    ['Сколько времени займёт мини-курс?', 'Около 2–3 часов; можно растянуть на несколько вечеров.'],
    ['Что нужно заранее?', 'Рабочая таблица (Excel или Google-таблица). Нет своей — будет учебная.'],
    ['Как получить доступ к платным курсам?', 'Войдите и введите промокод или оплатите курс; после этого он откроется в вашем кабинете.']
  ];

  function sec(cls, kids) { return E('section', { class: 'ld-sec ' + cls }, [E('div', { class: 'ld-in' }, kids)]); }
  function price(c) { return c.free ? 'Бесплатно' : (c.price ? Number(c.price).toLocaleString('ru-RU') + ' ₽' : ''); }

  A.views.landing = function (root) {
    root.classList.add('ld');
    root.appendChild(E('div', { class: 'ld-hero' }, [E('div', { class: 'ld-in' }, [
      E('h1', { text: 'Приложения на Интеграме — без программирования' }),
      E('p', { class: 'ld-lead', text: 'Курсы Интеграма: учим собирать бизнес-приложения вместо таблиц с помощью ИИ-агента и находить для них клиентов.' }),
      E('div', { class: 'row ld-cta' }, A.loginButtons()),
      E('p', { class: 'ld-sub' }, [E('a', { href: '#/c/mini/00-start', text: 'Сначала посмотреть первый урок' })])])]));

    var cards = (D.courses || []).map(function (c) {
      return E('div', { class: 'ld-card' }, [E('h3', { text: c.title }), E('div', { class: 'ld-price', text: price(c) }),
        E('p', { text: DESC[c.code] || '' }),
        c.free ? E('a', { class: 'btn', href: '#/c/mini/00-start', text: 'Посмотреть урок' }) : E('button', { class: 'btn', type: 'button', text: 'Войти и получить доступ', onclick: A.loginYandex })]);
    });
    root.appendChild(sec('', [E('h2', { text: 'Курсы' }), E('div', { class: 'ld-cards' }, cards)]));

    root.appendChild(sec('ld-alt', [E('h2', { text: 'Как это устроено' }), E('ol', { class: 'ld-steps' }, STEPS.map(function (s) {
      return E('li', {}, [E('b', { text: s[0] }), E('span', { text: s[1] })]);
    }))]));

    root.appendChild(sec('', [E('h2', { text: 'Рекомендуйте курсы и получайте комиссию с продаж' }),
      E('p', { text: 'У каждого ученика есть своя ссылка. Когда по ней оплачивают курс, вы получаете комиссию:' }),
      E('div', { class: 'ld-rates' }, [['40%', 'с первой оплаты приглашённого вами человека'], ['15%', 'с его повторных оплат'], ['5%', 'с продаж агентов, которых пригласили вы']].map(function (r) {
        return E('div', { class: 'ld-rate' }, [E('b', { text: r[0] }), E('span', { text: r[1] })]);
      }))]));

    root.appendChild(sec('ld-alt', [E('h2', { text: 'Частые вопросы' })].concat(FAQ.map(function (f) {
      return E('details', { class: 'ld-faq' }, [E('summary', { text: f[0] }), E('p', { text: f[1] })]);
    }))));

    root.appendChild(E('div', { class: 'ld-hero ld-final' }, [E('div', { class: 'ld-in' }, [
      E('h2', { text: 'Начните с бесплатного мини-курса' }),
      E('div', { class: 'row ld-cta' }, A.loginButtons())])]));
  };
})();
