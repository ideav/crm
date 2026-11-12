/* LMS: авторские курсы (ideav/courses#93) — общее ядро: поиск по каталогу, разбор строк «Каталога»,
   markdown → HTML (marked + DOMPurify), сборка lesson.json из черновика урока, даты.
   Без DOM-разметки экрана: файл грузится и в тестах (experiments/cources-authors-93.test.js). */
(function () {
  'use strict';
  var A = window.LMSApp = window.LMSApp || {};
  var AU = A.au = {};

  // Имена реквизитов в схеме (lms/authors/CONTRACT.md в ideav/courses).
  AU.F = { owner: 'Владелец', parent: 'Родительский курс' };
  AU.STATUS = { draft: 'черновик', review: 'на проверке', link: 'по ссылке', catalog: 'в каталоге', off: 'снят', reject: 'отклонён' };
  // Файлы, которые ученик может приложить к заданию авторского курса (без html/svg/js — их отдают как страницу).
  AU.ANSWER_EXT = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.pptx', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.zip'];
  AU.COVER_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
  AU.COVER_MAX = 2 * 1048576;
  AU.LETTERS = ['а', 'б', 'в', 'г'];

  // ---- поиск: без регистра, ё = е, все слова запроса должны найтись ----
  AU.norm = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); };
  AU.words = function (q) { return AU.norm(q).split(' ').filter(Boolean); };
  AU.haystack = function (c) {
    return AU.norm([c.title, c.desc, c.author, (c.tags || []).join(' '), (c.lessons || []).map(function (l) { return l.title; }).join(' ')].join(' \n '));
  };
  AU.match = function (c, q) {
    var h = AU.haystack(c);
    return AU.words(q).every(function (w) { return h.indexOf(w) >= 0; });
  };
  AU.tags = function (s) {
    var seen = {};
    return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) {
      var k = AU.norm(x); if (!k || seen[k]) return false; seen[k] = 1; return true;
    });
  };
  // filter: {q, price: ''|'free'|'paid', tag}
  AU.filter = function (courses, f) {
    f = f || {};
    var tag = AU.norm(f.tag);
    return courses.filter(function (c) {
      if (f.price === 'free' && !c.free) return false;
      if (f.price === 'paid' && c.free) return false;
      if (tag && !(c.tags || []).some(function (t) { return AU.norm(t) === tag; })) return false;
      return AU.match(c, f.q || '');
    });
  };

  // ---- строки базы → курс ----
  AU.json = function (s, def) { try { var v = JSON.parse(s); return v == null ? def : v; } catch (e) { return def; } };
  // Строка «Каталога» → курс в формате courses.json (+ поля авторского курса).
  AU.fromCatalog = function (row) {
    var price = Number(String(row['Цена'] || '0').replace(/[^0-9.]/g, '')) || 0;
    var ls = AU.json(row['Уроки'], []);
    return {
      code: String(row._main || ''), title: row['Название'] || row._main || '', free: price === 0, price: price,
      author: row['Автор'] || '', desc: row['Описание'] || '', forWhom: row['Для кого'] || '', tags: AU.tags(row['Теги']),
      cover: AU.safeUrl(row['Адрес обложки'], 'img'), payUrl: AU.safeUrl(row['Ссылка оплаты'], 'link'),
      manifest: row['Манифест'] || '', visibility: row['Видимость'] === 'ссылка' ? 'ссылка' : 'каталог',
      lessons: Array.isArray(ls) ? ls : [], authored: true, _row: row._id
    };
  };
  AU.isAuthored = function (code) { return /^a\d+$/.test(String(code || '')); };

  // Адрес из данных: только свой сайт или https (картинки в мок-режиме — data:image).
  AU.safeUrl = function (u, kind) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^\/(?!\/)/.test(u) || /^https:\/\//i.test(u)) return u;
    if (kind === 'img' && /^data:image\/(png|jpe?g|webp);/i.test(u)) return u;
    if (kind === 'json' && /^data:application\/json[;,]/i.test(u)) return u;
    return '';
  };
  AU.ext = function (name) { var m = /\.([^.\/\\]+)$/.exec(String(name || '')); return m ? '.' + m[1].toLowerCase() : ''; };
  // Проверка обложки до загрузки: тип и размер. Возвращает текст ошибки или ''.
  AU.coverError = function (file) {
    if (!file) return 'Выберите файл';
    if (AU.COVER_EXT.indexOf(AU.ext(file.name)) < 0) return 'Обложка — только PNG, JPG или WEBP';
    if (file.type && !/^image\/(png|jpeg|webp)$/.test(file.type)) return 'Обложка — только PNG, JPG или WEBP';
    if (file.size > AU.COVER_MAX) return 'Обложка больше 2 МБ';
    if (!file.size) return 'Файл пустой';
    return '';
  };

  // ---- даты: «дд.мм.гггг чч:мм[:сс]» или unix-время → мс ----
  AU.time = function (v) {
    var s = String(v || '').trim(), m;
    if (!s) return 0;
    if (/^\d{9,11}$/.test(s)) return Number(s) * 1000;
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
      return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) {
      return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    return 0;
  };
  // Курс ждёт модератора: отправлен на проверку позже последней публикации.
  AU.pending = function (row) {
    var s = AU.time(row['На проверку']);
    return s > 0 && s > AU.time(row['Опубликован']);
  };
  // Статус для автора: ожидание проверки видно сразу после отправки, до решения модератора.
  AU.statusOf = function (row) {
    if (AU.pending(row)) return AU.STATUS.review;
    return row['Статус'] || AU.STATUS.draft;
  };

  // ---- markdown → безопасный HTML ----
  var hooked = false;
  function purify() {
    var P = window.DOMPurify;
    if (P && !hooked && P.addHook) {
      hooked = true;
      P.addHook('afterSanitizeAttributes', function (node) {
        if (node.tagName === 'A' && node.getAttribute('href')) {
          var h = node.getAttribute('href');
          if (/^(https?:)?\/\//i.test(h)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener'); }
          else node.removeAttribute('target');
        }
      });
    }
    return P;
  }
  AU.sanitize = function (html) {
    var P = purify();
    if (!P || !P.sanitize) throw new Error('DOMPurify не загружен');
    return String(P.sanitize(String(html || ''), { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'] }));
  };
  // На случай, если санитайзер в окружении не трогает ссылки: внешние ссылки — в новой вкладке.
  AU.externalLinks = function (html) {
    return String(html).replace(/<a\s+([^>]*?)href="((?:https?:)?\/\/[^"]*)"([^>]*)>/gi, function (all, pre, href, post) {
      var rest = (pre + post).replace(/\s*(target|rel)="[^"]*"/gi, '');
      return '<a ' + (rest.trim() ? rest.trim() + ' ' : '') + 'href="' + href + '" target="_blank" rel="noopener">';
    });
  };
  function mk() { var M = window.marked; if (!M || !M.parse) throw new Error('marked не загружен'); return M; }
  AU.md = function (src) { return AU.externalLinks(AU.sanitize(mk().parse(String(src || ''), { gfm: true, breaks: false, async: false }))); };
  AU.inline = function (src) { return AU.externalLinks(AU.sanitize(mk().parseInline(String(src || ''), { gfm: true, async: false }))); };

  // ---- черновик урока → lesson.json (#84) ----
  var KIND_ORDER = ['text', 'file', 'practicum', 'quiz', 'selfcheck'];
  AU.mainKind = function (tasks) {
    var kinds = (tasks || []).map(function (t) { return t.kind; });
    return KIND_ORDER.filter(function (k) { return kinds.indexOf(k) >= 0; })[0] || null;
  };
  AU.acceptOf = function (accept) {
    var list = String(accept || '').toLowerCase().split(',').map(function (x) { x = x.trim(); return x && x[0] !== '.' ? '.' + x : x; })
      .filter(function (x) { return AU.ANSWER_EXT.indexOf(x) >= 0; });
    return (list.length ? list : AU.ANSWER_EXT).join(',');
  };
  // Ошибки черновика заданий, которые не дадут собрать урок (для автора и модератора).
  AU.taskProblems = function (tasks) {
    var out = [];
    (tasks || []).forEach(function (t, i) {
      var n = 'Задание ' + (i + 1);
      if (t.kind === 'quiz') {
        if (!(t.questions || []).length) out.push(n + ': в тесте нет вопросов');
        (t.questions || []).forEach(function (q, qi) {
          var ks = (q.options || []).filter(function (o) { return String(o.text || '').trim(); }).map(function (o) { return o.k; });
          if (!String(q.q || '').trim()) out.push(n + ', вопрос ' + (qi + 1) + ': нет текста');
          if (ks.length < 2) out.push(n + ', вопрос ' + (qi + 1) + ': нужно хотя бы два варианта');
          if (ks.indexOf(q.answer) < 0) out.push(n + ', вопрос ' + (qi + 1) + ': не отмечен правильный ответ');
        });
      } else if (t.kind === 'selfcheck') {
        if (!(t.items || []).filter(function (x) { return String(x || '').trim(); }).length) out.push(n + ': в самопроверке нет пунктов');
      } else if (t.kind !== 'text' && t.kind !== 'file') out.push(n + ': неизвестный вид «' + t.kind + '»');
    });
    return out;
  };
  // d: {id, course, n, title, md, tasks, prev, next}; хэш ответа — как проверяет quiz.js.
  AU.buildLesson = function (d) {
    var lid = String(d.id);
    var tasks = (d.tasks || []).map(function (t, i) {
      if (t.kind === 'text') return Promise.resolve({ kind: 'text', prompt: AU.md(t.prompt), template: String(t.template || '') });
      if (t.kind === 'file') return Promise.resolve({ kind: 'file', prompt: AU.md(t.prompt), accept: AU.acceptOf(t.accept), max: Math.min(10, Math.max(1, Number(t.max) || 5)) });
      if (t.kind === 'selfcheck') return Promise.resolve({ kind: 'selfcheck', items: (t.items || []).filter(function (x) { return String(x || '').trim(); }).map(AU.inline) });
      if (t.kind === 'quiz') {
        var qs = (t.questions || []).map(function (q, qi) {
          return A.sha256(lid + ':' + qi + ':' + String(q.answer || '')).then(function (h) {
            return {
              q: AU.inline(q.q), hash: h, explain: AU.inline(q.explain || ''),
              options: (q.options || []).filter(function (o) { return String(o.text || '').trim(); }).map(function (o) { return { k: String(o.k), text: AU.inline(o.text) }; })
            };
          });
        });
        var pass = Number(t.pass); if (!(pass > 0 && pass <= 1)) pass = 0.7;
        return Promise.all(qs).then(function (questions) { return { kind: 'quiz', pass: pass, questions: questions }; });
      }
      return Promise.reject(new Error('Задание ' + (i + 1) + ': неизвестный вид «' + t.kind + '»'));
    });
    return Promise.all(tasks).then(function (ts) {
      return { id: lid, course: String(d.course), n: d.n, title: String(d.title || ''), html: AU.md(d.md), tasks: ts, attachments: [], prev: d.prev || null, next: d.next || null };
    });
  };
  // Строки «Урок автора» (в любом порядке) → черновики уроков по порядку, с prev/next и id «l<строка>».
  AU.ordered = function (rows) {
    return rows.slice().sort(function (a, b) { return (Number(a['Порядок']) || 0) - (Number(b['Порядок']) || 0) || Number(a._id) - Number(b._id); });
  };
  AU.drafts = function (code, rows) {
    var ls = AU.ordered(rows);
    return ls.map(function (r, i) {
      return { id: 'l' + r._id, course: code, n: i + 1, title: r._main || ('Урок ' + (i + 1)), md: r['Текст'] || '', tasks: AU.json(r['Задания'], []),
        prev: i ? 'l' + ls[i - 1]._id : null, next: i < ls.length - 1 ? 'l' + ls[i + 1]._id : null, _row: r._id };
    });
  };

  // Повторная очистка HTML авторского урока перед показом (данные пришли из файла, а не из нашей сборки).
  AU.cleanLesson = function (l) {
    var s = AU.sanitize;
    var out = Object.assign({}, l, { html: s(l.html), attachments: [] });
    out.tasks = (l.tasks || []).map(function (t) {
      var c = Object.assign({}, t);
      if (c.prompt != null) c.prompt = s(c.prompt);
      if (c.items) c.items = c.items.map(s);
      if (c.kind === 'file') c.accept = AU.acceptOf(c.accept);
      if (c.questions) c.questions = c.questions.map(function (q) {
        return Object.assign({}, q, { q: s(q.q), explain: s(q.explain || ''), options: (q.options || []).map(function (o) { return { k: String(o.k), text: s(o.text) }; }) });
      });
      return c;
    }).filter(function (t) { return ['text', 'file', 'quiz', 'selfcheck'].indexOf(t.kind) >= 0; });
    return out;
  };
})();
