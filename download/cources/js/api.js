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
  // Порядок реквизитов в r[] = порядок ключей tbl.req (или tbl.order, если он есть). Поля, закрытые
  // роли грантом BARRED (tbl.hide[роль] в schema.json), ядро в JSON_OBJ не отдаёт — их пропускаем.
  function order(t) {
    var all = t.order || Object.keys(t.req), hide = (t.hide && t.hide[L.role]) || [];
    return hide.length ? all.filter(function (n) { return hide.indexOf(n) < 0; }) : all;
  }

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
  // значение FILE приходит как <a href="/download/..">имя</a> → {url, name}
  A.fileInfo = function (v) {
    var m = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(String(v || ''));
    if (m) return { url: m[1].replace(/&amp;/g, '&'), name: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') };
    return v ? { url: '', name: String(v) } : null;
  };
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
  // main (необязательно) — новое главное значение строки (t<id таблицы> в _m_set).
  A.update = function (name, id, fields, main) {
    if (A.mock) return A.mockApi.update(name, id, fields, main);
    var t = tbl(name), p = toParams(t, fields);
    if (main != null) p['t' + t.id] = main;
    return post('_m_set/' + id + '?JSON', p);
  };
  A.remove = function (name, id) {
    if (A.mock) return A.mockApi.remove(name, id);
    tbl(name);
    return post('_m_del/' + id + '?JSON', {});
  };
  A.hasField = function (name, field) { var t = schema && schema.tables && schema.tables[name]; return !!(t && t.req && t.req[field]); };
  function sendForm(url, fd, onProgress, needId) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url);
      x.withCredentials = true;
      x.upload.onprogress = function (e) { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onerror = function () { reject(new Error('нет связи с сервером')); };
      x.onload = function () {
        var d = null; try { d = JSON.parse(x.responseText); } catch (e) { /* не JSON */ }
        var err = d && (Array.isArray(d) ? d[0] && d[0].error : d.error);
        if (x.status >= 400 || err || !d || (needId && !(d.id || d.obj))) return reject(new Error(err || (d ? 'ошибка загрузки' : String(x.responseText || '').replace(/<[^>]+>/g, '').slice(0, 120)) || ('HTTP ' + x.status)));
        resolve(String(d.obj || d.id || ''));
      };
      x.send(fd);
    });
  }
  // Загрузка файла: multipart в _m_new (поле t<id реквизита FILE>), XHR ради индикатора прогресса.
  // fields — реквизиты таблицы по именам (кроме FILE); file — File; onProgress(0..1).
  A.upload = function (name, main, fields, fileField, file, onProgress) {
    if (A.mock) return A.mockApi.upload(name, main, fields, fileField, file);
    var t = tbl(name), p = toParams(t, fields);
    if (!t.req[fileField]) return Promise.reject(new Error('Нет реквизита «' + fileField + '»'));
    p['t' + t.id] = main; p._xsrf = L.xsrf || '';
    var fd = new FormData();
    Object.keys(p).forEach(function (k) { fd.append(k, p[k]); });
    fd.append('t' + t.req[fileField], file, file.name);
    return sendForm('/' + A.z + '/_m_new/' + t.id + '?JSON&up=1', fd, onProgress, true);
  };
  // Загрузка файла в существующую строку (_m_set, multipart): ядро пишет в тот же реквизит FILE,
  // поэтому адрес файла (хэш от id реквизита) остаётся прежним.
  A.uploadTo = function (name, id, fileField, file, onProgress) {
    if (A.mock) return A.mockApi.uploadTo(name, id, fileField, file);
    var t = tbl(name);
    if (!t.req[fileField]) return Promise.reject(new Error('Нет реквизита «' + fileField + '»'));
    var fd = new FormData();
    fd.append('_xsrf', L.xsrf || '');
    fd.append('t' + t.req[fileField], file, file.name);
    return sendForm('/' + A.z + '/_m_set/' + id + '?JSON', fd, onProgress, false).then(function () { return String(id); });
  };
  // Удаление строки с файлом: сначала очищаем реквизит FILE (так сервер стирает сам файл), потом строку.
  A.removeFile = function (name, id, fileField) {
    if (A.mock) return A.mockApi.remove(name, id);
    var f = {}; f[fileField] = '';
    return post('_m_set/' + id + '?JSON', toParams(tbl(name), f)).then(function () { return post('_m_del/' + id + '?JSON', {}); });
  };
  A.reportRows = function (name) {
    if (A.mock) return A.mockApi.report(name);
    var id = schema.reports && schema.reports[name];
    if (!id) return Promise.reject(new Error('Нет отчёта «' + name + '»'));
    return fetch('/' + A.z + '/report/' + (id.id || id) + '?JSON_KV', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  };
})();
