# integram.io — ядро отдельного хоста

PHP-движок integram.io работает на своём хосте (не на ideav.ru) и живёт на своей версии ядра.
Раньше снапшот лежал в `experiments/index_integram.io.php`, с #5228 переехал сюда.

## Что куда выкладывается

| В репо | На хосте (webroot integram.io) | Примечание |
|---|---|---|
| `integram.io/index.php` | `index.php` | ядро integram.io; **не** то же, что корневой `index.php` (ideav.ru) |
| `include/funcs.php` | `include/funcs.php` | общий с ideav.ru |
| `include/import_reconcile.php` | `include/import_reconcile.php` | общий с ideav.ru |
| — | `include/connection.php` | свой у хоста: база, SMTP, секреты; в репо не хранится |
| — | `include/.htaccess` | свой у хоста (Basic-auth), в репо не хранится |

На 22.10.2026 живые `index.php`, `include/funcs.php` и `include/import_reconcile.php` совпадают
с репо байт в байт (md5).

## Правка ядра

Фикс в корневом `index.php` сам до integram.io не доходит (так было с #5175 → #5185), поэтому
правку, которая нужна обоим хостам, вносят в оба файла. Мерки, которые гоняют оба ядра:
`experiments/fu-filter-without-parent-obj-5170.test.php`,
`experiments/integram-io-secure-token-5207.test.js`, `experiments/integramio-php8-1036.test.js`,
`experiments/security-integramio-1036.test.js`.

## Выкладка

Файлы ядра выкладывает владелец вручную, по явной команде (правило после #5155). Автосинка нет,
в `update.conf` их не добавлять.

Перед выкладкой:

1. Сверить живые файлы с репо: на хосте могут быть ручные хотфиксы, которых нет в снапшоте
   (так было с SMTP, #5161). Если md5 расходится, сначала перенести хотфикс в репо.
2. Сделать бэкап заменяемых файлов на хосте.
3. После выкладки учесть opcache: какое-то время отвечает старый код.
