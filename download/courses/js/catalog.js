/* LMS: каталог курсов с поиском (#/catalog?q=&price=&tag=) и страница курса (#/course/<код>), ideav/courses#93. */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data, AU = A.au;
  A.views = A.views || {};

  A.priceText = function (c) { return c.free ? 'Бесплатно' : (c.price ? Number(c.price).toLocaleString('ru-RU') + ' ₽' : 'Платный'); };

  function cover(c, cls) {
    return c.cover ? E('img', { class: cls, src: c.cover, alt: '', loading: 'lazy' }) : E('div', { class: cls + ' cover-ph', 'aria-hidden': 'true', text: (c.title || '?').charAt(0) });
  }

  A.views.catalog = function (root) {
    var Q = A.query || new URLSearchParams('');
    var st = { q: Q.get('q') || '', price: Q.get('price') || '', tag: Q.get('tag') || '' };
    var all = D.catalogList();
    root.appendChild(E('h1', { class: 'page-title', text: 'Каталог курсов' }));
    var inp = E('input', { class: 'inp', type: 'search', value: st.q, placeholder: 'Название, автор, тема, урок…', 'aria-label': 'Поиск по каталогу' });
    var priceBox = E('div', { class: 'chips', role: 'group', 'aria-label': 'Цена' });
    var tagBox = E('div', { class: 'chips chips-tags', role: 'group', 'aria-label': 'Теги' });
    // Стрелки по краям ленты видны, пока ей есть куда листать (ideav/crm#5779): одного затухания
    // края мало, чтобы понять, что тегов больше. Из Tab-обхода убраны — сами теги и так доступны.
    function arrow(dir) {
      return E('button', { class: 'tags-arr ' + dir, type: 'button', tabindex: '-1', 'aria-label': dir === 'l' ? 'Предыдущие теги' : 'Ещё теги', text: dir === 'l' ? '‹' : '›',
        onclick: function () {
          var d = (dir === 'l' ? -1 : 1) * Math.max(tagBox.clientWidth * 0.8, 80);
          if (tagBox.scrollBy) tagBox.scrollBy({ left: d, behavior: 'smooth' }); else { tagBox.scrollLeft += d; edges(); }
        } });
    }
    var tagWrap = E('div', { class: 'tags-wrap' }, [arrow('l'), tagBox, arrow('r')]);
    var count = E('p', { class: 'muted small cat-count', 'aria-live': 'polite' });
    var list = E('div', { class: 'cat-list' });
    root.appendChild(E('div', { class: 'cat-search' }, [inp]));
    root.appendChild(priceBox); root.appendChild(tagWrap); root.appendChild(count); root.appendChild(list);

    var tags = [], seen = {};
    all.forEach(function (c) { (c.tags || []).forEach(function (t) { var k = AU.norm(t); if (!seen[k]) { seen[k] = 1; tags.push(t); } }); });
    tags.sort(function (a, b) { return a.localeCompare(b, 'ru'); });

    function chip(text, on, fn) { return E('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', text: text, onclick: fn }); }
    function setOn(b, on) { b.className = 'chip' + (on ? ' on' : ''); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    // Теги — лента в одну строку с горизонтальной прокруткой (ideav/courses#212). Кнопки создаются
    // один раз: перерисовка списка не сбрасывает прокрутку ленты, у выбранного меняется только класс.
    var tagChips = tags.map(function (t) {
      var b = chip('#' + t, false, function () { st.tag = AU.norm(st.tag) === AU.norm(t) ? '' : t; update(); });
      b._tag = t; tagBox.appendChild(b); return b;
    });
    function edges() {
      var max = tagBox.scrollWidth - tagBox.clientWidth;
      tagBox.classList.toggle('fade-l', tagBox.scrollLeft > 1);
      tagBox.classList.toggle('fade-r', tagBox.scrollLeft < max - 1);
      tagWrap.classList.toggle('can-l', tagBox.scrollLeft > 1);
      tagWrap.classList.toggle('can-r', tagBox.scrollLeft < max - 1);
    }
    tagBox.addEventListener('scroll', edges, { passive: true });
    // Колесо мыши листает ленту вбок, пока ей есть куда; на краю прокручивается страница.
    tagBox.addEventListener('wheel', function (ev) {
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
      var max = tagBox.scrollWidth - tagBox.clientWidth;
      if (max <= 0 || (ev.deltaY < 0 && tagBox.scrollLeft <= 0) || (ev.deltaY > 0 && tagBox.scrollLeft >= max)) return;
      ev.preventDefault();
      tagBox.scrollLeft += ev.deltaY;
    }, { passive: false });
    function showActive() {
      var b = tagChips.filter(function (x) { return x.classList.contains('on'); })[0];
      if (b) tagBox.scrollLeft = b.offsetLeft - (tagBox.clientWidth - b.offsetWidth) / 2; // лента — offsetParent кнопок (position:relative)
      edges();
    }
    function keepUrl() {
      var p = new URLSearchParams();
      if (st.q.trim()) p.set('q', st.q.trim());
      if (st.price) p.set('price', st.price);
      if (st.tag) p.set('tag', st.tag);
      var s = p.toString();
      history.replaceState(null, '', location.pathname + location.search + '#/catalog' + (s ? '?' + s : ''));
    }
    function draw() {
      priceBox.innerHTML = '';
      [['', 'Все'], ['free', 'Бесплатные'], ['paid', 'Платные']].forEach(function (p) {
        priceBox.appendChild(chip(p[1], st.price === p[0], function () { st.price = p[0]; update(); }));
      });
      tagChips.forEach(function (b) { setOn(b, AU.norm(st.tag) === AU.norm(b._tag)); });
      var found = AU.filter(all, st);
      count.textContent = found.length ? 'Найдено курсов: ' + found.length : '';
      list.innerHTML = '';
      if (!found.length) {
        list.appendChild(E('div', { class: 'card' }, [E('p', { text: 'Ничего не нашлось.' }),
          E('button', { class: 'btn', type: 'button', text: 'Сбросить поиск', onclick: function () { st = { q: '', price: '', tag: '' }; inp.value = ''; update(); } })]));
      }
      found.forEach(function (c) {
        var ls = c.lessons || [];
        list.appendChild(E('a', { class: 'cat-card', href: '#/course/' + encodeURIComponent(c.code) }, [
          cover(c, 'cat-cover'),
          E('div', { class: 'cat-body' }, [
            E('div', { class: 'cat-top' }, [E('b', { class: 'cat-title', text: c.title }), E('span', { class: 'cat-price' + (c.free ? ' free' : ''), text: A.priceText(c) })]),
            E('div', { class: 'muted small', text: (c.author ? c.author + ' · ' : '') + ls.length + ' ' + plural(ls.length, 'урок', 'урока', 'уроков') }),
            c.desc ? E('p', { class: 'cat-desc', text: c.desc }) : null,
            (c.tags || []).length ? E('div', { class: 'cat-tags' }, c.tags.map(function (t) { return E('span', { class: 'tag', text: '#' + t }); })) : null])]));
      });
    }
    function update() { keepUrl(); draw(); }
    inp.addEventListener('input', function () { st.q = inp.value; update(); });
    draw();
    setTimeout(showActive, 0);
    if (st.q) setTimeout(function () { inp.focus(); }, 0);
  };
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
  }

  A.views.course = function (root, code) {
    var c = D.course(code);
    if (!c) { root.appendChild(E('div', { class: 'card' }, [E('p', { text: 'Курс не найден или снят с публикации.' }), E('a', { class: 'btn', href: '#/catalog', text: 'В каталог' })])); return; }
    var full = c.authored ? c : D.catalogList().filter(function (x) { return x.code === c.code; })[0] || c;
    var ls = c.lessons || [], access = D.hasAccess(c), guest = A.isGuest();
    var first = D.firstOpen(c) || ls[0];
    var started = ls.some(function (l) { return D.progress[c.code + '/' + l.id]; });
    var cta = E('div', { class: 'row course-cta' });
    var msg = E('p', { class: 'muted small' });
    var promo = null;
    var startHref = first ? '#/c/' + encodeURIComponent(c.code) + '/' + encodeURIComponent(first.id) : '#/map';
    if (access) {
      cta.appendChild(E('a', { class: 'btn btn-primary', href: startHref, text: started ? 'Продолжить' : 'Начать курс' }));
    } else if (guest) {
      msg.textContent = 'Войдите, чтобы купить курс и сохранять прогресс.';
      A.loginButtons().forEach(function (b) { cta.appendChild(b); });
    } else {
      var req = D.requests.filter(function (r) { return r['Курс'] === c.code && r['Статус'] !== 'reject' && A.refId(r['Пользователь']) === D.uid; })[0];
      // своя ссылка оплаты автора — во вкладке, с «Я оплатил»; иначе — оплата картой/СБП через
      // courses-pay.php, доступ открывает вебхук (ideav/crm#5588)
      var ownPay = !c.payUrl && !c.free && Number(c.price) > 0;
      if (c.payUrl) cta.appendChild(E('a', { class: 'btn btn-primary', href: c.payUrl, target: '_blank', rel: 'noopener', onclick: function () { if (A.goal) A.goal('course_pay_click', c.code); }, text: 'Оплатить · ' + A.priceText(c) }));
      if (ownPay) cta.appendChild(E('a', { class: 'btn btn-primary', href: '/courses-pay.php?course=' + encodeURIComponent(c.code), onclick: function () { if (A.goal) A.goal('course_pay_click', c.code); }, text: 'Оплатить · ' + A.priceText(c) }));
      if (req) msg.textContent = req['Статус'] === 'done' ? 'Заявка обработана — обновите страницу.' : D.requestNote;
      else if (ownPay) {
        msg.textContent = 'Курс откроется сразу после оплаты картой или СБП. Если у вас есть промокод — введите его, и курс откроется сразу.';
        if (A.promoForm) promo = A.promoForm(c);
      } else {
        var paid = E('button', { class: 'btn', type: 'button', text: 'Я оплатил', onclick: function () {
          paid.disabled = true;
          D.requestPaid(c.code).then(function () { A.route(); }, function () { paid.disabled = false; msg.textContent = 'Не удалось отправить, попробуйте ещё раз.'; });
        } });
        cta.appendChild(paid);
        msg.textContent = c.payUrl ? 'Оплата откроется в новой вкладке. Доступ откроется сам после оплаты; если за пару минут не открылся — нажмите «Я оплатил».' : 'Оплатили или есть промокод? Нажмите «Я оплатил» или введите промокод ниже.';
        if (A.promoForm) promo = A.promoForm(c);
      }
    }
    // видеовстречи курса (ideav/courses#200): ученику с доступом и ведущему; кто ведущий — решает сервер
    if (!guest && (access || (A.isCurator && A.isCurator()))) cta.appendChild(E('a', { class: 'btn', href: '#/meet/' + encodeURIComponent(c.code), text: 'Встречи' }));
    var head = E('section', { class: 'course-hero card' }, [
      cover(full, 'course-cover'),
      E('div', { class: 'course-info' }, [
        E('h1', { class: 'page-title', text: c.title }),
        E('div', { class: 'muted', text: (full.author ? 'Автор: ' + full.author + ' · ' : '') + ls.length + ' ' + plural(ls.length, 'урок', 'урока', 'уроков') }),
        E('div', { class: 'course-price', text: A.priceText(c) }),
        (full.tags || []).length ? E('div', { class: 'cat-tags' }, full.tags.map(function (t) { return E('a', { class: 'tag', href: '#/catalog?tag=' + encodeURIComponent(t), text: '#' + t }); })) : null,
        cta, msg, promo])]);
    root.appendChild(head);
    if (full.desc) root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'О курсе' }), E('p', { class: 'pre', text: full.desc })]));
    var who = E('section', { class: 'card', hidden: !full.forWhom }, [E('h2', { text: 'Для кого' }), E('p', { class: 'pre', text: full.forWhom || '' })]);
    root.appendChild(who);
    // «Для кого» нет в «Каталоге» — берём из манифеста, если он открыт этому посетителю
    if (!full.forWhom && c.authored && D.hasAccess(c)) {
      D.courseManifest(c).then(function (m) { if (m && m.forWhom) { who.lastChild.textContent = m.forWhom; who.hidden = false; } }, function () { /* нет манифеста */ });
    }
    root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'Программа' }), E('ol', { class: 'lessons' }, ls.map(function (l, i) {
      var done = D.isDone(c.code, l.id);
      var inner = [E('span', { class: 'ln', text: String(l.n || i + 1) }), E('span', { class: 'lt', text: l.title }), E('span', { class: 'ls', text: done ? 'Пройден' : '' })];
      return E('li', { class: done ? 'l-done' : '' }, [access ? E('a', { href: '#/c/' + encodeURIComponent(c.code) + '/' + encodeURIComponent(l.id) }, inner) : E('span', { class: 'l-lock' }, inner)]);
    }))]));
    root.appendChild(E('p', {}, [E('a', { href: '#/catalog', text: '← Все курсы' })]));
  };
})();
