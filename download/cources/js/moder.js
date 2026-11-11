/* LMS: вкладка админа «Курсы на проверке» (#/curator), ideav/courses#93.
   Публикация собирается в браузере админа: урок → lesson.json (marked + DOMPurify, answer → hash),
   файлы — FILE-ом в «Файл публикации» (та же строка при повторе — адрес не меняется), затем манифест,
   «Курс автора» и строка «Каталога». */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data, AU = A.au, F = AU.F;
  var PUB = 'Файл публикации';

  function jsonFile(obj, name) { return new File([JSON.stringify(obj)], name, { type: 'application/json' }); }
  // Загрузить объект как JSON-файл в строку «<main>» «Файла публикации»; вернуть адрес файла.
  function putFile(existing, main, obj, name) {
    var row = existing.filter(function (r) { return r._main === main; })[0];
    var p = row ? A.uploadTo(PUB, row._id, 'Файл', jsonFile(obj, name)) : A.upload(PUB, main, {}, 'Файл', jsonFile(obj, name));
    return p.then(function (id) {
      return A.list(PUB, {}).then(function (rows) {
        var r = rows.filter(function (x) { return x._id === String(id); })[0];
        var u = r && A.fileInfo(r['Файл']);
        if (!u || !u.url) throw new Error('не удалось прочитать адрес файла ' + main);
        if (!row) existing.push(r);
        return u.url;
      });
    });
  }
  function authorName(row) {
    var uid = A.refId(row[F.owner]);
    return A.list('Профиль', { 'Пользователь': uid }).then(function (p) { return (p[0] && p[0]['Имя']) || A.refText(row[F.owner]) || ''; }, function () { return A.refText(row[F.owner]) || ''; });
  }
  function lessonsOf(id) { return A.list('Урок автора', {}).then(function (rows) { return rows.filter(function (r) { return A.refId(r[F.parent]) === String(id); }); }); }

  // vis: 'каталог' | 'ссылка'; pay — ссылка оплаты; onStep(текст) — ход публикации
  A.publishCourse = function (row, vis, pay, onStep) {
    var code = 'a' + row._id, step = onStep || function () {};
    var price = Number(String(row['Цена'] || '0').replace(/[^0-9.]/g, '')) || 0;
    var ctx = {};
    step('Читаем уроки…');
    return Promise.all([lessonsOf(row._id), A.list(PUB, {}), A.list('Каталог', {}), authorName(row)]).then(function (r) {
      ctx.drafts = AU.drafts(code, r[0]); ctx.files = r[1]; ctx.catalog = r[2]; ctx.author = r[3];
      if (!ctx.drafts.length) throw new Error('в курсе нет уроков');
      var probs = [];
      ctx.drafts.forEach(function (d) { AU.taskProblems(d.tasks).forEach(function (p) { probs.push(d.title + ': ' + p); }); });
      if (probs.length) throw new Error(probs.join('; '));
      return ctx.drafts.reduce(function (p, d, i) {
        return p.then(function (acc) {
          step('Урок ' + (i + 1) + ' из ' + ctx.drafts.length + '…');
          return AU.buildLesson(d).then(function (lj) {
            return putFile(ctx.files, code + ':' + d.id, lj, code + '-' + d.id + '.json').then(function (url) {
              acc.push({ id: d.id, n: d.n, title: d.title, task: AU.mainKind(lj.tasks), url: url }); return acc;
            });
          });
        });
      }, Promise.resolve([]));
    }).then(function (ls) {
      ctx.lessons = ls;
      step('Манифест…');
      var man = { code: code, title: row._main, author: ctx.author, forWhom: row['Для кого'] || '', lessons: ls };
      return putFile(ctx.files, code + ':manifest', man, code + '-manifest.json');
    }).then(function (manUrl) {
      ctx.man = manUrl;
      step('Карточка курса…');
      var now = A.nowStr();
      var cf = A.fileInfo(row['Обложка']);
      var f = { 'Код': code, 'Статус': vis === 'ссылка' ? AU.STATUS.link : AU.STATUS.catalog, 'Опубликован': now, 'Манифест': manUrl, 'Ссылка оплаты': pay || '', 'Замечание': '' };
      if (!String(row['Комиссия'] || '').trim()) f['Комиссия'] = '30';
      var cat = { 'Название': row._main, 'Описание': row['Описание'] || '', 'Автор': ctx.author, 'Теги': AU.tags(row['Теги']).join(', '), 'Цена': String(price),
        'Обложка': (cf && cf.url) || '', 'Уроки': JSON.stringify(ctx.lessons.map(function (l) { return { id: l.id, n: l.n, title: l.title, task: l.task }; })),
        'Видимость': vis, 'Ссылка оплаты': pay || '', 'Манифест': price ? '' : manUrl, 'Дата и время': now };
      if (A.hasField && A.hasField('Каталог', 'Для кого')) cat['Для кого'] = row['Для кого'] || '';
      var crow = ctx.catalog.filter(function (x) { return x._main === code; })[0];
      return A.update('Курс автора', row._id, f).then(function () {
        Object.assign(row, f);
        return crow ? A.update('Каталог', crow._id, cat) : A.create('Каталог', code, cat);
      });
    }).then(function () { return { code: code, manifest: ctx.man }; });
  };

  function moder(pane) {
    pane.appendChild(E('p', { class: 'muted', text: 'Загружаем…' }));
    A.list('Курс автора', {}).then(function (rows) {
      pane.innerHTML = '';
      var wait = rows.filter(AU.pending).sort(function (a, b) { return AU.time(a['На проверку']) - AU.time(b['На проверку']); });
      var pub = rows.filter(function (r) { return !AU.pending(r) && /^(по ссылке|в каталоге)$/.test(r['Статус']); });
      pane.appendChild(E('h3', { text: 'Ждут проверки' + (wait.length ? ' (' + wait.length + ')' : '') }));
      if (!wait.length) pane.appendChild(E('p', { class: 'lms-empty', text: 'Новых курсов на проверке нет.' }));
      wait.forEach(function (r) { pane.appendChild(card(r, true)); });
      if (pub.length) pane.appendChild(E('h3', { text: 'Опубликованы' }));
      pub.forEach(function (r) { pane.appendChild(card(r, false)); });
    }, function (e) { pane.innerHTML = ''; pane.appendChild(E('p', { class: 'warn', text: 'Не удалось загрузить: ' + e.message })); });
  }

  function card(r, waiting) {
    var msg = E('div', { class: 'small muted', 'aria-live': 'polite' });
    var pv = E('div', { class: 'mod-preview' });
    var pay = E('input', { class: 'inp', type: 'url', placeholder: 'Ссылка оплаты (https://…), для платного курса' }); pay.value = r['Ссылка оплаты'] || '';
    var note = E('textarea', { class: 'inp', rows: 2, placeholder: 'Замечание автору (обязательно при отклонении)' }); note.value = r['Замечание'] || '';
    var price = Number(String(r['Цена'] || '0').replace(/[^0-9.]/g, '')) || 0;
    var btns = [];
    function busy(on) { btns.forEach(function (b) { b.disabled = on; }); }
    function done(t) { msg.className = 'small good'; msg.textContent = t; busy(false); }
    function err(e) { msg.className = 'small warn'; msg.textContent = 'Ошибка: ' + (e && e.message || e); busy(false); }
    function publish(vis) {
      var p = pay.value.trim();
      if (p && !AU.safeUrl(p, 'link')) { err(new Error('ссылка оплаты должна начинаться с https://')); return; }
      if (price && !p) { err(new Error('у платного курса нужна ссылка оплаты')); return; }
      busy(true); msg.className = 'small muted';
      A.publishCourse(r, vis, p, function (t) { msg.textContent = t; }).then(function (res) {
        done('Опубликовано ' + (vis === 'ссылка' ? 'по ссылке' : 'в каталоге') + ': #/course/' + res.code);
        return D.init ? reloadCatalog() : null;
      }, err);
    }
    var preview = E('button', { class: 'btn', type: 'button', text: 'Предпросмотр', onclick: function () {
      pv.innerHTML = '';
      if (pv.dataset.open) { delete pv.dataset.open; preview.textContent = 'Предпросмотр'; return; }
      pv.dataset.open = '1'; preview.textContent = 'Скрыть предпросмотр';
      pv.appendChild(E('p', { class: 'muted', text: 'Собираем уроки…' }));
      lessonsOf(r._id).then(function (ls) {
        var drafts = AU.drafts('a' + r._id, ls);
        return Promise.all(drafts.map(AU.buildLesson)).then(function (built) {
          pv.innerHTML = '';
          if (!built.length) pv.appendChild(E('p', { class: 'warn', text: 'В курсе нет уроков.' }));
          var probs = [];
          drafts.forEach(function (d) { AU.taskProblems(d.tasks).forEach(function (p) { probs.push(d.title + ': ' + p); }); });
          if (probs.length) pv.appendChild(E('p', { class: 'warn small', text: 'Не готово к публикации: ' + probs.join('; ') }));
          built.forEach(function (lj, i) {
            var d = E('details', { class: 'mod-lesson' }, [E('summary', { text: (i + 1) + '. ' + lj.title + ' · заданий: ' + lj.tasks.length })]);
            d.addEventListener('toggle', function () { if (d.open && !d.dataset.r) { d.dataset.r = '1'; A.lessonPreview(d, lj); answers(d, drafts[i]); } });
            pv.appendChild(d);
          });
        });
      }).catch(function (e) { pv.innerHTML = ''; pv.appendChild(E('p', { class: 'warn', text: 'Не удалось собрать: ' + e.message })); });
    } });
    btns.push(preview);
    var b1 = E('button', { class: 'btn btn-primary', type: 'button', text: 'Опубликовать в каталог', onclick: function () { publish('каталог'); } });
    var b2 = E('button', { class: 'btn', type: 'button', text: 'Опубликовать по ссылке', onclick: function () { publish('ссылка'); } });
    var b3 = E('button', { class: 'btn', type: 'button', text: 'Отклонить', onclick: function () {
      if (!note.value.trim()) { err(new Error('напишите замечание автору')); note.focus(); return; }
      busy(true);
      // опубликованный курс при отклонении правок остаётся в каталоге в прежней версии
      var f = { 'Замечание': note.value.trim(), 'На проверку': '' };
      if (!/^(по ссылке|в каталоге)$/.test(r['Статус'])) f['Статус'] = AU.STATUS.reject;
      A.update('Курс автора', r._id, f).then(function () { done('Отклонено, автор увидит замечание.'); }, err);
    } });
    var b4 = E('button', { class: 'btn', type: 'button', text: 'Снять с публикации', onclick: function () {
      if (!b4.dataset.sure) { b4.dataset.sure = '1'; b4.textContent = 'Точно снять?'; return; }
      busy(true);
      A.update('Курс автора', r._id, { 'Статус': AU.STATUS.off }).then(function () { return A.list('Каталог', {}); }).then(function (rows) {
        var c = rows.filter(function (x) { return x._main === 'a' + r._id; })[0];
        return c ? A.remove('Каталог', c._id) : null;
      }).then(function () { done('Курс снят: из каталога убран, выданные доступы работают.'); return reloadCatalog(); }, err);
    } });
    btns.push(b1, b2, b3, b4);
    var st = AU.statusOf(r);
    return E('section', { class: 'card mod-card' }, [
      E('div', { class: 'course-head' }, [E('h3', { text: r._main || 'Без названия' }), E('span', { class: 'badge', text: st })]),
      E('div', { class: 'muted small', text: 'Автор: ' + A.refText(r[F.owner]) + ' · ' + (price ? price.toLocaleString('ru-RU') + ' ₽' : 'бесплатно') + ' · отправлен ' + (r['На проверку'] || '—') + (r['Опубликован'] ? ' · опубликован ' + r['Опубликован'] : '') + (r['Код'] ? ' · код ' + r['Код'] : '') }),
      r['Описание'] ? E('p', { class: 'pre small', text: r['Описание'] }) : null,
      E('div', { class: 'row' }, [preview]), pv,
      waiting ? pay : null, waiting ? note : null,
      E('div', { class: 'row' }, waiting ? [b1, b2, b3] : [b4]), msg]);
  }
  function answers(box, d) {
    var qs = [];
    (d.tasks || []).forEach(function (t) { if (t.kind === 'quiz') (t.questions || []).forEach(function (q, i) { qs.push((i + 1) + '. ' + (q.q || '') + ' → ' + (q.answer || '?')); }); });
    if (qs.length) box.appendChild(E('div', { class: 'muted small', text: 'Правильные ответы: ' + qs.join(' · ') }));
  }
  function reloadCatalog() {
    return A.list('Каталог', {}).then(function (rows) { D.catalog = rows.map(AU.fromCatalog).filter(function (c) { return AU.isAuthored(c.code); }); }, function () { /* оставим как есть */ });
  }

  A.views = A.views || {};
  A.views.admin = (A.views.admin || []).concat([['moder', 'Курсы на проверке', moder]]);
})();
