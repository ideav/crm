/* LMS: практикум — выбор рабочей базы и автопроверка через window.LMSChecks.run(db, spec). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data;

  A.tasks.practicum = function (t, i, ctx) {
    var st = ctx.get(i);
    var inp = E('input', { class: 'inp', type: 'text', placeholder: 'Имя вашей базы, например my123', autocomplete: 'off' });
    inp.value = st.db || (D.profile && D.profile['Рабочая база']) || '';
    var btn = E('button', { class: 'btn btn-primary', type: 'button', text: 'Проверить мою базу' });
    var out = E('div', { class: 'checks', 'aria-live': 'polite' });
    var self = E('button', { class: 'btn', type: 'button', text: 'Я выполнил(а) это сам(а)', hidden: true });
    var done = !!st.done;

    function render(res) {
      out.innerHTML = '';
      res.forEach(function (r) {
        out.appendChild(E('div', { class: 'chk ' + (r.ok ? 'ok' : 'bad') }, [
          E('span', { class: 'mark', text: r.ok ? '✓' : '✗' }),
          E('span', {}, [E('b', { text: r.title || r.id }), r.ok ? '' : E('span', { class: 'muted', text: ' — ' + (r.hint || 'не выполнено') })])]));
      });
    }
    function finish(extra) {
      done = true;
      ctx.update(i, Object.assign({ done: true, db: inp.value.trim() }, extra || {}), true).then(ctx.changed);
      ctx.changed();
    }
    btn.addEventListener('click', function () {
      var db = inp.value.trim();
      if (!db) { out.textContent = 'Укажите имя вашей базы'; return; }
      D.saveProfile({ 'Рабочая база': db }).catch(function () { /* не критично */ });
      if (!window.LMSChecks) {
        out.innerHTML = '<p class="warn">Автопроверка пока недоступна. Выполните шаги по уроку и подтвердите вручную.</p>';
        self.hidden = false; return;
      }
      btn.disabled = true; out.textContent = 'Проверяем…';
      A.getJSON(A.contentRoot + 'checks/' + t.spec + '.json')
        .then(function (spec) { return window.LMSChecks.run(db, spec); })
        .then(function (res) {
          render(res);
          var all = res.length && res.every(function (r) { return r.ok; });
          out.appendChild(E('p', { class: all ? 'good' : 'warn', text: all ? 'Всё на месте — практикум выполнен.' : 'Исправьте отмеченное и проверьте снова.' }));
          if (all) finish({ check: res.map(function (r) { return { id: r.id, ok: r.ok }; }) }); else ctx.update(i, { db: db });
        })
        .catch(function (e) { out.innerHTML = '<p class="warn">Проверка не удалась: ' + A.esc(e.message) + '</p>'; self.hidden = false; })
        .then(function () { btn.disabled = false; });
    });
    self.addEventListener('click', function () { self.hidden = true; finish({ selfConfirmed: true }); out.textContent = 'Отмечено как выполненное.'; });
    if (done) out.textContent = 'Практикум выполнен.';
    return {
      el: E('section', { class: 'task task-practicum' }, [E('h3', { class: 'task-title', text: 'Практикум в вашей базе' }),
        E('div', { class: 'task-prompt', text: 'Выполните шаги урока в своей базе, затем нажмите проверку.' }),
        E('label', { class: 'lbl', text: 'Рабочая база' }), inp, E('div', { class: 'row' }, [btn, self]), out]),
      done: function () { return done; }, missing: 'выполните практикум и нажмите «Проверить мою базу»'
    };
  };
})();
