
// ── AI helper: formula or report described in words (issue #5583) ───────────
// The user describes what to compute; the database's AI agent (/ai/agent,
// under the user's session) only PROPOSES a JSON description. The browser
// checks it — formula by the button-action evaluator, report columns against
// metadata?JSON of the user's role (fields the role cannot see are absent
// there) — shows it, and applies it with the user's own requests only after
// "Применить". A plan the agent queues despite the instruction is cancelled.

const IntegramAiHelper = (function () {
    const BA = typeof IntegramButtonAction !== 'undefined' ? IntegramButtonAction : null;
    const FUNCS = { SUM: 'SUM', COUNT: 'COUNT', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', GROUP_CONCAT: 'GROUP_CONCAT', ABN_ID: 'abn_ID' };
    const TOTALS = ['SUM', 'COUNT'];
    const BASE_TYPES = { 3: 'строка', 8: 'строка', 12: 'текст', 9: 'дата', 4: 'дата и время', 13: 'целое число', 14: 'число', 11: 'да/нет', 10: 'файл', 7: 'кнопка' };
    const SQL_FORBIDDEN = /\b(SELECT|FROM|TABLE|INSERT|UPDATE|DELETE|DROP|ALTER|UNION|INTO|SLEEP|BENCHMARK|LOAD_FILE)\b|;|--|\/\*|#/i;
    const ALIAS_RE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$/;

    /**
     * JSON object of the agent's answer: the LAST ```json block (the agent sometimes
     * corrects itself with a second one), else the whole text, else an embedded {...}.
     */
    function extractJson(content) {
        const s = String(content || '');
        const tryParse = (t) => {
            try {
                const v = JSON.parse(t);
                return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
            } catch (e) { return undefined; }
        };
        const fences = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/gi) || [];
        for (const f of fences.slice().reverse()) {
            const body = f.replace(/^```(?:json)?\s*\n?/i, '').replace(/```$/, '').trim();
            const v = tryParse(body);
            if (v !== undefined) return v;
        }
        const whole = tryParse(s.trim());
        if (whole !== undefined) return whole;
        // Embedded object: scan balanced braces, skipping strings
        for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
            let depth = 0, inStr = false;
            for (let i = start; i < s.length; i++) {
                const c = s[i];
                if (inStr) {
                    if (c === '\\') i++;
                    else if (c === '"') inStr = false;
                    continue;
                }
                if (c === '"') inStr = true;
                else if (c === '{') depth++;
                else if (c === '}' && --depth === 0) {
                    const v = tryParse(s.slice(start, i + 1));
                    if (v) return v;
                    break;
                }
            }
        }
        return null;
    }

    const READ_ONLY = 'Ничего не меняй в базе: не выполняй ig POST и не составляй план — ' +
        'изменения применит пользователь сам после проверки. Данные можно читать (ig GET), если нужно.';

    function quoteList(names) {
        return names.map(n => `«${ n }»`).join(', ');
    }

    /** Request to the agent: a formula for a new column of the table. */
    function buildFormulaMessage(o) {
        return [
            `Помощник формул. Пользователь хочет добавить в таблицу «${ o.table }» колонку, которая считается по полям строки.`,
            `Описание пользователя: «${ String(o.text || '').trim() }».`,
            `Колонки строки, доступные пользователю: ${ quoteList(o.columns || []) }. Другие поля не используй.`,
            'Синтаксис формулы (это не JavaScript и не SQL): поле строки — {Название колонки}, [ID] — id записи, ' +
                '[VAL] — первая колонка; числа, строки в двойных кавычках, + - * / %, & — склейка, ' +
                'сравнения = != < <= > >=, && || !, условие a ? b : c; функции ROUND(x,n) FLOOR CEIL ABS MIN MAX ' +
                'SUM AVG NUM IF(усл,да,нет) LEN UPPER LOWER TRIM LEFT(s,n) RIGHT(s,n) CONCAT TODAY() DAYS(до,от) ' +
                'ADDDAYS(дата,n); даты — ДД.ММ.ГГГГ.',
            READ_ONLY,
            'Ответь ТОЛЬКО одним блоком ```json с объектом {"name":"имя новой колонки","formula":"формула",' +
                '"explain":"одной фразой, что считает"}. Если по этим колонкам посчитать нельзя — ' +
                '{"error":"почему и каких данных не хватает"}.'
        ].join('\n');
    }

    /**
     * Sources a report column may use: tables and their fields from metadata?JSON
     * of the current user (fields hidden from the role are not in it).
     */
    function sourcesFromMetadata(meta) {
        const out = [];
        (Array.isArray(meta) ? meta : []).forEach((t) => {
            if (!t || t.id === undefined) return;
            const table = String(t.val || t.value || t.name || t.id);
            out.push({ id: String(t.id), table, label: table, kind: 'таблица (главное значение записи)' });
            (Array.isArray(t.reqs) ? t.reqs : []).forEach((r) => {
                if (!r || r.id === undefined) return;
                const name = String(r.val || r.value || r.name || r.id);
                const kind = r.ref_id || r.ref ? 'ссылка' : (BASE_TYPES[String(r.type)] || '');
                out.push({ id: String(r.id), table, label: `${ table } → ${ name }`, kind });
            });
        });
        return out;
    }

    /** Request to the agent: a report definition over the allowed sources. */
    function buildReportMessage(o) {
        const sources = (o.sources || []).slice(0, 400);
        const first = o.table ? sources.filter(s => s.table === o.table) : [];
        const rest = sources.filter(s => first.indexOf(s) === -1);
        const lines = first.concat(rest).map(s => `${ s.id }: ${ s.label }${ s.kind ? ` (${ s.kind })` : '' }`);
        return [
            'Помощник отчётов. Пользователь описал словами отчёт (запрос) базы Интеграм' +
                (o.table ? `; он сейчас в таблице «${ o.table }»` : '') + '.',
            `Описание пользователя: «${ String(o.text || '').trim() }».`,
            'Источники колонок — ТОЛЬКО из этого списка (id: таблица → поле); других полей пользователю не видно:',
            lines.join('\n'),
            'Отчёт — список колонок. Первая колонка задаёт главную таблицу (её source — id таблицы или её поля). ' +
                'Соединения таблиц и GROUP BY ядро строит само: группировка по всем видимым колонкам без func.',
            'Поля колонки: source — id из списка или 0 для вычисляемой; name — имя в отчёте (без пробелов лучше); ' +
                'alias — псевдоним одним словом (на него ссылаются формулы); formula — SQL-выражение только у source 0, ' +
                'поля в нём — псевдонимами (например месяц даты: DATE_FORMAT(дата,\'%Y-%m\')); SELECT/FROM нельзя; ' +
                'func — SUM, COUNT, AVG, MIN, MAX, GROUP_CONCAT или abn_ID; from/to — фильтр значения от/до ' +
                '(текущий год у даты: from "1.1", to "31.12"; "[TODAY]", "%" — непусто); hidden — true, если колонка ' +
                'только для фильтра или псевдонима; sort — 1, 2… (минус — по убыванию); total — SUM или COUNT (итог).',
            READ_ONLY,
            'Имена колонок (name) не повторяются. Сначала проверь вариант сам, затем ' +
                'ответь ТОЛЬКО одним блоком ```json с объектом {"name":"имя отчёта","explain":"одной фразой, что ' +
                'покажет","columns":[{"source":123,"name":"…","alias":"…","func":"SUM"}]}. Если из доступных полей ' +
                'отчёт не собрать — {"error":"почему"}.'
        ].join('\n');
    }

    /** Syntax and column check of a formula; division by zero is a data issue, not an error. */
    function checkFormula(formula, columns) {
        const src = String(formula || '').trim();
        if (!src) return { ok: false, error: 'Формула пустая' };
        if (!BA) return { ok: false, error: 'Вычислитель формул не загружен' };
        const fields = {};
        (columns || []).forEach((n) => { fields[n] = '1'; });
        try {
            BA.formatResult(BA.evalFormula(src, { id: 1, val: '1', fields }));
        } catch (e) {
            if (!/Деление на ноль/.test(e.message)) return { ok: false, error: e.message };
        }
        return { ok: true };
    }

    /** Button action for the proposed formula: computed on display, or stored on create/update. */
    function formulaAction(p, store) {
        const cfg = { type: 'formula', formula: String(p.formula || '').trim(), label: p.label ? String(p.label) : '' };
        if (store) { cfg.write = true; cfg.on = ['CREATE', 'UPDATE', 'READ']; }
        else { cfg.write = false; cfg.on = ['READ']; cfg.recompute = true; }
        return BA.toAction(cfg);
    }

    function str(v, max) {
        const s = v === undefined || v === null ? '' : String(v).trim();
        if (s.length > max) throw new Error(`слишком длинное значение «${ s.slice(0, 40) }…»`);
        return s;
    }

    /** One proposed column → normalized column, or throws with the reason. */
    function normalizeColumn(c, idx, allowed) {
        if (!c || typeof c !== 'object') throw new Error('колонка не описана');
        const source = str(c.source === undefined ? 0 : c.source, 20) || '0';
        if (!/^\d+$/.test(source)) throw new Error(`источник «${ source }» — не id`);
        const col = { source, name: str(c.name, 100) };
        if (source === '0') {
            if (idx === 0) throw new Error('первая колонка должна брать таблицу или её поле, а не формулу');
            const formula = str(c.formula, 1000);
            if (!formula) throw new Error(`у вычисляемой колонки «${ col.name }» нет формулы`);
            if (SQL_FORBIDDEN.test(formula)) throw new Error(`в формуле «${ col.name }» недопустимые слова SQL`);
            col.formula = formula;
        } else {
            if (!allowed.has(source)) throw new Error(`поле ${ source } недоступно вашей роли или не существует`);
            const alias = str(c.alias !== undefined ? c.alias : c.formula, 60);
            if (alias && !ALIAS_RE.test(alias)) throw new Error(`псевдоним «${ alias }» — должно быть одно слово`);
            if (alias) col.alias = alias;
        }
        const fn = str(c.func, 20);
        if (fn) {
            const canon = FUNCS[fn.toUpperCase()];
            if (!canon) throw new Error(`функция «${ fn }» не поддерживается`);
            col.func = canon;
        }
        const total = str(c.total, 10).toUpperCase();
        if (total) {
            if (TOTALS.indexOf(total) === -1) throw new Error(`итог «${ total }» не поддерживается`);
            col.total = total;
        }
        const from = str(c.from, 200), to = str(c.to, 200);
        if (from) col.from = from;
        if (to) col.to = to;
        if (c.hidden === true || c.hidden === 1 || c.hidden === '1') col.hidden = true;
        if (c.sort !== undefined && c.sort !== null && c.sort !== '' && c.sort !== 0) {
            const sort = Number(c.sort);
            if (!Number.isInteger(sort) || Math.abs(sort) > 20) throw new Error(`сортировка «${ c.sort }» — целое число`);
            col.sort = sort;
        }
        return col;
    }

    /** Proposed report → {ok, report} with columns limited to the role's sources, or {ok:false, error}. */
    function validateReport(p, sources) {
        try {
            if (!p || typeof p !== 'object') throw new Error('ИИ не описал отчёт');
            const name = str(p.name, 120);
            if (!name) throw new Error('у отчёта нет имени');
            const cols = Array.isArray(p.columns) ? p.columns : [];
            if (!cols.length) throw new Error('в отчёте нет колонок');
            if (cols.length > 40) throw new Error('больше 40 колонок');
            const allowed = new Set((sources || []).map(s => String(s.id)));
            const columns = cols.map((c, i) => normalizeColumn(c, i, allowed));
            const seen = new Set();
            columns.forEach((c) => {
                const key = c.name.toLowerCase();
                if (key && seen.has(key)) throw new Error(`две колонки с именем «${ c.name }»`);
                if (key) seen.add(key);
            });
            return { ok: true, report: { name, explain: str(p.explain, 500), columns } };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    /** Fields of a report column record (table 28), see docs/kb/report-building.md. */
    function reportColumnFields(c) {
        const f = { t28: c.source };
        if (c.name) f.t100 = c.name;
        if (c.formula || c.alias) f.t101 = c.formula || c.alias;
        if (c.from) f.t102 = c.from;
        if (c.to) f.t103 = c.to;
        if (c.func) f.t104 = c.func;
        if (c.total) f.t72 = c.total;
        if (c.hidden) f.t107 = '1';
        if (c.sort) f.t109 = String(c.sort);
        return f;
    }

    function newConversationId() {
        let s = '';
        for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
    }

    return { extractJson, buildFormulaMessage, buildReportMessage, sourcesFromMetadata, checkFormula, formulaAction, validateReport, reportColumnFields, newConversationId };
})();

if (typeof window !== 'undefined') window.IntegramAiHelper = IntegramAiHelper;

if (typeof IntegramTable !== 'undefined') {
    IntegramTable.AiHelper = IntegramAiHelper;

    Object.assign(IntegramTable.prototype, {
        /** POST to the core with _xsrf; returns parsed JSON or throws the core's error. */
        async aiHelperPost(path, fields) {
            const params = new URLSearchParams();
            params.append('_xsrf', this.getButtonActionXsrf());
            Object.keys(fields || {}).forEach(k => params.append(k, fields[k]));
            const resp = await fetch(`${ this.getApiBase() }/${ path }`, {
                method: 'POST', body: params.toString(), credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const text = await resp.text();
            let data = null;
            try { data = JSON.parse(text); } catch (e) { /* error page */ }
            const err = Array.isArray(data) ? (data[0] && data[0].error) : (data && data.error);
            if (!resp.ok || !data || err) throw new Error(err || text.slice(0, 200) || `HTTP ${ resp.status }`);
            return data;
        },

        /**
         * Ask the agent for a proposal; returns the JSON object of its answer.
         * Runs in its own conversation so the user's chat session is not mixed in.
         */
        async askAiHelper(message, context) {
            const AH = IntegramAiHelper;
            const conversation = AH.newConversationId();
            const agentUrl = `${ this.getApiBase() }/ai/agent?JSON=1`;
            const form = new FormData();
            form.append('_xsrf', this.getButtonActionXsrf());
            form.append('message', message);
            form.append('context', JSON.stringify(context || {}));
            form.append('conversation', conversation);
            const resp = await fetch(agentUrl, {
                method: 'POST', body: form, credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await resp.json().catch(() => null);
            if (resp.status === 402) throw new Error((data && (data.error || data.message)) || 'Доступ к ИИ-агенту не оплачен');
            const job = data && data.job;
            if (!job) throw new Error((data && (data.error || data.message)) || 'ИИ-агент недоступен');
            const res = await this.pollButtonActionJob(job);
            if (res.plan && res.plan.id && res.plan.status === 'pending') {
                // The helper applies changes itself after confirmation; the agent's plan is dropped.
                const cancel = new FormData();
                cancel.append('_xsrf', this.getButtonActionXsrf());
                cancel.append('action', 'cancel');
                cancel.append('plan', res.plan.id);
                cancel.append('conversation', conversation);
                await fetch(agentUrl, {
                    method: 'POST', body: cancel, credentials: 'same-origin',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                }).catch(() => null);
            }
            const content = this.buttonActionJobContent(res);
            const proposal = AH.extractJson(content);
            if (!proposal) throw new Error(`ИИ-агент не предложил вариант: ${ String(content || 'пустой ответ').slice(0, 300) }`);
            if (proposal.error) throw new Error(String(proposal.error));
            return proposal;
        },

        /** Create the confirmed report: query, its columns, a check run; rollback on failure. */
        async applyAiReport(report) {
            const created = await this.aiHelperPost('_m_new/22?JSON', { up: '1', t22: report.name });
            const id = String(created.id || created.obj || '');
            if (!/^\d+$/.test(id)) throw new Error('Ядро не вернуло id отчёта');
            const rollback = () => this.aiHelperPost(`_m_del/${ id }?JSON=1`, {}).catch(() => null);
            try {
                for (const col of report.columns) {
                    await this.aiHelperPost(`_m_new/28?JSON&up=${ id }`, Object.assign({ up: id }, IntegramAiHelper.reportColumnFields(col)));
                }
                const resp = await fetch(`${ this.getApiBase() }/report/${ id }?JSON_KV&LIMIT=5`, { credentials: 'same-origin' });
                const text = await resp.text();
                let data;
                try { data = JSON.parse(text); } catch (e) { throw new Error(`Отчёт не строится: ${ text.replace(/<[^>]*>/g, ' ').trim().slice(0, 300) }`); }
                let err = data && !Array.isArray(data) ? (data.error || data.err) : (Array.isArray(data) && data[0] && data[0].error);
                // A failed SQL comes back as HTTP 200 with the error text inside the first row's cell
                const row = Array.isArray(data) && data[0] && typeof data[0] === 'object' ? data[0] : {};
                const sqlErr = Object.keys(row).map(k => row[k]).find(v => typeof v === 'string' && /^Couldn't execute query/.test(v));
                if (!err && sqlErr) err = sqlErr.replace(/^Couldn't execute query(?: \[[^\]]*\])?\s*/, '').replace(/\s*\(SELECT[\s\S]*$/, '');
                if (!resp.ok || err) throw new Error(`Отчёт не строится: ${ err || 'HTTP ' + resp.status }`);
            } catch (e) {
                await rollback();
                throw e;
            }
            return { id, url: `${ this.getApiBase() }/report/${ id }` };
        },

        /** Add the confirmed formula as a new BUTTON column; drop the column if the action is refused. */
        async applyAiFormula(p, store) {
            const name = String(p.name || '').trim() || 'Формула';
            const created = await this.createColumn(name, 7, false, false);
            if (!created || !created.success) throw new Error((created && created.error) || 'Колонка не создана');
            const saved = await this.saveButtonAction(created.columnId, IntegramAiHelper.formulaAction(p, store));
            if (!saved || !saved.success) {
                await this.deleteColumn(created.columnId);
                throw new Error((saved && saved.error) || 'Формула не сохранена');
            }
            return { columnId: String(created.columnId) };
        },

        // ── Dialogs ───────────────────────────────────────────────────────

        aiHelperTableName() {
            const tableId = String(this.objectTableId || this.options.tableTypeId || '');
            const t = (this.globalMetadata || []).find(m => String(m.id) === tableId);
            return (t && (t.val || t.name)) || this.options.title || '';
        },

        /** Modal skeleton shared by both helpers; returns {modal, q, close, status}. */
        aiHelperModal(title, placeholder) {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';
            overlay.style.zIndex = '1003';
            const modal = document.createElement('div');
            modal.className = 'column-settings-modal it-ai-helper-modal';
            modal.style.zIndex = '1004';
            modal.innerHTML = `<h3 style="margin:0 0 12px 0;font-weight:500;font-size:1.125rem;">${ this.escapeHtml(title) }</h3>
                <textarea class="form-control it-ai-text" rows="3" placeholder="${ this.escapeHtml(placeholder) }"></textarea>
                <div class="it-ai-extra"></div>
                <div class="it-ai-status" style="margin:8px 0;font-size:13px;white-space:pre-wrap;"></div>
                <div class="it-ai-proposal"></div>
                <div class="col-edit-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
                    <button class="btn btn-primary it-ai-ask">Предложить</button>
                    <button class="btn btn-success it-ai-apply" style="display:none;">Применить</button>
                    <button class="btn btn-secondary it-ai-close">Закрыть</button>
                </div>`;
            const close = () => { overlay.remove(); modal.remove(); };
            overlay.addEventListener('click', close);
            document.body.appendChild(overlay);
            document.body.appendChild(modal);
            const q = (s) => modal.querySelector(s);
            q('.it-ai-close').addEventListener('click', close);
            q('.it-ai-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });
            const status = (text, kind) => {
                const el = q('.it-ai-status');
                el.textContent = text || '';
                el.style.color = kind === 'error' ? 'var(--md-error,#c62828)' : 'var(--md-on-surface-variant,#555)';
            };
            setTimeout(() => q('.it-ai-text').focus(), 0);
            return { modal, q, close, status };
        },

        /** "Формула словами": proposal → check and preview on the first rows → new column. */
        openAiFormulaHelper() {
            const AH = IntegramAiHelper;
            const columns = [];
            this.columns.forEach((c) => { [c.name, c.val].forEach(n => { if (n && columns.indexOf(n) === -1) columns.push(n); }); });
            const ui = this.aiHelperModal('Формула словами', 'Что посчитать в новой колонке? Например: сумма с НДС 20% по цене и количеству');
            const { q, status } = ui;
            q('.it-ai-extra').innerHTML = `<label class="col-edit-check-label" style="display:block;margin-top:8px;font-size:13px;">
                <input type="checkbox" class="it-ai-store"> Сохранять значение в записи (считается при создании и изменении записи)</label>`;
            let proposal = null;
            const render = () => {
                const formula = q('.it-ai-formula').value;
                const check = AH.checkFormula(formula, columns);
                const rows = Math.min(3, (this.data || []).length);
                const preview = [];
                if (check.ok) {
                    for (let i = 0; i < rows; i++) {
                        const ctx = this.buildButtonActionContext(i);
                        let v;
                        try { v = IntegramButtonAction.formatResult(IntegramButtonAction.evalFormula(formula, ctx)); } catch (e) { v = `ошибка: ${ e.message }`; }
                        preview.push(`${ ctx.val || '#' + ctx.id } → ${ v }`);
                    }
                }
                q('.it-ai-check').textContent = check.ok ? (preview.length ? `Пример по первым строкам:\n${ preview.join('\n') }` : 'Формула проверена.') : `Ошибка: ${ check.error }`;
                q('.it-ai-check').style.color = check.ok ? '' : 'var(--md-error,#c62828)';
                q('.it-ai-apply').style.display = check.ok ? '' : 'none';
            };
            q('.it-ai-ask').addEventListener('click', async () => {
                const text = q('.it-ai-text').value.trim();
                if (!text) { status('Опишите, что посчитать.', 'error'); return; }
                q('.it-ai-ask').disabled = true;
                q('.it-ai-apply').style.display = 'none';
                status('ИИ-агент составляет формулу… База не меняется.');
                try {
                    proposal = await this.askAiHelper(AH.buildFormulaMessage({ table: this.aiHelperTableName(), columns, text }),
                        { page: 'table', table_id: String(this.objectTableId || this.options.tableTypeId || ''), label: 'Помощник формул' });
                    q('.it-ai-proposal').innerHTML = `<div class="col-edit-row"><label class="col-edit-label">Имя колонки:</label>
                        <input type="text" class="form-control form-control-sm it-ai-name" autocomplete="off"></div>
                        <div class="col-edit-row"><label class="col-edit-label">Формула:</label>
                        <textarea class="form-control form-control-sm it-ai-formula" rows="2"></textarea></div>
                        <div class="it-ai-check" style="font-size:13px;white-space:pre-wrap;margin-top:6px;"></div>`;
                    q('.it-ai-name').value = String(proposal.name || '');
                    q('.it-ai-formula').value = String(proposal.formula || '');
                    q('.it-ai-formula').addEventListener('input', render);
                    q('.it-ai-formula').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });
                    status(proposal.explain ? String(proposal.explain) : 'Проверьте формулу и нажмите «Применить».');
                    render();
                } catch (e) {
                    status(e.message, 'error');
                } finally {
                    q('.it-ai-ask').disabled = false;
                }
            });
            q('.it-ai-apply').addEventListener('click', async () => {
                const p = { name: q('.it-ai-name').value.trim(), formula: q('.it-ai-formula').value.trim() };
                const check = AH.checkFormula(p.formula, columns);
                if (!check.ok) { render(); return; }
                q('.it-ai-apply').disabled = true;
                q('.it-ai-ask').disabled = true;
                status('Добавляю колонку…');
                try {
                    const res = await this.applyAiFormula(p, q('.it-ai-store').checked);
                    ui.close();
                    this.closeColumnSettings();
                    if (!this.visibleColumns.includes(res.columnId)) this.visibleColumns.push(res.columnId);
                    this.saveColumnState();
                    this.metadataCache = {};
                    this.metadataFetchPromises = {};
                    this.globalMetadata = null;
                    this.globalMetadataPromise = null;
                    if (typeof this.clearSharedGlobalMetadata === 'function') this.clearSharedGlobalMetadata();
                    await this.loadData(false);
                    this.showToast(`Колонка «${ p.name || 'Формула' }» добавлена`, 'success');
                } catch (e) {
                    status(e.message, 'error');
                    q('.it-ai-apply').disabled = false;
                    q('.it-ai-ask').disabled = false;
                }
            });
        },

        /** "Отчёт словами": proposal → check against the role's fields → query + columns. */
        openAiReportHelper() {
            const AH = IntegramAiHelper;
            const ui = this.aiHelperModal('Отчёт словами', 'Какой отчёт нужен? Например: выручка по месяцам за этот год');
            const { q, status } = ui;
            let report = null;
            q('.it-ai-ask').addEventListener('click', async () => {
                const text = q('.it-ai-text').value.trim();
                if (!text) { status('Опишите отчёт.', 'error'); return; }
                q('.it-ai-ask').disabled = true;
                q('.it-ai-apply').style.display = 'none';
                q('.it-ai-proposal').innerHTML = '';
                status('ИИ-агент составляет отчёт… База не меняется.');
                try {
                    if (!this.globalMetadata) {
                        if (!this.globalMetadataPromise) this.globalMetadataPromise = this.loadGlobalMetadata();
                        await this.globalMetadataPromise;
                    }
                    const sources = AH.sourcesFromMetadata(this.globalMetadata || []);
                    if (!sources.length) throw new Error('Не удалось прочитать структуру базы');
                    const proposal = await this.askAiHelper(AH.buildReportMessage({ table: this.aiHelperTableName(), sources, text }),
                        { page: 'table', table_id: String(this.objectTableId || this.options.tableTypeId || ''), label: 'Помощник отчётов' });
                    const v = AH.validateReport(proposal, sources);
                    if (!v.ok) throw new Error(`ИИ предложил отчёт, который нельзя создать: ${ v.error }. Уточните описание и попробуйте ещё раз.`);
                    report = v.report;
                    const label = {};
                    sources.forEach(s => { label[s.id] = s.label; });
                    const esc = (s) => this.escapeHtml(s === undefined || s === null ? '' : String(s));
                    const rows = report.columns.map(c => `<tr${ c.hidden ? ' style="opacity:.6"' : '' }><td>${ esc(c.name) }</td>
                        <td>${ c.source === '0' ? `<code>${ esc(c.formula) }</code>` : esc(label[c.source]) }</td>
                        <td>${ esc(c.func) }</td><td>${ esc([c.from, c.to].filter(Boolean).join(' … ')) }</td>
                        <td>${ c.hidden ? 'скрыта' : '' }</td><td>${ esc(c.sort) }</td></tr>`).join('');
                    q('.it-ai-proposal').innerHTML = `<div class="col-edit-row"><label class="col-edit-label">Имя отчёта:</label>
                        <input type="text" class="form-control form-control-sm it-ai-name" autocomplete="off"></div>
                        <div style="max-height:40vh;overflow:auto;"><table class="table table-sm" style="font-size:13px;">
                        <thead><tr><th>Колонка</th><th>Источник</th><th>Функция</th><th>Фильтр</th><th></th><th>Сорт.</th></tr></thead>
                        <tbody>${ rows }</tbody></table></div>`;
                    q('.it-ai-name').value = report.name;
                    status((report.explain ? report.explain + '\n' : '') + 'Проверьте колонки и нажмите «Применить» — отчёт будет создан.');
                    q('.it-ai-apply').style.display = '';
                } catch (e) {
                    status(e.message, 'error');
                } finally {
                    q('.it-ai-ask').disabled = false;
                }
            });
            q('.it-ai-apply').addEventListener('click', async () => {
                if (!report) return;
                const name = q('.it-ai-name').value.trim();
                if (!name) { status('Укажите имя отчёта.', 'error'); return; }
                q('.it-ai-apply').disabled = true;
                q('.it-ai-ask').disabled = true;
                status('Создаю отчёт…');
                try {
                    const res = await this.applyAiReport(Object.assign({}, report, { name }));
                    q('.it-ai-apply').style.display = 'none';
                    q('.it-ai-proposal').innerHTML = `<a class="btn btn-primary" href="${ this.escapeHtml(res.url) }" target="_blank" rel="noopener">Открыть отчёт «${ this.escapeHtml(name) }»</a>`;
                    status('Отчёт создан.');
                    window.open(res.url, '_blank', 'noopener');
                } catch (e) {
                    status(`${ e.message }\nНичего не создано.`, 'error');
                    q('.it-ai-apply').disabled = false;
                    q('.it-ai-ask').disabled = false;
                }
            });
        }
    });
}
