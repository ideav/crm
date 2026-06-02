# Файлы сервера — `dir_admin`
> Часть базы знаний Integram. Индекс: [docs/kb/README.md](README.md)

## На пальцах (для человека)
У каждой базы Интеграма на сервере есть два каталога с файлами: `download/{db}`
(JS/HTML рабочих мест, картинки — отдаётся по `https://ideav.ru/download/{db}/...`)
и `templates/custom/{db}` (кастомные шаблоны, бэкапы). Управляет ими файловый
менеджер `dir_admin`: через него заливают шаблоны, создают папки, удаляют и читают
файлы. Это мощный и опасный инструмент — право на запись фактически позволяет
подменить код фронтенда, поэтому доступ к нему (синтетический объект `10` Files,
см. [roles.md](roles.md)) выдают адресно. Авторизация чуть хитрее обычной: кроме
токена нужны cookie и `_xsrf`.

> ────────── дальше — справочник для агента ──────────

## Операции (для агента)

`dir_admin` обслуживает два дерева, выбираемых параметром:
- `download=1` → каталог `download/{db}` (раздаётся по `https://ideav.ru/download/{db}/`);
- `templates=1` → каталог `templates/custom/{db}` (шаблоны, `/backups`).

Подкаталог внутри дерева задаётся `add_path=/sub/dir`.

### Авторизация
POST-команды требуют: заголовок `X-Authorization: <token>` + cookie
`idb_{db}=<token>` + поля `_xsrf=<xsrf>` и `token=<token>` в теле. Без cookie
`idb_{db}` сервер падает с `InvalidToken`.

### Загрузить файл (шаблон/JS)
```bash
curl -sS -H "X-Authorization: ${TOKEN}" -b "idb_${DB}=${TOKEN}" \
  -F download=1 -F add_path= -F upload=Загрузить \
  -F "_xsrf=${XSRF}" -F "token=${TOKEN}" \
  -F userfile=@file.js \
  "https://ideav.ru/${DB}/dir_admin/"
# после: доступен по https://ideav.ru/download/${DB}/file.js
# перезапись существующего: добавить -F rewrite=1
```

### Создать папку / пустой файл
```bash
# dir_name=<имя> + mkdir=1  (папка)  |  + touch=1  (пустой файл)
curl ... -F templates=1 -F add_path=/ -F dir_name=backups -F mkdir=1 ...
```

### Удалить
```bash
# del[]=<имя файла/папки> (можно несколько) + delete=1
curl ... -F download=1 -F add_path=/ -F "del[]=old.js" -F delete=1 ...
```

### Прочитать файл / JSON-ответ
```bash
GET https://ideav.ru/{db}/dir_admin/?templates=1&add_path=/backups&gf=<имя>   # содержимое файла
GET https://ideav.ru/{db}/dir_admin/?download=1&JSON=1                         # листинг каталога в JSON (PR #3101)
```
`&gf=` отдаёт сам файл; `?JSON=1` переводит ответ менеджера из HTML в JSON
(удобно для агента) — добавлено в PR #3101.

### Безопасность (как устроена защита)
- имена нормализуются от path-traversal (`../` вырезается);
- allowlist разрешённых расширений (плюс `.htaccess`);
- в `download/` и `templates/` выполнение скриптов на веб-сервере отключено (no-exec);
- доступ к файловому менеджеру гейтится объектом Files (синтетический id `10`),
  WRITE на него = возможность подменить фронт — выдавать адресно (см. [roles.md](roles.md)).

> Полный набор команд `dir_admin` (`del[]`/`mkdir`/`touch`/`gf`/`?JSON=1`) и их
> JSON-ответ задокументированы в PR #3101; базовая загрузка шаблонов — в монолите
> [../integram-app-workflow.md](../integram-app-workflow.md) §4.4. Бэкап базы
> кладётся менеджером в `templates=1&add_path=/backups` (§6.1).

## Грабли
- **Симптом:** `dir_admin` отвечает `InvalidToken` → **Причина:** передан только заголовок/`token`, но нет cookie `idb_{db}` → **Фикс:** добавить `-b "idb_${DB}=${TOKEN}"`. *(monolith §4.4 / §6.1)*
- **Симптом:** GET файла `.html` вернул HTTP 200, решили что файл существует, а его нет → **Причина:** SPA отдаёт фолбэк-страницу на несуществующий путь → **Фикс:** проверять существование файла через файловый менеджер (`&gf=`), а не по коду ответа на прямой URL. *(PR #3101)*
- **Симптом:** удалённый из репозитория файл всё ещё лежит на сервере → **Причина:** деплой `update.php` только копирует, ничего не удаляет (см. [deploy.md](deploy.md)) → **Фикс:** удалить файл вручную через `dir_admin` (`del[]`+`delete`). *(см. [deploy.md](deploy.md))*
