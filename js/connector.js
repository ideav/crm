/*
 * connector.js — рабочее место «Коннектор» (Битрикс24 / 1С → Интеграм).
 * Развёртывание: js/connector.js, подключается из templates/connector.html:
 *     <script src="/js/connector.js?2"></script>
 *
 * Подбор соответствия полей: браузер → b24ig.php?action=match (тот же домен) → эмбеддер.
 * Адрес эмбеддера — matcher.url конфига базы, токен — EMBED_TOKEN в secrets.json; в браузер не отдаются,
 * в БД не хранятся. Браузер напрямую к эмбеддеру не ходит (CORS не нужен).
 *
 * Всё, что зависит от базы, берётся из конфига базы (#5015) —
 * templates/custom/<база>/connector/<имя>.json, того же файла, что читает b24ig.php:
 *   имя конфига   — ?config=<имя> в URL; иначе листинг connector/ (один — берём, несколько — выбор);
 *   сущности      — entities.<имя>.target.table_id / target.table;
 *   поля источника— ключи entities.<имя>.fields (производные «X@y» не показываем).
 * Конфиг читается и сохраняется через dir_admin (сессия + _xsrf, право WRITE на файлы).
 * «Проверить / Пробный / Запустить» при несохранённых правках сначала сохраняют конфиг.
 *
 * Шаблон задаёт (инжектится ядром):
 *   window.CONNECTOR_DB   — имя базы ({_global_.z})
 *   window.CONNECTOR_XSRF — XSRF-токен ({_global_.xsrf})
 * Необязательные переопределения (отладка): CONNECTOR_CONFIG,
 *   CONNECTOR_TABLES { "<сущность>": <table_id> }, CONNECTOR_SOURCE_FIELDS { "<сущность>": [[name,label],...] }.
 *
 * DOM (как в connector.html): #configSel, #entities, #aiBtn, #saveBtn, #mapBody, #mapHint,
 *   #checkBtn, #dryBtn, #runBtn, #result.
 */
