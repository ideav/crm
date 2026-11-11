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
  T.file = T.text;

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
