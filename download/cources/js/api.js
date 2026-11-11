/* LMS: доступ к данным базы cources по id из schema.json (или к localStorage-моку при ?mock=1). */
(function () {
  'use strict';
  var A = window.LMSApp, L = window.LMS || {};
  var schema = null;

  A.loadSchema = function () {
    if (schema) return Promise.resolve(schema);
    return A.getJSON(A.root + 'schema.json').then(function (s) { schema = s; return s; });
  };
  function tbl(name) {
    var t = schema && schema.tables && schema.tables[name];
    if (!t) throw new Error('В schema.json нет таблицы «' + name + '»');
    return t;
  }
  // Порядок реквизитов в r[] = порядок ключей tbl.req (или tbl.order, если он есть).
  function order(t) { return t.order || Object.keys(t.req); }

  function parseRow(t, rec) {
    var row = { _id: String(rec.i), _main: rec.r && rec.r[0] };
    order(t).forEach(function (name, i) {
      var v = rec.r ? rec.r[i + 1] : '';
      v = v == null ? '' : v;
      if (/^[0-9]{9,11}$/.test(v) && /^(Дата|Доступно)/.test(name)) v = A.fmtUnix(v);
      row[name] = v;
    });
    return row;
  }
  // значение ссылки приходит как «id:текст»
  A.refId = function (v) { var m = /^(\d+):/.exec(String(v || '')); return m ? m[1] : String(v || ''); };
  A.refText = function (v) { return String(v || '').replace(/^\d+:/, ''); };

  function post(path, params) {
    var f = new URLSearchParams();
    f.append('_xsrf', L.xsrf || '');
    Object.keys(params).forEach(function (k) { if (params[k] != null) f.append(k, params[k]); });
    return fetch('/' + A.z + '/' + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: f.toString()
    }).then(function (r) {
      return r.text().then(function (txt) {
        var d = null; try { d = JSON.parse(txt); } catch (e) { /* не JSON */ }
        var err = d && (Array.isArray(d) ? d[0] && d[0].error : d.error);
        if (!r.ok || err) throw new Error(err || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  // list('Прогресс', {Пользователь: 5}) -> [{_id,_main,Курс,...}]
  A.list = function (name, filter) {
    if (A.mock) return A.mockApi.list(name, filter);
    var t = tbl(name), q = ['JSON_OBJ', 'LIMIT=0,5000'];
    // ссылки сервер фильтрует по тексту, не по id; чужие строки и так режет маска роли — отбор на клиенте
    var client = filter || {};
    return fetch('/' + A.z + '/object/' + t.id + '/?' + q.join('&'), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (arr) {
        return (Array.isArray(arr) ? arr : []).map(function (rec) { return parseRow(t, rec); }).filter(function (row) {
          return Object.keys(client).every(function (k) { return A.refId(row[k]) === String(client[k]) || row[k] === String(client[k]); });
        });
      });
  };

  function toParams(t, fields) {
    var p = {};
    Object.keys(fields || {}).forEach(function (k) {
      if (!t.req[k]) throw new Error('Нет реквизита «' + k + '»');
      p['t' + t.req[k]] = fields[k];
    });
    return p;
  }
  A.create = function (name, main, fields) {
    if (A.mock) return A.mockApi.create(name, main, fields);
    var t = tbl(name), p = toParams(t, fields);
    p['t' + t.id] = main;
    return post('_m_new/' + t.id + '?JSON&up=1', p).then(function (d) {
      return String((d && (d.id || d.obj)) || '');
    });
  };
  A.update = function (name, id, fields) {
    if (A.mock) return A.mockApi.update(name, id, fields);
    return post('_m_set/' + id + '?JSON', toParams(tbl(name), fields));
  };
  A.reportRows = function (name) {
    if (A.mock) return A.mockApi.report(name);
    var id = schema.reports && schema.reports[name];
    if (!id) return Promise.reject(new Error('Нет отчёта «' + name + '»'));
    return fetch('/' + A.z + '/report/' + (id.id || id) + '?JSON_KV', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  };
})();
