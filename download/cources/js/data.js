/* LMS: состояние ученика — каталог, прогресс, доступ, профиль. */
(function () {
  'use strict';
  var A = window.LMSApp, L = window.LMS || {};
  var D = A.data = { courses: [], progress: {}, access: [], profile: null, requests: [], comments: [] };
  var uid = String(L.userId || '');
  var queues = {};

  D.uid = uid;
  D.init = function () {
    return A.loadSchema().then(function () {
      return Promise.all([
        A.getJSON(A.contentRoot + 'courses.json'),
        A.list('Прогресс', { 'Пользователь': uid }),
        A.list('Доступ', { 'Пользователь': uid }),
        A.list('Профиль', { 'Пользователь': uid }),
        A.list('Заявка', { 'Пользователь': uid }).catch(function () { return []; }),
        A.list('Комментарий', { 'Пользователь': uid }).catch(function () { return []; })
      ]);
    }).then(function (r) {
      D.courses = r[0].courses || [];
      D.progress = {};
      r[1].forEach(function (row) { D.progress[row.Курс + '/' + row.Урок] = row; });
      D.access = r[2];
      D.profile = r[3][0] || null;
      D.requests = r[4];
      D.comments = r[5];
    });
  };

  D.course = function (code) { return D.courses.filter(function (c) { return c.code === code; })[0]; };
  D.accessKey = function (code) {
    var a = D.access.filter(function (x) { return x['Курс'] === code && x['Ключ']; })[0];
    return a ? a['Ключ'] : null;
  };
  // путь к json уроков курса или null, если доступа нет
  D.contentPath = function (course) {
    if (course.free) return A.contentRoot + (course.path || course.code) + '/';
    var k = D.accessKey(course.code);
    return k ? A.contentRoot + course.code + '-' + k + '/' : null;
  };
  D.hasAccess = function (course) { return !!D.contentPath(course); };
  D.loadLesson = function (course, id) {
    var p = D.contentPath(course);
    if (!p) return Promise.reject(new Error('locked'));
    return A.getJSON(p + id + '.json');
  };

  D.state = function (course, lesson) {
    var row = D.progress[course + '/' + lesson], ans = {};
    if (row && row['Ответ']) { try { ans = JSON.parse(row['Ответ']) || {}; } catch (e) { ans = {}; } }
    return { row: row || null, ans: ans, done: !!row && row['Статус'] === 'done' };
  };
  D.isDone = function (course, lesson) { return D.state(course, lesson).done; };

  // patch: {ans, done, score, attempts, check}; запись сериализована по уроку (без дублей строк)
  D.save = function (course, lesson, patch) {
    var key = course + '/' + lesson;
    var run = function () {
      var row = D.progress[key];
      var f = {};
      if (patch.ans !== undefined) f['Ответ'] = JSON.stringify(patch.ans);
      if (patch.done !== undefined) f['Статус'] = patch.done ? 'done' : 'open';
      if (patch.score !== undefined) f['Балл'] = String(patch.score);
      if (patch.attempts !== undefined) f['Попыток'] = String(patch.attempts);
      if (patch.check !== undefined) f['Проверка'] = JSON.stringify(patch.check);
      f['Дата и время'] = A.nowStr();
      if (row) {
        return A.update('Прогресс', row._id, f).then(function () { Object.assign(row, f); return row; });
      }
      if (f['Статус'] === undefined) f['Статус'] = 'open';
      f['Пользователь'] = uid; f['Курс'] = course; f['Урок'] = lesson;
      return A.create('Прогресс', uid + ':' + course + ':' + lesson, f).then(function (id) {
        var nr = Object.assign({ _id: id }, f);
        D.progress[key] = nr;
        return nr;
      });
    };
    var p = (queues[key] || Promise.resolve()).then(run, run);
    queues[key] = p.catch(function () { /* ошибку получает вызывающий */ });
    return p;
  };

  D.saveProfile = function (patch) {
    var f = Object.assign({}, patch);
    if (D.profile) return A.update('Профиль', D.profile._id, f).then(function () { Object.assign(D.profile, f); });
    f['Пользователь'] = uid;
    return A.create('Профиль', uid, f).then(function (id) { D.profile = Object.assign({ _id: id }, f); });
  };

  D.requestPromo = function (course, code) {
    var f = { 'Пользователь': uid, 'Курс': course, 'Код промокода': code, 'Статус': 'new', 'Дата и время': A.nowStr() };
    return A.create('Заявка', uid + ':' + course + ':' + Date.now(), f).then(function (id) {
      D.requests.push(Object.assign({ _id: id }, f));
    });
  };

  // первый невыполненный урок курса (или null)
  D.firstOpen = function (course) {
    var ls = course.lessons || [];
    for (var i = 0; i < ls.length; i++) if (!D.isDone(course.code, ls[i].id)) return ls[i];
    return null;
  };
  D.courseDone = function (course) { return !D.firstOpen(course); };
  D.hasAnyProgress = function () { return Object.keys(D.progress).length > 0; };
  D.lastCourse = function () {
    var best = null;
    Object.keys(D.progress).forEach(function (k) {
      var r = D.progress[k]; if (!best || Number(r._id) > Number(best._id)) best = r;
    });
    return best ? D.course(best['Курс']) : null;
  };
})();
