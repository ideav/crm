
// ── Button column actions (issue #5116) ─────────────────────────────────────
// A BUTTON column's modifier (attrs) may hold a self-contained description of
// what the button does under the "action" key:
//   link    — {"type":"link","url":"report/1?FR_X=[ID]","newTab":true}
//   prompt  — {"type":"prompt","prompt":"Кратко опиши {Описание}","write":true}
//   formula — {"type":"formula","formula":"{Цена} * {Кол-во}","write":true}
//   query   — {"type":"query","query":"Имя запроса","params":"FR_X=[ID]","write":true}
// "label" — optional button caption. Templates may use [ID] (record id),
// [VAL] (value of the record's first column) and {Column name}.
// With "write" the result is stored into the record's value of this column;
// a stored value is shown instead of the button, with recalc and clear.
// Redefining the column does not recalculate stored results.

const IntegramButtonAction = (function () {
    const TYPES = ['link', 'prompt', 'formula', 'query'];
    const TYPE_NAMES = { link: 'Ссылка', prompt: 'Промпт ИИ', formula: 'Формула', query: 'Запрос' };
    const TYPE_ICONS = { link: 'pi-external-link', prompt: 'pi-sparkles', formula: 'pi-calculator', query: 'pi-database' };

    function parseAttrs(attrs) {
        if (typeof parseIntegramAttrs === 'function') return parseIntegramAttrs(attrs);
        const s = String(attrs || '').trim();
        if (s.charAt(0) === '{') {
            try { return JSON.parse(s); } catch (e) { /* fall through */ }
        }
        return { defaultValue: s };
    }

    /**
     * Action config of a BUTTON column, or null. A column without an "action"
     * key but with a default value is a plain link (the server already
     * substitutes [ID]/[VAL] into it).
     */
    function parseConfig(attrs) {
        const parsed = parseAttrs(attrs) || {};
        let action = parsed.action;
        if (typeof action === 'string') {
            try { action = JSON.parse(action); } catch (e) { action = null; }
        }
        if (action && typeof action === 'object' && TYPES.indexOf(action.type) !== -1) {
            const cfg = { type: action.type, label: action.label ? String(action.label) : '' };
            if (action.type === 'link') {
                cfg.url = String(action.url || '');
                cfg.newTab = action.newTab === undefined ? true : !!action.newTab;
            } else {
                cfg.write = !!action.write;
                if (action.type === 'prompt') cfg.prompt = String(action.prompt || '');
                if (action.type === 'formula') cfg.formula = String(action.formula || '');
                if (action.type === 'query') {
                    cfg.query = String(action.query || '');
                    cfg.params = String(action.params || '');
                }
            }
            return cfg;
        }
        const def = parsed.defaultValue !== undefined ? parsed.defaultValue : parsed.default;
        if (def) return { type: 'link', label: '', url: String(def), newTab: true, legacy: true };
        return null;
    }

    /** Serializable action object for the server (drops runtime-only keys). */
    function toAction(cfg) {
        if (!cfg || TYPES.indexOf(cfg.type) === -1) return null;
        const a = { type: cfg.type };
        if (cfg.label) a.label = cfg.label;
        if (cfg.type === 'link') { a.url = cfg.url || ''; a.newTab = cfg.newTab !== false; }
        else {
            if (cfg.type === 'prompt') a.prompt = cfg.prompt || '';
            if (cfg.type === 'formula') a.formula = cfg.formula || '';
            if (cfg.type === 'query') { a.query = cfg.query || ''; if (cfg.params) a.params = cfg.params; }
            a.write = !!cfg.write;
        }
        return a;
    }

    function lookupField(ctx, name) {
        const fields = (ctx && ctx.fields) || {};
        if (Object.prototype.hasOwnProperty.call(fields, name)) return { found: true, value: fields[name] };
        const lower = name.toLowerCase();
        for (const k in fields) {
            if (Object.prototype.hasOwnProperty.call(fields, k) && k.toLowerCase() === lower) return { found: true, value: fields[k] };
        }
        return { found: false, value: '' };
    }

    /**
     * Replace [ID], [VAL] and {Column name} in a template. `encode` is applied
     * to every inserted value (e.g. encodeURIComponent for URLs).
     */
    function substitute(template, ctx, encode) {
        const enc = typeof encode === 'function' ? encode : (v) => v;
        const str = (v) => (v === null || v === undefined ? '' : String(v));
        return String(template || '')
            .replace(/\[ID\]/g, () => enc(str(ctx && ctx.id)))
            .replace(/\[VAL\]/g, () => enc(str(ctx && ctx.val)))
            .replace(/\{([^{}]+)\}/g, (m, name) => {
                const f = lookupField(ctx, name.trim());
                return f.found ? enc(str(f.value)) : m;
            });
    }

    // ── Formula evaluator ────────────────────────────────────────────────
    // Arithmetic, comparison, logic, string concatenation and a fixed set of
    // functions. No access to JS globals: a formula is written by the table
    // admin and runs in every user's browser.

    function toNumber(v) {
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        const s = String(v === null || v === undefined ? '' : v).replace(/[\s ]/g, '').replace(',', '.');
        if (s === '') return 0;
        const n = Number(s);
        if (isNaN(n)) throw new Error(`«${ v }» — не число`);
        return n;
    }

    function looksNumeric(v) {
        if (typeof v === 'number') return true;
        if (typeof v !== 'string') return false;
        const s = v.replace(/[\s ]/g, '').replace(',', '.');
        return s !== '' && !isNaN(Number(s));
    }

    function fieldValue(v) {
        return looksNumeric(v) ? toNumber(v) : (v === null || v === undefined ? '' : String(v));
    }

    function parseDate(v) {
        if (v instanceof Date) return v;
        const s = String(v || '').trim();
        let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        throw new Error(`«${ s }» — не дата`);
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDate(d) { return `${ pad2(d.getDate()) }.${ pad2(d.getMonth() + 1) }.${ d.getFullYear() }`; }

    const FUNCTIONS = {
        ROUND: (x, n) => { const p = Math.pow(10, n === undefined ? 0 : toNumber(n)); return Math.round(toNumber(x) * p) / p; },
        FLOOR: (x) => Math.floor(toNumber(x)),
        CEIL: (x) => Math.ceil(toNumber(x)),
        ABS: (x) => Math.abs(toNumber(x)),
        MIN: (...a) => Math.min(...a.map(toNumber)),
        MAX: (...a) => Math.max(...a.map(toNumber)),
        SUM: (...a) => a.reduce((s, x) => s + toNumber(x), 0),
        AVG: (...a) => (a.length ? a.reduce((s, x) => s + toNumber(x), 0) / a.length : 0),
        NUM: (x) => toNumber(x),
        IF: (c, a, b) => (truthy(c) ? a : (b === undefined ? '' : b)),
        LEN: (s) => String(s === undefined ? '' : s).length,
        UPPER: (s) => String(s === undefined ? '' : s).toUpperCase(),
        LOWER: (s) => String(s === undefined ? '' : s).toLowerCase(),
        TRIM: (s) => String(s === undefined ? '' : s).trim(),
        LEFT: (s, n) => String(s === undefined ? '' : s).slice(0, toNumber(n === undefined ? 1 : n)),
        RIGHT: (s, n) => { const str = String(s === undefined ? '' : s); const k = toNumber(n === undefined ? 1 : n); return k > 0 ? str.slice(-k) : ''; },
        CONCAT: (...a) => a.map(x => String(x === undefined ? '' : x)).join(''),
        TODAY: () => fmtDate(new Date()),
        DAYS: (to, from) => Math.round((parseDate(to) - parseDate(from)) / 86400000),
        ADDDAYS: (d, n) => { const dt = parseDate(d); dt.setDate(dt.getDate() + toNumber(n)); return fmtDate(dt); }
    };

    function truthy(v) {
        return !(v === '' || v === 0 || v === false || v === null || v === undefined || v === '0');
    }

    function tokenize(src) {
        const tokens = [];
        let i = 0;
        while (i < src.length) {
            const c = src[i];
            if (/\s/.test(c)) { i++; continue; }
            if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
                const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
                tokens.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
            }
            if (c === '"' || c === "'") {
                let j = i + 1, s = '';
                while (j < src.length && src[j] !== c) {
                    if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
                    s += src[j++];
                }
                if (j >= src.length) throw new Error('Незакрытая строка в формуле');
                tokens.push({ t: 'str', v: s }); i = j + 1; continue;
            }
            if (c === '{') {
                const j = src.indexOf('}', i);
                if (j === -1) throw new Error('Незакрытая скобка { в формуле');
                tokens.push({ t: 'field', v: src.slice(i + 1, j).trim() }); i = j + 1; continue;
            }
            if (src.startsWith('[ID]', i)) { tokens.push({ t: 'id' }); i += 4; continue; }
            if (src.startsWith('[VAL]', i)) { tokens.push({ t: 'val' }); i += 5; continue; }
            const ident = src.slice(i).match(/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*/);
            if (ident) { tokens.push({ t: 'ident', v: ident[0] }); i += ident[0].length; continue; }
            const op = src.slice(i).match(/^(<=|>=|<>|!=|==|&&|\|\||[-+*\/%()<>=!?:,&])/);
            if (op) { tokens.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
            throw new Error(`Недопустимый символ «${ c }» в формуле`);
        }
        return tokens;
    }

    function evalFormula(src, ctx) {
        const tokens = tokenize(String(src || ''));
        let pos = 0;
        const peek = () => tokens[pos];
        const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
        const expect = (v) => { if (!isOp(v)) throw new Error(`Ожидалось «${ v }» в формуле`); pos++; };

        function ternary() {
            const c = or();
            if (isOp('?')) { pos++; const a = ternary(); expect(':'); const b = ternary(); return truthy(c) ? a : b; }
            return c;
        }
        function or() { let l = and(); while (isOp('||')) { pos++; const r = and(); l = truthy(l) || truthy(r); } return l; }
        function and() { let l = cmp(); while (isOp('&&')) { pos++; const r = cmp(); l = truthy(l) && truthy(r); } return l; }
        function cmp() {
            const l = add();
            const t = peek();
            if (t && t.t === 'op' && ['==', '=', '!=', '<>', '<', '<=', '>', '>='].indexOf(t.v) !== -1) {
                pos++;
                const r = add();
                const num = looksNumeric(l) && looksNumeric(r);
                const a = num ? toNumber(l) : String(l), b = num ? toNumber(r) : String(r);
                switch (t.v) {
                    case '==': case '=': return a === b;
                    case '!=': case '<>': return a !== b;
                    case '<': return a < b;
                    case '<=': return a <= b;
                    case '>': return a > b;
                    default: return a >= b;
                }
            }
            return l;
        }
        function add() {
            let l = mul();
            for (;;) {
                if (isOp('+')) { pos++; const r = mul(); l = (looksNumeric(l) && looksNumeric(r)) ? toNumber(l) + toNumber(r) : String(l) + String(r); }
                else if (isOp('-')) { pos++; l = toNumber(l) - toNumber(mul()); }
                else if (isOp('&')) { pos++; l = String(l) + String(mul()); }
                else return l;
            }
        }
        function mul() {
            let l = unary();
            for (;;) {
                if (isOp('*')) { pos++; l = toNumber(l) * toNumber(unary()); }
                else if (isOp('/')) { pos++; const r = toNumber(unary()); if (r === 0) throw new Error('Деление на ноль'); l = toNumber(l) / r; }
                else if (isOp('%')) { pos++; l = toNumber(l) % toNumber(unary()); }
                else return l;
            }
        }
        function unary() {
            if (isOp('-')) { pos++; return -toNumber(unary()); }
            if (isOp('+')) { pos++; return toNumber(unary()); }
            if (isOp('!')) { pos++; return !truthy(unary()); }
            return primary();
        }
        function primary() {
            const t = peek();
            if (!t) throw new Error('Формула оборвана');
            pos++;
            if (t.t === 'num' || t.t === 'str') return t.v;
            if (t.t === 'id') return fieldValue(ctx && ctx.id);
            if (t.t === 'val') return fieldValue(ctx && ctx.val);
            if (t.t === 'field') {
                const f = lookupField(ctx, t.v);
                if (!f.found) throw new Error(`Нет колонки «${ t.v }»`);
                return fieldValue(f.value);
            }
            if (t.t === 'op' && t.v === '(') { const v = ternary(); expect(')'); return v; }
            if (t.t === 'ident') {
                const name = t.v.toUpperCase();
                if (name === 'TRUE') return true;
                if (name === 'FALSE') return false;
                const fn = FUNCTIONS[name];
                if (!fn) throw new Error(`Неизвестная функция ${ t.v }`);
                expect('(');
                const args = [];
                if (!isOp(')')) {
                    args.push(ternary());
                    while (isOp(',')) { pos++; args.push(ternary()); }
                }
                expect(')');
                return fn(...args);
            }
            throw new Error(`Неожиданное «${ t.v }» в формуле`);
        }

        if (!tokens.length) return '';
        const result = ternary();
        if (pos < tokens.length) throw new Error(`Лишнее «${ tokens[pos].v || '' }» в формуле`);
        return result;
    }

    function formatResult(v) {
        if (typeof v === 'number') {
            if (!isFinite(v)) throw new Error('Результат не число');
            return String(Number(v.toFixed(10)));
        }
        if (typeof v === 'boolean') return v ? '1' : '0';
        return v === null || v === undefined ? '' : String(v);
    }

    /** Message for the agent: the prompt plus, when writing, the answer format. */
    function buildPrompt(cfg, ctx, columnName) {
        const text = substitute(cfg.prompt, ctx);
        if (!cfg.write) return text;
        return `${ text }\n\nОтветь только итоговым значением для поля «${ columnName }» записи #${ ctx.id }` +
            ' — без пояснений, кавычек и форматирования.';
    }

    /** Agent answer → value to store: trims and unwraps a lone code fence. */
    function cleanAnswer(text) {
        let s = String(text || '').trim();
        const fence = s.match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
        if (fence) s = fence[1].trim();
        return s;
    }

    return { TYPES, TYPE_NAMES, TYPE_ICONS, parseConfig, toAction, substitute, evalFormula, formatResult, buildPrompt, cleanAnswer };
})();

if (typeof window !== 'undefined') window.IntegramButtonAction = IntegramButtonAction;

if (typeof IntegramTable !== 'undefined') {
    IntegramTable.ButtonAction = IntegramButtonAction;

    Object.assign(IntegramTable.prototype, {
        /** Row context for templates: record id, first-column value, fields by column name. */
        buildButtonActionContext(rowIndex) {
            const row = this.data[rowIndex] || [];
            const raw = this.rawObjectData && this.rawObjectData[rowIndex];
            const fields = {};
            this.columns.forEach((col, i) => {
                let v = row[i];
                if (v !== null && v !== undefined && typeof this.parseReferenceDisplayValue === 'function') {
                    v = this.parseReferenceDisplayValue(v, col);
                }
                v = v === null || v === undefined ? '' : v;
                if (col.name) fields[col.name] = v;
                if (col.val && !(col.val in fields)) fields[col.val] = v;
            });
            const firstIdx = this.columns.findIndex(c => c.id === String(this.objectTableId));
            const val = row[firstIdx >= 0 ? firstIdx : 0];
            return { id: raw && raw.i !== undefined ? raw.i : '', val: val === null || val === undefined ? '' : val, fields };
        },

        /** Inner HTML of a BUTTON cell that has an action config. */
        renderButtonActionCell(column, value, cfg) {
            const colId = this.escapeHtml(String(column.id));
            const title = this.escapeHtml(cfg.label || IntegramButtonAction.TYPE_NAMES[cfg.type]);
            const stored = value !== null && value !== undefined && String(value) !== '';
            if (stored) {
                return `<span class="it-btn-result">${ this.escapeHtml(String(value)) }</span>` +
                    `<span class="it-btn-result-tools" style="white-space:nowrap;margin-left:4px;">` +
                    `<button type="button" class="it-btn-tool" style="border:0;background:none;padding:0 2px;cursor:pointer;opacity:.6;" data-btn-action="run" data-col-id="${ colId }" title="Пересчитать"><i class="pi pi-refresh"></i></button>` +
                    `<button type="button" class="it-btn-tool" style="border:0;background:none;padding:0 2px;cursor:pointer;opacity:.6;" data-btn-action="clear" data-col-id="${ colId }" title="Удалить результат"><i class="pi pi-times"></i></button>` +
                    `</span>`;
            }
            const label = cfg.label ? `<span class="it-btn-label">${ this.escapeHtml(cfg.label) }</span>` : '';
            return `<button type="button" class="btn btn-sm btn-primary it-btn-action" data-btn-action="run" data-col-id="${ colId }" title="${ title }">` +
                `<i class="pi ${ IntegramButtonAction.TYPE_ICONS[cfg.type] }"></i>${ label }</button>`;
        },

        getButtonActionColumns() {
            return this.columns.filter(c => this.normalizeFormat(c.type) === 'BUTTON')
                .map(c => ({ col: c, cfg: IntegramButtonAction.parseConfig(c.attrs) }))
                .filter(x => x.cfg && x.cfg.type !== 'link');
        },

        /** Toolbar buttons that run an action column for the selected rows. */
        renderButtonActionBulkButtons(instanceName) {
            if (!this.checkboxMode || !this.selectedRows || this.selectedRows.size === 0) return '';
            return this.getButtonActionColumns().map(({ col, cfg }) =>
                `<button class="btn btn-sm btn-outline-primary it-btn-action-bulk" onclick="window.${ instanceName }.runButtonActionForSelected('${ this.escapeHtml(String(col.id)) }')" title="${ this.escapeHtml(IntegramButtonAction.TYPE_NAMES[cfg.type]) } для выделенных строк">` +
                `<i class="pi ${ IntegramButtonAction.TYPE_ICONS[cfg.type] }"></i> ${ this.escapeHtml(col.name) } (${ this.selectedRows.size })</button>`
            ).join('');
        },

        /** Click on [data-btn-action] inside a grid cell. */
        async handleButtonActionClick(el, td) {
            const rowIndex = parseInt(td.dataset.row, 10);
            const column = this.columns.find(c => String(c.id) === el.dataset.colId);
            if (!column || isNaN(rowIndex)) return;
            const cfg = IntegramButtonAction.parseConfig(column.attrs);
            if (!cfg) return;
            const kind = el.dataset.btnAction;
            try {
                if (kind === 'clear') {
                    await this.writeButtonActionResult(rowIndex, column, '');
                    return;
                }
                if (kind === 'reset') {
                    this.refreshButtonActionCell(td, rowIndex, column);
                    return;
                }
                el.disabled = true;
                el.classList.add('it-btn-busy');
                const result = await this.runButtonAction(rowIndex, column, cfg);
                if (result === null) return;
                if (cfg.write) {
                    await this.writeButtonActionResult(rowIndex, column, result);
                } else if (cfg.type === 'prompt') {
                    this.showButtonActionAnswer(column, result);
                } else {
                    td.innerHTML = `<span class="it-btn-result it-btn-result-temp">${ this.escapeHtml(result) }</span>` +
                        `<span class="it-btn-result-tools" style="white-space:nowrap;margin-left:4px;"><button type="button" class="it-btn-tool" style="border:0;background:none;padding:0 2px;cursor:pointer;opacity:.6;" data-btn-action="reset" data-col-id="${ this.escapeHtml(String(column.id)) }" title="Скрыть"><i class="pi pi-times"></i></button></span>`;
                    return;
                }
            } catch (err) {
                this.showToast(`${ column.name }: ${ err.message }`, 'error');
            } finally {
                if (el.isConnected) {
                    el.disabled = false;
                    el.classList.remove('it-btn-busy');
                }
            }
        },

        /**
         * Execute an action for one row. Returns the result string, or null for
         * a link (navigation has no result).
         */
        async runButtonAction(rowIndex, column, cfg) {
            const ctx = this.buildButtonActionContext(rowIndex);
            switch (cfg.type) {
                case 'link': {
                    const serverValue = this.data[rowIndex] ? this.data[rowIndex][this.columns.indexOf(column)] : '';
                    const target = cfg.legacy && serverValue ? String(serverValue)
                        : IntegramButtonAction.substitute(cfg.url, ctx, encodeURIComponent);
                    if (!target) throw new Error('Ссылка не задана');
                    const href = /^https?:\/\//i.test(target) ? target : `${ this.getApiBase() }/${ target.replace(/^\//, '') }`;
                    if (cfg.newTab) window.open(href, '_blank');
                    else window.location.href = href;
                    return null;
                }
                case 'formula':
                    return IntegramButtonAction.formatResult(IntegramButtonAction.evalFormula(cfg.formula, ctx));
                case 'query':
                    return this.runButtonActionQuery(cfg, ctx);
                case 'prompt':
                    return this.runButtonActionPrompt(cfg, ctx, column);
            }
            return null;
        },

        async runButtonActionQuery(cfg, ctx) {
            if (!cfg.query) throw new Error('Запрос не задан');
            const params = IntegramButtonAction.substitute(cfg.params, ctx, encodeURIComponent).replace(/^[?&]+/, '');
            const url = `${ this.getApiBase() }/report/${ encodeURIComponent(cfg.query) }?JSON_KV${ params ? '&' + params : '' }`;
            const resp = await fetch(url, { credentials: 'same-origin' });
            const text = await resp.text();
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error(`Запрос «${ cfg.query }» вернул не JSON`); }
            if (!resp.ok || (data && !Array.isArray(data) && (data.error || data.err))) {
                throw new Error((data && (data.error || data.err)) || `Запрос «${ cfg.query }»: HTTP ${ resp.status }`);
            }
            const rows = Array.isArray(data) ? data : [];
            if (!rows.length) return '';
            const first = rows[0];
            const keys = first && typeof first === 'object' ? Object.keys(first) : [];
            return keys.length ? IntegramButtonAction.formatResult(first[keys[0]]) : '';
        },

        getButtonActionXsrf() {
            if (typeof xsrf !== 'undefined' && xsrf) return xsrf;
            const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="_xsrf"]') : null;
            return meta ? meta.getAttribute('content') : '';
        },

        /** Run the prompt through the database's AI agent under the user's session. */
        async runButtonActionPrompt(cfg, ctx, column) {
            if (!cfg.prompt) throw new Error('Промпт не задан');
            const agentUrl = `${ this.getApiBase() }/ai/agent?JSON=1`;
            const form = new FormData();
            form.append('_xsrf', this.getButtonActionXsrf());
            form.append('message', IntegramButtonAction.buildPrompt(cfg, ctx, column.name));
            form.append('context', JSON.stringify({
                page: 'table',
                table_id: String(this.objectTableId || this.options.tableTypeId || ''),
                object_id: String(ctx.id),
                label: `Кнопка «${ column.name }»`
            }));
            const resp = await fetch(agentUrl, {
                method: 'POST', body: form, credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await resp.json().catch(() => null);
            if (resp.status === 402) throw new Error((data && (data.error || data.message)) || 'Доступ к ИИ-агенту не оплачен');
            let job = data && data.job;
            if (!job) throw new Error((data && (data.error || data.message)) || 'ИИ-агент недоступен');
            const deadline = Date.now() + 5 * 60 * 1000;
            while (job.status !== 'done' && job.status !== 'error') {
                if (Date.now() > deadline) throw new Error('ИИ-агент не ответил за 5 минут');
                await new Promise(r => setTimeout(r, 2500));
                const pr = await fetch(`${ agentUrl }&job=${ encodeURIComponent(job.id) }`, {
                    credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                const pd = await pr.json().catch(() => null);
                if (pd && pd.job) job = pd.job;
            }
            const res = job.result || {};
            if (job.status === 'error') throw new Error(job.error || res.error || 'ИИ-агент завершил работу с ошибкой');
            const content = res.assistant && typeof res.assistant.content === 'string' ? res.assistant.content
                : (typeof res.content === 'string' ? res.content : (typeof res.message === 'string' ? res.message : ''));
            if (res.plan && res.plan.status === 'pending' && !cfg.write) {
                return `${ content }\n\nАгент предложил изменения — подтвердите их в ИИ-чате.`;
            }
            return IntegramButtonAction.cleanAnswer(content);
        },

        /** Store the result into the record's value of the button column (empty = delete). */
        async writeButtonActionResult(rowIndex, column, value) {
            const raw = this.rawObjectData && this.rawObjectData[rowIndex];
            if (!raw || raw.i === undefined) throw new Error('Не найден id записи');
            const params = new URLSearchParams();
            params.append('_xsrf', this.getButtonActionXsrf());
            params.append(`t${ column.paramId || column.id }`, value);
            const resp = await fetch(`${ this.getApiBase() }/_m_set/${ raw.i }?JSON`, {
                method: 'POST', body: params, credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const text = await resp.text();
            let result = null;
            try { result = JSON.parse(text); } catch (e) { /* non-JSON error page */ }
            const err = typeof this.getServerError === 'function' ? this.getServerError(result) : (result && result.error);
            if (!resp.ok || !result || err) throw new Error(err || `Запись не сохранена (HTTP ${ resp.status })`);
            const colIndex = this.columns.indexOf(column);
            if (this.data[rowIndex]) this.data[rowIndex][colIndex] = value;
            const td = this.container && this.container.querySelector(`td[data-row="${ rowIndex }"] [data-col-id="${ column.id }"]`);
            const cell = td ? td.closest('td') : null;
            if (cell) this.refreshButtonActionCell(cell, rowIndex, column);
            return value;
        },

        refreshButtonActionCell(td, rowIndex, column) {
            const colIndex = this.columns.indexOf(column);
            const value = this.data[rowIndex] ? this.data[rowIndex][colIndex] : '';
            const cfg = IntegramButtonAction.parseConfig(column.attrs);
            if (cfg) td.innerHTML = this.renderButtonActionCell(column, value, cfg);
        },

        /** Run a column's action for every selected row, one after another. */
        async runButtonActionForSelected(colId) {
            const column = this.columns.find(c => String(c.id) === String(colId));
            const cfg = column && IntegramButtonAction.parseConfig(column.attrs);
            if (!cfg || cfg.type === 'link') return;
            const rows = Array.from(this.selectedRows).sort((a, b) => a - b);
            if (!rows.length) return;
            if (!cfg.write && !window.confirm(`Результат «${ column.name }» не записывается в поле. Всё равно выполнить для ${ rows.length } строк?`)) return;
            let ok = 0;
            const errors = [];
            for (let k = 0; k < rows.length; k++) {
                this.showToast(`${ column.name }: ${ k + 1 } из ${ rows.length }…`, 'info');
                try {
                    const result = await this.runButtonAction(rows[k], column, cfg);
                    if (cfg.write && result !== null) await this.writeButtonActionResult(rows[k], column, result);
                    ok++;
                } catch (err) {
                    const raw = this.rawObjectData && this.rawObjectData[rows[k]];
                    errors.push(`#${ raw ? raw.i : rows[k] }: ${ err.message }`);
                }
            }
            const msg = `${ column.name }: готово ${ ok } из ${ rows.length }` + (errors.length ? `. Ошибки: ${ errors.slice(0, 3).join('; ') }${ errors.length > 3 ? '…' : '' }` : '');
            this.showToast(msg, errors.length ? 'error' : 'success');
        },

        showButtonActionAnswer(column, text) {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';
            overlay.style.zIndex = '1001';
            const modal = document.createElement('div');
            modal.className = 'column-settings-modal it-btn-answer-modal';
            modal.style.zIndex = '1002';
            modal.innerHTML = `<h3 style="margin:0 0 12px 0;font-weight:500;font-size:1.125rem;">${ this.escapeHtml(column.name) }</h3>` +
                `<div class="it-btn-answer" style="white-space:pre-wrap;max-height:60vh;overflow:auto;">${ this.escapeHtml(text || 'ИИ-агент не вернул ответ.') }</div>` +
                `<div class="col-edit-actions"><button class="menu-modal-btn cancel">Закрыть</button></div>`;
            const close = () => { overlay.remove(); modal.remove(); };
            overlay.addEventListener('click', close);
            modal.querySelector('button').addEventListener('click', close);
            document.body.appendChild(overlay);
            document.body.appendChild(modal);
        },

        // ── Action editor inside the column edit modal ────────────────────

        buttonActionEditorHtml(col, instanceName, visible) {
            const cfg = IntegramButtonAction.parseConfig(col.attrs) || { type: 'link', url: '', newTab: true, label: '' };
            const body = cfg.type === 'link' ? cfg.url : cfg.type === 'prompt' ? cfg.prompt
                : cfg.type === 'formula' ? cfg.formula : cfg.query;
            const p = `col-edit-action-${ instanceName }`;
            return `<div class="col-edit-action-section" id="${ p }" style="${ visible ? '' : 'display:none;' }">
                    <div class="col-edit-row">
                        <label class="col-edit-label">Действие кнопки:</label>
                        <select id="${ p }-type" class="form-control form-control-sm col-edit-select">
                            ${ IntegramButtonAction.TYPES.map(t => `<option value="${ t }" ${ cfg.type === t ? 'selected' : '' }>${ IntegramButtonAction.TYPE_NAMES[t] }</option>`).join('') }
                        </select>
                    </div>
                    <div class="col-edit-row">
                        <label class="col-edit-label">Подпись:</label>
                        <input type="text" id="${ p }-label" class="form-control form-control-sm col-edit-input" value="${ this.escapeHtml(cfg.label || '') }" placeholder="Без подписи — только значок" autocomplete="off">
                    </div>
                    <div class="col-edit-row">
                        <label class="col-edit-label" id="${ p }-body-label"></label>
                        <textarea id="${ p }-body" class="form-control form-control-sm col-edit-input" rows="3">${ this.escapeHtml(body || '') }</textarea>
                    </div>
                    <div class="col-edit-row" id="${ p }-params-row">
                        <label class="col-edit-label">Параметры:</label>
                        <input type="text" id="${ p }-params" class="form-control form-control-sm col-edit-input" value="${ this.escapeHtml(cfg.params || '') }" placeholder="FR_Клиент=[ID]" autocomplete="off">
                    </div>
                    <div class="col-edit-row" id="${ p }-newtab-row">
                        <label class="col-edit-label col-edit-check-label">
                            <input type="checkbox" id="${ p }-newtab" ${ cfg.newTab !== false ? 'checked' : '' }> Открывать в новой вкладке
                        </label>
                    </div>
                    <div class="col-edit-row" id="${ p }-write-row">
                        <label class="col-edit-label col-edit-check-label">
                            <input type="checkbox" id="${ p }-write" ${ cfg.write ? 'checked' : '' }> Записывать результат в поле записи
                        </label>
                    </div>
                    <div class="col-edit-hint" style="font-size:12px;color:var(--md-on-surface-variant,#666);">
                        [ID] — id записи, [VAL] — значение первой колонки, {Название колонки} — значение поля строки.
                    </div>
                </div>`;
        },

        bindButtonActionEditor(modal, instanceName) {
            const p = `col-edit-action-${ instanceName }`;
            const q = (s) => modal.querySelector(`#${ p }${ s }`);
            if (!q('')) return;
            const labels = { link: 'Адрес:', prompt: 'Промпт:', formula: 'Формула:', query: 'Имя запроса:' };
            const hints = {
                link: 'report/123?FR_Клиент=[ID]',
                prompt: 'Сформулируй краткое описание для {Название} по полю {Описание}',
                formula: 'ROUND({Цена} * {Количество}, 2)',
                query: 'Остаток по клиенту'
            };
            const sync = () => {
                const t = q('-type').value;
                q('-body-label').textContent = labels[t];
                q('-body').placeholder = hints[t];
                q('-body').rows = t === 'prompt' ? 4 : (t === 'formula' ? 2 : 1);
                q('-params-row').style.display = t === 'query' ? '' : 'none';
                q('-newtab-row').style.display = t === 'link' ? '' : 'none';
                q('-write-row').style.display = t === 'link' ? 'none' : '';
            };
            q('-type').addEventListener('change', sync);
            // Enter inside the prompt/formula text must add a line, not save the modal
            q('-body').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });
            sync();
        },

        readButtonActionEditor(modal, instanceName) {
            const p = `col-edit-action-${ instanceName }`;
            const q = (s) => modal.querySelector(`#${ p }${ s }`);
            if (!q('')) return null;
            const type = q('-type').value;
            const body = q('-body').value.trim();
            const cfg = { type, label: q('-label').value.trim() };
            if (type === 'link') { cfg.url = body; cfg.newTab = q('-newtab').checked; }
            else {
                cfg.write = q('-write').checked;
                if (type === 'prompt') cfg.prompt = body;
                if (type === 'formula') cfg.formula = body;
                if (type === 'query') { cfg.query = body; cfg.params = q('-params').value.trim(); }
            }
            return IntegramButtonAction.toAction(cfg);
        },

        async saveButtonAction(colId, action) {
            const params = new URLSearchParams();
            params.append('_xsrf', this.getButtonActionXsrf());
            params.append('action', action ? JSON.stringify(action) : '');
            try {
                const resp = await fetch(`${ this.getApiBase() }/_d_action/${ colId }?JSON`, {
                    method: 'POST', body: params, credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
                const text = await resp.text();
                let result = null;
                try { result = JSON.parse(text); } catch (e) { /* error page */ }
                const err = typeof this.getServerError === 'function' ? this.getServerError(result) : (result && result.error);
                if (!resp.ok || !result || err) return { success: false, error: err || text.slice(0, 200) || `HTTP ${ resp.status }` };
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    });
}
