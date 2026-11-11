/* LMS: состояние ученика — каталог, прогресс, доступ, профиль. */
(function () {
  'use strict';
  var A = window.LMSApp, L = window.LMS || {};
  var D = A.data = { courses: [], catalog: [], progress: {}, access: [], profile: null, requests: [], comments: [], files: [] };
  var AU = A.au, manifests = {};
  var uid = String(L.userId || '');
  var queues = {};

  D.uid = uid;
  D.init = function () {
    if (A.isGuest()) { // гость: только публичный каталог (courses.json + таблица «Каталог»)
      return Promise.all([A.getJSON(A.contentRoot + 'courses.json'), loadCatalog()]).then(function (r) { D.courses = r[0].courses || []; D.catalog = r[1]; });
    }
    return A.loadSchema().then(function () {
      return Promise.all([
        loadCatalog(),
        A.getJSON(A.contentRoot + 'courses.json'),
        A.list('Прогресс', { 'Пользователь': uid }),
        A.list('Доступ', { 'Пользователь': uid }),
        A.list('Профиль', { 'Пользователь': uid }),
        A.list('Заявка', { 'Пользователь': uid }).catch(function () { return []; }),
        A.list('Комментарий', { 'Пользователь': uid }).catch(function () { return []; }),
        A.list('Файл ответа', { 'Пользователь': uid }).catch(function () { return []; })
      ]);
    }).then(function (r) {
      D.catalog = r.shift();
      D.courses = r[0].courses || [];
      D.progress = {};
      r[1].forEach(function (row) { D.progress[row.Курс + '/' + row.Урок] = row; });
      D.access = r[2];
      D.profile = r[3][0] || null;
      D.requests = r[4];
      D.comments = r[5];
      D.files = r[6].filter(function (x) { return x['Файл']; });
      return orphans();
    });
  };
  // строки «Каталога» (#93); нет таблицы или прав — каталог из одних встроенных курсов
  function loadCatalog() {
    return A.loadSchema().then(function () { return A.list('Каталог', {}); })
      .then(function (rows) { return rows.map(AU.fromCatalog).filter(function (c) { return AU.isAuthored(c.code); }); }, function () { return []; });
  }
  // Курс снят с каталога, а у ученика есть платный доступ: собираем курс из его манифеста.
  function orphans() {
    var miss = D.access.filter(function (a) { return AU.isAuthored(a['Курс']) && a['Ключ'] && !D.course(a['Курс']); });
    return Promise.all(miss.map(function (a) {
      return D.manifest(a['Ключ']).then(function (m) {
        D.catalog.push({ code: a['Курс'], title: m.title || a['Курс'], author: m.author || '', free: false, price: 0, tags: [], desc: '', authored: true, visibility: 'ссылка',
          lessons: (m.lessons || []).map(function (l) { return { id: l.id, n: l.n, title: l.title, task: l.task }; }) });
      }, function () { /* манифест недоступен — курса нет */ });
    }));
  }

  D.course = function (code) {
    return D.courses.filter(function (c) { return c.code === code; })[0] || D.catalog.filter(function (c) { return c.code === code; })[0];
  };
  // все курсы для каталога: встроенные + видимые строки «Каталога»
  D.catalogList = function () {
    return D.courses.map(function (c) {
      return Object.assign({ author: 'Интеграм', desc: (A.courseDesc || {})[c.code] || '', tags: (A.courseTags || {})[c.code] || [] }, c);
    }).concat(D.catalog.filter(function (c) { return c.visibility === 'каталог'; }));
  };
  // курсы ученика для карты: встроенные + авторские, к которым есть доступ или прогресс
  D.myCourses = function () {
    return D.courses.concat(D.catalog.filter(function (c) {
      return D.accessKey(c.code) || Object.keys(D.progress).some(function (k) { return k.indexOf(c.code + '/') === 0; });
    }));
  };
  D.manifest = function (url) {
    var u = AU.safeUrl(url, 'json');
    if (!u) return Promise.reject(new Error('нет адреса манифеста'));
    if (!manifests[u]) manifests[u] = A.getJSON(u).catch(function (e) { delete manifests[u]; throw e; });
    return manifests[u];
  };
  D.accessKey = function (code) {
    var a = D.access.filter(function (x) { return x['Курс'] === code && x['Ключ']; })[0];
    return a ? a['Ключ'] : null;
  };
  // путь к json уроков курса или null, если доступа нет
  D.contentPath = function (course) {
    if (course.authored) return (course.free && course.manifest) || D.accessKey(course.code) || null; // URL манифеста
    if (course.free) return A.contentRoot + (course.path || course.code) + '/';
    var k = D.accessKey(course.code);
    return k ? A.contentRoot + course.code + '-' + k + '/' : null;
  };
  D.hasAccess = function (course) { return !!D.contentPath(course); };
  D.loadLesson = function (course, id) {
    var p = D.contentPath(course);
    if (!p) return Promise.reject(new Error('locked'));
    if (course.authored) {
      return D.manifest(p).then(function (m) {
        var l = (m.lessons || []).filter(function (x) { return x.id === id; })[0], u = l && AU.safeUrl(l.url, 'json');
        if (!u) throw new Error('урока нет в манифесте');
        return A.getJSON(u);
      }).then(AU.cleanLesson);
    }
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

  // файлы ученика к заданию i урока
  D.filesFor = function (course, lesson, i) {
    return D.files.filter(function (f) { return f['Курс'] === course && f['Урок'] === lesson && String(f['Задание']) === String(i); });
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

  // «Я оплатил»: заявка без промокода, админ сверяет оплату и выдаёт доступ
  D.requestPaid = function (course) { return D.requestPromo(course, ''); };
  // бесплатный авторский курс: строка «Доступ» с основанием «бесплатно» (если роль не может её создать — курс открыт и так)
  D.joinFree = function (course) {
    if (A.isGuest() || !course.authored || !course.free || D.accessKey(course.code)) return Promise.resolve();
    var f = { 'Пользователь': uid, 'Курс': course.code, 'Ключ': course.manifest, 'Основание': 'бесплатно', 'Дата и время': A.nowStr() };
    return A.create('Доступ', uid + ':' + course.code, f).then(function (id) { D.access.push(Object.assign({ _id: id }, f)); }, function () { /* нет прав — не мешаем учиться */ });
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
