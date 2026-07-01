/*
 * Локальная установка Интеграм — пакетный оверрайд для страницы входа (start.html).
 *
 * Убирает на локальной установке: регистрацию, вход через Яндекс и капчу.
 * НЕ трогает общий код (index.php, js/app.js, start.html в репозитории) — этот файл
 * подключается ТОЛЬКО в архиве локальной установки: local/make-archive.sh кладёт его
 * в js/ и вставляет <script> сразу после js/app.js (issue #3950).
 *
 * Грузится ПОСЛЕ app.js, поэтому переопределяет глобальные функции капчи.
 */
(function () {
    // 1) Капча. На локальной установке сервер её не проверяет (ключ-заглушка
    //    SMARTCAPTCHA_SERVER_KEY), но клиент до отправки требует токен и без него
    //    блокирует вход (app.js). Возвращаем непустой токен — проверка проходит,
    //    сервер его игнорирует.
    window.getCaptchaToken = function () { return 'local-install'; };
    window.resetCaptcha = function () {};

    // 2) Прячем UI регистрации, входа через Яндекс и капчи. !important перекрывает
    //    инлайновые display, которые проставляет app.js при переключении вкладок.
    var sel = [
        '#tab-register', '#register-section',
        '#yandex-login-btn', '#yandex-register-btn',
        '#yandex-divider', '#yandex-reg-divider',
        '.smart-captcha'
    ].join(',');
    var style = document.createElement('style');
    style.textContent = sel + '{display:none !important;}';
    (document.head || document.documentElement).appendChild(style);
})();
