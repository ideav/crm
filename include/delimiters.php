<?php
/**
 * Экранирование разделителей текстовых форматов обмена (BKI, JSON-архив).
 *
 * В BKI поля строки разделены `;`, части поля — `:`, значения мульти-ссылки — `,`.
 * Значение, содержащее разделитель, экранируется обратной косой (`Mask`), а разбор
 * прячет экранированные последовательности в служебные маркеры (`Hide`), чтобы
 * `explode` резал только настоящие разделители.
 *
 * Маркеры — управляющие символы \x01..\x04, а не последовательности вида `%3B`:
 * значение «https://host/?a=1%3Bb» после разбора превращалось в «https://host/?a=1;b»,
 * потому что UnHideDelimiters не отличает свой маркер от такого же текста в данных.
 * Управляющие символы в значениях полей не встречаются (их вычищает Format_Val),
 * поэтому подмена маркеров делает разбор обратимым.
 */

defined("DELIM_HIDE_BACKSLASH") || define("DELIM_HIDE_BACKSLASH", "\x01");
defined("DELIM_HIDE_COLON")     || define("DELIM_HIDE_COLON",     "\x02");
defined("DELIM_HIDE_SEMICOLON") || define("DELIM_HIDE_SEMICOLON", "\x03");
defined("DELIM_HIDE_COMMA")     || define("DELIM_HIDE_COMMA",     "\x04");

# Экранировать разделители в значении, уезжающем в файл
function MaskDelimiters($v)
{
    return str_replace(";", "\;", str_replace(":", "\:", str_replace("\\", "\\\\", $v)));
}
# Снять экранирование с поля, прочитанного из файла
function UnMaskDelimiters($v)
{
    return str_replace("\;", ";", str_replace("\:", ":", str_replace("\\\\", "\\", UnHideDelimiters($v))));
}
# Спрятать экранированные разделители, чтобы explode резал только настоящие
function HideDelimiters($v)
{
    return str_replace("\,", DELIM_HIDE_COMMA
            , str_replace("\;", DELIM_HIDE_SEMICOLON
            , str_replace("\:", DELIM_HIDE_COLON
            , str_replace("\\\\", DELIM_HIDE_BACKSLASH, $v))));
}
# Вернуть спрятанные последовательности на место (принимает строку или массив полей)
function UnHideDelimiters($v)
{
    return str_replace(DELIM_HIDE_COMMA, "\,"
            , str_replace(DELIM_HIDE_SEMICOLON, "\;"
            , str_replace(DELIM_HIDE_COLON, "\:"
            , str_replace(DELIM_HIDE_BACKSLASH, "\\\\", $v))));
}
