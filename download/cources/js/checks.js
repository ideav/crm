/*
 * LMSChecks: автопроверка практикума по базе ученика Integram (ideav/courses#84, WP4).
 * Работает в браузере ученика, same-origin ideav.ru: ученик владелец своей базы.
 *   LMSChecks.run(db, spec, opts) -> Promise<[{id,title,ok,hint,details}]>
 *   LMSChecks.listMyDbs()         -> Promise<string[]>
 * opts (необязательно): {fetch: function(url, init) -> Promise<Response-like>, base: ''}.
 * Спецификации: download/cources/content/checks/p1..p5.json (из репо courses).
 */
(function (global) {
  'use strict';

  var TYPE = {SHORT: [3, 8], DATETIME: [4], BUTTON: [7], CHARS: [8, 3], DATE: [9],
    FILE: [10], BOOLEAN: [11], MEMO: [12], NUMBER: [13, 14], CALC: [15], HTML: [2]};
  var TYPE_RU = {SHORT: 'короткий текст', DATETIME: 'дата и время', DATE: 'дата',
    MEMO: 'многострочный текст', NUMBER: 'число', BOOLEAN: 'флажок', CHARS: 'текст',
    BUTTON: 'кнопка', FILE: 'файл', HTML: 'HTML', CALC: 'вычисляемое'};
  var LOOK = {a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в'};

  function nkey(s) {
    s = String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[ \s]+/g, ' ').trim();
    return s.replace(/[a-z]/g, function (ch) { return LOOK[ch] || ch; });
  }
  function nsimple(s) { return nkey(s).replace(/\s*->\s*/g, ' -> '); }
  function toList(x) { return x == null ? [] : (Array.isArray(x) ? x : [x]); }
  function escRe(s) { return s.replace(/[.*+?^$()|{}\[\]\\]/g, '\\$&'); }
  function exactish(actual, want) {
    var a = nsimple(actual), w = nsimple(want);
    return a === w || new RegExp('^' + escRe(w) + ' \\d+$').test(a);
  }
  function nameMatches(actual, alts) {
    var a = nsimple(actual);
    return toList(alts).some(function (alt) {
      var k = nsimple(alt);
      if (!k) return false;
      if (a === k) return true;
      if (a.indexOf(k) === 0 && !/[a-zа-я0-9]/.test(a.charAt(k.length) || ' ')) return true;
      return k.length >= 8 && a.indexOf(k) >= 0;
    });
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/[\s ]/g, '').replace(/₽|руб\.?/gi, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }
  function softEq(actual, expected) {
    if (expected === '*') return String(actual == null ? '' : actual).trim() !== '';
    var a = num(actual), e = num(expected);
    if (!isNaN(a) && !isNaN(e)) return a === e;
    return nkey(actual) === nkey(expected);
  }
  function disp(v) {
    var m = /^(\d+):([\s\S]*)$/.exec(String(v == null ? '' : v));
    return m ? m[2] : String(v == null ? '' : v);
  }

  function AccessError(msg) { this.message = msg; this.access = true; }
  AccessError.prototype = Object.create(Error.prototype);

  /* Контекст проверки одной базы: сеть и кэш */
  function Ctx(db, opts) {
    opts = opts || {};
    this.db = db;
    this.base = opts.base || '';
    this.fetch = opts.fetch || function (u, i) { return global.fetch(u, i); };
    this.cache = {};
  }
  Ctx.prototype.access = function (why) {
    return new AccessError('Не удалось прочитать базу «' + this.db + '»' + (why ? ' (' + why + ')' : '') +
      '. Откройте свою базу https://ideav.ru/' + this.db + '/ в соседней вкладке, войдите под своим логином и повторите проверку.');
  };
  Ctx.prototype.warm = function () {
    var self = this;
    if (!this.cache.warm) {
      this.cache.warm = Promise.resolve(this.fetch(this.base + '/' + this.db + '/', {credentials: 'include'}))
        .then(function () { return true; }, function () { return false; });
    }
    return this.cache.warm.then(function () { return self; });
  };
  Ctx.prototype.get = function (path) {
    var self = this, url = this.base + '/' + this.db + '/' + path;
    if (this.cache[url]) return this.cache[url];
    this.cache[url] = this.warm().then(function () {
      return self.fetch(url, {credentials: 'include'});
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw self.access('доступ запрещён, ' + r.status);
      if (r.status === 404) throw self.access('такой базы нет, 404');
      return r.text().then(function (t) {
        var j;
        if (/^\s*</.test(t)) throw self.access('вместо данных пришла страница входа');
        try { j = JSON.parse(t); } catch (e) { throw new Error('ответ сервера не разобран: ' + t.slice(0, 80)); }
        var e0 = Array.isArray(j) && j[0] && j[0].error;
        if (e0) {
          if (/авториз|доступ|права/i.test(e0)) throw self.access(String(e0));
          throw new Error(String(e0));
        }
        if (j && j.error && !Array.isArray(j)) throw self.access(String(j.error));
        return j;
      });
    });
    return this.cache[url];
  };

  /* Метаданные: все таблицы базы */
  Ctx.prototype.meta = function () {
    var self = this;
    if (!this.cache.metaIdx) {
      this.cache.metaIdx = this.get('metadata?JSON').then(function (list) {
        var idx = {all: list, byId: {}};
        list.forEach(function (t) { idx.byId[t.id] = t; });
        return idx;
      });
    }
    return this.cache.metaIdx;
  };
  Ctx.prototype.tables = function (name, parentName) {
    var self = this;
    return this.meta().then(function (m) {
      var cands = m.all.filter(function (t) { return exactish(t.val, name); });
      if (!parentName) return cands;
      var arr = {};
      m.all.filter(function (p) { return exactish(p.val, parentName); }).forEach(function (p) {
        (p.reqs || []).forEach(function (r) { if (r.arr_id) arr[r.arr_id] = p; });
      });
      return cands.filter(function (t) { return arr[t.id]; });
    });
  };
  Ctx.prototype.parentOf = function (t) {
    return this.meta().then(function (m) {
      var res = null;
      m.all.forEach(function (p) {
        (p.reqs || []).forEach(function (r) { if (String(r.arr_id) === String(t.id)) res = p; });
      });
      return res;
    });
  };
  /* Записи таблицы верхнего уровня; sub: по записи родителя */
  Ctx.prototype.rows = function (tableId, parentId) {
    var p = 'object/' + tableId + '/?JSON_OBJ&LIMIT=5000' + (parentId ? '&F_U=' + parentId : '');
    return this.get(p).then(function (a) { return Array.isArray(a) ? a : []; });
  };
  /* Все записи подчинённой таблицы: [{parent: запись родителя, row}] */
  Ctx.prototype.subRows = function (parentTable, subTable) {
    var self = this;
    return this.rows(parentTable.id).then(function (ps) {
      return Promise.all(ps.map(function (p) {
        return self.rows(subTable.id, p.i).then(function (rs) {
          return rs.map(function (r) { return {parent: p, row: r}; });
        });
      }));
    }).then(function (parts) { return [].concat.apply([], parts); });
  };

  /* Колонки таблицы: первая колонка (имя = имя таблицы) + реквизиты */
  function tableCols(t) {
    var cols = [{name: t.val, idx: 0, type: parseInt(t.type, 10), first: true}];
    (t.reqs || []).forEach(function (r, i) {
      cols.push({name: r.val, idx: i + 1, type: parseInt(r.type, 10), ref: r.ref, arr: r.arr_id, req: r});
    });
    return cols;
  }
  function findCol(t, names) {
    var alts = String(names).split('|'), cols = tableCols(t), res = null;
    cols.forEach(function (c) {
      if (!res && alts.some(function (a) { return nkey(a) === nkey(c.name); })) res = c;
    });
    return res;
  }
  function cell(t, col, row) {
    var v = row.r ? row.r[col.idx] : '';
    return col.ref ? disp(v) : (v == null ? '' : String(v));
  }
  function plural(n, a, b, c) {
    var m = n % 100, d = n % 10;
    return (m > 10 && m < 15) ? c : d === 1 ? a : (d > 1 && d < 5) ? b : c;
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function names(list) { return list.map(function (t) { return '«' + t.val + '»'; }).join(', '); }
  var SYSTEM = ['Пользователь', 'Запрос', 'Колонки запроса', 'Формат', 'Роль', 'FROM', 'Доступ', 'Функция', 'Итог',
    'Объекты', 'Форма', 'Панель', 'Поле', 'Кнопка', 'Меню', 'Настройка', 'Статус', 'Тег', 'Карта', 'Клиент',
    'Статус задачи'];
  function userTables(m) {
    return m.all.filter(function (t) {
      return !SYSTEM.some(function (s) { return nkey(s) === nkey(t.val); });
    });
  }

  function absent(ctx, what, nameStr) {
    return ctx.meta().then(function (m) {
      var u = userTables(m).map(function (t) { return t.val; }).slice(0, 14);
      return 'нет ' + what + ' «' + nameStr + '». Сейчас в базе: ' + (u.length ? u.join(', ') : 'пусто') + '.';
    });
  }
  function describeType(spec) {
    var s = [];
    if (spec.type) s.push(TYPE_RU[spec.type] || spec.type);
    if (spec.ref) s.push('ссылка на «' + spec.ref + '»');
    if (spec.sub) s.push('подчинённая таблица «' + spec.sub + '»');
    return s.join(', ');
  }
  function colProblem(ctx, t, spec) {
    if (typeof spec === 'string') spec = {name: spec};
    var c = findCol(t, spec.name);
    if (!c) return Promise.resolve('нет колонки «' + spec.name.split('|')[0] + '»');
    var bad = null;
    if (spec.type && TYPE[spec.type] && TYPE[spec.type].indexOf(c.type) < 0 && !c.ref && !c.arr) {
      bad = 'колонка «' + c.name + '» должна быть типа «' + (TYPE_RU[spec.type] || spec.type) + '»';
    }
    if (spec.type && TYPE[spec.type] && (c.ref || c.arr) && !spec.ref && !spec.sub) {
      bad = 'колонка «' + c.name + '» должна быть типа «' + (TYPE_RU[spec.type] || spec.type) + '», а не ссылкой';
    }
    if (bad) return Promise.resolve(bad);
    if (!spec.ref && !spec.sub) return Promise.resolve(null);
    return ctx.meta().then(function (m) {
      if (spec.ref) {
        var rt = c.ref ? m.byId[c.ref] : null;
        if (!rt || !exactish(rt.val, spec.ref)) return 'колонка «' + c.name + '» должна быть ссылкой на справочник «' + spec.ref + '»' +
          (rt ? ' (сейчас ссылка на «' + rt.val + '»)' : ' (сейчас это не ссылка)');
      }
      if (spec.sub) {
        var st = c.arr ? m.byId[c.arr] : null;
        if (!st || !exactish(st.val, spec.sub)) return 'внутри таблицы нет подчинённой таблицы «' + spec.sub + '»';
      }
      return null;
    });
  }

  var H = {};

  H.tableExists = function (ctx, p) {
    return ctx.tables(p.table, p.parent).then(function (c) {
      if (!c.length) {
        if (p.parent) return ctx.tables(p.table).then(function (c2) {
          return {ok: false, details: c2.length ? 'таблица «' + p.table + '» есть, но не подчинена таблице «' + p.parent + '»' :
            'нет подчинённой таблицы «' + p.table + '» внутри «' + p.parent + '»'};
        });
        return absent(ctx, 'таблицы', p.table).then(function (d) { return {ok: false, details: d}; });
      }
      if (p.unique) {
        var u = c.filter(function (t) { return String(t.unique) === '1'; });
        if (!u.length) return {ok: false, details: 'таблица «' + c[0].val + '» есть, но первая колонка не уникальная (для справочника она должна быть уникальной)'};
      }
      return {ok: true, details: 'таблица «' + c[0].val + '» найдена'};
    });
  };

  H.columns = function (ctx, p) {
    return ctx.tables(p.table, p.parent).then(function (c) {
      if (!c.length) return absent(ctx, 'таблицы', p.table).then(function (d) { return {ok: false, details: d}; });
      return Promise.all(c.map(function (t) {
        return Promise.all(p.columns.map(function (s) { return colProblem(ctx, t, s); })).then(function (pr) {
          return pr.filter(Boolean);
        });
      })).then(function (all) {
        var best = all.reduce(function (a, b) { return b.length < a.length ? b : a; }, all[0]);
        return best.length ? {ok: false, details: 'в таблице «' + p.table + '»: ' + best.join('; ')} :
          {ok: true, details: 'колонки таблицы «' + p.table + '» в порядке'};
      });
    });
  };

  /* Записи таблицы-кандидата: [{parent, row}] (для подчинённой — по всем записям родителя) */
  function loadRecords(ctx, t, isSub) {
    if (!isSub) return ctx.rows(t.id).then(function (rs) { return rs.map(function (r) { return {parent: null, row: r}; }); });
    return ctx.parentOf(t).then(function (pt) {
      return pt ? ctx.subRows(pt, t) : [];
    });
  }
  function withCands(ctx, p, fn) {
    return ctx.tables(p.table, p.parent).then(function (c) {
      if (!c.length) return absent(ctx, p.parent ? 'подчинённой таблицы' : 'таблицы', p.table).then(function (d) { return {ok: false, details: d}; });
      return Promise.all(c.map(function (t) {
        return loadRecords(ctx, t, !!p.parent).then(function (recs) { return fn(t, recs); });
      })).then(function (res) {
        var good = res.filter(function (r) { return r.ok; })[0];
        return good || res[0];
      });
    });
  }
  function cntText(n) { return n + ' ' + plural(n, 'запись', 'записи', 'записей'); }

  H.recordCount = function (ctx, p) {
    return withCands(ctx, p, function (t, recs) {
      var n = recs.length, bad = [];
      if (p.count != null && n !== p.count) bad.push('сейчас ' + cntText(n) + ', нужно ' + p.count);
      if (p.min != null && n < p.min) bad.push('сейчас ' + cntText(n) + ', нужно не меньше ' + p.min);
      if (p.max != null && n > p.max) bad.push('сейчас ' + cntText(n) + ', нужно не больше ' + p.max);
      if (p.perParent) {
        Object.keys(p.perParent).forEach(function (k) {
          var have = recs.filter(function (x) { return softEq(x.parent && x.parent.r[0], k); }).length;
          if (have !== p.perParent[k]) bad.push('у «' + k + '» ' + have + ', нужно ' + p.perParent[k]);
        });
      }
      return {ok: !bad.length, details: bad.length ? 'в «' + p.table + '»: ' + bad.join('; ') : 'в «' + p.table + '» ' + cntText(n)};
    });
  };

  function rowMatches(t, rec, want) {
    var miss = [];
    Object.keys(want).forEach(function (k) {
      if (k === '_parent') {
        if (!(rec.parent && softEq(disp(rec.parent.r[0]), want[k]))) miss.push(k);
        return;
      }
      var c = findCol(t, k);
      if (!c) { miss.push('нет колонки «' + k.split('|')[0] + '»'); return; }
      if (!softEq(cell(t, c, rec.row), want[k])) miss.push(k);
    });
    return miss;
  }
  function rowLabel(want) {
    return Object.keys(want).map(function (k) { return want[k]; }).slice(0, 3).join(' / ');
  }

  H.recordValues = function (ctx, p) {
    return withCands(ctx, p, function (t, recs) {
      var bad = [];
      p.rows.forEach(function (want) {
        var best = null;
        var found = recs.some(function (rec) {
          var m = rowMatches(t, rec, want);
          if (!m.length) return true;
          if (!best || m.length < best.length) best = m;
          return false;
        });
        if (!found) {
          var noCol = best && best.filter(function (x) { return x.indexOf('нет колонки') === 0; })[0];
          bad.push(noCol ? noCol : 'нет записи «' + rowLabel(want) + '»' + (best && best.length === 1 ? ' (не совпадает «' + best[0].split('|')[0] + '»)' : ''));
        }
      });
      bad = uniq(bad);
      return {ok: !bad.length, details: bad.length ? 'в «' + p.table + '»: ' + bad.join('; ') : 'нужные записи в «' + p.table + '» есть'};
    });
  };

  /* Отчёты («Запрос», таблица 22) */
  Ctx.prototype.reports = function () {
    if (!this.cache.reports) {
      this.cache.reports = this.rows(22).then(function (rs) {
        return rs.map(function (r) { return {id: r.i, name: String(r.r[0])}; });
      });
    }
    return this.cache.reports;
  };
  function findReport(ctx, alts) {
    return ctx.reports().then(function (list) {
      var hit = list.filter(function (r) { return nameMatches(r.name, alts); });
      if (!hit.length) {
        var user = list.filter(function (r) { return !/^(int[A-Z]|my[A-Z]|MyRoleMenu|rec$)/.test(r.name); });
        throw new Error('нет отчёта «' + toList(alts)[0] + '». Сейчас отчёты: ' +
          (user.map(function (r) { return r.name; }).slice(0, 12).join(', ') || 'нет'));
      }
      return hit[0];
    });
  }
  /* Данные отчёта: {columns: [имена], rows: [[ячейки]]} */
  function reportData(ctx, rep, query) {
    return ctx.get('report/' + rep.id + '?JSON&LIMIT=5000' + (query || '')).then(function (j) {
      var cols = (j && j.columns) || [], data = (j && j.data) || [];
      var n = data.length && Array.isArray(data[0]) ? data[0].length : 0, rows = [], i, k;
      for (i = 0; i < n; i++) {
        var row = [];
        for (k = 0; k < cols.length; k++) row.push(data[k] ? data[k][i] : '');
        rows.push(row);
      }
      return {columns: cols.map(function (c) { return String(c.name); }), rows: rows};
    });
  }
  function queryStr(q) {
    if (!q) return '';
    return Object.keys(q).map(function (k) { return '&' + k + '=' + encodeURIComponent(q[k]); }).join('');
  }
  function repCol(rd, names) {
    var alts = String(names).split('|'), res = -1;
    rd.columns.forEach(function (c, i) {
      if (res < 0 && alts.some(function (a) { return nkey(a) === nkey(c); })) res = i;
    });
    return res;
  }
  function repRowMatch(rd, row, want) {
    var miss = [];
    Object.keys(want).forEach(function (k) {
      var i = repCol(rd, k);
      if (i < 0) { miss.push('нет колонки «' + k.split('|')[0] + '»'); return; }
      if (!softEq(disp(row[i]), want[k]) && !softEq(row[i], want[k])) miss.push(k);
    });
    return miss;
  }
  function repLabel(want) { return Object.keys(want).map(function (k) { return want[k]; }).slice(0, 3).join(' / '); }

  H.reportRows = function (ctx, p) {
    return findReport(ctx, p.report).then(function (rep) {
      return reportData(ctx, rep, queryStr(p.query)).then(function (rd) {
        var bad = [], n = rd.rows.length, nm = '«' + rep.name + '»';
        (p.columns || []).forEach(function (c) {
          if (repCol(rd, c) < 0) bad.push('нет колонки «' + String(c).split('|')[0] + '»');
        });
        if (p.count != null && n !== p.count) bad.push('сейчас ' + n + ' ' + plural(n, 'строка', 'строки', 'строк') + ', нужно ' + p.count);
        if (p.min != null && n < p.min) bad.push('сейчас ' + n + ' строк, нужно не меньше ' + p.min);
        if (p.max != null && n > p.max) bad.push('сейчас ' + n + ' строк, нужно не больше ' + p.max);
        (p.contains || []).forEach(function (want) {
          var best = null, ok = rd.rows.some(function (r) {
            var m = repRowMatch(rd, r, want);
            if (!m.length) return true;
            if (!best || m.length < best.length) best = m;
            return false;
          });
          if (!ok) bad.push(best && best[0].indexOf('нет колонки') === 0 ? best[0] : 'нет строки «' + repLabel(want) + '»');
        });
        (p.notContains || []).forEach(function (want) {
          var hit = rd.rows.some(function (r) { return !repRowMatch(rd, r, want).length; });
          if (hit) bad.push('в отчёте не должно быть строки «' + repLabel(want) + '»');
        });
        if (p.first) {
          var m0 = rd.rows.length ? repRowMatch(rd, rd.rows[0], p.first) : ['пусто'];
          if (m0.length) bad.push('первой строкой должна быть «' + repLabel(p.first) + '»');
        }
        bad = uniq(bad);
        return {ok: !bad.length, details: bad.length ? 'отчёт ' + nm + ': ' + bad.join('; ') : 'отчёт ' + nm + ': ' + n + ' ' + plural(n, 'строка', 'строки', 'строк')};
      });
    });
  };

  H.reportExists = function (ctx, p) {
    return findReport(ctx, p.report).then(function (rep) { return {ok: true, details: 'отчёт «' + rep.name + '» есть'}; });
  };

  H.reportSum = function (ctx, p) {
    return findReport(ctx, p.report).then(function (rep) {
      return reportData(ctx, rep).then(function (rd) {
        var i = repCol(rd, p.column), nm = '«' + rep.name + '»';
        if (i < 0) return {ok: false, details: 'в отчёте ' + nm + ' нет колонки «' + String(p.column).split('|')[0] + '»'};
        var sum = 0;
        rd.rows.forEach(function (r) { var v = num(r[i]); if (!isNaN(v)) sum += v; });
        var ok = Math.abs(sum - p.equals) <= (p.tolerance || 0);
        return {ok: ok, details: 'отчёт ' + nm + ', сумма по колонке «' + String(p.column).split('|')[0] + '»: ' +
          (Math.round(sum * 100) / 100) + (ok ? '' : ', нужно ' + p.equals)};
      });
    });
  };

  /* Определение отчёта: колонки с фильтрами, скрытием, итогами (таблица 28) */
  H.reportDef = function (ctx, p) {
    return findReport(ctx, p.report).then(function (rep) {
      return Promise.all([ctx.meta(), ctx.rows(28, rep.id)]).then(function (a) {
        var t28 = a[0].byId[28], rows = a[1], pos = {};
        (t28 ? t28.reqs : []).forEach(function (r, i) {
          var k = nkey(r.val);
          if (k.indexOf('имя в отчете') === 0) pos.name = i + 1;
          else if (k === 'значение (от)') pos.from = i + 1;
          else if (k === 'значение (до)') pos.to = i + 1;
          else if (k === 'скрыть') pos.hide = i + 1;
          else if (k === 'итог') pos.total = i + 1;
          else if (k === 'формула') pos.formula = i + 1;
          else if (k === 'присвоить') pos.set = i + 1;
        });
        var alts = String(p.column || '').split('|');
        var hit = rows.filter(function (r) {
          var nm = (pos.name && r.r[pos.name]) || disp(r.r[0]);
          return alts.some(function (x) { return nkey(x) === nkey(nm) || nkey(x) === nkey(disp(r.r[0])); });
        });
        var nm = '«' + rep.name + '», колонка «' + alts[0] + '»';
        if (!hit.length) return {ok: false, details: 'в отчёте «' + rep.name + '» нет колонки «' + alts[0] + '»'};
        var bad = [];
        var ok = hit.some(function (r) {
          var flt = String(r.r[pos.from] || '') + ' ' + String(r.r[pos.to] || '');
          var b = [];
          if (p.filterContains && flt.toUpperCase().indexOf(String(p.filterContains).toUpperCase()) < 0) {
            b.push('в фильтре колонки должно быть «' + p.filterContains + '»' + (flt.trim() ? ' (сейчас «' + flt.trim() + '»)' : ' (сейчас фильтра нет)'));
          }
          if (p.filterAny && !flt.trim()) b.push('у колонки не задан фильтр');
          if (p.hidden != null && (String(r.r[pos.hide] || '') === '1' || r.r[pos.hide] === true) !== p.hidden) {
            b.push(p.hidden ? 'колонка должна быть скрыта' : 'колонка не должна быть скрыта');
          }
          if (p.total && nkey(disp(r.r[pos.total])) !== nkey(p.total)) b.push('итог по колонке должен быть ' + p.total);
          if (p.setAny && !String(r.r[pos.set] || '').trim()) b.push('у колонки не задано «Присвоить» (SET)');
          if (p.formulaContains && nkey(r.r[pos.formula]).indexOf(nkey(p.formulaContains)) < 0) b.push('в формуле нет «' + p.formulaContains + '»');
          if (b.length) bad = b;
          return !b.length;
        });
        return {ok: ok, details: ok ? 'отчёт ' + nm + ' настроен' : 'отчёт ' + nm + ': ' + bad.join('; ')};
      });
    });
  };

  /* Роли и права */
  Ctx.prototype.roles = function () {
    if (!this.cache.roles) {
      this.cache.roles = this.rows(42).then(function (rs) {
        return rs.map(function (r) { return {id: r.i, name: String(r.r[0])}; });
      });
    }
    return this.cache.roles;
  };
  function findRole(ctx, name) {
    return ctx.roles().then(function (list) {
      var hit = list.filter(function (r) { return nkey(r.name) === nkey(name); })[0];
      if (!hit) {
        var own = list.filter(function (r) { return ['admin', 'user'].indexOf(nkey(r.name)) < 0; });
        throw new Error('нет роли «' + name + '». Сейчас роли: ' + (own.map(function (r) { return r.name; }).join(', ') || 'нет, кроме admin и user'));
      }
      return hit;
    });
  }
  H.roleExists = function (ctx, p) {
    return findRole(ctx, p.role).then(function (r) { return {ok: true, details: 'роль «' + r.name + '» есть'}; });
  };

  /* Значение маски: число — номер записи справочника, переводим в имя */
  function maskNames(ctx, objName, values) {
    var m = /^(.*?)\s*->\s*(.*)$/.exec(objName);
    if (!m) return Promise.resolve(values);
    return ctx.tables(m[1]).then(function (c) {
      var col = c[0] ? findCol(c[0], m[2]) : null;
      if (!col || !col.ref) return values;
      return ctx.rows(col.ref).then(function (rs) {
        var by = {};
        rs.forEach(function (r) { by[String(r.i)] = String(r.r[0]); });
        return values.map(function (v) { return by[String(v).trim()] != null ? by[String(v).trim()] : v; });
      });
    });
  }
  function grantOne(ctx, p) {
    return findRole(ctx, p.role).then(function (role) {
      return ctx.rows(116, role.id).then(function (rows) {
        var mine = rows.filter(function (r) {
          var nm = disp(r.r[0]);
          return p.object.indexOf('->') >= 0 ? nsimple(nm) === nsimple(p.object) || nameMatches(nm, p.objectAlt || []) :
            (nsimple(nm).indexOf('->') < 0 && (exactish(nm, p.object) || nameMatches(nm, [p.object].concat(p.objectAlt || []))));
        });
        var lvl = function (r) { return disp(r.r[1]).toUpperCase(); };
        var nmo = '«' + p.object + '» у роли «' + role.name + '»';
        if (p.absent) return {ok: !mine.length, details: mine.length ? 'у роли «' + role.name + '» не должно быть прав на «' + p.object + '»' : 'прав на «' + p.object + '» у роли «' + role.name + '» нет'};
        if (!mine.length) return {ok: false, details: 'у роли «' + role.name + '» нет прав на «' + p.object + '»'};
        var wantL = toList(p.level).map(function (x) { return String(x).toUpperCase(); });
        var want = wantL.join(' или ');
        var rowsL = wantL.length ? mine.filter(function (r) { return wantL.indexOf(lvl(r)) >= 0; }) : mine;
        if (!rowsL.length) return {ok: false, details: 'права на ' + nmo + ': сейчас ' + mine.map(lvl).join('/') + ', нужно ' + want};
        var vals = p.masks || (p.mask != null ? [p.mask] : null);
        if (!vals) return {ok: true, details: 'права на ' + nmo + ': ' + want};
        return maskNames(ctx, p.object, rowsL.map(function (r) { return String(r.r[2] || ''); })).then(function (have) {
          var miss = vals.filter(function (v) { return !have.some(function (h) { return softEq(h, v); }); });
          if (miss.length) return {ok: false, details: 'маска на ' + nmo + ': нет значения «' + miss.join('», «') + '»' +
            (have.filter(Boolean).length ? ' (сейчас: ' + have.filter(Boolean).join(', ') + ')' : ' (маска не задана)')};
          return {ok: true, details: 'маска на ' + nmo + ' в порядке'};
        });
      });
    });
  }
  H.grant = function (ctx, p) {
    var objs = p.objects || [p.object];
    return Promise.all(objs.map(function (o) {
      var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; }); q.object = o;
      return grantOne(ctx, q);
    })).then(function (res) {
      var bad = res.filter(function (r) { return !r.ok; });
      return bad.length ? {ok: false, details: bad.map(function (r) { return r.details; }).join('; ')} : res[0];
    });
  };

  function runOne(ctx, chk) {
    var h = H[chk.type];
    var res = {id: chk.id, title: chk.title, ok: false, hint: chk.hint || '', details: ''};
    if (!h) { res.details = 'неизвестный тип проверки «' + chk.type + '»'; return Promise.resolve(res); }
    return Promise.resolve().then(function () { return h(ctx, chk.params || {}); }).then(function (r) {
      res.ok = !!r.ok;
      res.details = r.details || '';
      return res;
    }, function (e) {
      res.details = (e && e.message) || String(e);
      if (e && e.access) res.access = true;
      return res;
    });
  }

  /* run(db, spec, opts) -> Promise<[{id,title,ok,hint,details}]> */
  function run(db, spec, opts) {
    var ctx = new Ctx(String(db || '').trim(), opts);
    var checks = (spec && spec.checks) || [];
    if (!ctx.db) {
      return Promise.resolve(checks.map(function (c) {
        return {id: c.id, title: c.title, ok: false, hint: 'Укажите имя своей базы.', details: 'имя базы не задано'};
      }));
    }
    return ctx.warm().then(function () { return ctx.meta(); }).then(function () {
      var out = [];
      return checks.reduce(function (p, c) {
        return p.then(function () { return runOne(ctx, c).then(function (r) { out.push(r); }); });
      }, Promise.resolve()).then(function () { return out; });
    }, function (e) {
      var msg = (e && e.message) || String(e);
      return checks.map(function (c) {
        return {id: c.id, title: c.title, ok: false, access: !!(e && e.access),
          hint: (e && e.access) ? msg : (c.hint || ''), details: msg};
      });
    });
  }

  /* Базы пользователя из ЛК my: report/313 (то же, что js/cabinet.js). Недоступно — [] */
  function listMyDbs(opts) {
    opts = opts || {};
    var f = opts.fetch || function (u, i) { return global.fetch(u, i); };
    return Promise.resolve().then(function () {
      return f((opts.base || '') + '/my/report/313?JSON_KV', {credentials: 'include'});
    }).then(function (r) {
      if (!r.ok && r.status !== undefined && r.status >= 400) return [];
      return r.text().then(function (t) {
        var j;
        try { j = JSON.parse(t); } catch (e) { return []; }
        if (!Array.isArray(j)) return [];
        var seen = {}, list = [];
        j.forEach(function (x) {
          var d = x && x.DB ? String(x.DB) : '';
          if (d && !seen[d]) { seen[d] = 1; list.push(d); }
        });
        return list;
      });
    }).catch(function () { return []; });
  }

  global.LMSChecks = {run: run, listMyDbs: listMyDbs, _norm: nkey, _nameMatches: nameMatches};
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LMSChecks;
})(typeof window !== 'undefined' ? window : globalThis);
