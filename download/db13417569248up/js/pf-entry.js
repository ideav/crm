/* Рабочее место оператора: компактная форма ввода показаний (планшет) */
(function () {
    'use strict';
    var root = document.getElementById('pf-entry-root');
    if (!root) return;
    var el = PF.el;
    var TASK = 'Задание производства';
    var KINDS = [
        {name: 'Замес-кусочки', report: 'pf_meas_kus', short: 'кусочки'},
        {name: 'Замес-паштет', report: 'pf_meas_pas', short: 'паштет'},
        {name: 'Замес-волокна', report: 'pf_meas_vol', short: 'волокна'}
    ];
    var ABS_MIN = 1, ABS_MAX = 100;    // физический диапазон, ТД-3.2 / ФТ-17.1

    var st = {tasks: [], task: null, batches: [], current: null, lines: [], meas: [], dicts: {}, kind: null};

    /* ------------------------------------------------------------ загрузка */
    function loadDicts() {
        return Promise.all([
            PF.rows(PF.tid('Статус задания')),
            PF.rows(PF.tid('Показатель контроля')),
            PF.rows(PF.tid('Оборудование')),
            PF.rows(PF.tid('Вид поломки')),
            PF.rows(PF.tid('Тип замера'))
        ]).then(function (r) {
            var stt = PF.table('Статус задания');
            var ci = 1 + stt.reqs.findIndex(function (q) { return q.name === 'Код статуса'; });
            st.dicts.status = r[0].map(function (x) { return {id: x.i, name: x.r[0], code: x.r[ci]}; });
            var mt = PF.table('Тип замера');
            var mi = 1 + mt.reqs.findIndex(function (q) { return q.name === 'Код типа замера'; });
            var codeById = {};
            r[4].forEach(function (x) { codeById[x.i] = x.r[mi] || 'value'; });
            var pk = PF.table('Показатель контроля');
            var ti = 1 + pk.reqs.findIndex(function (q) { return q.name === 'Тип замера'; });
            st.dicts.ind = {};
            r[1].forEach(function (x) {
                st.dicts.ind[x.r[0]] = {
                    id: x.i, name: x.r[0],
                    type: codeById[PF.refId(x.r[ti])] || 'value'      // код типа замера, не название
                };
            });
            st.dicts.equip = r[2].map(function (x) { return {id: x.i, name: x.r[0]}; });
            st.dicts.fail = r[3].map(function (x) { return {id: x.i, name: x.r[0]}; });
        });
    }

    function loadTasks() {
        return Promise.all([PF.report('pf_tasks'), PF.visibleIds(TASK)]).then(function (res) {
            var rows = res[0], visible = res[1];
            st.tasks = rows.filter(function (r) {
                return r.task_id && visible[r.task_id] && r.status_code !== 'done';
            });
            var wanted = PF.qs('task');
            st.task = st.tasks.filter(function (r) { return String(r.task_id) === String(wanted); })[0] ||
                st.tasks.filter(function (r) { return r.status_code === 'in_work'; })[0] || st.tasks[0] || null;
        });
    }

    function loadTaskDetails() {
        if (!st.task) return Promise.resolve();
        st.batches = []; st.meas = [];
        var jobs = KINDS.map(function (k) {
            return PF.children(PF.tid(k.name), st.task.task_id).then(function (rows) {
                var t = PF.table(k.name);
                var idx = {};
                ['Маркировка тележки', 'Начат', 'Завершён'].forEach(function (n) {
                    idx[n] = 1 + t.reqs.findIndex(function (q) { return q.name === n; });
                });
                rows.forEach(function (r) {
                    st.batches.push({id: r.i, no: PF.num(r.r[0]) || 0, kind: k.name, short: k.short,
                        cart: r.r[idx['Маркировка тележки']], started: r.r[idx['Начат']]});
                });
            });
        });
        KINDS.forEach(function (k) {
            jobs.push(PF.report(k.report, {FR_task_id: st.task.task_id}).then(function (rows) {
                rows.forEach(function (m) { if (String(m.task_id) === String(st.task.task_id)) st.meas.push(m); });
            }));
        });
        jobs.push(loadCard());
        return Promise.all(jobs).then(function () {
            st.batches.sort(function (a, b) { return a.no - b.no; });
            if (!st.current || !st.batches.some(function (b) { return b.id === st.current; }))
                st.current = st.batches.length ? st.batches[st.batches.length - 1].id : null;
            st.kind = guessKind();
        });
    }

    function guessKind() {
        if (st.batches.length) return st.batches[st.batches.length - 1].kind;
        var name = (st.task && (st.task.card || st.task.product) || '').toLowerCase();
        var hit = KINDS.filter(function (k) { return name.indexOf(k.short) >= 0; })[0];
        return (hit || KINDS[0]).name;
    }

    function loadCard() {
        st.lines = [];
        if (!st.task || !st.task.card) return Promise.resolve();
        return PF.rows(PF.tid('Карта контроля')).then(function (cards) {
            var card = cards.filter(function (c) { return c.r[0] === st.task.card; })[0];
            if (!card) return;
            return PF.children(PF.tid('Строка карты'), card.i).then(function (rows) {
                var t = PF.table('Строка карты');
                var idx = {};
                ['Показатель контроля', 'Порядок сортировки', 'Обязателен', 'Норма мин карты', 'Норма макс карты']
                    .forEach(function (n) { idx[n] = 1 + t.reqs.findIndex(function (q) { return q.name === n; }); });
                st.lines = rows.map(function (r) {
                    var nm = PF.refVal(r.r[idx['Показатель контроля']]);
                    return {
                        indId: PF.refId(r.r[idx['Показатель контроля']]), indName: nm,
                        ord: PF.num(r.r[idx['Порядок сортировки']]) || 0,
                        required: r.r[idx['Обязателен']] === 'X',
                        min: PF.num(r.r[idx['Норма мин карты']]),
                        max: PF.num(r.r[idx['Норма макс карты']]),
                        type: (st.dicts.ind[nm] || {}).type || 'value'
                    };
                }).sort(function (a, b) { return a.ord - b.ord; });
            });
        });
    }

    function isInterval(line) {
        return String(line.type || '').indexOf('interval') === 0;
    }

    /* --------------------------------------------------------- запись замера */
    function measOf(batchId, indName) {
        return st.meas.filter(function (m) {
            return String(m.batch_id) === String(batchId) && m.indicator === indName;
        })[0];
    }

    function saveMeasurement(line, batchId, value, endMode, comment) {
        var m = measOf(batchId, line.indName);
        var fields = {};
        if (endMode) {
            fields[PF.f('Замер', 'Значение окончания, °C')] = value === null ? '' : value;
            fields[PF.f('Замер', 'Время окончания замера')] = PF.stampNow();
        } else {
            fields[PF.f('Замер', 'Значение, °C')] = value === null ? '' : value;
            fields[PF.f('Замер', 'Время замера')] = PF.stampNow();     // время ставит система (ФТ-15)
        }
        if (comment) fields[PF.f('Замер', 'Комментарий замера')] = comment;
        var op = null;
        if (m) {
            op = PF.update(m.zamer_id, fields);
        } else {
            fields[PF.f('Замер', 'Показатель контроля')] = line.indId;
            fields[PF.f('Замер', 'Оператор замера')] = PF.uid;
            op = PF.create(PF.tid('Замер'), fields, batchId);
        }
        var qKey = batchId + '|' + line.indName + '|' + (endMode ? 'end' : 'val');
        return op.catch(function (e) {
            PF.queue.put({uid: qKey, batchId: batchId, indId: line.indId, indName: line.indName,
                fields: fields, existing: m ? m.zamer_id : 0});
            PF.toast('Нет связи — замер сохранён в очередь, отправим при восстановлении', 'warn');
            throw e;
        });
    }

    function flushQueue() {
        return PF.queue.flush(function (item) {
            return item.existing ? PF.update(item.existing, item.fields)
                : PF.create(PF.tid('Замер'), item.fields, item.batchId);
        }).then(function (n) {
            if (n) PF.toast('Отправлено из очереди: ' + n);
            return n;
        });
    }

    /* ------------------------------------------------------------- действия */
    function addBatch() {
        var kinds = KINDS.map(function (k) { return {id: k.name, name: k.name}; });
        var next = st.batches.filter(function (b) { return b.kind === st.kind; }).length + 1;
        var f = PF.form([
            {key: 'kind', label: 'Тип замеса', type: 'select', options: kinds},
            {key: 'cart', label: 'Маркировка тележки', type: 'text', placeholder: 'Т-104'}
        ], {kind: st.kind});
        PF.modal('Замес №' + next, f.node, [{
            text: 'Добавить замес', primary: true, onClick: function (close) {
                var v = f.values();
                var n = st.batches.filter(function (b) { return b.kind === v.kind; }).length + 1;
                var fields = {};
                fields['t' + PF.tid(v.kind)] = n;                       // номер по порядку (ФТ-14)
                fields[PF.f(v.kind, 'Маркировка тележки')] = v.cart;
                fields[PF.f(v.kind, 'Начат')] = PF.stampNow();
                PF.create(PF.tid(v.kind), fields, st.task.task_id).then(function (id) {
                    close();
                    st.current = id;
                    st.kind = v.kind;
                    PF.toast('Замес ' + n + ' добавлен');
                    reload();
                }).catch(PF.error);
            }
        }]);
    }

    function downtimeForm() {
        var f = PF.form([
            {key: 'equip', label: 'Оборудование', type: 'ref', options: st.dicts.equip},
            {key: 'fail', label: 'Вид поломки / остановки', type: 'ref', options: st.dicts.fail},
            {key: 'minutes', label: 'Длительность, мин', type: 'number'},
            {key: 'comment', label: 'Комментарий', type: 'memo', rows: 2}
        ], {});
        PF.modal('Поломка / простой', f.node, [{
            text: 'Записать простой', primary: true, onClick: function (close) {
                var v = f.values(), fields = {};
                var now = PF.serverNow();
                fields[PF.f('Простой', 'Оборудование')] = v.equip;
                fields[PF.f('Простой', 'Вид поломки')] = v.fail;
                fields[PF.f('Простой', 'Начало простоя')] = PF.stampNow();
                fields[PF.f('Простой', 'Окончание простоя')] = PF.fmtDT(new Date(now.getTime() + (PF.num(v.minutes) || 0) * 60000));
                fields[PF.f('Простой', 'Длительность, мин')] = v.minutes;
                fields[PF.f('Простой', 'Комментарий простоя')] = v.comment;
                PF.create(PF.tid('Простой'), fields, st.task.task_id)
                    .then(function () { close(); PF.toast('Простой записан'); }).catch(PF.error);
            }
        }]);
    }

    function setStatus(code) {
        var s = (st.dicts.status.filter(function (x) { return x.code === code; })[0] || {}).id;
        var f = {};
        f[PF.f(TASK, 'Статус')] = s;
        if (code === 'in_work' && !st.task.started) f[PF.f(TASK, 'Начато')] = PF.stampNow();
        if (code === 'done') f[PF.f(TASK, 'Завершено')] = PF.stampNow();
        return PF.update(st.task.task_id, f);
    }

    function missing() {
        var miss = [];
        st.batches.forEach(function (b) {
            st.lines.filter(function (l) { return l.required; }).forEach(function (l) {
                var m = measOf(b.id, l.indName);
                if (!m || m.value === '') miss.push('Замес ' + b.no + ' · ' + l.indName);
            });
        });
        return miss;
    }

    function finishTask() {
        var miss = missing();
        var done = function () {
            setStatus('done').then(function () { PF.toast('Задание завершено'); reload(); }).catch(PF.error);
        };
        if (!miss.length) { done(); return; }
        PF.modal('Завершить с пропусками?', el('div', {}, [
            el('p', {text: 'Не заполнены обязательные показатели (' + miss.length + '):'}),
            el('ul', {}, miss.slice(0, 12).map(function (x) { return el('li', {text: x}); }))
        ]), [{text: 'Всё равно завершить', primary: true, onClick: function (close) { close(); done(); }}]);
    }

    /* --------------------------------------------------------------- рендер */
    function measRow(line) {
        var batchId = st.current;
        var m = measOf(batchId, line.indName);
        var min = line.min === null ? ABS_MIN : line.min;
        var max = line.max === null ? ABS_MAX : line.max;
        var row = el('div', {class: 'pf-meas'});
        var v = m ? PF.num(m.value) : null;
        var out = v !== null && (v < min || v > max);
        if (out) row.classList.add('pf-meas--out');

        row.appendChild(el('div', {}, [
            el('div', {class: 'pf-meas__name', text: line.indName + (line.required ? ' *' : '')}),
            el('div', {class: 'pf-meas__norm', text: 'норма +' + min + '…+' + max + ' °C' +
                (isInterval(line) ? ' · интервал' : '')})
        ]));

        var state = el('div', {class: 'pf-meas__state', text: m && m.value !== '' ? '✓' : ''});
        var time = el('div', {class: 'pf-meas__time', text: m ? PF.fmtTime(m.ts) : ''});

        function commit(input, endMode) {
            var raw = input.value.replace(',', '.').trim();
            if (raw === '') return;
            var val = parseFloat(raw);
            if (isNaN(val)) { PF.toast('Введите число', 'warn'); return; }
            var proceed = function (comment) {
                state.textContent = '⏳';
                saveMeasurement(line, batchId, val, endMode, comment)
                    .then(function () {
                        state.textContent = '✓';
                        time.textContent = PF.fmtTime(PF.serverNow());
                        return refreshMeas();
                    })
                    .then(function () { renderBody(); })
                    .catch(function () { state.textContent = '⚠'; });
            };
            if (val < ABS_MIN || val > ABS_MAX) {                 // описка (ФТ-17.1)
                PF.modal('Проверьте значение', el('p', {
                    text: 'Введено ' + val + ' °C — за пределами физического диапазона +' + ABS_MIN +
                        '…+' + ABS_MAX + ' °C. Сохранить как есть?'
                }), [{text: 'Сохранить', primary: true, onClick: function (close) {
                    close(); proceed('Подтверждено оператором: значение вне диапазона +1…+100 °C');
                }}]);
                return;
            }
            if (val < min || val > max) {                          // отклонение (ФТ-17)
                var cf = PF.form([{key: 'c', label: 'Комментарий к отклонению', type: 'memo', rows: 2}], {});
                PF.modal('Значение вне нормы', el('div', {}, [
                    el('p', {text: 'Значение ' + val + ' °C выходит за норму +' + min + '…+' + max + ' °C. Замер будет сохранён.'}),
                    cf.node
                ]), [{text: 'Сохранить', primary: true, onClick: function (close) {
                    close(); proceed(cf.values().c || 'Отклонение от нормы');
                }}]);
                return;
            }
            proceed('');
        }

        if (isInterval(line)) {
            var startBtn = el('button', {
                class: 'pf-btn' + (m && m.ts ? ' pf-btn--primary' : ''), type: 'button',
                text: m && m.ts ? 'Начало ' + PF.fmtTime(m.ts) + ' ✓' : 'Начало',
                onclick: function () {
                    state.textContent = '⏳';
                    saveMeasurement(line, batchId, PF.num(m && m.value) || null, false, '')
                        .then(refreshMeas).then(renderBody).catch(function () { state.textContent = '⚠'; });
                }
            });
            var endBtn = el('button', {
                class: 'pf-btn' + (m && m.ts_end ? ' pf-btn--primary' : ''), type: 'button',
                text: m && m.ts_end ? 'Окончание ' + PF.fmtTime(m.ts_end) + ' ✓' : 'Окончание →',
                onclick: function () {
                    if (!m) { PF.toast('Сначала отметьте начало', 'warn'); return; }
                    state.textContent = '⏳';
                    saveMeasurement(line, batchId, PF.num(m.value_end) || null, true, '')
                        .then(refreshMeas).then(renderBody).catch(function () { state.textContent = '⚠'; });
                }
            });
            var iv = el('input', {type: 'number', inputmode: 'decimal', class: 'pf-input pf-meas__val',
                placeholder: '°C', value: v === null ? '' : v});
            iv.addEventListener('change', function () { commit(iv, false); });
            row.appendChild(iv);
            row.appendChild(el('div', {class: 'pf-meas__interval'}, [startBtn, endBtn]));
            row.appendChild(state);
            return row;
        }

        var input = el('input', {
            type: 'number', inputmode: 'decimal', class: 'pf-input pf-meas__val',
            placeholder: '°C', value: v === null ? '' : v
        });
        input.addEventListener('change', function () { commit(input, false); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                commit(input, false);
                var all = Array.prototype.slice.call(root.querySelectorAll('.pf-meas__val'));
                var i = all.indexOf(input);
                if (i >= 0 && all[i + 1]) all[i + 1].focus();
            }
        });
        row.appendChild(input);
        row.appendChild(time);
        row.appendChild(state);
        return row;
    }

    function refreshMeas() {
        st.meas = [];
        return Promise.all(KINDS.map(function (k) {
            return PF.report(k.report, {FR_task_id: st.task.task_id}).then(function (rows) {
                rows.forEach(function (m) { if (String(m.task_id) === String(st.task.task_id)) st.meas.push(m); });
            });
        }));
    }

    var bodyBox = null;

    function renderBody() {
        if (!bodyBox) return;
        PF.clear(bodyBox);
        if (!st.current) {
            bodyBox.appendChild(el('div', {class: 'pf-empty', text: 'Добавьте первый замес кнопкой «+ Замес»'}));
            return;
        }
        var batch = st.batches.filter(function (b) { return b.id === st.current; })[0];
        var lines = st.lines;
        var filled = lines.filter(function (l) {
            var m = measOf(st.current, l.indName);
            return m && m.value !== '';
        }).length;
        bodyBox.appendChild(el('div', {class: 'pf-entry-head__row', style: 'padding:6px 12px'}, [
            el('div', {class: 'pf-entry-meta', text: 'Тележка: ' + (batch && batch.cart || '—') +
                ' · начат ' + PF.fmtTime(batch && batch.started)}),
            el('div', {class: 'pf-entry-meta', text: 'Заполнено ' + filled + ' из ' + lines.length})
        ]));
        if (!lines.length) {
            bodyBox.appendChild(el('div', {class: 'pf-empty', text: 'В карте контроля задания нет строк показателей'}));
        }
        lines.forEach(function (l) { bodyBox.appendChild(measRow(l)); });
    }

    function render() {
        PF.clear(root);
        if (!st.tasks.length) {
            root.appendChild(el('div', {class: 'pf-card'}, [
                el('h2', {text: 'Нет доступных заданий'}),
                el('p', {text: 'Мастер ещё не создал задание на вашу смену либо все задания уже завершены.'})
            ]));
            return;
        }
        var t = st.task;
        var head = el('div', {class: 'pf-entry-head'});
        var sel = el('select', {class: 'pf-input', style: 'max-width:520px', onchange: function () {
            st.task = st.tasks.filter(function (x) { return String(x.task_id) === sel.value; })[0];
            st.current = null;
            reload();
        }});
        st.tasks.forEach(function (x) {
            var o = el('option', {value: x.task_id, text: '№' + x.task_no + ' · ' + PF.fmtDate(x.date) + ' · ' +
                x.shift + ' · ' + x.product + ' · ' + x.pack_type + ' · ' + x.status});
            if (String(x.task_id) === String(t.task_id)) o.setAttribute('selected', 'selected');
            sel.appendChild(o);
        });
        head.appendChild(el('div', {class: 'pf-entry-head__row'}, [
            sel,
            el('div', {class: 'pf-actions'}, [
                t.status_code === 'new' ? el('button', {class: 'pf-btn pf-btn--primary', text: 'Взять в работу',
                    onclick: function () { setStatus('in_work').then(function () { PF.toast('Задание в работе'); reload(); }); }}) : null,
                el('button', {class: 'pf-btn', text: 'Карточка задания', onclick: function () { PF.go('pf-task', {id: t.task_id}); }})
            ])
        ]));
        head.appendChild(el('div', {class: 'pf-entry-meta', style: 'margin-top:6px',
            text: 'Линия: ' + t.line + ' · упаковка: ' + t.pack_type + ' · ' + (t.gramm || '') + ' г · карта: ' + (t.card || '—')}));

        var tabs = el('div', {class: 'pf-tabs', style: 'padding:10px 12px'});
        st.batches.forEach(function (b) {
            tabs.appendChild(el('button', {
                class: 'pf-tab' + (b.id === st.current ? ' pf-tab--active' : ''),
                type: 'button', text: String(b.no),
                title: b.kind + ' · ' + (b.cart || ''),
                onclick: function () { st.current = b.id; st.kind = b.kind; render(); }
            }));
        });
        if (PF.canWrite('Замес-кусочки')) {
            tabs.appendChild(el('button', {class: 'pf-tab', type: 'button', text: '+ Замес', onclick: addBatch}));
        }

        bodyBox = el('div', {class: 'pf-entry-body'});
        var actions = el('div', {class: 'pf-sticky-actions'}, [
            el('button', {class: 'pf-btn pf-btn--lg', type: 'button', text: 'Поломка / простой', onclick: downtimeForm}),
            el('button', {class: 'pf-btn pf-btn--lg pf-btn--primary', type: 'button', text: 'Завершить задание', onclick: finishTask})
        ]);
        root.appendChild(el('div', {class: 'pf-card', style: 'padding:0'}, [head, tabs, bodyBox, actions]));
        renderBody();
    }

    function reload() {
        PF.loading(root);
        return loadTaskDetails().then(render).catch(function (e) {
            PF.clear(root).appendChild(el('div', {class: 'pf-card', text: 'Ошибка: ' + e.message}));
            PF.error(e);
        });
    }

    PF.loading(root);
    PF.schema().then(loadDicts).then(loadTasks).then(flushQueue).then(reload)
        .catch(function (e) {
            PF.clear(root).appendChild(el('div', {class: 'pf-card', text: 'Ошибка: ' + e.message}));
            PF.error(e);
        });
    window.addEventListener('online', flushQueue);
})();
