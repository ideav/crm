/* Диспетчеризация: экран «Акты отклонений». Акт из тревоги: партии, лежавшие в зоне, решение по каждой, утверждение руководителем качества. */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    var opened = false;
    /* Решение по партии правит тот, у кого поле не закрыто ролью (заведующая видит решение, но не принимает его). */
    function canDecide() {
        var t = P.metaBy['Партия в акте']; if (!t || t.granted !== 'WRITE') return false;
        var rq = (t.reqs || []).filter(function (q) { return q.val === 'Решение по партии'; })[0];
        return !(rq && rq.granted && rq.granted !== 'WRITE');
    }
    function card(M, x) {
        var a = M.alarmBy[x.alarm] || {}, mode = M.modeOfZone(a.zone) || {};
        var canEdit = P.canWrite('Акт отклонения') && x.status !== 'Утверждён', decide = canDecide() && x.status !== 'Утверждён';
        var canApprove = P.canWrite('Режим хранения') && x.status !== 'Утверждён';
        var cause = P.el('textarea', { rows: 2 }); cause.value = x.cause; cause.disabled = !canEdit;
        var list = P.el('div', {}, ['Загрузка партий...']), errBox = P.el('div', {}), lines = [];
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'dsp-kv', html: '<span>Тревога</span><span><a href="' + P.nav('alarms', 'code=' + encodeURIComponent(x.alarm)) + '">' + P.esc(x.alarm) + '</a> ' + P.esc(a.obj + ', ' + a.zone) + '</span>' }),
            P.el('div', { 'class': 'dsp-kv', html: '<span>Отклонение</span><span>' + P.esc(C.toDmy(a.date) + ' ' + a.time + ', пик ' + P.deg(a.peak) + ', ' + a.minutes + ' мин при режиме ' + (mode.name || '')) + '</span>' }),
            P.el('div', { 'class': 'dsp-kv', html: '<span>Реакция</span><span>' + (a.code ? P.reactHtml(M, a) + ', ' + P.esc(P.short(a.resp)) : '') + (a.moved ? ', товар перенесён' : '') + '</span>' }),
            P.el('div', { 'class': 'dsp-kv', html: '<span>Статус</span><span>' + P.badge(x.status, P.ACT_KIND[x.status]) + (x.signer ? ' подписал ' + P.esc(P.short(x.signer)) + ' ' + P.esc(C.toDmy(x.date) + ' ' + (x.signTime || '')) : '') + '</span>' }),
            P.field('Причина отклонения', cause), P.el('h3', { text: 'Партии в зоне на момент отклонения', style: 'margin-top:10px' }), list, errBox]);
        P.get('object/' + P.tid('Партия в акте') + '/?JSON_OBJ&NAMED&F_U=' + x.id).then(function (rows) {
            list.innerHTML = '';
            if (!rows.length) { list.textContent = 'Партий в зоне не было.'; return; }
            rows.forEach(function (r) {
                var name = P.dec(r['Партия в акте']), b = M.batchBy[name] || {}, cur = r['Решение по партии'] ? P.dec(r['Решение по партии'].val) : '';
                var sel = P.select([['', 'решение не принято']].concat(C.DECISIONS.map(function (d) { return [d, d]; })), cur); sel.disabled = !decide;
                var com = P.input('text', P.dec(r['Комментарий к решению'] || ''), { placeholder: 'комментарий' }); com.disabled = !decide;
                lines.push({ id: r.id, batch: name, drug: b.drug, sel: sel, com: com });
                list.appendChild(P.el('div', { 'class': 'dsp-card', style: 'margin-bottom:8px' }, [
                    P.el('div', { html: '<b>' + P.esc(name) + '</b> ' + P.esc(b.drug || '') + ' <span class="dsp-muted">' + P.esc((b.maker || '') + (b.qty ? ', ' + b.qty + ' уп' : '')) + '</span>' }),
                    P.el('div', { 'class': 'dsp-grid2', style: 'margin-top:6px' }, [sel, com])]));
            });
            if (!decide && x.status !== 'Утверждён') list.appendChild(P.el('p', { 'class': 'dsp-muted', text: 'Решение по партии принимает руководитель службы качества (оценку влияния даёт производитель).' }));
        }, function (er) { list.textContent = er.denied ? 'Партии закрыты ролью.' : er.message; });
        function save() {
            var ch = canEdit ? P.update(x.id, { 'Причина отклонения': cause.value }) : Promise.resolve();
            if (decide) lines.forEach(function (l) { ch = ch.then(function () { var f = { 'Комментарий к решению': l.com.value }; if (l.sel.value) f['Решение по партии'] = l.sel.value; return P.update(l.id, f); }); });
            return ch;
        }
        var btns = [{ text: 'Закрыть окно' }];
        if (canEdit || decide) btns.push({ text: 'Сохранить', fn: function (close) { save().then(function () { P.toast('Акт ' + x.code + ' сохранён'); close(); P.refresh(); }, function (er) { P.toast(er.message, true); }); return false; } });
        if (canApprove) btns.push({ text: 'Утвердить и подписать', cls: 'dsp-primary', fn: function (close) {
            var errs = C.actErrors({ cause: cause.value }, lines.map(function (l) { return { name: l.batch, drug: l.drug }; }), lines.map(function (l) { return { batch: l.batch, decision: l.sel.value }; }));
            errBox.innerHTML = ''; errs.forEach(function (t) { errBox.appendChild(P.el('div', { 'class': 'dsp-warnbox dsp-e', text: t })); });
            if (errs.length) return false;
            var who = M.me ? M.me.name : M.head;
            save().then(function () { return P.update(x.id, { 'Статус акта': 'Утверждён', 'Подписал': who, 'Дата акта': P.TODAY, 'Время подписи': P.CLOCK }); }).then(function () { P.toast('Акт ' + x.code + ' утверждён'); close(); P.refresh(); }, function (er) { P.toast(er.message, true); });
            return false;
        } });
        P.modal('Акт отклонения ' + x.code, body, btns, true);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Акты отклонений', 'Акт формируется из тревоги: партии, лежавшие в зоне в момент отклонения, подставляются сами. Утвердить можно только с причиной и решением по каждой партии.')));
        if (!M.acts) { host.appendChild(P.el('p', { 'class': 'dsp-muted', text: 'Раздел закрыт ролью.' })); return; }
        var noAct = M.alarms.filter(function (a) { return a.cls === 'Тревога' && !M.actByAlarm[a.code]; });
        if (noAct.length) host.appendChild(P.el('div', { 'class': 'dsp-warnbox dsp-w', text: 'Тревоги без акта: ' + noAct.map(function (a) { return a.code + ' (' + a.obj + ', ' + C.toShort(a.date) + ')'; }).join(', ') + '. Откройте тревогу и нажмите «Сформировать акт».' }));
        var rows = M.acts.slice().sort(function (x, y) { return (x.status === 'Черновик' ? 0 : 1) - (y.status === 'Черновик' ? 0 : 1) || (y.date < x.date ? -1 : 1); });
        host.appendChild(P.table([
            { t: 'Акт', html: function (x) { return '<b>' + P.esc(x.code) + '</b>'; } },
            { t: 'Дата', html: function (x) { return P.esc(C.toDmy(x.date)); } },
            { t: 'Тревога', html: function (x) { var a = M.alarmBy[x.alarm] || {}; return P.esc(x.alarm) + '<br><span class="dsp-muted">' + P.esc((a.zone || '') + ', ' + P.deg(a.peak)) + '</span>'; } },
            { t: 'Объект', k: 'obj' },
            { t: 'Причина', html: function (x) { return x.cause ? P.esc(x.cause) : '<span class="dsp-t-overdue">не указана</span>'; } },
            { t: 'Статус', html: function (x) { return P.badge(x.status, P.ACT_KIND[x.status]) + (x.signer ? '<br><span class="dsp-muted">' + P.esc(P.short(x.signer)) + '</span>' : ''); } }
        ], rows, { onrow: function (x) { card(M, x); }, rowCls: function (x) { return x.status === 'Черновик' ? 'dsp-row-warn' : ''; }, empty: 'Актов нет' }));
        var h = P.hash(), x = h.code && M.acts.filter(function (y) { return y.code === h.code; })[0];
        if (x && !opened) { opened = true; card(M, x); }
    }
    P.mount(render);
})();
