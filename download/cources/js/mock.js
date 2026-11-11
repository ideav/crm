/* LMS: мок-бэкенд на localStorage для ?mock=1 (локальная проверка без сервера). */
(function () {
  'use strict';
  var A = window.LMSApp, KEY = 'lms_mock_db';
  if (!A.mock) return;

  function load() {
    var d = null;
    try { d = JSON.parse(A.store.get(KEY)); } catch (e) { d = null; }
    if (!d) {
      d = { seq: 100, t: {} };
      d.t['Доступ'] = [{ _id: '1', _main: 'k1', 'Пользователь': '1:student', 'Курс': 'adept', 'Ключ': 'devkey', 'Основание': 'админ' }];
    }
    if (!d.seed93) { d.seed93 = 1; d.t['Каталог'] = (d.t['Каталог'] || []).concat(SEED_CATALOG()); }
    return d;
  }
  function save(d) { A.store.set(KEY, JSON.stringify(d)); }
  // #93: опубликованные авторские курсы для проверки каталога (файлы — dev/content/authored/).
  function SEED_CATALOG() {
    var dir = '/download/cources/dev/content/authored/';
    return [
      { _id: '2', _main: 'a900', 'Название': 'Учёт заказов пекарни', 'Описание': 'Как вести заказы, ёмкости и сроки в одной базе вместо пяти таблиц.', 'Автор': 'Мария Петрова',
        'Теги': 'пекарня, учёт, малый бизнес', 'Цена': '0', 'Обложка': '', 'Уроки': JSON.stringify([{ id: 'l1', n: 1, title: 'Заказы и клиенты', task: 'quiz' }, { id: 'l2', n: 2, title: 'Сроки и ёмкости', task: 'selfcheck' }]),
        'Видимость': 'каталог', 'Ссылка оплаты': '', 'Манифест': dir + 'a900-manifest.json', 'Дата и время': '01.11.2026 10:00:00' },
      { _id: '3', _main: 'a901', 'Название': 'CRM для автосервиса', 'Описание': 'Записи на ремонт, запчасти и напоминания клиентам.', 'Автор': 'Иван Сидоров',
        'Теги': 'автосервис, CRM', 'Цена': '4900', 'Обложка': '', 'Уроки': JSON.stringify([{ id: 'l1', n: 1, title: 'Запись на ремонт', task: 'text' }]),
        'Видимость': 'каталог', 'Ссылка оплаты': 'https://example.com/pay/a901', 'Манифест': '', 'Дата и время': '02.11.2026 10:00:00' },
      { _id: '4', _main: 'a902', 'Название': 'Скрытый курс для своих', 'Описание': 'Доступен только по прямой ссылке.', 'Автор': 'Мария Петрова',
        'Теги': 'закрытый', 'Цена': '0', 'Обложка': '', 'Уроки': JSON.stringify([{ id: 'l1', n: 1, title: 'Заказы и клиенты', task: 'quiz' }]),
        'Видимость': 'ссылка', 'Ссылка оплаты': '', 'Манифест': dir + 'a900-manifest.json', 'Дата и время': '03.11.2026 10:00:00' }
    ];
  }
  // Файл мока хранится как data:-адрес внутри строки (fetch и <img> работают так же, как с адресом сервера).
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).replace(/^data:;/, 'data:application/octet-stream;')); };
      r.onerror = function () { reject(new Error('не удалось прочитать файл')); };
      r.readAsDataURL(file);
    });
  }
  function fileVal(url, name) { return '<a target="_blank" href="' + url + '">' + A.esc(name) + '</a>'; }
  var REF = { 'Пользователь': 1, 'Владелец': 1 };

  A.mockApi = {
    list: function (name, filter) {
      var rows = (load().t[name] || []).filter(function (r) {
        return Object.keys(filter || {}).every(function (k) {
          var v = r[k];
          return A.refId(v) === String(filter[k]) || String(v) === String(filter[k]);
        });
      });
      return Promise.resolve(JSON.parse(JSON.stringify(rows)));
    },
    create: function (name, main, fields) {
      var d = load(), id = String(++d.seq);
      var row = { _id: id, _main: main };
      Object.keys(fields || {}).forEach(function (k) {
        row[k] = (REF[k] && /^\d+$/.test(fields[k])) ? fields[k] + ':user' + fields[k] : fields[k];
      });
      (d.t[name] = d.t[name] || []).push(row);
      save(d);
      return Promise.resolve(id);
    },
    update: function (name, id, fields, main) {
      var d = load();
      (d.t[name] || []).forEach(function (r) { if (r._id === String(id)) { Object.assign(r, fields); if (main != null) r._main = main; } });
      save(d);
      return Promise.resolve({});
    },
    upload: function (name, main, fields, fileField, file) {
      var self = this;
      return readFile(file).then(function (url) { var f = Object.assign({}, fields); f[fileField] = fileVal(url, file.name); return self.create(name, main, f); });
    },
    uploadTo: function (name, id, fileField, file) {
      var self = this;
      return readFile(file).then(function (url) { var f = {}; f[fileField] = fileVal(url, file.name); return self.update(name, id, f); }).then(function () { return String(id); });
    },
    remove: function (name, id) {
      var d = load(); d.t[name] = (d.t[name] || []).filter(function (r) { return r._id !== String(id); }); save(d);
      return Promise.resolve({});
    },
    report: function () { return Promise.resolve([]); }
  };
  A.mockReset = function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
})();
