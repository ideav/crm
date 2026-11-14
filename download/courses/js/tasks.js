/* LMS: рендер заданий урока. Каждый возвращает {el, done(), missing()}.
   ctx: {course, lesson (json), get(i), update(i, obj, flush)} — см. lesson.js. */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, T = A.tasks = {};

  function box(title, kind, kids) {
    return E('section', { class: 'task task-' + kind }, [E('h3', { class: 'task-title', text: title })].concat(kids));
  }
  function promptEl(t) { return E('div', { class: 'task-prompt lesson-html', html: t.prompt || '' }); }

  // ---- text / file ----
  T.text = function (t, i, ctx) {
    var st = ctx.get(i), isFile = t.kind === 'file';
    var ta = E('textarea', { class: 'inp', rows: isFile ? 3 : 7, placeholder: isFile ? 'Вставьте ссылку на файл (Яндекс Диск, Google Drive) или опишите результат' : 'Ваш ответ' });
    ta.value = st.draft != null ? st.draft : (st.text || (st.saved ? '' : t.template || ''));
    var status = E('span', { class: 'muted' });
    var btn = E('button', { class: 'btn btn-primary', type: 'button', text: st.saved ? 'Сохранить ещё раз' : 'Сохранить ответ' });
    var cur = ctx.get(i);
    function show() { status.textContent = ctx.get(i).saved ? 'Ответ принят' : ''; }
    var auto = A.debounce(function () {
      ctx.update(i, { draft: ta.value }).then(function () { status.textContent = 'Черновик сохранён'; }, function () { status.textContent = 'Не удалось сохранить черновик'; });
    }, 1200);
    ta.addEventListener('input', function () { status.textContent = 'Печатаете…'; auto(); });
    btn.addEventListener('click', function () {
      if (!ta.value.trim()) { status.textContent = 'Сначала напишите ответ'; return; }
      auto.flush(); btn.disabled = true;
      ctx.update(i, { text: ta.value, draft: ta.value, saved: true }, true).then(function () {
        status.textContent = 'Ответ принят'; btn.textContent = 'Сохранить ещё раз'; ctx.changed();
      }, function () { status.textContent = 'Ошибка сохранения, попробуйте ещё раз'; }).then(function () { btn.disabled = false; });
    });
    var kids = [promptEl(t), ta];
    if (isFile && t.accept) kids.push(E('p', { class: 'muted small', text: 'Файл: ' + t.accept + (t.max ? ', до ' + t.max + ' МБ' : '') + '. Пока принимаем ссылку на файл.' }));
    kids.push(E('div', { class: 'row' }, [btn, status]));
    show();
    return { el: box(isFile ? 'Ваш файл' : 'Ваш ответ', t.kind, kids), done: function () { return !!cur && !!ctx.get(i).saved; }, missing: isFile ? 'сохраните ссылку на файл' : 'сохраните ответ' };
  };
  // ---- file: загрузка файлов в «Файл ответа» (до t.max штук, каждый ≤10 МБ) + запасная ссылка на облако ----
  var MAX_MB = 10;
  function ext(n) { var m = /\.([^.\/]+)$/.exec(n || ''); return m ? '.' + m[1].toLowerCase() : ''; }
  function okExt(accept, name) {
    var list = String(accept || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return !list.length || list.indexOf(ext(name)) >= 0;
  }
  function mb(n) { return (n / 1048576).toFixed(n < 1048576 ? 2 : 1).replace('.', ',') + ' МБ'; }
  T.file = function (t, i, ctx) {
    var D = A.data, maxN = Number(t.max) > 0 ? Number(t.max) : 5, busy = false;
    var list = E('ul', { class: 'file-list' }), msg = E('div', { class: 'file-msg small' });
    var input = E('input', { type: 'file', multiple: true, accept: t.accept || '', class: 'file-input' });
    var bar = E('progress', { class: 'file-progress', max: 1, value: 0, hidden: true });
    var link = E('textarea', { class: 'inp', rows: 2, placeholder: 'Файл слишком большой? Вставьте ссылку на облако (Яндекс Диск, Google Drive)' });
    var lbtn = E('button', { class: 'btn', type: 'button', text: 'Сохранить ссылку' });
    var st0 = ctx.get(i);
    link.value = st0.text || '';
    function mine() { return D.filesFor(ctx.course, ctx.lesson.id, i); }
    function note(txt, bad) { msg.textContent = txt || ''; msg.className = 'file-msg small' + (bad ? ' warn' : ' muted'); }
    function sync() { return ctx.update(i, { files: mine().length }, true).then(function () { ctx.changed(); }); }
    function draw() {
      list.innerHTML = '';
      mine().forEach(function (f) {
        var fi = A.fileInfo(f['Файл']) || { url: '', name: '' };
        var del = E('button', { class: 'btn btn-sm', type: 'button', text: 'Удалить', onclick: function () {
          if (busy) return; busy = true; del.disabled = true;
          A.removeFile('Файл ответа', f._id, 'Файл').then(function () {
            D.files = D.files.filter(function (x) { return x._id !== f._id; });
            busy = false; draw(); note('Файл удалён'); return sync();
          }).catch(function (e) { busy = false; del.disabled = false; note('Не удалось удалить: ' + e.message, true); });
        } });
        list.appendChild(E('li', {}, [fi.url ? E('a', { href: fi.url, target: '_blank', rel: 'noopener', text: fi.name }) : E('span', { text: fi.name }), ' ', del]));
      });
      input.disabled = mine().length >= maxN;
    }
    function uploadAll(files) {
      var free = maxN - mine().length, errs = [], queue = [];
      files.forEach(function (f) {
        if (!okExt(t.accept, f.name)) errs.push(f.name + ': допустимы ' + t.accept);
        else if (f.size > MAX_MB * 1048576) errs.push(f.name + ': ' + mb(f.size) + ' — больше ' + MAX_MB + ' МБ');
        else if (!f.size) errs.push(f.name + ': пустой файл');
        else if (queue.length >= free) errs.push(f.name + ': не больше ' + maxN + ' файлов');
        else queue.push(f);
      });
      if (!queue.length) { note(errs.join('; '), true); return; }
      busy = true; input.disabled = true; bar.hidden = false;
      var done = 0;
      queue.reduce(function (p, f, k) {
        return p.then(function () {
          note('Загружаем ' + f.name + ' (' + (k + 1) + ' из ' + queue.length + ')…'); bar.value = 0;
          var fields = { 'Пользователь': D.uid, 'Курс': ctx.course, 'Урок': ctx.lesson.id, 'Задание': String(i), 'Дата и время': A.nowStr() };
          return A.upload('Файл ответа', D.uid + ':' + ctx.course + ':' + ctx.lesson.id + ':' + i + ':' + Date.now() + k, fields, 'Файл', f, function (x) { bar.value = x; })
            .then(function (id) {
              var row = Object.assign({ _id: id, _main: '' }, fields);
              return A.list('Файл ответа', { 'Пользователь': D.uid }).then(function (all) {
                var got = all.filter(function (x) { return x._id === String(id); })[0];
                D.files.push(got || Object.assign(row, { 'Файл': '<a>' + f.name + '</a>' })); done++; draw();
              });
            }, function (e) { errs.push(f.name + ': ' + e.message); });
        });
      }, Promise.resolve()).then(function () {
        busy = false; bar.hidden = true; draw();
        note((done ? 'Загружено: ' + done + '. ' : '') + errs.join('; '), errs.length > 0);
        return done ? sync() : null;
      }).catch(function () { busy = false; bar.hidden = true; draw(); note('Не удалось сохранить, попробуйте ещё раз', true); });
    }
    input.addEventListener('change', function () { var fs = [].slice.call(input.files); input.value = ''; if (fs.length && !busy) uploadAll(fs); });
    lbtn.addEventListener('click', function () {
      var v = link.value.trim(); lbtn.disabled = true;
      ctx.update(i, { text: v, saved: !!v }, true).then(function () { note(v ? 'Ссылка сохранена' : 'Ссылка убрана'); ctx.changed(); }, function () { note('Не удалось сохранить ссылку', true); }).then(function () { lbtn.disabled = false; });
    });
    draw();
    var hint = 'Файлы' + (t.accept ? ' (' + t.accept + ')' : '') + ', до ' + maxN + ' шт., каждый до ' + MAX_MB + ' МБ.';
    return { el: box('Ваши файлы', 'file', [promptEl(t), E('p', { class: 'muted small', text: hint }), E('div', { class: 'row' }, [input]), bar, list, msg,
        E('div', { class: 'file-link' }, [link, E('div', { class: 'row' }, [lbtn])])]),
      done: function () { var s = ctx.get(i); return mine().length > 0 || !!(s.saved && s.text); }, missing: 'загрузите файл' };
  };

  // ---- selfcheck ----
  T.selfcheck = function (t, i, ctx) {
    var checked = (ctx.get(i).checked || []).slice();
    var items = (t.items || []).map(function (txt, k) {
      var cb = E('input', { type: 'checkbox' });
      cb.checked = checked.indexOf(k) >= 0;
      cb.addEventListener('change', function () {
        checked = checked.filter(function (x) { return x !== k; });
        if (cb.checked) checked.push(k);
        ctx.update(i, { checked: checked }, true).then(ctx.changed);
        ctx.changed();
      });
      return E('label', { class: 'check' }, [cb, E('span', { html: txt })]);
    });
    return { el: box('Проверьте себя', 'selfcheck', items),
      done: function () { return (t.items || []).every(function (_, k) { return checked.indexOf(k) >= 0; }); },
      missing: 'отметьте все пункты самопроверки' };
  };
})();
