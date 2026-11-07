// ЛК базы my (#5420): поле «Аккаунт» профиля и раздел «Обзор».
// Поле «Аккаунт» перенесено из инлайн-скрипта templates/my/main.html без изменений логики.
(function() {
    if (typeof document === 'undefined') return;
    var USERNAME_REGEX = /^[a-zA-Z]([a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,32}$/;
    var savedUsername = ''; // tracks the last successfully saved (or loaded) username

    function isValidUsername(val) {
        return USERNAME_REGEX.test(val);
    }

    function initAccountField() {
        var usernameInput = document.getElementById('profile-username');
        var saveUsernameBtn = document.getElementById('save-username-btn');
        var usernameHint = document.getElementById('profile-username-hint');
        var usernameError = document.getElementById('profile-username-error');
        var publicCheckbox = document.getElementById('profile-public');

        if (!usernameInput || !saveUsernameBtn || !publicCheckbox) return;

        var originalUsername = usernameInput.value;

        function updateUsernameUI() {
            var val = usernameInput.value;
            var changed = val !== originalUsername;
            var valid = isValidUsername(val);

            // Show save button if value changed
            saveUsernameBtn.style.display = changed ? '' : 'none';

            // Show hint while editing (field is focused or has content being edited)
            usernameHint.style.display = changed ? '' : 'none';

            // Clear error while typing
            usernameError.style.display = 'none';
            usernameError.textContent = '';
        }

        usernameInput.addEventListener('input', updateUsernameUI);
        usernameInput.addEventListener('focus', function() {
            if (!isValidUsername(usernameInput.value)) {
                usernameHint.style.display = '';
            }
        });
        usernameInput.addEventListener('blur', function() {
            if (usernameInput.value === originalUsername) {
                usernameHint.style.display = 'none';
            }
        });

        saveUsernameBtn.addEventListener('click', async function() {
            var val = usernameInput.value.trim();
            if (!isValidUsername(val)) {
                usernameError.textContent = 'Неверный формат аккаунта. Только латинские буквы, цифры и дефис, начинается с буквы, до 33 символов';
                usernameError.style.display = '';
                return;
            }

            saveUsernameBtn.disabled = true;
            usernameError.style.display = 'none';

            try {
                var apiConfig = window._cabinetController && window._cabinetController.apiConfig;
                var host = apiConfig ? apiConfig.host : location.host;
                var url = 'https://' + host + '/my/report/236592?JSON_KV';

                var fd = new FormData();
                fd.append('name', val);
                fd.append('confirmed', '1');
                if (typeof xsrf !== 'undefined') fd.append('_xsrf', xsrf);

                var response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                var data = await response.json();

                if (!data || typeof data.name === 'undefined' || data.name !== val) {
                    throw new Error('Сервер вернул неожиданный ответ');
                }

                // Success
                originalUsername = val;
                savedUsername = val;
                usernameInput.value = val;
                updateUsernameUI();
                if (typeof showToast === 'function') showToast('Аккаунт сохранен', 'success');
            } catch (err) {
                usernameError.textContent = 'Ошибка сохранения: ' + (err.message || 'неизвестная ошибка');
                usernameError.style.display = '';
                if (typeof showToast === 'function') showToast('Ошибка сохранения аккаунта', 'error');
            } finally {
                saveUsernameBtn.disabled = false;
            }
        });

        // Restrict public profile checkbox if account is not saved with valid format
        publicCheckbox.addEventListener('click', function(e) {
            if (!isValidUsername(savedUsername)) {
                e.preventDefault();
                publicCheckbox.checked = false;
                usernameError.textContent = 'Сначала сохраните Аккаунт в правильном формате, чтобы включить публичный профиль';
                usernameError.style.display = '';
                usernameInput.focus();
                return false;
            }
        });
    }

    // Wait for DOM + cabinet data load, then patch loadUserData to also set username
    function patchCabinetController() {
        if (!window._cabinetController) {
            setTimeout(patchCabinetController, 100);
            return;
        }
        var ctrl = window._cabinetController;
        var origPopulateProfile = ctrl.populateProfile.bind(ctrl);
        ctrl.populateProfile = function() {
            origPopulateProfile();
            // Populate username field from UserName field
            var usernameInput = document.getElementById('profile-username');
            if (usernameInput && ctrl.userData) {
                var uname = ctrl.userData.UserName || '';
                usernameInput.value = uname;
                // If already valid, mark as saved and make it readonly
                if (USERNAME_REGEX.test(uname)) {
                    savedUsername = uname;
                    usernameInput.readOnly = true;
                    usernameInput.disabled = true;
                    usernameInput.title = 'Аккаунт уже задан и не может быть изменён';
                    usernameInput.classList.add('profile-email-disabled');
                    var saveBtn = document.getElementById('save-username-btn');
                    if (saveBtn) saveBtn.style.display = 'none';
                    var hint = document.getElementById('profile-username-hint');
                    if (hint) hint.style.display = 'none';
                }
            }
        };
    }

    document.addEventListener('DOMContentLoaded', function() {
        initAccountField();
        patchCabinetController();
    });
})();

// Раздел «Обзор»: сводка из тех же данных, что заполняют остальные разделы (report/313 и cabdata)
(function (root) {
    'use strict';

    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }

    // Даты отчётов — ДД.ММ.ГГГГ; для сортировки — ГГГГММДД
    function dateKey(s) {
        var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || ''));
        return m ? m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2) : '';
    }

    function overview(userData, databases, cabData) {
        var u = userData || {};
        var dbs = (databases || []).filter(function (d) { return d && d.DB; });
        var units = dbs.reduce(function (s, d) { return s + (parseInt(d.Count || '0', 10) || 0); }, 0);
        var limit = parseInt(u.PlanLimit || '0', 10) || (cabData && cabData.limit) || 3000;
        var planId = parseInt(u.PlanID || '0', 10);
        var recent = dbs.slice().sort(function (a, b) {
            var ka = dateKey(a.Date), kb = dateKey(b.Date);
            return ka < kb ? 1 : ka > kb ? -1 : 0;
        }).slice(0, 5).map(function (d) { return { name: d.DB, count: parseInt(d.Count || '0', 10) || 0, date: d.Date || '' }; });
        return {
            name: u.Name || '',
            dbs: dbs.length,
            dbsNote: planId && planId < 1147 ? 'из 3 на бесплатном плане' : '',
            plan: u.Plan || 'Free',
            planDate: u['Plan date'] || '',
            balance: num(u.Balance),
            bonuses: num(u.Bonus),
            units: units,
            limit: limit,
            percent: Math.min(100, Math.round(units / limit * 1000) / 10),
            recent: recent
        };
    }

    function setText(doc, id, text) {
        var el = doc.getElementById(id);
        if (el) el.textContent = text;
    }

    function render(doc, ov, host) {
        setText(doc, 'mc-hello-name', ov.name ? ', ' + ov.name : '');
        setText(doc, 'mc-kpi-dbs', String(ov.dbs));
        setText(doc, 'mc-kpi-dbs-note', ov.dbsNote);
        setText(doc, 'mc-kpi-plan', ov.plan);
        setText(doc, 'mc-kpi-plan-note', ov.planDate ? 'оплачен до ' + ov.planDate : '');
        setText(doc, 'mc-kpi-balance', ov.balance.toLocaleString('ru-RU'));
        setText(doc, 'mc-kpi-bonuses', ov.bonuses.toLocaleString('ru-RU'));
        setText(doc, 'mc-usage-units', String(ov.units));
        setText(doc, 'mc-usage-limit', String(ov.limit));
        setText(doc, 'mc-usage-note', ov.percent >= 100 ? 'Лимит плана исчерпан — повысьте план, чтобы базы продолжили работу.'
            : ov.percent >= 80 ? 'Расход близок к лимиту плана.' : 'Использовано ' + ov.percent + '% лимита плана.');
        var fill = doc.getElementById('mc-usage-fill');
        if (fill) {
            fill.style.width = ov.percent + '%';
            fill.classList.toggle('mc-usage-warn', ov.percent >= 80);
        }
        var box = doc.getElementById('mc-recent-dbs');
        if (!box) return;
        box.textContent = '';
        if (!ov.recent.length) {
            var p = doc.createElement('p');
            p.className = 'mc-muted';
            p.textContent = 'Баз пока нет — создайте первую.';
            box.appendChild(p);
            return;
        }
        ov.recent.forEach(function (d) {
            var a = doc.createElement('a');
            a.className = 'mc-recent-item';
            a.href = 'https://' + host + '/' + encodeURIComponent(d.name);
            a.target = d.name;
            var n = doc.createElement('strong');
            n.textContent = d.name;
            var meta = doc.createElement('span');
            meta.className = 'mc-muted';
            meta.textContent = 'расход ' + d.count + (d.date ? ' · создана ' + d.date : '');
            a.appendChild(n);
            a.appendChild(meta);
            box.appendChild(a);
        });
    }

    root.MyCabinet = { overview: overview, render: render };

    if (!root.document || !root.document.getElementById('section-overview')) return;

    // Кнопки обзора ведут в разделы; «Создать базу» сразу открывает форму создания
    root.document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-mc-go]') : null;
        var ctrl = root._cabinetController;
        if (!btn || !ctrl) return;
        ctrl.showSection(btn.dataset.mcGo);
        ctrl.updateUrlHash(btn.dataset.mcGo);
        if (btn.dataset.mcCreate) {
            var create = root.document.getElementById('create-db-btn');
            var form = root.document.getElementById('create-db-form');
            if (create && form && form.style.display === 'none') create.click();
        }
    });

    function hook() {
        var ctrl = root._cabinetController;
        if (!ctrl) return setTimeout(hook, 100);
        var draw = function () {
            render(root.document, overview(ctrl.userData, ctrl.databases, ctrl.cabData), ctrl.apiConfig.host);
        };
        var orig = ctrl.populateUserData.bind(ctrl);
        ctrl.populateUserData = function () {
            orig();
            draw();
        };
        if (ctrl.userData) draw();
    }
    root.document.addEventListener('DOMContentLoaded', hook);
})(typeof window !== 'undefined' ? window : globalThis);
