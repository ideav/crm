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
    return d;
  }
  function save(d) { A.store.set(KEY, JSON.stringify(d)); }

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
        row[k] = (k === 'Пользователь' && /^\d+$/.test(fields[k])) ? fields[k] + ':user' + fields[k] : fields[k];
      });
      (d.t[name] = d.t[name] || []).push(row);
      save(d);
      return Promise.resolve(id);
    },
    update: function (name, id, fields) {
      var d = load();
      (d.t[name] || []).forEach(function (r) { if (r._id === String(id)) Object.assign(r, fields); });
      save(d);
      return Promise.resolve({});
    },
    upload: function (name, main, fields, fileField, file) {
      return this.create(name, main, Object.assign({}, fields, { 'Файл': '<a href="#">' + file.name + '</a>' }));
    },
    remove: function (name, id) {
      var d = load(); d.t[name] = (d.t[name] || []).filter(function (r) { return r._id !== String(id); }); save(d);
      return Promise.resolve({});
    },
    report: function () { return Promise.resolve([]); }
  };
  A.mockReset = function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
})();
