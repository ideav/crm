/* LMS: тест (проверка на месте по sha256) и практикум (автопроверка базы). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, T = A.tasks;

  // Разбор результата: считает верные, находит по хэшу верный вариант и текст ответа ученика.
  // sha — функция строка → Promise<hex>; без DOM, проверяется в experiments/courses-quiz-result-170.test.js.
  T.quizReview = function (lessonId, qs, picks, pass, sha) {
    function txt(q, k) { var o = (q.options || []).filter(function (x) { return x.k === k; })[0]; return o ? o.text : ''; }
    return Promise.all(qs.map(function (q, qi) {
      return Promise.all((q.options || []).map(function (o) { return sha(lessonId + ':' + qi + ':' + o.k).then(function (h) { return h === q.hash ? o.k : null; }); }))
        .then(function (r) { return r.filter(function (k) { return k != null; })[0]; });
    })).then(function (keys) {
      var ok = qs.map(function (q, qi) { return keys[qi] != null && picks[qi] === keys[qi]; });
      var n = ok.filter(Boolean).length, total = qs.length, score = total ? n / total : 1, errors = [];
      qs.forEach(function (q, qi) {
        if (ok[qi]) return;
        errors.push({ index: qi, q: q.q, picked: txt(q, picks[qi]), correct: keys[qi] != null ? txt(q, keys[qi]) : '', explain: q.explain || '' });
      });
      return { ok: ok, n: n, total: total, score: score, percent: Math.round(score * 100), passed: score >= pass, errors: errors };
    });
  };

  T.quiz = function (t, i, ctx) {
    var lessonId = ctx.lesson.id, qs = t.questions || [], pass = t.pass == null ? 0.7 : t.pass;
    var st = ctx.get(i), picks = (st.picks || []).slice();
    var result = E('div', { class: 'quiz-result', 'aria-live': 'polite' });
    var review = E('div', { class: 'quiz-review', hidden: true });
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
    var retry = E('button', { class: 'btn', type: 'button', text: 'Пройти заново', hidden: true });
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
    function showReview(rv) {
      review.innerHTML = ''; review.hidden = !rv.errors.length;
      if (!rv.errors.length) return;
      review.appendChild(E('h4', { text: 'Разбор ошибок' }));
      rv.errors.forEach(function (e) {
        review.appendChild(E('div', { class: 'quiz-err' }, [
          E('div', { class: 'qe-q', html: (e.index + 1) + '. ' + e.q }),
          E('div', { class: 'qe-bad', html: 'Ваш ответ: ' + (e.picked || '—') }),
          E('div', { class: 'qe-good', html: 'Верный ответ: ' + (e.correct || '—') }),
          e.explain ? E('div', { class: 'qe-expl', html: e.explain }) : null
        ].filter(Boolean)));
      });
    }
    function check() {
      if (picks.filter(Boolean).length < qs.length) { result.textContent = 'Ответьте на все вопросы'; result.className = 'quiz-result warn'; return; }
      btn.disabled = true;
      T.quizReview(lessonId, qs, picks, pass, A.sha256)
        .then(function (rv) {
          var n = rv.n, score = rv.score, passed = rv.passed;
          mark({ ok: rv.ok });
          result.className = 'quiz-result ' + (passed ? 'good' : 'warn');
          result.textContent = n + ' из ' + qs.length + ' (' + rv.percent + '%) — ' + (passed ? 'сдано' : 'не сдано, нужно не меньше ' + Math.round(pass * 100) + '%');
          showReview(rv);
          retry.hidden = false; btn.hidden = true;
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
      result.textContent = ''; result.className = 'quiz-result'; review.hidden = true; review.innerHTML = ''; retry.hidden = true; btn.hidden = false; btn.disabled = false;
    });
    var node = E('section', { class: 'task task-quiz' }, [E('h3', { class: 'task-title', text: 'Проверьте себя' })]
      .concat(qEls.map(function (q) { return q.wrap; }), [E('div', { class: 'row' }, [btn, retry]), result, review]));
    if (done) { result.className = 'quiz-result good'; result.textContent = 'Сдано' + (st.score != null ? ' — ' + st.score + '%' : '') + '. Можно пройти заново.'; retry.hidden = false; btn.hidden = true; }
    return { el: node, done: function () { return done; }, missing: 'пройдите тест (минимум ' + Math.round(pass * 100) + '% верных)' };
  };
})();
