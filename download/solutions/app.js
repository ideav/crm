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
    // имя файла картинки (без суффикса и расширения): буквы, цифры, дефис
    safeImg: function (v) {
      var s = String(v == null ? '' : v).trim();
      return /^[A-Za-z0-9][A-Za-z0-9-]{2,60}$/.test(s) ? s : '';
    },
    // «Автор | Сервис | URL страницы фото» → {author, service, url}; без автора — null
    parseCredit: function (v) {
      var p = String(v == null ? '' : v).split('|').map(function (x) { return x.trim(); });
      if (!p[0]) return null;
      return { author: p[0], service: p[1] || 'Unsplash', url: Core.safeUrl(p[2]) };
    },
    // адрес решения: латиница, цифры, дефис (ядро приводит путь к нижнему регистру)
    safeSlug: function (v) {
      var s = String(v == null ? '' : v).trim();
      return /^[a-z0-9][a-z0-9-]{0,60}$/.test(s) ? s : '';
    },
    // ссылка карточки: чистый адрес, а без адреса — прежняя hash-ссылка
    solutionHref: function (db, s) { return s.slug ? '/' + db + '/' + s.slug : '#/s/' + s.id; },
    bySlug: function (list, slug) {
      return list.filter(function (x) { return x.slug && x.slug === slug; })[0] || null;
    },
    // куда уводить старую ссылку #/s/<id>; пусто — у решения нет адреса
    legacyTarget: function (list, id, db) {
      var s = list.filter(function (x) { return x.id === id; })[0];
      return s && s.slug ? '/' + db + '/' + s.slug : '';
    },
    // путь важнее hash: /<база>/<slug> — страница решения; hash остаётся для каталога, заявки и старых ссылок
    parseLocation: function (pathname, hash) {
      var h = Core.parseHash(hash);
      if (h.view === 'solution') return { view: 'legacy', id: h.id };
      if (h.view === 'apply') return h;
      var seg = String(pathname || '').split('/')[2] || '';
      if (seg && seg.toLowerCase() !== 'catalog') {
        try { seg = decodeURIComponent(seg); } catch (e) { /* битый адрес оставляем как есть */ }
        return { view: 'solution', slug: seg.toLowerCase() };
      }
      return h;
    },
    esc: function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); },
    // картинка в шапке решения. С источником — фото-иллюстрация: на широком экране сужается до 2/3
    // (.sl-hero-photo, backlogram#1000). Без источника — своя схема, остаётся во всю ширину.
    heroFigure: function (s) {
      if (!s || !s.img) return '';
      var e = Core.esc, c = s.credit;
      var cr = c ? '<figcaption class="sl-credit">Фото: ' + (c.url ? '<a href="' + e(c.url) + '" target="_blank" rel="noopener">' + e(c.author) + ' / ' + e(c.service) + '</a>' : e(c.author) + ' / ' + e(c.service)) + '</figcaption>' : '';
      return '<figure class="sl-hero' + (c ? ' sl-hero-photo' : '') + '"><img src="' + e(Core.imgUrl(s.img, 'l')) + '" width="1600" height="900" alt="' + e(s.title) + '">' + cr + '</figure>';
    },
    // схема в конце страницы решения: крупная картинка и подпись под ней (python2node#1425)
    schemeFigure: function (sc, title) {
      if (!sc || !sc.img) return '';
      var e = Core.esc;
      return '<figure class="sl-scheme"><img loading="lazy" src="' + e(Core.imgUrl(sc.img, 'l')) + '" width="1600" height="900" alt="' + e(sc.caption || title) + '">' +
        (sc.caption ? '<figcaption class="sl-scheme-cap">' + e(sc.caption) + '</figcaption>' : '') + '</figure>';
    },
    imgUrl: function (name, size) { return '/download/solutions/img/' + name + (size === 'l' ? '-l.webp' : '-s.webp'); },
    // строки наборных блоков и идей (backlogram#1016): «Название — пояснение» делится на head/text,
    // строка с «?» в начале — пункт, который обсуждаем на звонке (ask: ссылка на заявку по решению)
    items: function (s) {
      return Core.splitLines(s).map(function (l) {
        var ask = /^\?\s*/.test(l);
        if (ask) l = l.replace(/^\?\s*/, '');
        var i = l.indexOf(' — ');
        return i > 0 ? { head: l.slice(0, i).trim(), text: l.slice(i + 3).trim(), ask: ask } : { head: '', text: l, ask: ask };
      }).filter(function (x) { return x.head || x.text; });
    },
    // «Цена от»/«Цена до» — тыс. ₽; null, если нет нижней границы
    price: function (from, to) {
      var f = Number(String(from == null ? '' : from).replace(',', '.')), t = Number(String(to == null ? '' : to).replace(',', '.'));
      if (!(f > 0)) return null;
      return { from: f, to: t > f ? t : 0 };
    },
    // 150000 → «150 000»
    rub: function (k) { return String(Math.round(k * 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); },
    priceText: function (p) {
      if (!p) return '';
      return p.to ? 'от ' + Core.rub(p.from) + ' до ' + Core.rub(p.to) + ' ₽' : 'от ' + Core.rub(p.from) + ' ₽';
    },
    // «Продукт — цена | URL» → {text, url}; без цены строку не показываем
    competitors: function (s) {
      return Core.splitLines(s).map(function (l) {
        var p = l.split('|');
        return { text: p[0].trim(), url: Core.safeUrl(p.slice(1).join('|')) };
      }).filter(function (x) { return x.text.indexOf(' — ') > 0; });
    },
    // разметка списка блоков/идей; askHref — адрес заявки по этому решению
    itemsHtml: function (arr, askHref) {
      var e = Core.esc;
      return '<ul class="sl-list sl-items">' + arr.map(function (x) {
        return '<li>' + (x.head ? '<b>' + e(x.head) + '</b> — ' : '') + e(x.text) +
          (x.ask ? ' <a class="sl-ask" href="' + e(askHref) + '">Обсудим на звонке →</a>' : '') + '</li>';
      }).join('') + '</ul>';
    },
    // блок «Сколько стоит»: ориентир цены, срок, кнопка звонка, публичные цены коробок для сравнения
    priceHtml: function (s, askHref) {
      if (!s.price && !s.term) return '';
      var e = Core.esc, h = '<section class="sl-price"><h2 class="sl-h2">Сколько стоит и как быстро</h2><dl class="sl-price-grid">';
      h += '<div><dt>Демо на ваших данных</dt><dd>бесплатно</dd></div>';
      if (s.price) h += '<div><dt>Настройка под вашу компанию</dt><dd>' + e(Core.priceText(s.price)) + '</dd></div>';
      if (s.term) h += '<div><dt>Срок запуска</dt><dd>' + e(s.term) + '</dd></div>';
      h += '</dl><p class="sl-muted">Это ориентир для типового объёма. Точную сумму и срок назовём после короткого созвона, когда посмотрим ваши процессы и данные.</p>' +
        '<div class="sl-actions"><a class="sl-btn" href="' + e(askHref) + '">Заказать звонок</a></div>';
      if (s.competitors.length) {
        h += '<details class="sl-cmp"><summary>Для сравнения: публичные цены коробочных систем</summary><ul class="sl-list">' + s.competitors.map(function (c) {
          return '<li>' + e(c.text) + (c.url ? ' (<a href="' + e(c.url) + '" target="_blank" rel="noopener nofollow">источник</a>)' : '') + '</li>';
        }).join('') + '</ul></details>';
      }
      return h + '</section>';
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
        slug: Core.safeSlug(row['Адрес']),
        short: row['Кратко'] || '',
        pain: row['Боль'] || '',
        features: Core.splitLines(row['Что умеет']),
        steps: Core.splitLines(row['Как переезжаем']),
        category: cat ? { id: Number(cat.id), val: cat.val } : null,
        industries: Core.refs(row['Отрасль']).map(function (x) { return { id: Number(x.id), val: x.val }; }),
        platforms: Core.refs(row['Надстройка над']).map(function (x) { return { id: Number(x.id), val: x.val }; }),
        img: Core.safeImg(row['Картинка']),
        scheme: Core.safeImg(row['Схема']) ? { img: Core.safeImg(row['Схема']), caption: String(row['Подпись схемы'] || '').trim() } : null,
        credit: Core.parseCredit(row['Источник изображения']),
        blocks: Core.items(row['Наборные блоки']),
        ideas: Core.items(row['Идеи кастомизации']),
        price: Core.price(row['Цена от'], row['Цена до']),
        term: String(row['Срок'] || '').trim(),
        competitors: Core.competitors(row['Цены конкурентов']),
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
    // бейдж страницы решения ведёт в каталог с фильтром (backlogram#999): kind — cat | ind | plat
    tagHref: function (db, kind, id) {
      var f = {}; f[kind] = id;
      return '/' + db + '/catalog' + Core.buildHash(f);
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
    },
    // Уведомление о заявке в Telegram-чат заявок (#5660): поля сайтового /telegram-notify.php (backlogram).
    // sol — выбранное решение из каталога или null; origin — https://ideav.ru
    buildNotify: function (v, sol, origin, db) {
      var task = [];
      if (sol) {
        task.push('Решение: ' + sol.title);
        task.push('Страница: ' + origin + (sol.slug ? '/' + db + '/' + sol.slug : '/' + db + '/catalog#/s/' + sol.id));
      } else task.push('Решение: не выбрано');
      var c = String(v.comment || '').trim().slice(0, 3000);
      if (c) task.push('', c);
      return { source: 'solutions', name: String(v.name || '').trim().slice(0, 200), company: String(v.company || '').trim().slice(0, 200),
        contact: String(v.contact || '').trim().slice(0, 200), task: task.join('\n') };
    },
    // подпись в шапке движка (.navbar-workspace), backlogram#997: страница решения и заявка по решению — «коробка», остальное — каталог
    workspaceTitle: function (r) {
      return r && (r.view === 'solution' || r.view === 'legacy' || (r.view === 'apply' && r.id)) ? 'Ваша персональная коробка' : 'Копируем любые решения и делаем их под вас';
    },
    // Метрика ideav.ru (backlogram#1017): к её цели sol_lead привязаны кампании Директа с оплатой за конверсии
    METRIKA_ID: 108758829,
    // Платная цель — только от живого человека. Защита: форма появляется лишь после клика «Оставить заявку»
    // (sol_apply_open), в сессии был настоящий жест (isTrusted), страница прожила ≥ 2,5 с, форму заполняли ≥ 4 с,
    // браузер не автоматизирован, скрытое поле пустое, платной заявки в этой сессии браузера ещё не было. Иначе — sol_lead_blocked (видно в отчётах, Директ за неё не платит).
    leadGoal: function (sig) {
      var s = sig || {};
      var ok = s.trusted === true && s.webdriver === false && s.honeypot === false && s.repeat !== true &&
        Number(s.aliveMs) >= 2500 && Number(s.formMs) >= 4000;
      return ok ? 'sol_lead' : 'sol_lead_blocked';
    },
    goalParams: function (sol) {
      return { solution: sol ? (sol.slug || 'id' + sol.id) : 'catalog' };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.SolutionsCore = Core;
  if (typeof document === 'undefined') return;

  var DB = (location.pathname.match(/^\/([^\/]+)\//) || [])[1] || 'solutions';
  var app = document.getElementById('sl-app');
  var CATALOG = '/' + DB + '/catalog';
  var state = { list: null, cats: [], inds: [], plats: [], error: '' };

  // Метрика (backlogram#1017): стандартный тег; hash-маршруты (#/apply) считаются просмотрами
  var T0 = Date.now(), trusted = false;
  // Платная цель — раз за сессию браузера: повторные отправки одного посетителя Директ не оплачивает
  var LEAD_KEY = 'sl_lead_sent', leadSent = false;
  function leadRepeat() { if (leadSent) return true; try { return sessionStorage.getItem(LEAD_KEY) === '1'; } catch (e) { return false; } }
  function markLead() { leadSent = true; try { sessionStorage.setItem(LEAD_KEY, '1'); } catch (e) { /* хранилище недоступно — хватит флага */ } }
  ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (e.isTrusted) trusted = true; }, { passive: true, capture: true });
  });
  (function (m, e, t, r, i) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    var k = e.createElement(t), a = e.getElementsByTagName(t)[0];
    k.async = 1; k.src = r;
    if (a && a.parentNode) a.parentNode.insertBefore(k, a); else e.head.appendChild(k);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
  window.ym(Core.METRIKA_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, trackHash: true });
  function goal(name, params) {
    try { window.ym(Core.METRIKA_ID, 'reachGoal', name, params || {}); } catch (e) { /* Метрика заблокирована — заявка важнее */ }
  }

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
  // arr: [{id, val, kind?}]; с kind — ссылка в каталог с фильтром, без — простой бейдж (в карточке каталога, она сама ссылка)
  function tags(arr) {
    return arr.length ? '<div class="sl-tags">' + arr.map(function (x) {
      return x.kind ? '<a class="sl-tag" href="' + esc(Core.tagHref(DB, x.kind, x.id)) + '">' + esc(x.val) + '</a>' : '<span class="sl-tag">' + esc(x.val) + '</span>';
    }).join('') + '</div>' : '';
  }
  function kinded(arr, kind) { return arr.map(function (x) { return { id: x.id, val: x.val, kind: kind }; }); }
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
      var pic = s.img ? '<img class="sl-thumb" loading="lazy" width="480" height="320" src="' + esc(Core.imgUrl(s.img, 's')) + '" alt="' + esc(s.title) + '">' : '';
      return '<a class="sl-card" href="' + esc(Core.solutionHref(DB, s)) + '">' + pic + '<h3>' + esc(s.title) + '</h3><p>' + esc(s.short) + '</p>' +
        (s.price ? '<p class="sl-from">Настройка под вас — ' + esc(Core.priceText({ from: s.price.from, to: 0 })) + '</p>' : '') +
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

  // картинка и схема решения открываются во весь экран поверх страницы (backlogram#999); закрыть — клик или Esc
  function zoomable(imgs) {
    Array.prototype.forEach.call(imgs, function (img) {
      img.classList.add('sl-zoomable');
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.title = 'Открыть крупно';
      img.onclick = function () { zoomOpen(img); };
      img.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomOpen(img); } };
    });
  }
  function zoomOpen(img) {
    var box = document.createElement('div');
    box.className = 'sl-zoom';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', img.alt || 'Изображение');
    var big = document.createElement('img');
    big.src = img.currentSrc || img.src;
    big.alt = img.alt || '';
    box.appendChild(big);
    var prev = document.body.style.overflow;
    function close() { box.remove(); document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); img.focus(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    box.onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(box);
  }
  function viewSolution(s) {
    if (!s) { app.innerHTML = '<p>Такого решения нет в каталоге. <a href="' + CATALOG + '">Вернуться к каталогу</a></p>'; return; }
    var demo = s.demo && !s.demoSoon ? '<a class="sl-btn" href="' + esc(s.demo) + '" target="_blank" rel="noopener">Попробовать демо</a>'
      : s.demoSoon ? '<span class="sl-btn alt" aria-disabled="true">Демо скоро</span>' : '';
    var hero = Core.heroFigure(s);
    var h = '<a class="sl-back" href="' + CATALOG + '">← Каталог</a>' + hero + '<h1 class="sl-h">' + esc(s.title) + '</h1><p class="sl-muted">' + esc(s.short) + '</p>' +
      tags(kinded(s.category ? [s.category] : [], 'cat').concat(kinded(s.industries, 'ind'), kinded(s.platforms, 'plat')));
    h += '<div class="sl-actions">' + demo + '<a class="sl-btn' + (demo ? ' alt' : '') + '" href="#/apply/' + s.id + '">' + (s.demo && !s.demoSoon ? 'Оставить заявку' : 'Запросить демо') + '</a></div>';
    h += '<h2 class="sl-h2">Какую боль закрывает</h2><p>' + esc(s.pain).replace(/\n+/g, '</p><p>') + '</p>';
    if (s.features.length) h += '<h2 class="sl-h2">Что умеет</h2><ul class="sl-list">' + s.features.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    var ask = '#/apply/' + s.id;
    if (s.blocks.length) h += '<h2 class="sl-h2">Готовые блоки: собираем за 1–2 часа каждый</h2>' + Core.itemsHtml(s.blocks, ask);
    if (s.ideas.length) h += '<h2 class="sl-h2">Что донастроим под вас</h2>' + Core.itemsHtml(s.ideas, ask);
    h += Core.priceHtml(s, ask);
    if (s.steps.length) h += '<h2 class="sl-h2">Как переезжаем</h2><ol class="sl-steps">' + s.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    h += Core.schemeFigure(s.scheme, s.title);
    app.innerHTML = h;
    zoomable(app.querySelectorAll('.sl-hero img, .sl-scheme img'));
    document.title = s.title + ' — Решения Интеграм';
  }

  function viewApply(id) {
    var h = '<a class="sl-back" href="' + CATALOG + '">← Каталог</a><h1 class="sl-h">Заявка</h1><p class="sl-muted">Оставьте контакт: мы покажем демо или обсудим вашу задачу.</p>' +
      '<form class="sl-form" id="sl-form" novalidate>' +
      '<label>Ваше имя<input name="name" maxlength="200" required autocomplete="name"></label>' +
      '<label>Компания<input name="company" maxlength="200" autocomplete="organization"></label>' +
      '<label>Как с вами связаться (почта или телефон)<input name="contact" maxlength="200" required autocomplete="email"></label>' +
      '<label>Решение<select name="solution">' + opts(state.list.map(function (s) { return { id: s.id, val: s.title }; }), id, 'Не выбрано, расскажу в комментарии') + '</select></label>' +
      '<label>Комментарий<textarea name="comment" maxlength="3000" placeholder="Что сейчас используете, что хотите получить"></textarea></label>' +
      '<div class="sl-hp" aria-hidden="true"><label>Сайт<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div><button class="sl-btn" type="submit">Отправить заявку</button></div><p class="sl-err" id="sl-msg" role="alert"></p></form>';
    app.innerHTML = h;
    var form = app.querySelector('#sl-form'), msg = app.querySelector('#sl-msg'), busy = false, opened = Date.now();
    function pickSol(sid) { return (state.list || []).filter(function (s) { return String(s.id) === String(sid); })[0] || null; }
    goal('sol_apply_open', Core.goalParams(pickSol(id)));
    form.onsubmit = function (e) {
      e.preventDefault();
      if (busy) return;
      var v = {};
      ['name', 'company', 'contact', 'solution', 'comment', 'website'].forEach(function (k) { v[k] = form.elements[k].value; });
      var fields = Core.buildRequest(v);
      if (!fields) { msg.textContent = 'Укажите имя и контакт.'; return; }
      var now = Date.now(), leadGoal = Core.leadGoal({ trusted: trusted && e.isTrusted !== false, webdriver: !!navigator.webdriver,
        honeypot: !!v.website, aliveMs: now - T0, formMs: now - opened, repeat: leadRepeat() });
      if (v.website) { goal('sol_lead_blocked', Core.goalParams(pickSol(v.solution))); form.outerHTML = '<p class="sl-ok">Спасибо, заявка принята.</p>'; return; } // ловушка для ботов
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
        // Запись в базе — главное; уведомление в Telegram вдогонку (#5660). Скрипт сайта сам кладёт его в спул
        // и дошлёт cron-ом; капчу не просит при cookie idb_* (её ставит и гостевая сессия). Сбой заявку не отменяет.
        var sol = pickSol(v.solution);
        goal(leadGoal, Core.goalParams(sol)); // цель — только после записи заявки в базу
        if (leadGoal === 'sol_lead') markLead();
        var n = Core.buildNotify(v, sol, location.origin, DB), fd = new FormData();
        Object.keys(n).forEach(function (k) { fd.set(k, n[k]); });
        return fetch('/telegram-notify.php', { method: 'POST', credentials: 'same-origin', body: fd })
          .then(function (r) { if (!r.ok && window.console) console.warn('solutions: telegram-notify', r.status); },
            function (e) { if (window.console) console.warn('solutions: telegram-notify', e); });
      }).then(function () {
        app.innerHTML = '<h1 class="sl-h">Спасибо, заявка принята</h1><p>Мы свяжемся с вами по указанному контакту.</p><p><a href="' + CATALOG + '">Вернуться к каталогу</a></p>';
      }).catch(function () { busy = false; msg.textContent = 'Не удалось отправить заявку. Попробуйте ещё раз чуть позже.'; });
    };
  }

  function route() {
    var r = Core.parseLocation(location.pathname, location.hash);
    document.title = 'Решения на Интеграме';
    var ws = document.querySelector('.navbar-workspace');
    if (ws) ws.textContent = Core.workspaceTitle(r);
    if (state.error) { app.innerHTML = '<p class="sl-err">' + esc(state.error) + '</p>'; return; }
    if (r.view === 'legacy') {
      var to = Core.legacyTarget(state.list || [], r.id, DB);
      if (to) { location.replace(to); return; }
      viewSolution((state.list || []).filter(function (x) { return x.id === r.id; })[0]);
    } else if (r.view === 'solution') viewSolution(Core.bySlug(state.list || [], r.slug));
    else if (r.view === 'apply') viewApply(r.id);
    else viewCatalog(r.q);
    document.getElementById('sl-root').scrollTop = 0;
  }
  window.addEventListener('hashchange', route);
  load().catch(function () { state.error = 'Каталог сейчас недоступен. Попробуйте обновить страницу позже.'; }).then(route);
})(typeof window !== 'undefined' ? window : globalThis);
