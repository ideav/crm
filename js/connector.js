/*
 * connector.js — рабочее место «Коннектор» (Битрикс24 / 1С → Интеграм).
 * Развёртывание: js/connector.js, подключается из templates/connector.html:
 *     <script src="/js/connector.js?1"></script>
 *
 * Путь «П»: подбор соответствия полей идёт браузер → ядро (_connect) → эмбеддер на 104.
 * Браузер напрямую на 104 не ходит (CORS не нужен, 104 закрыт для браузеров).
 *
 * Ожидает в шаблоне (инжектится ядром / заданы в connector.html):
 *   window.CONNECTOR_DB        — имя базы ({_global_.z})
 *   window.CONNECTOR_CONNECT_ID— id записи-«Коннектора» (тип CONNECT) с URL эмбеддера
 *   window.CONNECTOR_TABLES     — { "<ключ сущности>": <table_id>, ... }
 *   (опц.) window.CONNECTOR_SOURCE_FIELDS — { "<сущность>": [[name,label],...] } если поля
 *          источника уже получены на сервере; иначе задайте getSourceFields().
 *
 * DOM (как в connector.html): #entities (select), #aiBtn, #mapBody (tbody), #mapHint.
 */
(function (w, d) {
  "use strict";

  var DB = w.CONNECTOR_DB || "";
  var CONFIG = w.CONNECTOR_CONFIG || "";        // имя конфига в базе (без .json)
  var CONNECT_ID = w.CONNECTOR_CONNECT_ID || 0;
  var TABLES = w.CONNECTOR_TABLES || {};
  var MANUAL = 0.60;                            // порог: score ниже — просить подтверждение
  var FETCH_TIMEOUT = 30000;
  var OK_METHODS = { "точное": 1, "словарь": 1, "exact": 1, "dict": 1, "dictionary": 1 };

  // ---- утилиты ----
  function b64url(obj) {
    var s = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function num(v) {
    return esc(String(v == null ? 0 : v));
  }
  function errMsg(e) {
    if (!e) return "неизвестная ошибка";
    if (typeof e === "string") return e;
    return e.message || "неизвестная ошибка";
  }
  function truthyRef(v) {
    if (!v) return false;
    if (v === true || v === 1) return true;
    var n = +v;
    if (!isNaN(n) && String(v).trim() !== "") return n !== 0;
    var s = String(v).toLowerCase();
    return s !== "false" && s !== "null" && s !== "undefined" && s !== "0";
  }

  function fetchTO(url) {
    var opts = { credentials: "same-origin" };
    var timer = null;
    if (typeof AbortController !== "undefined") {
      var ctl = new AbortController();
      opts.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT);
    }
    return fetch(url, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === "AbortError") throw new Error("таймаут " + (FETCH_TIMEOUT / 1000) + " с");
      throw e;
    });
  }

  // ---- колонки целевой таблицы из метаданных базы (ядро, по сессии-куке) ----
  // GET /{db}/metadata/{tableId}?JSON=1 -> {val, reqs:[{val, attrs, ref, ...}]}
  function loadColumns(tableId) {
    return fetchTO("/" + DB + "/metadata/" + tableId + "?JSON=1")
      .then(function (r) { if (!r.ok) throw new Error("метаданные: HTTP " + r.status); return r.json(); })
      .then(function (m) {
        var names = [], refCols = {};
        (m.reqs || []).forEach(function (rq) {
          var attrs = rq.attrs || "", name = rq.val;
          if (attrs && attrs.charAt(0) === "{") {
            try { var j = JSON.parse(attrs); if (j && j.alias) name = j.alias; } catch (e) {}
          } else {
            var mm = /:ALIAS=([^:]*):/.exec(attrs); if (mm) name = mm[1];
          }
          if (names.indexOf(name) < 0) names.push(name);
          if (truthyRef(rq.ref)) refCols[name] = true;
        });
        return { table: m.val, names: names, refCols: refCols };
      });
  }

  // ---- поля источника: [[name,label],...] ----
  // По умолчанию берём из window.CONNECTOR_SOURCE_FIELDS (получены на сервере). Переопределяемо.
  function getSourceFields(entity) {
    var sf = w.CONNECTOR_SOURCE_FIELDS || {};
    if (sf[entity]) return Promise.resolve(sf[entity]);
    return Promise.reject(new Error("нет полей источника для «" + entity + "» — получите их на сервере (Битрикс *.fields / 1С $metadata)"));
  }

  // ---- вызов эмбеддера ЧЕРЕЗ ЯДРО (_connect) ----
  // Ядро подставит URL из записи-«Коннектора» и токен, дописав наш ?q=...
  function suggest(source, columns) {
    if (!CONNECT_ID) return Promise.reject(new Error("не задан CONNECTOR_CONNECT_ID (запись-«Коннектор»)"));
    var q = b64url({ source: source, target: columns });
    return fetchTO("/" + DB + "/_connect/" + CONNECT_ID + "?q=" + q)
      .then(function (r) {
        if (!r.ok) throw new Error("эмбеддер: HTTP " + r.status);
        return r.text();
      })
      .then(function (t) {
        var m; try { m = JSON.parse(t); } catch (e) { throw new Error("эмбеддер: неожиданный ответ"); }
        if (m.error) throw new Error("эмбеддер: " + m.error);
        return m; // {matches, fields, manual}
      });
  }

  // ---- отрисовка таблицы соответствия ----
  var openList = null;
  function closeList() {
    if (openList) { openList.classList.remove("show"); openList = null; }
  }
  d.addEventListener("click", function (e) {
    if (!openList) return;
    var box = openList.parentNode;
    if (!box || !box.contains(e.target)) closeList();
  });

  function buildCombobox(td, cols, value) {
    td.innerHTML =
      '<div class="cbx"><input type="text" role="combobox" autocomplete="off" value="' + esc(value || "") +
      '" placeholder="колонка базы…"><input type="hidden" class="val" value="' + esc(value || "") +
      '"><div class="list"></div></div>';
    var box = td.querySelector(".cbx"), inp = box.querySelector("input[role=combobox]"),
        hid = box.querySelector(".val"), list = box.querySelector(".list");
    function render(qs) {
      qs = (qs || "").toLowerCase();
      var items = cols.filter(function (c) { return c.toLowerCase().indexOf(qs) >= 0; });
      if (!items.length) {
        list.innerHTML = '<div class="cbx-empty">нет совпадений</div>';
        return;
      }
      list.innerHTML = items.map(function (c) { return "<div>" + esc(c) + "</div>"; }).join("");
      Array.prototype.forEach.call(list.querySelectorAll("div"), function (el) {
        el.onclick = function () {
          inp.value = el.textContent; hid.value = el.textContent;
          closeList(); markManual();
        };
      });
    }
    inp.addEventListener("focus", function () { closeList(); render(inp.value); list.classList.add("show"); openList = list; });
    inp.addEventListener("input", function () { render(inp.value); list.classList.add("show"); openList = list; hid.value = ""; });
  }

  function markManual() {
    Array.prototype.forEach.call(d.querySelectorAll("#mapBody tr"), function (tr) {
      var hid = tr.querySelector(".val");
      var empty = !hid || !hid.value;
      var low = tr.dataset.low === "1";
      tr.classList.toggle("row-manual", empty || low);
    });
  }

  function renderRows(source, cols) {
    var body = d.getElementById("mapBody"); body.innerHTML = "";
    source.forEach(function (f) {
      var tr = d.createElement("tr");
      tr.dataset.name = f[0];
      tr.innerHTML = '<td><b>' + esc(f[0]) + '</b><div class="tr-sel">«' + esc(f[1]) +
        '»</div></td><td class="arrow">→</td><td class="col"></td><td class="how"><span class="badge warn">ручное</span></td>';
      body.appendChild(tr);
      buildCombobox(tr.querySelector(".col"), cols, "");
    });
    markManual();
  }

  function applyMatches(matches, refCols, cols) {
    var byName = {}; (matches || []).forEach(function (m) { byName[m.field] = m; });
    Array.prototype.forEach.call(d.querySelectorAll("#mapBody tr"), function (tr) {
      var how = tr.querySelector(".how");
      var m = byName[tr.dataset.name];
      if (!m) {
        tr.dataset.low = "";
        var hid0 = tr.querySelector(".val"), inp0 = tr.querySelector("input[role=combobox]");
        if (hid0) hid0.value = "";
        if (inp0) inp0.value = "";
        how.innerHTML = '<span class="badge warn">ручное</span>';
        return;
      }
      var col = m.column || "";
      var score = m.score || 0;
      var scoreTxt = score.toFixed(2);
      if (col && cols && cols.indexOf(col) < 0) {
        tr.dataset.low = "";
        tr.querySelector(".val").value = "";
        tr.querySelector("input[role=combobox]").value = "";
        how.innerHTML = '<span class="badge warn">нет колонки «' + esc(col) + '» · ' + scoreTxt + '</span>';
        return;
      }
      tr.querySelector(".val").value = col;
      tr.querySelector("input[role=combobox]").value = col;
      if (!col) {
        tr.dataset.low = "";
        how.innerHTML = '<span class="badge warn">ручное · ' + scoreTxt + "</span>";
      } else {
        var method = String(m.method || "");
        var isOk = !!OK_METHODS[method.toLowerCase()];
        var lowScore = score < MANUAL;
        tr.dataset.low = lowScore ? "1" : "";
        if (lowScore) {
          how.innerHTML = '<span class="badge warn">' + esc(method) + ' · ' + scoreTxt + ' (низкий)</span>';
        } else {
          var cls = isOk ? "ok" : "";
          var isRef = refCols && refCols[col];
          how.innerHTML = '<span class="badge ' + cls + '">' + esc(method) + ' · ' + scoreTxt +
            (isRef ? " · ref" : "") + '</span>';
        }
      }
    });
    markManual();
  }

  // ---- собрать секцию fields конфига из подтверждённой таблицы ----
  // needsRef — ref-колонки, для которых сущность ещё нужно проставить (не пишем заглушки в конфиг)
  function buildConfigFields(refCols) {
    var fields = {}, manual = [], needsRef = [];
    Array.prototype.forEach.call(d.querySelectorAll("#mapBody tr"), function (tr) {
      var name = tr.dataset.name, col = (tr.querySelector(".val") || {}).value || "";
      if (!col) { manual.push(name); return; }
      var spec = { column: col };
      if (refCols && refCols[col]) {
        spec.ref = { entity: "", by: "key", missing: "skip" };
        needsRef.push({ field: name, column: col });
      }
      fields[name] = spec;
    });
    return { fields: fields, manual: manual, needsRef: needsRef };
  }

  // ---- блокировка кнопок на время запроса ----
  var busy = false;
  function setBusy(on) {
    busy = on;
    ["aiBtn", "runBtn", "checkBtn", "dryBtn"].forEach(function (id) {
      var b = d.getElementById(id);
      if (b) b.disabled = !!on;
    });
  }

  // ---- главный обработчик кнопки «Подобрать соответствие» ----
  var CURRENT = { cols: [], refCols: {} };
  function runSuggest(entity) {
    if (busy) return;
    var hint = d.getElementById("mapHint");
    var tableId = TABLES[entity];
    if (!tableId) { if (hint) hint.textContent = "не задан table_id для «" + entity + "»"; return; }
    if (hint) hint.textContent = "Читаю колонки базы и подбираю соответствие…";
    setBusy(true);
    var meta;
    loadColumns(tableId)
      .then(function (m) { meta = m; CURRENT = { cols: m.names, refCols: m.refCols }; return getSourceFields(entity); })
      .then(function (source) {
        renderRows(source, meta.names);
        return suggest(source, meta.names).then(function (res) {
          applyMatches(res.matches, meta.refCols, meta.names);
        });
      })
      .then(function () { if (hint) hint.textContent = "Подобрано. Проверьте жёлтые строки, поправьте комбобоксом и запускайте."; })
      .catch(function (e) { if (hint) hint.textContent = "Ошибка: " + errMsg(e); })
      .then(function () { setBusy(false); });
  }

  // ---- запуск коннектора через b24ig.php (тот же домен, CORS не нужен) ----
  // mode: "" (рабочий) | "check" (проверка схем) | "dry_run" (пробный)
  function run(mode) {
    if (busy) return;
    var out = d.getElementById("result");
    var url = "/b24ig.php?db=" + encodeURIComponent(DB) + "&config=" + encodeURIComponent(CONFIG) +
      "&JSON" + (mode ? "&" + mode : "");
    if (out) { out.style.display = "block"; out.innerHTML = '<div class="bar">Запуск…</div>'; }
    setBusy(true);
    return fetchTO(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (rep) { renderRun(rep, mode); })
      .catch(function (e) { if (out) out.innerHTML = '<div class="bar" style="color:var(--color-error)">Ошибка: ' + esc(errMsg(e)) + "</div>"; })
      .then(function () { setBusy(false); });
  }

  function renderRun(rep, mode) {
    var out = d.getElementById("result"); if (!out) return;
    var ok = rep.ok && (!rep.errors || !rep.errors.length);
    var head = ok ? '<span class="ok">Готово · ошибок нет</span>' :
      (rep.busy ? '<span class="badge warn">уже выполняется</span>' :
        '<span style="color:var(--color-error)">Есть ошибки</span>');
    var rows = "";
    Object.keys(rep.entities || {}).forEach(function (name) {
      var e = rep.entities[name] || {};
      rows += "<tr><td>" + esc(name) + "</td><td>получено " + num(e.fetched) + ", строк " + num(e.rows) +
        " (новых " + num(e.new) + ", существ. " + num(e.existing) + ")</td><td>ссылок " + num(e.refs_set) +
        (e.manual_binding ? ", ручных " + num(e.manual_binding) : "") + "</td></tr>";
    });
    var errs = (rep.errors || []).map(function (er) {
      return '<div style="color:var(--color-error)">ОШИБКА [' + esc(er.kind || "") + "] " + esc(er.entity || "") + ": " + esc(er.message || "") + "</div>";
    }).join("");
    out.innerHTML = '<div class="bar"><span class="dot"></span>' + head +
      (mode ? ' <span class="badge">' + esc(mode) + "</span>" : "") + "</div>" +
      (rows ? '<table class="res"><tr><th>Таблица</th><th>Загружено</th><th>Связи</th></tr>' + rows + "</table>" : "") + errs;
  }

  // экспорт для шаблона
  w.Connector = {
    runSuggest: runSuggest,
    run: run,
    buildConfigFields: function () { return buildConfigFields(CURRENT.refCols); },
    loadColumns: loadColumns,
    suggest: suggest
  };

  d.addEventListener("DOMContentLoaded", function () {
    var sel = d.getElementById("entities");
    function ent() { return sel ? sel.value : (Object.keys(TABLES)[0] || ""); }
    var b;
    if ((b = d.getElementById("aiBtn"))) b.onclick = function () { runSuggest(ent()); };
    if ((b = d.getElementById("runBtn"))) b.onclick = function () { run(""); };
    if ((b = d.getElementById("checkBtn"))) b.onclick = function () { run("check"); };
    if ((b = d.getElementById("dryBtn"))) b.onclick = function () { run("dry_run"); };
  });
})(window, document);
