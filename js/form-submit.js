// ────────────────────────────────────────────────────────────────────────────
// Глобальный Ctrl+Enter / Cmd+Enter → отправка формы из любого поля ввода.
//
// Единое поведение для ВСЕХ форм и модалок проекта. Подключается в main.html,
// поэтому работает на каждой странице (ядро + все рабочие места atex).
// См. docs/UI_UX_GUIDELINES.md, раздел «Отправка формы с клавиатуры».
//
// Приоритет поиска цели от поля, в котором стоит фокус:
//   1) ближайшая <form>            → form.requestSubmit() (настоящие формы — без правок);
//   2) ближайшая модалка/панель    → клик по [data-default-submit], иначе по первой
//      видимой primary-кнопке (button[type=submit] / *-btn-primary / .menu-modal-btn.save).
//   Контейнер не-<form> формы помечается атрибутом data-submit-scope; модалки ловятся
//   по классу/role автоматически. Если ни форма, ни scope не найдены — ничего не делаем
//   (Ctrl+Enter в случайном поле вне формы безопасен).
//
// Локальные обработчики имеют приоритет: если кто-то уже обработал Ctrl+Enter и вызвал
// preventDefault (например, фиксация правки ячейки в integram-table) — мы не вмешиваемся.
// ────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // Контейнеры, внутри которых Ctrl+Enter ищет primary-кнопку (для не-<form> форм).
    var SCOPE_SELECTOR = '[data-submit-scope],[role="dialog"],dialog,.menu-modal,[class*="modal"],[class*="overlay"]';

    // Кандидаты на роль «главной» кнопки внутри scope (в порядке предпочтения).
    var PRIMARY_SELECTOR = [
        'button[type="submit"]',
        'input[type="submit"]',
        '[class*="-btn-primary"]',
        '[class*="-btn--primary"]',
        '.btn-primary',
        '.menu-modal-btn.save'
    ].join(',');

    // Поле ввода, из которого осмысленно отправлять форму по Ctrl+Enter.
    function isTextEntry(el) {
        if (!el || el.disabled || el.readOnly) return false;
        var tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag === 'INPUT') {
            var t = String((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase();
            return ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].indexOf(t) === -1;
        }
        return el.isContentEditable === true;
    }

    // Видимая, доступная для клика кнопка.
    function isVisible(el) {
        if (!el || el.disabled) return false;
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
        if (el.hidden) return false;
        if (typeof el.offsetParent !== 'undefined') {
            if (el.offsetParent !== null) return true;
            if (el.getClientRects && el.getClientRects().length > 0) return true;
            return false;
        }
        return true;
    }

    function firstVisible(scope, selector) {
        var list = scope.querySelectorAll(selector);
        for (var i = 0; i < list.length; i++) {
            if (isVisible(list[i])) return list[i];
        }
        return null;
    }

    // Чистая логика выбора цели отправки — без побочных эффектов (экспортируется в тест).
    function resolveSubmitTarget(el) {
        if (!el || typeof el.closest !== 'function') return null;
        var form = el.closest('form');
        if (form) return { kind: 'form', form: form };
        var scope = el.closest(SCOPE_SELECTOR);
        if (!scope) return null;
        var btn = firstVisible(scope, '[data-default-submit]') || firstVisible(scope, PRIMARY_SELECTOR);
        if (btn) return { kind: 'button', button: btn };
        return null;
    }

    function submitForm(form) {
        var btn = form.querySelector('[data-default-submit],button[type="submit"],input[type="submit"]');
        var withBtn = btn && isVisible(btn) ? btn : undefined;
        if (typeof form.requestSubmit === 'function') {
            try { form.requestSubmit(withBtn); return; } catch (e) { /* fallthrough */ }
        }
        if (withBtn) withBtn.click();
        else if (typeof form.submit === 'function') form.submit();
    }

    function onKeydown(e) {
        if (e.defaultPrevented) return;
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        if (!isTextEntry(e.target)) return;
        var target;
        try { target = resolveSubmitTarget(e.target); } catch (err) { return; }
        if (!target) return;
        e.preventDefault();
        try {
            if (target.kind === 'form') submitForm(target.form);
            else if (target.kind === 'button') target.button.click();
        } catch (err) { /* не ломаем страницу из-за ошибки конкретной формы */ }
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('keydown', onKeydown);
    }

    // Экспорт чистой логики для node-теста.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            resolveSubmitTarget: resolveSubmitTarget,
            isTextEntry: isTextEntry,
            isVisible: isVisible,
            SCOPE_SELECTOR: SCOPE_SELECTOR,
            PRIMARY_SELECTOR: PRIMARY_SELECTOR
        };
    }
})();
