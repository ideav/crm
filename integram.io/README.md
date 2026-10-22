# integram.io — ядро отдельного хоста

PHP-движок integram.io работает на своём хосте (не на ideav.ru) на своей версии ядра —
`integram.io/index.php`. Эта папка — источник истины для файлов, которые выкладываются на хост.

## Что куда выкладывается

| В репо | На хосте (webroot integram.io) | Примечание |
|---|---|---|
| `integram.io/index.php` | `index.php` | ядро integram.io; **не** то же, что корневой `index.php` (ideav.ru) |
| `integram.io/include/funcs.php` | `include/funcs.php` | копия общего `include/funcs.php` |
| `integram.io/include/import_reconcile.php` | `include/import_reconcile.php` | копия общего `include/import_reconcile.php` |
| `integram.io/include/connection.php` | `include/connection.php` | **шаблон**: база, SMTP, соль, ключи SMS/Google/Yandex — заменить `<…>` реальными значениями |
| `integram.io/include/.htaccess` | `include/.htaccess` | **шаблон**: Basic-auth на `include/`, `<webroot_parent>` — каталог над webroot |

На 22.10.2026 живые `index.php`, `include/funcs.php` и `include/import_reconcile.php` совпадают
с репо байт в байт (md5); шаблоны сняты с живых файлов, секреты заменены заглушками. Реальные
`connection.php` и `.htaccess` на хосте не перезаписывать шаблоном.

## Правка ядра

Корневой `index.php` (ideav.ru) и `integram.io/index.php` — разные файлы: правку, которая нужна
обоим хостам, вносят в оба (пример — issue #5170 и #5184).

`funcs.php` и `import_reconcile.php` правят в `include/` и копируют в `integram.io/include/`;
расхождение роняет `experiments/integram-io-include-sync-5228.test.js`. Мерки, которые гоняют оба ядра:
`experiments/fu-filter-without-parent-obj-5170.test.php`,
`experiments/integram-io-secure-token-5207.test.js`, `experiments/integramio-php8-1036.test.js`,
`experiments/security-integramio-1036.test.js`.

## Выкладка

Файлы ядра выкладывает владелец вручную, по явной команде (правило после #5155). Автосинка нет,
в `update.conf` их не добавлять.

Перед выкладкой:

1. Сверить живые файлы с репо: на хосте могут быть ручные хотфиксы, которых нет в снапшоте
   (пример — SMTP, issue #5161). Если md5 расходится, сначала перенести хотфикс в репо.
2. Сделать бэкап заменяемых файлов на хосте.
3. После выкладки учесть opcache: какое-то время отвечает старый код.
