/* LMS: студия автора (#/author, #/author/<курс>, #/author/<курс>/<урок>, #/author/help), ideav/courses#93.
   Пишем только поля, которые автору разрешены: ядро создаёт строку даже тогда, когда на запретное поле отвечает 403. */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data, AU = A.au, F = AU.F;
  A.views = A.views || {};
  var KIND = { text: 'Текстовый ответ', file: 'Файл', quiz: 'Тест', selfcheck: 'Самопроверка' };
  var flushers = [];
  var prevCleanup = A.cleanup;
  A.cleanup = function () { if (prevCleanup) prevCleanup(); flushers.splice(0).forEach(function (f) { f(); }); };

  function fail(root, e) { root.innerHTML = ''; root.appendChild(E('div', { class: 'card' }, [E('p', { class: 'warn', text: 'Не удалось загрузить: ' + (e && e.message || e) }), E('a', { class: 'btn', href: '#/author', text: 'К моим курсам' })])); }
  function badge(row) {
    var s = AU.statusOf(row);
    return E('span', { class: 'badge st-' + ({ 'черновик': 'draft', 'на проверке': 'review', 'по ссылке': 'pub', 'в каталоге': 'pub', 'снят': 'off', 'отклонён': 'bad' }[s] || 'draft'), text: s });
  }
  function fld(label, input, hint) { return E('label', { class: 'fld' }, [E('span', { class: 'lbl', text: label }), input, hint ? E('span', { class: 'muted small', text: hint }) : null]); }
  function inp(value, attrs) { var i = E('input', Object.assign({ class: 'inp', type: 'text' }, attrs || {})); i.value = value == null ? '' : value; return i; }
  function area(value, rows, attrs) { var t = E('textarea', Object.assign({ class: 'inp', rows: rows || 4 }, attrs || {})); t.value = value == null ? '' : value; return t; }
  function myCourses() { return A.list('Курс автора', {}).then(function (rows) { return rows.filter(function (r) { return A.refId(r[F.owner]) === D.uid; }); }); }
  function lessonsOf(courseId) { return A.list('Урок автора', {}).then(function (rows) { return AU.ordered(rows.filter(function (r) { return A.refId(r[F.parent]) === String(courseId); })); }); }

  // Автосохранение: правка → «Есть несохранённые изменения» → через 1,5 с запись; кнопка «Сохранить» — сразу.
  function saver(fn) {
    var st = E('span', { class: 'save-state muted small', 'aria-live': 'polite', text: 'Сохранено' });
    var dirty = false, busy = null;
    function set(t, cls) { st.textContent = t; st.className = 'save-state small ' + (cls || 'muted'); }
    function run() {
      if (!dirty) return busy || Promise.resolve();
      dirty = false; set('Сохраняем…');
      busy = Promise.resolve(busy).then(fn).then(function () { busy = null; if (!dirty) set('Сохранено', 'good'); },
        function (e) { busy = null; dirty = true; set('Не сохранено: ' + (e && e.message || e), 'warn'); throw e; });
      return busy;
    }
    var later = A.debounce(function () { run().catch(function () { /* показано в статусе */ }); }, 1500);
    var btn = E('button', { class: 'btn', type: 'button', text: 'Сохранить', onclick: function () { later.flush(); dirty = true; run().catch(function () { /* показано */ }); } });
    flushers.push(function () { if (dirty) { later.flush(); run().catch(function () { /* ушли со страницы */ }); } });
    return { el: E('div', { class: 'row save-row' }, [btn, st]), touch: function () { dirty = true; set('Есть несохранённые изменения', 'warn'); later(); },
      flush: function () { later.flush(); return dirty ? run() : (busy || Promise.resolve()); }, isDirty: function () { return dirty; } };
  }

  // ---- #/author ----
  A.views.author = function (root) {
    root.appendChild(E('h1', { class: 'page-title', text: 'Мои курсы' }));
    root.appendChild(E('p', { class: 'muted' }, ['Соберите свой курс: уроки, тесты, задания. После проверки он появится в каталоге. ',
      E('a', { href: '#/author/help', text: 'Как сделать курс' })]));
    var title = inp('', { placeholder: 'Название нового курса', maxlength: 120 });
    var msg = E('span', { class: 'muted small' });
    var add = E('button', { class: 'btn btn-primary', type: 'button', text: 'Создать курс', onclick: function () {
      var t = title.value.trim();
      if (!t) { msg.textContent = 'Напишите название'; title.focus(); return; }
      add.disabled = true;
      var f = {}; f[F.owner] = D.uid;
      A.create('Курс автора', t, f).then(function (id) { location.hash = '#/author/' + id; },
        function (e) { add.disabled = false; msg.textContent = 'Не удалось создать: ' + e.message; });
    } });
    root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'Новый курс' }), E('div', { class: 'row' }, [title, add]), msg]));
    var list = E('div', {}, [E('p', { class: 'muted', text: 'Загружаем…' })]);
    root.appendChild(list);
    myCourses().then(function (rows) {
      list.innerHTML = '';
      if (!rows.length) { list.appendChild(E('p', { class: 'lms-empty', text: 'Курсов пока нет.' })); return; }
      rows.sort(function (a, b) { return Number(b._id) - Number(a._id); }).forEach(function (r) {
        var pub = /^(по ссылке|в каталоге)$/.test(r['Статус']) && r['Код'];
        list.appendChild(E('section', { class: 'card au-course' }, [
          E('div', { class: 'course-head' }, [E('h2', {}, [E('a', { href: '#/author/' + r._id, text: r._main || 'Без названия' })]), badge(r)]),
          r['Замечание'] && !AU.pending(r) ? E('p', { class: 'note-bad' }, [E('b', { text: 'Замечание модератора: ' }), r['Замечание']]) : null,
          E('div', { class: 'row' }, [E('a', { class: 'btn', href: '#/author/' + r._id, text: 'Редактировать' }),
            pub ? E('a', { class: 'btn', href: '#/course/' + encodeURIComponent(r['Код']), text: 'Страница в каталоге' }) : null])]));
      });
    }, function (e) { fail(list, e); });
  };

  A.views.authorHelp = function (root) {
    root.appendChild(E('p', {}, [E('a', { href: A.isGuest() ? '#/catalog' : '#/author', text: '← Назад' })]));
    var box = E('article', { class: 'card lesson-html', text: 'Загружаем…' });
    root.appendChild(box);
    fetch('/download/cources/author-guide.md', { credentials: 'same-origin', cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (md) { box.innerHTML = AU.md(md); A.fixLinks(box); }, function () {
        box.innerHTML = '';
        [E('h1', { text: 'Как сделать курс' }), E('p', { text: 'Подробная инструкция скоро появится. Коротко:' }),
          E('ol', {}, ['Создайте курс в разделе «Автор» и заполните описание, «Для кого», теги и цену (0 — бесплатно).',
            'Добавьте уроки: текст пишется в markdown, справа видно, как его увидит ученик.',
            'Добавьте задания: ответ текстом, файл, тест с вариантами или самопроверку.',
            'Нажмите «Отправить на проверку». После проверки курс появится в каталоге или по ссылке.'].map(function (t) { return E('li', { text: t }); }))]
          .forEach(function (n) { box.appendChild(n); });
      });
  };

  // ---- #/author/<id>[/<урок>] ----
  A.views.authorCourse = function (root, id, lessonId) {
    root.appendChild(E('p', { class: 'lms-empty', text: 'Загружаем…' }));
    Promise.all([A.list('Курс автора', {}), lessonsOf(id)]).then(function (r) {
      var row = r[0].filter(function (x) { return x._id === String(id); })[0];
      root.innerHTML = '';
      if (!row) { root.appendChild(E('div', { class: 'card' }, [E('p', { text: 'Курс не найден.' }), E('a', { class: 'btn', href: '#/author', text: 'К моим курсам' })])); return; }
      if (lessonId) {
        var l = r[1].filter(function (x) { return x._id === String(lessonId); })[0];
        if (!l) { root.appendChild(E('div', { class: 'card' }, [E('p', { text: 'Урок не найден.' }), E('a', { class: 'btn', href: '#/author/' + id, text: 'К курсу' })])); return; }
        lessonEditor(root, row, l, r[1]);
      } else courseEditor(root, row, r[1]);
    }, function (e) { fail(root, e); });
  };

  function courseEditor(root, row, lessons) {
    root.appendChild(E('p', {}, [E('a', { href: '#/author', text: '← Мои курсы' })]));
    root.appendChild(E('div', { class: 'course-head' }, [E('h1', { class: 'page-title', text: row._main || 'Курс' }), badge(row)]));
    if (row['Замечание'] && !AU.pending(row)) root.appendChild(E('p', { class: 'note-bad' }, [E('b', { text: 'Замечание модератора: ' }), row['Замечание']]));
    if (/^(по ссылке|в каталоге)$/.test(AU.statusOf(row))) root.appendChild(E('p', { class: 'muted small' }, ['Курс опубликован' + (row['Код'] ? ': ' : '.'),
      row['Код'] ? E('a', { href: '#/course/' + encodeURIComponent(row['Код']), text: location.origin + location.pathname + '#/course/' + row['Код'] }) : null,
      '. Правки увидят ученики после повторной проверки.']));

    // мета курса
    var title = inp(row._main, { maxlength: 120 }), desc = area(row['Описание'], 4), who = area(row['Для кого'], 3);
    var tags = inp(row['Теги'], { placeholder: 'например: учёт, склад, малый бизнес' });
    var price = inp(row['Цена'] || '0', { inputmode: 'numeric', placeholder: '0' });
    var meta = saver(function () {
      var p = String(price.value).replace(/[^0-9]/g, '') || '0';
      return A.update('Курс автора', row._id, { 'Описание': desc.value, 'Для кого': who.value, 'Теги': AU.tags(tags.value).join(', '), 'Цена': p }, title.value.trim() || row._main)
        .then(function () { row._main = title.value.trim() || row._main; row['Описание'] = desc.value; row['Для кого'] = who.value; row['Цена'] = p; });
    });
    [title, desc, who, tags, price].forEach(function (x) { x.addEventListener('input', meta.touch); });
    var fi = A.fileInfo(row['Обложка']);
    var img = E('img', { class: 'au-cover', alt: 'Обложка', src: fi && AU.safeUrl(fi.url, 'img') || null, hidden: !(fi && AU.safeUrl(fi.url, 'img')) });
    var cmsg = E('span', { class: 'muted small' });
    var cin = E('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp', class: 'file-input' });
    cin.addEventListener('change', function () {
      var f = cin.files[0]; cin.value = '';
      var err = AU.coverError(f);
      if (err) { cmsg.textContent = err; cmsg.className = 'warn small'; return; }
      cmsg.textContent = 'Загружаем…'; cmsg.className = 'muted small'; cin.disabled = true;
      A.uploadTo('Курс автора', row._id, 'Обложка', f).then(function () { return A.list('Курс автора', {}); }).then(function (rows) {
        var nr = rows.filter(function (x) { return x._id === row._id; })[0], u = nr && A.fileInfo(nr['Обложка']);
        row['Обложка'] = nr && nr['Обложка'];
        if (u && AU.safeUrl(u.url, 'img')) { img.src = AU.safeUrl(u.url, 'img'); img.hidden = false; }
        cmsg.textContent = 'Обложка загружена'; cmsg.className = 'good small'; cin.disabled = false;
      }, function (e) { cmsg.textContent = 'Не удалось загрузить: ' + e.message; cmsg.className = 'warn small'; cin.disabled = false; });
    });
    root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'О курсе' }),
      fld('Название', title), fld('Описание', desc, 'Что ученик получит в конце курса.'), fld('Для кого', who),
      fld('Теги', tags, 'Через запятую — по ним ищут в каталоге.'), fld('Цена, ₽', price, '0 — бесплатный курс.'),
      E('div', { class: 'fld' }, [E('span', { class: 'lbl', text: 'Обложка' }), img, E('div', { class: 'row' }, [cin]), E('span', { class: 'muted small', text: 'PNG, JPG или WEBP, до 2 МБ.' }), cmsg]),
      meta.el]));

    // уроки
    var lbox = E('ol', { class: 'au-lessons' });
    function drawLessons() {
      lbox.innerHTML = '';
      if (!lessons.length) lbox.appendChild(E('li', { class: 'muted', text: 'Уроков пока нет.' }));
      lessons.forEach(function (l, i) {
        var del = E('button', { class: 'btn btn-sm', type: 'button', text: 'Удалить', onclick: function () {
          if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Точно удалить?'; return; }
          del.disabled = true;
          A.remove('Урок автора', l._id).then(function () { lessons.splice(lessons.indexOf(l), 1); return renumber(); }).then(drawLessons, function (e) { del.disabled = false; A.toast('Не удалось удалить: ' + e.message); });
        } });
        lbox.appendChild(E('li', {}, [E('a', { class: 'au-l-title', href: '#/author/' + row._id + '/' + l._id, text: (i + 1) + '. ' + (l._main || 'Без названия') }),
          E('span', { class: 'au-l-tools' }, [
            E('button', { class: 'btn btn-sm', type: 'button', text: '↑', 'aria-label': 'Выше', disabled: i === 0, onclick: function () { move(i, -1); } }),
            E('button', { class: 'btn btn-sm', type: 'button', text: '↓', 'aria-label': 'Ниже', disabled: i === lessons.length - 1, onclick: function () { move(i, 1); } }),
            del])]));
      });
    }
    function renumber() {
      return lessons.reduce(function (p, l, i) {
        if (Number(l['Порядок']) === i + 1) return p;
        return p.then(function () { return A.update('Урок автора', l._id, { 'Порядок': String(i + 1) }).then(function () { l['Порядок'] = String(i + 1); }); });
      }, Promise.resolve());
    }
    function move(i, d) {
      var t = lessons[i]; lessons[i] = lessons[i + d]; lessons[i + d] = t;
      drawLessons();
      renumber().catch(function (e) { A.toast('Порядок не сохранён: ' + e.message); });
    }
    var lt = inp('', { placeholder: 'Заголовок урока', maxlength: 160 });
    var ladd = E('button', { class: 'btn btn-primary', type: 'button', text: 'Добавить урок', onclick: function () {
      var t = lt.value.trim();
      if (!t) { lt.focus(); return; }
      ladd.disabled = true;
      var f = { 'Порядок': String(lessons.length + 1), 'Текст': '', 'Задания': '[]' };
      f[F.owner] = D.uid; f[F.parent] = row._id;
      A.create('Урок автора', t, f).then(function (lid) { location.hash = '#/author/' + row._id + '/' + lid; },
        function (e) { ladd.disabled = false; A.toast('Не удалось добавить: ' + e.message); });
    } });
    drawLessons();
    root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'Уроки' }), lbox, E('div', { class: 'row' }, [lt, ladd])]));

    // отправка на проверку
    var smsg = E('div', { class: 'small' });
    var send = E('button', { class: 'btn btn-primary', type: 'button', text: AU.pending(row) ? 'Отправить ещё раз' : 'Отправить на проверку', onclick: function () {
      var probs = [];
      if (!(title.value.trim())) probs.push('нет названия');
      if (!desc.value.trim()) probs.push('нет описания');
      if (!lessons.length) probs.push('нет ни одного урока');
      lessons.forEach(function (l, i) { AU.taskProblems(AU.json(l['Задания'], [])).forEach(function (p) { probs.push('урок ' + (i + 1) + ': ' + p); }); });
      if (probs.length) { smsg.className = 'warn small'; smsg.textContent = 'Сначала исправьте: ' + probs.join('; ') + '.'; return; }
      send.disabled = true;
      meta.flush().then(function () { return A.update('Курс автора', row._id, { 'На проверку': A.nowStr() }); }).then(function () {
        row['На проверку'] = A.nowStr(); smsg.className = 'good small'; smsg.textContent = 'Курс отправлен на проверку. Ответ модератора появится здесь.';
        send.textContent = 'Отправить ещё раз'; send.disabled = false;
      }, function (e) { send.disabled = false; smsg.className = 'warn small'; smsg.textContent = 'Не удалось отправить: ' + e.message; });
    } });
    root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'Публикация' }),
      E('p', { class: 'muted small', text: 'Модератор проверит курс и опубликует его в каталоге или по ссылке. Комиссия платформы с платных курсов — 30%.' }),
      E('div', { class: 'row' }, [send]), smsg]));
  }

  // ---- редактор урока ----
  function lessonEditor(root, course, l, all) {
    var idx = all.indexOf(l);
    var tasks = AU.json(l['Задания'], []);
    if (!Array.isArray(tasks)) tasks = [];
    root.appendChild(E('p', {}, [E('a', { href: '#/author/' + course._id, text: '← ' + (course._main || 'Курс') })]));
    root.appendChild(E('div', { class: 'muted small', text: 'Урок ' + (idx + 1) + ' из ' + all.length }));
    var title = inp(l._main, { class: 'inp au-title', maxlength: 160, 'aria-label': 'Заголовок урока' });
    var text = area(l['Текст'], 14, { class: 'inp au-md', placeholder: '## Подзаголовок\n\nТекст урока. **Жирный**, списки, [ссылки](https://example.com).', 'aria-label': 'Текст урока, markdown' });
    var prev = E('div', { class: 'lesson-html au-preview' });
    var probs = E('div', { class: 'warn small' });
    var sv = saver(function () {
      var json = JSON.stringify(tasks);
      return A.update('Урок автора', l._id, { 'Текст': text.value, 'Задания': json }, title.value.trim() || l._main)
        .then(function () { l._main = title.value.trim() || l._main; l['Текст'] = text.value; l['Задания'] = json; });
    });
    function render() { try { prev.innerHTML = AU.md(text.value) || '<p class="muted">Здесь появится текст урока.</p>'; A.fixLinks(prev); } catch (e) { prev.textContent = e.message; } }
    var later = A.debounce(render, 250);
    text.addEventListener('input', function () { later(); sv.touch(); });
    title.addEventListener('input', sv.touch);
    render();
    root.appendChild(E('section', { class: 'card' }, [fld('Заголовок', title),
      E('div', { class: 'au-split' }, [E('div', {}, [E('span', { class: 'lbl', text: 'Текст (markdown)' }), text]),
        E('div', {}, [E('span', { class: 'lbl', text: 'Как увидит ученик' }), prev])]), sv.el]));

    var tbox = E('div', { class: 'au-tasks' });
    function changed() { sv.touch(); probs.textContent = AU.taskProblems(tasks).join('; '); }
    function drawTasks() {
      tbox.innerHTML = '';
      if (!tasks.length) tbox.appendChild(E('p', { class: 'muted', text: 'Заданий нет. Урок без заданий ученик закрывает кнопкой «Дальше».' }));
      tasks.forEach(function (t, i) { tbox.appendChild(taskCard(t, i)); });
      probs.textContent = AU.taskProblems(tasks).join('; ');
    }
    function taskCard(t, i) {
      var body;
      if (t.kind === 'text') {
        var p = area(t.prompt, 3), tp = area(t.template, 3);
        p.addEventListener('input', function () { t.prompt = p.value; changed(); });
        tp.addEventListener('input', function () { t.template = tp.value; changed(); });
        body = [fld('Задание (markdown)', p), fld('Шаблон ответа', tp, 'Необязательно: подставится в поле ответа.')];
      } else if (t.kind === 'file') {
        var fp = area(t.prompt, 3), mx = inp(t.max || 5, { type: 'number', min: 1, max: 10 });
        var acc = String(t.accept || '').split(',').map(function (x) { return x.trim(); });
        var boxes = E('div', { class: 'au-exts' }, AU.ANSWER_EXT.map(function (x) {
          var cb = E('input', { type: 'checkbox' }); cb.checked = acc.indexOf(x) >= 0;
          cb.addEventListener('change', function () {
            acc = acc.filter(function (y) { return y && y !== x; }); if (cb.checked) acc.push(x);
            t.accept = acc.join(','); changed();
          });
          return E('label', { class: 'check' }, [cb, E('span', { text: x })]);
        }));
        fp.addEventListener('input', function () { t.prompt = fp.value; changed(); });
        mx.addEventListener('input', function () { t.max = Math.min(10, Math.max(1, Number(mx.value) || 5)); changed(); });
        body = [fld('Задание (markdown)', fp), E('div', { class: 'fld' }, [E('span', { class: 'lbl', text: 'Какие файлы принимать (ничего не отмечено — любые из списка)' }), boxes]), fld('Сколько файлов, до', mx)];
      } else if (t.kind === 'selfcheck') {
        var it = area((t.items || []).join('\n'), 4, { placeholder: 'Каждый пункт с новой строки' });
        it.addEventListener('input', function () { t.items = it.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); changed(); });
        body = [fld('Пункты самопроверки', it, 'Каждый пункт с новой строки. Ученик отмечает все.')];
      } else if (t.kind === 'quiz') body = quizBuilder(t);
      else body = [E('p', { class: 'warn', text: 'Неизвестный вид задания: ' + t.kind })];
      return E('section', { class: 'task au-task' }, [E('div', { class: 'course-head' }, [E('h3', { class: 'task-title', text: (i + 1) + '. ' + (KIND[t.kind] || t.kind) }),
        E('span', { class: 'au-l-tools' }, [
          E('button', { class: 'btn btn-sm', type: 'button', text: '↑', 'aria-label': 'Выше', disabled: i === 0, onclick: function () { swap(i, -1); } }),
          E('button', { class: 'btn btn-sm', type: 'button', text: '↓', 'aria-label': 'Ниже', disabled: i === tasks.length - 1, onclick: function () { swap(i, 1); } }),
          E('button', { class: 'btn btn-sm', type: 'button', text: 'Убрать', onclick: function () { tasks.splice(i, 1); drawTasks(); changed(); } })])])].concat(body));
    }
    function swap(i, d) { var x = tasks[i]; tasks[i] = tasks[i + d]; tasks[i + d] = x; drawTasks(); changed(); }
    function quizBuilder(t) {
      t.questions = t.questions || [];
      var pass = inp(Math.round((t.pass == null ? 0.7 : t.pass) * 100), { type: 'number', min: 10, max: 100, step: 5 });
      pass.addEventListener('input', function () { var v = Number(pass.value); t.pass = v >= 10 && v <= 100 ? v / 100 : 0.7; changed(); });
      var qbox = E('div', {});
      function drawQ() {
        qbox.innerHTML = '';
        t.questions.forEach(function (q, qi) {
          q.options = q.options || [];
          var qt = area(q.q, 2, { placeholder: 'Текст вопроса' });
          qt.addEventListener('input', function () { q.q = qt.value; changed(); });
          var name = 'ans_' + Math.random().toString(36).slice(2);
          var opts = AU.LETTERS.map(function (k) {
            var o = q.options.filter(function (x) { return x.k === k; })[0];
            var oi = inp(o ? o.text : '', { placeholder: 'Вариант ' + k + (k === 'в' || k === 'г' ? ' (необязательно)' : '') });
            var rb = E('input', { type: 'radio', name: name, 'aria-label': 'Правильный ответ ' + k }); rb.checked = q.answer === k;
            oi.addEventListener('input', function () {
              var cur = q.options.filter(function (x) { return x.k === k; })[0];
              if (cur) cur.text = oi.value; else q.options.push({ k: k, text: oi.value });
              q.options.sort(function (a, b) { return AU.LETTERS.indexOf(a.k) - AU.LETTERS.indexOf(b.k); });
              changed();
            });
            rb.addEventListener('change', function () { if (rb.checked) { q.answer = k; changed(); } });
            return E('div', { class: 'au-opt' }, [E('label', { class: 'au-right', title: 'Правильный ответ' }, [rb, E('span', { text: k })]), oi]);
          });
          var ex = inp(q.explain, { placeholder: 'Пояснение после ответа (необязательно)' });
          ex.addEventListener('input', function () { q.explain = ex.value; changed(); });
          qbox.appendChild(E('div', { class: 'question au-q' }, [E('div', { class: 'course-head' }, [E('b', { text: 'Вопрос ' + (qi + 1) }),
            E('button', { class: 'btn btn-sm', type: 'button', text: 'Убрать вопрос', onclick: function () { t.questions.splice(qi, 1); drawQ(); changed(); } })]),
            qt, E('div', { class: 'muted small', text: 'Отметьте кружком правильный вариант.' })].concat(opts, [ex])));
        });
      }
      drawQ();
      return [qbox, E('div', { class: 'row' }, [E('button', { class: 'btn', type: 'button', text: '+ Вопрос', onclick: function () { t.questions.push({ q: '', options: [], answer: '', explain: '' }); drawQ(); changed(); } })]),
        fld('Порог прохождения, % верных', pass)];
    }
    var kind = E('select', { class: 'inp', 'aria-label': 'Вид задания' }, Object.keys(KIND).map(function (k) { return E('option', { value: k, text: KIND[k] }); }));
    var addT = E('button', { class: 'btn', type: 'button', text: 'Добавить задание', onclick: function () {
      var k = kind.value;
      tasks.push(k === 'quiz' ? { kind: 'quiz', pass: 0.7, questions: [{ q: '', options: [], answer: '', explain: '' }] } : k === 'selfcheck' ? { kind: 'selfcheck', items: [] } : k === 'file' ? { kind: 'file', prompt: '', accept: '', max: 5 } : { kind: 'text', prompt: '', template: '' });
      drawTasks(); changed();
    } });
    drawTasks();
    root.appendChild(E('section', { class: 'card' }, [E('h2', { text: 'Задания' }), tbox, probs, E('div', { class: 'row' }, [kind, addT])]));

    // предпросмотр «как ученик»: та же сборка, что при публикации, и те же виджеты заданий
    var pv = E('div', {});
    var pbtn = E('button', { class: 'btn', type: 'button', text: 'Предпросмотр урока', onclick: function () {
      pv.innerHTML = '';
      AU.buildLesson({ id: 'l' + l._id, course: 'preview', n: idx + 1, title: title.value, md: text.value, tasks: tasks }).then(function (lj) { A.lessonPreview(pv, lj); pv.scrollIntoView({ block: 'start' }); },
        function (e) { pv.appendChild(E('p', { class: 'warn', text: 'Ошибка сборки: ' + e.message })); });
    } });
    var nav = E('div', { class: 'row' }, [pbtn,
      idx > 0 ? E('a', { class: 'btn', href: '#/author/' + course._id + '/' + all[idx - 1]._id, text: '← Предыдущий' }) : null,
      idx < all.length - 1 ? E('a', { class: 'btn', href: '#/author/' + course._id + '/' + all[idx + 1]._id, text: 'Следующий →' }) : null]);
    root.appendChild(nav); root.appendChild(pv);
  }

  // Урок в формате lesson.json, отрисованный виджетами ученика, без записи прогресса.
  A.lessonPreview = function (box, lesson) {
    var st = {};
    var ctx = { course: 'preview', lesson: lesson, get: function (i) { return st[i] || {}; },
      update: function (i, o) { st[i] = Object.assign(st[i] || {}, o); return Promise.resolve(); }, changed: function () { /* предпросмотр */ } };
    var parts = (lesson.tasks || []).map(function (t, i) {
      if (t.kind === 'file') return { el: E('div', { class: 'guest-tasks', inert: true }, [A.tasks.file(t, i, ctx).el]) };
      var r = A.tasks[t.kind];
      return r ? r(t, i, ctx) : { el: E('p', { class: 'muted', text: 'Неизвестное задание: ' + t.kind }) };
    });
    var art = E('article', { class: 'lesson au-pv' }, [E('div', { class: 'muted small', text: 'Предпросмотр: ответы не сохраняются' }), E('h1', { class: 'lesson-title', text: lesson.title }),
      E('div', { class: 'lesson-html', html: AU.sanitize(lesson.html) })].concat(parts.map(function (p) { return p.el; })));
    box.appendChild(art);
    A.fixLinks(box);
  };
})();
