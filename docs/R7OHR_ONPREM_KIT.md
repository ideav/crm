# Комплект переноса on-prem: старый Интеграм (demo) → новый (r7ohr)

Комплект для администратора заказчика: он сам переносит базу **demo** со старого Интеграма
(дистрибутив integram.io ~08.2025, PHP 8) в новую on-prem-установку под именем **r7ohr**.
Скрипты комплекта **в репозитории не хранятся**. Они лежат только локально, у владельца.

## Где лежит

| Что | Путь |
|---|---|
| Актуальный архив | `C:\Users\drynn\r7ohr-onprem\r7ohr-onprem-kit-20261031.tar.gz` |
| sha256 архива | `9efe9996870c6fc39c6770bfa080739e2040f1bb82a9216d3b51afcc28021a58` |
| Исходники комплекта (правки — здесь) | `C:\Users\drynn\r7ohr-onprem\kit\` |
| Предыдущий архив (без автопоиска сайта) | `C:\Users\drynn\r7ohr-onprem\r7ohr-onprem-kit-20261029.tar.gz` |

## Состав `kit/`

- `kit.conf` — `OLD_DB` (demo), `NEW_DB` (r7ohr), `INSTALL_DIR`;
- `1-export-old.sh` — старый сервер: дамп таблицы базы и архив её файлов (только чтение);
- `2-install-new.sh` — новый сервер: установка из `integram-local-<дата>.tar.gz`;
- `3-import.sh` — загрузка выгрузки в новую установку под именем `NEW_DB`;
- `4-reset-passwords.sh` + `reset-passwords.php` — сброс паролей пользователей базы;
- `old-core-fix/` — правка старого ядра под PHP 8 (иначе экспорт отвечает 500);
- `README.txt` — порядок шагов для администратора; `SHA256SUMS` — контрольные суммы.

## История

- 29.10.2026 — первая сборка. Дистрибутив собран из локальной ветки `kitbuild-20261029`
  (worktree `C:\Users\drynn\crm-kitbuild`) = PR #5299 + #5304. Фикс экспорта под PHP 8 — PR #5300.
- 31.10.2026 — #5302: `1-export-old.sh` останавливался с «в /var/www/integram нет index.php»,
  если сайт лежит в другой папке. Теперь скрипт сам ищет папку с `index.php` и
  `include/connection.php` в `/var/www`, `/srv`, `/home`, `/opt`. Нашёл одну — берёт её,
  нашёл несколько — предлагает команды `OLD_WEBROOT=… bash 1-export-old.sh` на выбор.

## Пересборка

PR #5299, #5300 и #5304 влиты в `main`, так что дистрибутив `integram-local-*.tar.gz`
теперь собирается с `main`, а не с ветки `kitbuild`. После правки скриптов в `kit\`:

```sh
cd /c/Users/drynn/r7ohr-onprem/kit
sha256sum -b kit.conf integram-local-*.tar.gz *.sh reset-passwords.php README.txt old-core-fix/* > SHA256SUMS
cd .. && tar czf r7ohr-onprem-kit-$(date +%Y%m%d).tar.gz kit
```

Затем обновить таблицу «Где лежит» в этом файле.
