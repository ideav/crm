/* LMS: доступ к данным базы courses по id из schema.json (или к localStorage-моку при ?mock=1).
   На новом ядре (A.core, courses#145) — родной REST /api/v1/<база>/ (objects, object/<id>, queries/<id>,
   object/<id>/file/<реквизит>), схема из core/schema.json. */
(function () {
  'use strict';
  var A = window.LMSApp, L = window.LMS || {};
  var schema = null;

  A.loadSchema = function () {
    if (schema) return Promise.resolve(schema);
    return A.getJSON(A.root + (A.core && !A.mock ? 'core/schema.json' : 'schema.json')).then(function (s) { schema = s; return s; });
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

  // Значение FILE на новом ядре — «<id файла>/<имя>» (python2node#1286); файл отдаёт только
  // GET /api/v1/<база>/object/<строка>/file/<реквизит> с проверкой прав. Переводим в вид старого ядра
  // (<a href>имя</a>), чтобы A.fileInfo и все, кто его зовёт, работали одинаково.
  var CORE_FILE = /^[0-9a-f]{32}\/([\s\S]+)$/;
  function esc(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function coreFile(t, rowId, name, v) {
    var m = CORE_FILE.exec(v);
    if (!m) return v;
    return '<a href="/api/v1/' + A.z + '/object/' + rowId + '/file/' + t.req[name] + '">' + esc(m[1]) + '</a>';
  }

  function parseRow(t, rec) {
    var row = { _id: String(rec.i), _main: rec.r && rec.r[0] };
    order(t).forEach(function (name, i) {
      var v = rec.r ? rec.r[i + 1] : '';
      v = v == null ? '' : v;
      if (/^[0-9]{9,11}(.[0-9]+)?$/.test(v) && /^(Дата|Доступно)/.test(name)) v = A.fmtUnix(v);
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

  // ошибка ядра: [{error:'…'}] у записи, {error:'…'} или {error:{code,message}} у чтения
  function errOf(d) {
    var e = d && (Array.isArray(d) ? d[0] && d[0].error : d.error);
    return e && typeof e === 'object' ? (e.message || e.code || 'ошибка') : e;
  }
  function answer(r) {
    return r.text().then(function (txt) {
      var d = null; try { d = JSON.parse(txt); } catch (e) { /* не JSON */ }
      var err = errOf(d);
      if (!r.ok || err) throw new Error(err || ('HTTP ' + r.status));
      return d;
    });
  }
  // чтение: тело — JSON и при ошибке (ядро отдаёт {error:…}); не JSON — только статус
  function answerJson(r) {
    return r.json().catch(function () { return null; }).then(function (d) {
      var err = errOf(d);
      if (!r.ok || err) throw new Error(err || ('HTTP ' + r.status));
      return d;
    });
  }
  function post(path, params) {
    var f = new URLSearchParams(), x = A.xsrf();
    f.append('_xsrf', x);
    Object.keys(params).forEach(function (k) { if (params[k] != null) f.append(k, params[k]); });
    var h = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    if (A.core) h['X-XSRF-Token'] = x;
    return fetch(A.base + path, { method: 'POST', credentials: 'same-origin', headers: h, body: f.toString() }).then(answer);
  }

  // Новое ядро: запись — JSON с X-XSRF-Token; ответ записи [{id}] или [{error}] разбирает answer.
  function send(method, path, data) {
    var h = { 'X-XSRF-Token': A.xsrf() };
    if (data) h['Content-Type'] = 'application/json';
    return fetch(A.base + path, { method: method, credentials: 'same-origin', headers: h, body: data ? JSON.stringify(data) : undefined }).then(answer);
  }
  // Колонки строки compact — в порядке заголовка таблицы (header). Колонки, закрытые роли, ядро в нём
  // не отдаёт; колонки, которых нет в schema.json, отдаёт — поэтому имя берётся по reqId, не по позиции.
  var heads = {};
  function header(t) {
    if (!heads[t.id]) {
      heads[t.id] = fetch(A.base + 'objects/' + t.id + '?limit=1', { credentials: 'same-origin' }).then(answerJson).then(function (d) {
        var byId = {};
        Object.keys(t.req).forEach(function (n) { byId[t.req[n]] = n; });
        return ((d && d.header) || []).map(function (h) { return byId[h.reqId] || null; });
      });
      heads[t.id].catch(function () { delete heads[t.id]; });
    }
    return heads[t.id];
  }
  function parseCoreRow(t, rec, names) {
    var row = { _id: String(rec.i), _main: rec.r && rec.r[0] };
    names.forEach(function (name, i) {
      if (!name) return;
      var v = rec.r ? rec.r[i + 1] : '';
      v = coreFile(t, rec.i, name, v == null ? '' : v);
      if (/^[0-9]{9,11}(.[0-9]+)?$/.test(v) && /^(Дата|Доступно)/.test(name)) v = A.fmtUnix(v);
      row[name] = v;
    });
    return row;
  }
  function firstId(d) { var o = Array.isArray(d) ? d[0] : d; return String((o && (o.id || o.obj)) || ''); }

  // list('Прогресс', {Пользователь: 5}) -> [{_id,_main,Курс,...}]
  A.list = function (name, filter) {
    if (A.mock) return A.mockApi.list(name, filter);
    var t = tbl(name);
    // ссылки сервер фильтрует по тексту, не по id; чужие строки и так режет маска роли — отбор на клиенте
    var client = filter || {};
    var rows = A.core
      ? Promise.all([header(t), fetch(A.base + 'objects/' + t.id + '?format=compact&limit=5000', { credentials: 'same-origin' }).then(answerJson)])
        .then(function (r) { return (Array.isArray(r[1]) ? r[1] : []).map(function (rec) { return parseCoreRow(t, rec, r[0]); }); })
      : fetch(A.base + 'object/' + t.id + '/?JSON_OBJ&LIMIT=0,5000', { credentials: 'same-origin' }).then(answerJson)
        .then(function (arr) { return (Array.isArray(arr) ? arr : []).map(function (rec) { return parseRow(t, rec); }); });
    return rows.then(function (list) {
      return list.filter(function (row) {
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
    if (A.core) return send('POST', 'objects', Object.assign({ id: t.id, up: 1 }, p)).then(firstId);
    return post('_m_new/' + t.id + '?JSON&up=1', p).then(firstId);
  };
  // main (необязательно) — новое главное значение строки (t<id таблицы>).
  A.update = function (name, id, fields, main) {
    if (A.mock) return A.mockApi.update(name, id, fields, main);
    var t = tbl(name), p = toParams(t, fields);
    if (main != null) p['t' + t.id] = main;
    if (A.core) return send('PATCH', 'object/' + id, p);
    return post('_m_set/' + id + '?JSON', p);
  };
  A.remove = function (name, id) {
    if (A.mock) return A.mockApi.remove(name, id);
    tbl(name);
    if (A.core) return send('DELETE', 'object/' + id);
    return post('_m_del/' + id + '?JSON', {});
  };
  A.hasField = function (name, field) { var t = schema && schema.tables && schema.tables[name]; return !!(t && t.req && t.req[field]); };
  function sendForm(url, fd, onProgress, needId) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url);
      x.withCredentials = true;
      if (A.core) x.setRequestHeader('X-XSRF-Token', A.xsrf()); // ядро требует заголовок на записи
      x.upload.onprogress = function (e) { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onerror = function () { reject(new Error('нет связи с сервером')); };
      x.onload = function () {
        var d = null; try { d = JSON.parse(x.responseText); } catch (e) { /* не JSON */ }
        var err = errOf(d);
        if (x.status >= 400 || err || !d || (needId && !(d.id || d.obj))) return reject(new Error(err || (d ? 'ошибка загрузки' : String(x.responseText || '').replace(/<[^>]+>/g, '').slice(0, 120)) || ('HTTP ' + x.status)));
        resolve(String(d.obj || d.id || ''));
      };
      x.send(fd);
    });
  }
  // Новое ядро: файл — multipart (часть file) в POST /api/v1/<база>/object/<строка>/file/<реквизит>.
  function coreUpload(t, id, fileField, file, onProgress) {
    var fd = new FormData();
    fd.append('file', file, file.name);
    return sendForm(A.base + 'object/' + id + '/file/' + t.req[fileField], fd, onProgress, false).then(function () { return String(id); });
  }
  // Загрузка файла: multipart в _m_new (поле t<id реквизита FILE>), XHR ради индикатора прогресса.
  // На новом ядре — строка без файла, затем файл в неё; файл не принят — строка удаляется.
  // fields — реквизиты таблицы по именам (кроме FILE); file — File; onProgress(0..1).
  A.upload = function (name, main, fields, fileField, file, onProgress) {
    if (A.mock) return A.mockApi.upload(name, main, fields, fileField, file);
    var t = tbl(name), p = toParams(t, fields);
    if (!t.req[fileField]) return Promise.reject(new Error('Нет реквизита «' + fileField + '»'));
    p['t' + t.id] = main;
    if (A.core) {
      return send('POST', 'objects', Object.assign({ id: t.id, up: 1 }, p)).then(firstId).then(function (id) {
        if (!id) throw new Error('ядро не вернуло id строки');
        return coreUpload(t, id, fileField, file, onProgress).catch(function (e) {
          return send('DELETE', 'object/' + id).then(function () { throw e; }, function () { throw e; });
        });
      });
    }
    p._xsrf = A.xsrf();
    var fd = new FormData();
    Object.keys(p).forEach(function (k) { fd.append(k, p[k]); });
    fd.append('t' + t.req[fileField], file, file.name);
    return sendForm('/' + A.z + '/_m_new/' + t.id + '?JSON&up=1', fd, onProgress, true);
  };
  // Загрузка файла в существующую строку: ядро пишет в тот же реквизит FILE,
  // поэтому адрес файла (строка и реквизит) остаётся прежним.
  A.uploadTo = function (name, id, fileField, file, onProgress) {
    if (A.mock) return A.mockApi.uploadTo(name, id, fileField, file);
    var t = tbl(name);
    if (!t.req[fileField]) return Promise.reject(new Error('Нет реквизита «' + fileField + '»'));
    if (A.core) return coreUpload(t, id, fileField, file, onProgress);
    var fd = new FormData();
    fd.append('_xsrf', A.xsrf());
    fd.append('t' + t.req[fileField], file, file.name);
    return sendForm('/' + A.z + '/_m_set/' + id + '?JSON', fd, onProgress, false).then(function () { return String(id); });
  };
  // Удаление строки с файлом: сначала очищаем реквизит FILE (так сервер стирает сам файл), потом строку.
  // Новое ядро файлы без ссылок стирает само (сборщик python2node#1342) — достаточно удалить строку.
  A.removeFile = function (name, id, fileField) {
    if (A.mock) return A.mockApi.remove(name, id);
    if (A.core) return send('DELETE', 'object/' + id);
    var f = {}; f[fileField] = '';
    return post('_m_set/' + id + '?JSON', toParams(tbl(name), f)).then(function () { return post('_m_del/' + id + '?JSON', {}); });
  };
  // Строки отчёта нового ядра {columns:[{alias,name,ord}], composition:[{ord,reportName}], rows:[{alias:…}]}
  // в виде JSON_KV: ключ — «Имя в отчете» колонки, без него — имя колонки, без него — col<порядок>.
  function kvRows(d) {
    var names = {};
    ((d && d.composition) || []).forEach(function (c) { if (c.reportName) names[c.ord] = c.reportName; });
    var cols = ((d && d.columns) || []).map(function (c) { return { alias: c.alias, name: names[c.ord] || c.name || ('col' + c.ord) }; });
    return ((d && d.rows) || []).map(function (row) {
      var o = {};
      cols.forEach(function (c) { var v = row[c.alias]; o[c.name] = v == null ? '' : v; });
      return o;
    });
  }
  A.reportRows = function (name) {
    if (A.mock) return A.mockApi.report(name);
    var id = schema.reports && schema.reports[name];
    if (!id) return Promise.reject(new Error('Нет отчёта «' + name + '»'));
    if (A.core) return fetch(A.base + 'queries/' + (id.id || id) + '?limit=5000', { credentials: 'same-origin' }).then(answerJson).then(kvRows);
    return fetch(A.base + 'report/' + (id.id || id) + '?JSON_KV', { credentials: 'same-origin' })
      .then(answerJson);
  };
})();
