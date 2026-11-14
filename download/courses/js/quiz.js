/* LMS: тест (проверка на месте по sha256) и практикум (автопроверка базы). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, T = A.tasks;

  T.quiz = function (t, i, ctx) {
    var lessonId = ctx.lesson.id, qs = t.questions || [], pass = t.pass == null ? 0.7 : t.pass;
    var st = ctx.get(i), picks = (st.picks || []).slice();
    var result = E('div', { class: 'quiz-result', 'aria-live': 'polite' });
    var qEls = qs.map(function (q, qi) {
      var name = 'q' + i + '_' + qi;
      var shuffled = (q.options || []).slice().sort(function () { return Math.random() - 0.5; });
      var opts = shuffled.map(function (o) {
        var r = E('input', { type: 'radio', name: name, value: o.k });
        r.checked = picks[qi] === o.k;
        r.addEventListener('change', function () { picks[qi] = o.k; });
        return E('label', { class: 'opt' }, [r, E('span', { html: o.text })]);
      });
      var expl = E('div', { class: 'explain', hidden: true });
      return { wrap: E('div', { class: 'question' }, [E('div', { class: 'q-text', html: (qi + 1) + '. ' + q.q }), E('div', { class: 'opts' }, opts), expl]), opts: opts, expl: expl };
    });
    var btn = E('button', { class: 'btn btn-primary', type: 'button', text: 'Проверить' });
    var retry = E('button', { class: 'btn', type: 'button', text: 'Пройти ещё раз', hidden: true });
    var done = !!st.done;

    function mark(res) {
      qEls.forEach(function (qe, qi) {
        qe.wrap.classList.toggle('ok', res.ok[qi]); qe.wrap.classList.toggle('bad', !res.ok[qi]);
        qe.opts.forEach(function (lab) {
          var inp = lab.querySelector('input');
          lab.classList.toggle('picked', inp.checked); inp.disabled = true;
        });
        qe.expl.hidden = false;
        qe.expl.innerHTML = (res.ok[qi] ? '<b>Верно.</b> ' : '<b>Неверно.</b> ') + (qs[qi].explain || '');
      });
    }
    function check() {
      if (picks.filter(Boolean).length < qs.length) { result.textContent = 'Ответьте на все вопросы'; result.className = 'quiz-result warn'; return; }
      btn.disabled = true;
      Promise.all(qs.map(function (q, qi) { return A.sha256(lessonId + ':' + qi + ':' + picks[qi]).then(function (h) { return h === q.hash; }); }))
        .then(function (ok) {
          var n = ok.filter(Boolean).length, score = qs.length ? n / qs.length : 1, passed = score >= pass;
          mark({ ok: ok });
          result.className = 'quiz-result ' + (passed ? 'good' : 'warn');
          result.textContent = 'Верно ' + n + ' из ' + qs.length + (passed ? ' — тест пройден.' : '. Нужно не меньше ' + Math.round(pass * 100) + '%, попробуйте ещё раз.');
          retry.hidden = passed; btn.hidden = true;
          var attempts = (ctx.get(i).attempts || 0) + 1;
          var upd = { picks: picks, attempts: attempts, score: Math.round(score * 100) };
          if (passed) { upd.done = true; done = true; }
          return ctx.update(i, upd, true).then(function () { if (passed) ctx.changed(); });
        }).catch(function (e) { result.textContent = 'Ошибка проверки: ' + e.message; btn.disabled = false; });
    }
    btn.addEventListener('click', check);
    retry.addEventListener('click', function () {
      picks = [];
      qEls.forEach(function (qe) {
        qe.wrap.classList.remove('ok', 'bad'); qe.expl.hidden = true;
        qe.opts.forEach(function (lab) { var inp = lab.querySelector('input'); inp.checked = false; inp.disabled = false; lab.classList.remove('picked'); });
      });
      result.textContent = ''; result.className = 'quiz-result'; retry.hidden = true; btn.hidden = false; btn.disabled = false;
    });
    var node = E('section', { class: 'task task-quiz' }, [E('h3', { class: 'task-title', text: 'Проверьте себя' })]
      .concat(qEls.map(function (q) { return q.wrap; }), [E('div', { class: 'row' }, [btn, retry]), result]));
    if (done) { result.className = 'quiz-result good'; result.textContent = 'Тест пройден' + (st.score != null ? ' (' + st.score + '%)' : '') + '. Можно пройти ещё раз.'; btn.textContent = 'Пройти заново'; }
    return { el: node, done: function () { return done; }, missing: 'пройдите тест (минимум ' + Math.round(pass * 100) + '% верных)' };
  };
})();
