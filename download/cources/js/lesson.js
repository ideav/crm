/* LMS: экран урока — единый шаблон: шапка, html, задания, одна кнопка «Дальше». */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data;
  var timer = null;
  A.views = A.views || {};

  function cancelAuto() { clearTimeout(timer); timer = null; var b = document.querySelector('.lms-auto'); if (b) b.remove(); }
  A.cleanup = cancelAuto;

  A.views.lesson = function (root, code, id) {
    var course = D.course(code);
    if (!course) { root.appendChild(E('p', { class: 'lms-empty', text: 'Курс не найден.' })); return; }
    if (!D.hasAccess(course)) {
      root.appendChild(E('div', { class: 'card' }, [E('h1', { text: course.title }),
        E('p', { text: 'Этот курс пока закрыт. Откройте карту курсов, чтобы ввести промокод.' }),
        E('a', { class: 'btn btn-primary', href: '#/map', text: 'К карте курсов' })]));
      return;
    }
    root.appendChild(E('p', { class: 'lms-empty', text: 'Загружаем урок…' }));
    D.loadLesson(course, id).then(function (lesson) { root.innerHTML = ''; build(root, course, lesson); },
      function () { root.innerHTML = ''; root.appendChild(E('div', { class: 'card' }, [E('p', { text: 'Не удалось загрузить урок.' }), E('a', { class: 'btn', href: '#/map', text: 'К карте' })])); });
  };

  function build(root, course, lesson) {
    var st = D.state(course.code, lesson.id), ans = st.ans;
    ans.tasks = ans.tasks || {};
    var wasDone = st.done, finished = st.done, ready = false;
    var lessons = course.lessons || [], total = lessons.length;
    var pos = Math.max(0, lessons.map(function (l) { return l.id; }).indexOf(lesson.id));
    var ctx = {
      course: course.code, lesson: lesson,
      get: function (i) { return ans.tasks[i] || {}; },
      update: function (i, obj) { ans.tasks[i] = Object.assign(ans.tasks[i] || {}, obj); return D.save(course.code, lesson.id, { ans: ans }); },
      changed: function () { refresh(); }
    };
    var bar = E('header', { class: 'lesson-bar' }, [
      E('div', { class: 'lesson-bar-row' }, [E('span', { class: 'lb-course', text: course.title }),
        E('span', { class: 'lb-pos', text: (pos + 1) + ' / ' + total }),
        E('a', { class: 'lb-map', href: '#/map', text: 'Карта' })]),
      E('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': pos + 1 }, [E('i', { style: 'width:' + Math.round((pos + 1) / total * 100) + '%' })])]);
    var title = E('h1', { class: 'lesson-title', text: lesson.title });
    var body = E('div', { class: 'lesson-html', html: lesson.html || '' });
    var att = (lesson.attachments || []).length ? E('div', { class: 'attach' }, lesson.attachments.map(function (a) {
      return E('a', { class: 'btn', href: a.url, download: '', text: 'Скачать: ' + a.title }); })) : null;
    var parts = (lesson.tasks || []).map(function (t, i) {
      var r = A.tasks[t.kind === 'file' ? 'file' : t.kind];
      return r ? r(t, i, ctx) : { el: E('p', { class: 'muted', text: 'Неизвестное задание: ' + t.kind }), done: function () { return true; }, missing: '' };
    });
    var comments = D.comments.filter(function (c) { return c['Курс'] === course.code && c['Урок'] === lesson.id; });
    var cbox = comments.length ? E('section', { class: 'task task-comments' }, [E('h3', { class: 'task-title', text: 'Комментарий куратора' })]
      .concat(comments.map(function (c) { return E('div', { class: 'comment' }, [E('div', { class: 'muted small', text: (c['Автор'] || 'Куратор') + ' · ' + (c['Дата и время'] || '') }), E('p', { text: c['Текст'] || c._main || '' })]); }))) : null;
    var miss = E('span', { class: 'next-miss' });
    var next = E('button', { class: 'btn btn-primary btn-next', type: 'button' });
    var isLast = !lesson.next;
    next.textContent = isLast ? 'Завершить курс' : 'Дальше →';
    var foot = E('footer', { class: 'lesson-foot' }, [next, miss]);

    function missing() { return parts.filter(function (p) { return !p.done(); }).map(function (p) { return p.missing; }); }
    function refresh() {
      var m = missing();
      next.disabled = m.length > 0;
      miss.textContent = m.length ? 'Чтобы продолжить: ' + m.join('; ') + '.' : '';
      if (!m.length && parts.length && !finished) {
        finished = true;
        D.save(course.code, lesson.id, { ans: ans, done: true }).then(function () { afterDone(ready); });
      }
    }
    function afterDone(auto) {
      if (A.share) {
        if (D.courseDone(course)) A.share.show('course:' + course.code);
        else if (course.code === 'mini' && pos === 0) A.share.show('lesson1');
      }
      if (auto && !wasDone) startAuto();
    }
    function go() { cancelAuto(); location.hash = lesson.next ? '#/c/' + course.code + '/' + lesson.next : '#/map'; }
    function startAuto() {
      cancelAuto();
      var stay = E('button', { class: 'btn', type: 'button', text: 'Остаться', onclick: cancelAuto });
      (document.getElementById('lms-shell') || document.body).appendChild(E('div', { class: 'lms-auto', role: 'status' }, [E('span', { text: lesson.next ? 'Урок выполнен. Переходим к следующему…' : 'Курс пройден! Открываем карту…' }), stay]));
      timer = setTimeout(go, 1500);
    }
    next.addEventListener('click', function () {
      if (finished || parts.length) return go();
      next.disabled = true;
      D.save(course.code, lesson.id, { ans: ans, done: true }).then(function () { finished = true; afterDone(false); go(); },
        function () { next.disabled = false; A.toast('Не удалось сохранить, попробуйте ещё раз'); });
    });
    [bar, E('article', { class: 'lesson' }, [title, body, att].concat(parts.map(function (p) { return p.el; }), [cbox, foot]))].forEach(function (n) { if (n) root.appendChild(n); });
    A.fixLinks(root);
    refresh();
    ready = true;
    setTimeout(function () { title.scrollIntoView({ block: 'start' }); }, 0);
  }
})();