(function (w, d) {
  "use strict";

  var DB = w.CONNECTOR_DB || "";
  var XSRF = w.CONNECTOR_XSRF || "";
  var CONFIG = urlParam("config") || w.CONNECTOR_CONFIG || "";   // имя конфига в базе (без .json)
  var TABLES = w.CONNECTOR_TABLES || {};
  var TABLES_FROM_CFG = !w.CONNECTOR_TABLES;
  var CFG_DIR = "/connector";                   // каталог конфигов в templates/custom/<база>
  var MANUAL = 0.60;                            // порог: score ниже — просить подтверждение
  var FETCH_TIMEOUT = 30000;
  var OK_METHODS = { "точное": 1, "словарь": 1, "exact": 1, "dict": 1, "dictionary": 1 };

  var CFG = null;        // разобранный конфиг базы
  var CFG_TEXT = "";     // его исходный текст (для резервной копии)

  // ---- утилиты ----
  function urlParam(name) {
    try {
      var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(w.location.search);
      return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
    } catch (e) { return ""; }
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
  function setHint(t) {
    var hint = d.getElementById("mapHint");
    if (hint) hint.textContent = t;
  }
  function plainText(html) {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\[(RU|EN)\]/g, " ").replace(/\s+/g, " ").trim();
  }
  function stamp() {
    var t = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + "-" + p(t.getHours()) + p(t.getMinutes()) + p(t.getSeconds());
  }

  function fetchTO(url, extra) {
    var opts = { credentials: "same-origin" };
    for (var k in extra || {}) opts[k] = extra[k];
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

  // ---- конфиг базы через dir_admin ----
  function dirAdminUrl(extra) {
    return "/" + DB + "/dir_admin/?templates=1&add_path=" + CFG_DIR + (extra || "");
  }

  // Листинг connector/: ссылки «…&add_path=/connector&gf=<имя>» (разметка templates/dir_admin.html).
  // Если каталога нет, dir_admin показывает корень — там add_path пустой, и такие ссылки не берём.
  function listConfigs() {
    return fetchTO(dirAdminUrl(""))
      .then(function (r) { if (!r.ok) throw new Error("листинг конфигов: HTTP " + r.status); return r.text(); })
      .then(function (html) {
        var out = [], re = /add_path=\/connector&(?:amp;)?gf=([^"'&<>\s]+)/g, m;
        while ((m = re.exec(String(html)))) {
          var name = decodeURIComponent(m[1]);
          if (!/\.json$/i.test(name) || /^secrets\.json$/i.test(name)) continue;
          name = name.replace(/\.json$/i, "");
          if (out.indexOf(name) < 0) out.push(name);
        }
        return out;
      });
  }

  function readConfig(name) {
    return fetchTO(dirAdminUrl("&gf=" + encodeURIComponent(name + ".json")))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (t) {
        var cfg;
        try { cfg = JSON.parse(t); } catch (e) { throw new Error(plainText(t).slice(0, 160) || "не JSON"); }
        if (!cfg || typeof cfg !== "object") throw new Error("не объект");
        return { cfg: cfg, text: t };
      })
      .catch(function (e) { throw new Error("конфиг «" + name + "» не прочитан: " + errMsg(e)); });
  }

  function uploadConfigFile(fileName, text, rewrite) {
    var fd = new FormData();
    fd.append("_xsrf", XSRF);
    fd.append("templates", "1");
    fd.append("add_path", CFG_DIR);
    fd.append("upload", "1");
    if (rewrite) fd.append("rewrite", "1");
    fd.append("userfile", new Blob([text], { type: "application/json" }), fileName);
    return fetch("/" + DB + "/dir_admin/?JSON=1", { method: "POST", credentials: "same-origin", body: fd })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (!j || !j.ok) throw new Error("«" + fileName + "» не сохранён: " + (plainText(t).slice(0, 200) || "пустой ответ"));
      });
  }

  function cfgEntity(name) {
    return CFG && CFG.entities && CFG.entities[name] || null;
  }

  function applyConfig(cfg) {
    CFG = cfg;
    if (TABLES_FROM_CFG) {
      TABLES = {};
      Object.keys(cfg.entities || {}).forEach(function (k) {
        var t = cfg.entities[k] && cfg.entities[k].target;
        if (t && t.table_id) TABLES[k] = t.table_id;
      });
      var sel = d.getElementById("entities");
      if (sel) {
        sel.innerHTML = Object.keys(TABLES).map(function (k) {
          var label = (cfg.entities[k].target && cfg.entities[k].target.table) || k;
          return '<option value="' + esc(k) + '">' + esc(label) + "</option>";
        }).join("");
        sel.value = Object.keys(TABLES)[0] || "";
      }
    }
  }

  function fillConfigSelect(names) {
    var sel = d.getElementById("configSel");
    if (!sel) return;
    sel.innerHTML = names.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + "</option>";
    }).join("");
    sel.value = CONFIG;
    var box = d.getElementById("configBox");
    if (box) box.style.display = names.length > 1 ? "" : "none";
  }

  function loadConfig(name) {
    CONFIG = name;
    return readConfig(name).then(function (r) {
      CFG_TEXT = r.text;
      applyConfig(r.cfg);
      setHint("Конфиг «" + name + "». Выберите сущность и нажмите «Подобрать соответствие».");
    });
  }

  function initConfig() {
    var names = CONFIG ? Promise.resolve([CONFIG]) : listConfigs();
    return names
      .then(function (list) {
        if (!list.length) throw new Error("в templates/custom/" + DB + "/connector/ нет конфига (*.json) — положите его через «Файлы сервера»");
        if (!CONFIG) CONFIG = list[0];
        fillConfigSelect(list);
        return loadConfig(CONFIG);
      })
      .catch(function (e) { setHint("Конфиг: " + errMsg(e)); });
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
  // Переопределение window.CONNECTOR_SOURCE_FIELDS; иначе — ключи fields сущности из конфига.
  function getSourceFields(entity) {
    var sf = w.CONNECTOR_SOURCE_FIELDS || {};
    if (sf[entity]) return Promise.resolve(sf[entity]);
    var ent = cfgEntity(entity);
    if (ent && ent.fields) {
      var list = Object.keys(ent.fields).filter(function (k) { return k.indexOf("@") < 0; })
        .map(function (k) { return [k, ent.fields[k].label || ""]; });
      if (list.length) return Promise.resolve(list);
    }
    return Promise.reject(new Error("нет полей источника для «" + entity + "» — опишите их в fields конфига"));
  }

  // текущая колонка поля по конфигу
  function configColumn(entity, field) {
    var ent = cfgEntity(entity);
    var f = ent && ent.fields && ent.fields[field];
    return f && f.column ? String(f.column) : "";
  }

  // ---- вызов эмбеддера через b24ig.php (адрес и токен — в конфиге/secrets базы на сервере) ----
  function suggest(source, columns) {
    if (!CONFIG) return Promise.reject(new Error("не выбран конфиг коннектора"));
    var url = "/b24ig.php?action=match&db=" + encodeURIComponent(DB) + "&config=" + encodeURIComponent(CONFIG);
    return fetchTO(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: source, target: columns })
    })
      .then(function (r) {
        return r.text().then(function (t) {
          var m = null;
          try { m = JSON.parse(t); } catch (e) {}
          if (!r.ok) throw new Error("эмбеддер: HTTP " + r.status + (m && m.error ? " — " + m.error : ""));
          if (!m) throw new Error("эмбеддер: неожиданный ответ");
          if (m.error) throw new Error("эмбеддер: " + m.error);
          return m; // {matches, fields, manual}
        });
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

  function buildCombobox(tr, td, cols, value) {
    td.innerHTML =
      '<div class="cbx"><input type="text" role="combobox" autocomplete="off" value="' + esc(value || "") +
      '" placeholder="колонка базы…"><input type="hidden" class="val" value="' + esc(value || "") +
      '"><div class="list"></div></div>';
    var box = td.querySelector(".cbx"), inp = box.querySelector("input[role=combobox]"),
        hid = box.querySelector(".val"), list = box.querySelector(".list");
    // выбор человеком подтверждает строку: пометка «низкий» снимается
    function choose(col) {
      hid.value = col;
      tr.dataset.low = "";
      markManual();
    }
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
          inp.value = el.textContent;
          closeList(); choose(el.textContent);
        };
      });
    }
    inp.addEventListener("focus", function () { closeList(); render(inp.value); list.classList.add("show"); openList = list; });
    inp.addEventListener("input", function () {
      render(inp.value); list.classList.add("show"); openList = list;
      var typed = String(inp.value).trim();
      if (cols.indexOf(typed) >= 0) choose(typed);   // точное имя колонки, набранное руками
      else { hid.value = ""; markManual(); }
    });
  }

  function markManual() {
    Array.prototype.forEach.call(d.querySelectorAll("#mapBody tr"), function (tr) {
      var hid = tr.querySelector(".val");
      var empty = !hid || !hid.value;
      var low = tr.dataset.low === "1";
      tr.classList.toggle("row-manual", empty || low);
    });
  }

  // current: { поле: колонка } — что стоит в конфиге сейчас
  function renderRows(source, cols, current) {
    var body = d.getElementById("mapBody"); body.innerHTML = "";
    current = current || {};
    source.forEach(function (f) {
      var tr = d.createElement("tr");
      tr.dataset.name = f[0];
      var col = current[f[0]] || "";
      tr.innerHTML = '<td><b>' + esc(f[0]) + '</b>' + (f[1] ? '<div class="tr-sel">«' + esc(f[1]) + '»</div>' : "") +
        '</td><td class="arrow">→</td><td class="col"></td><td class="how">' +
        (col ? '<span class="badge">из конфига</span>' : '<span class="badge warn">ручное</span>') + "</td>";
      body.appendChild(tr);
      buildCombobox(tr, tr.querySelector(".col"), cols, col);
    });
    markManual();
  }

  function applyMatches(matches, refCols, cols) {
    var byName = {}; (matches || []).forEach(function (m) { byName[m.field] = m; });
    Array.prototype.forEach.call(d.querySelectorAll("#mapBody tr"), function (tr) {
      var how = tr.querySelector(".how");
      var m = byName[tr.dataset.name];
      var keep = configColumn(CURRENT.entity, tr.dataset.name);   // без подсказки остаётся колонка из конфига
      function setCol(v) {
        tr.querySelector(".val").value = v;
        tr.querySelector("input[role=combobox]").value = v;
      }
      if (!m) {
        tr.dataset.low = "";
        setCol(keep);
        how.innerHTML = keep ? '<span class="badge">из конфига</span>' : '<span class="badge warn">ручное</span>';
        return;
      }
      var col = m.column || "";
      var score = m.score || 0;
      var scoreTxt = score.toFixed(2);
      if (col && cols && cols.indexOf(col) < 0) {
        tr.dataset.low = "";
        setCol(keep);
        how.innerHTML = '<span class="badge warn">нет колонки «' + esc(col) + '» · ' + scoreTxt + '</span>';
        return;
      }
      setCol(col || keep);
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

  // ---- таблица на экране → fields сущности в конфиге ----
  // Существующие поля правятся на месте: transform/ref/прочие ключи сохраняются, производные «X@y»
  // не трогаются. Пустая колонка — поле не грузится (ключ удаляется). Ref-колонка без известной
  // сущности (ref.entity) в конфиг не пишется: она попадает в blocked.
  function mergeFields(entity) {
    var ent = cfgEntity(entity);
    if (!ent) return null;
    var old = ent.fields || {};
    var next = JSON.parse(JSON.stringify(old)), blocked = [];
    Array.prototype.forEach.call(d.querySelectorAll("#mapBody tr"), function (tr) {
      var name = tr.dataset.name, col = (tr.querySelector(".val") || {}).value || "";
      if (!col) { delete next[name]; return; }
      var spec = next[name] || {};
      spec.column = col;
      if (CURRENT.refCols[col] && !(spec.ref && spec.ref.entity)) blocked.push(name + " → " + col);
      next[name] = spec;
    });
    return { fields: next, blocked: blocked, changed: JSON.stringify(next) !== JSON.stringify(old) };
  }

  // Сохранить соответствие в конфиг базы. → true (сохранено) | false (нечего сохранять)
  function saveMapping() {
    if (!CFG) return Promise.reject(new Error("конфиг базы не загружен"));
    var m = mergeFields(CURRENT.entity);
    if (!m) return Promise.resolve(false);
    if (m.blocked.length) {
      return Promise.reject(new Error("ссылочные колонки без сущности: " + m.blocked.join(", ") +
        " — пропишите ref.entity у этих полей в конфиге"));
    }
    if (!m.changed) return Promise.resolve(false);
    var next = JSON.parse(JSON.stringify(CFG));
    next.entities[CURRENT.entity].fields = m.fields;
    var text = JSON.stringify(next, null, 2) + "\n";
    return uploadConfigFile(CONFIG + ".json." + stamp() + ".bak", CFG_TEXT, false)
      .then(function () { return uploadConfigFile(CONFIG + ".json", text, true); })
      .then(function () { CFG = next; CFG_TEXT = text; return true; });
  }

  // ---- блокировка кнопок на время запроса ----
  var busy = false;
  function setBusy(on) {
    busy = on;
    ["aiBtn", "saveBtn", "runBtn", "checkBtn", "dryBtn"].forEach(function (id) {
      var b = d.getElementById(id);
      if (b) b.disabled = !!on;
    });
  }

  // ---- таблица соответствия сущности: колонки базы + поля источника ----
  var CURRENT = { entity: "", cols: [], refCols: {} };
  function prepareRows(entity) {
    var tableId = TABLES[entity];
    if (!tableId) return Promise.reject(new Error("не задан table_id для «" + entity + "»"));
    var meta;
    return loadColumns(tableId)
      .then(function (m) { meta = m; return getSourceFields(entity); })
      .then(function (source) {
        CURRENT = { entity: entity, cols: meta.names, refCols: meta.refCols };
        var current = {};
        source.forEach(function (f) { current[f[0]] = configColumn(entity, f[0]); });
        // «@name» — главное значение записи: выбирается вручную, в подбор не идёт
        var cols = CFG ? ["@name"].concat(meta.names) : meta.names;
        renderRows(source, cols, current);
        return { source: source, meta: meta };
      });
  }

  function showCurrent(entity) {
    if (busy || !CFG) return;
    setHint("Читаю колонки базы…");
    setBusy(true);
    prepareRows(entity)
      .then(function () { setHint("Соответствие из конфига «" + CONFIG + "». Поправьте или подберите AI."); })
      .catch(function (e) { setHint("Ошибка: " + errMsg(e)); })
      .then(function () { setBusy(false); });
  }

  // ---- главный обработчик кнопки «Подобрать соответствие» ----
  function runSuggest(entity) {
    if (busy) return;
    if (!TABLES[entity]) { setHint("не задан table_id для «" + entity + "»"); return; }
    setHint("Читаю колонки базы и подбираю соответствие…");
    setBusy(true);
    prepareRows(entity)
      .then(function (p) {
        return suggest(p.source, p.meta.names).then(function (res) {
          applyMatches(res.matches, p.meta.refCols, p.meta.names);
        });
      })
      .then(function () { setHint("Подобрано. Проверьте жёлтые строки, поправьте комбобоксом и сохраните."); })
      .catch(function (e) { setHint("Ошибка: " + errMsg(e)); })
      .then(function () { setBusy(false); });
  }

  function runSave() {
    if (busy) return;
    setBusy(true);
    return saveMapping()
      .then(function (saved) { setHint(saved ? "Соответствие сохранено в конфиг «" + CONFIG + "»." : "Изменений нет."); })
      .catch(function (e) { setHint("Не сохранено: " + errMsg(e)); })
      .then(function () { setBusy(false); });
  }

  // ---- запуск коннектора через b24ig.php (тот же домен, CORS не нужен) ----
  // mode: "" (рабочий) | "check" (проверка схем) | "dry_run" (пробный)
  // Несохранённое соответствие сначала уходит в конфиг: запуск идёт по тому, что на экране.
  function run(mode) {
    if (busy) return;
    var out = d.getElementById("result");
    var url = "/b24ig.php?db=" + encodeURIComponent(DB) + "&config=" + encodeURIComponent(CONFIG) +
      "&JSON" + (mode ? "&" + mode : "");
    if (out) { out.style.display = "block"; out.innerHTML = '<div class="bar">Запуск…</div>'; }
    setBusy(true);
    var pre = CFG && cfgEntity(CURRENT.entity) ? saveMapping() : Promise.resolve(false);
    return pre
      .then(function () { return fetchTO(url); })
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
    save: runSave,
    buildConfigFields: function () { return buildConfigFields(CURRENT.refCols); },
    loadColumns: loadColumns,
    suggest: suggest
  };

  d.addEventListener("DOMContentLoaded", function () {
    var sel = d.getElementById("entities");
    function ent() { return sel ? sel.value : (Object.keys(TABLES)[0] || ""); }
    var b;
    if ((b = d.getElementById("aiBtn"))) b.onclick = function () { runSuggest(ent()); };
    if ((b = d.getElementById("saveBtn"))) b.onclick = function () { runSave(); };
    if ((b = d.getElementById("runBtn"))) b.onclick = function () { run(""); };
    if ((b = d.getElementById("checkBtn"))) b.onclick = function () { run("check"); };
    if ((b = d.getElementById("dryBtn"))) b.onclick = function () { run("dry_run"); };
    if (sel) sel.onchange = function () { showCurrent(ent()); };
    var cs = d.getElementById("configSel");
    if (cs) cs.onchange = function () {
      if (busy) return;
      CFG = null;
      d.getElementById("mapBody").innerHTML = "";
      loadConfig(cs.value).catch(function (e) { setHint("Конфиг: " + errMsg(e)); });
    };
    initConfig();
  });
})(window, document);
