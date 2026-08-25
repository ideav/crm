# Как забрать отчёт Integram из Airflow по токену

Инструкция для админа DWH. Тикет: [ideav/crm#4813](https://github.com/ideav/crm/issues/4813).

## 1. Что забираем

| Параметр | Значение |
|---|---|
| Хост | `https://integram.io` |
| Инстанс | `r7ohr` |
| Отчёт (объект) | `17021` |
| Формат вывода | `JSON_KV` — строки данных (массив «ключ→значение»); `JSON` — метаданные/схема (`columns`) |
| Полный URL | `https://integram.io/r7ohr/report/17021?JSON_KV` |
| Метод | `GET` |

`?JSON_KV` в query-строке обязателен: он переключает отчёт в машинный JSON.
Без параметра формата эндпоинт отвечает **302** (редирект в браузерный UI) — для Airflow это ошибка.

## 2. Предусловие: роль в Integram

Токен сам по себе даёт только *аутентификацию* — прав на данные у него по умолчанию нет
(запрос вернёт `200` с телом `"...нет доступа... Ваш глобальный доступ: ''"`).

Чтобы отчёт отдавал данные, в Integram должна быть **создана роль с доступом на чтение**:

- либо **на конкретные отчёты** (напр. только 17021) — рекомендуется, least-privilege для DWH;
- либо **на все отчёты** — если один токен тянет много разных выгрузок.

Эту роль нужно **назначить пользователю/токену**, под которым ходит Airflow.

Проверка, что роль выдана правильно (least-privilege): запрос отчёта 17021 отдаёт данные, а
корневой объект остаётся закрытым — глобальный доступ на «всё» для pull-токена не нужен.

## 3. Аутентификация

Токен передаётся HTTP-заголовком:

```
Authorization: Bearer <ТОКЕН>
```

- Токен — секрет. В коде DAG его не хранить: только Airflow Connection / Variable (см. §5).
- Query-параметр `token=` и заголовок `X-Auth-Token` **не работают** (проверено — 401). Только `Authorization`.

## 4. Проверка руками (curl)

```bash
TOKEN='CvDyY7dJCsoIzM+9NiNqw2TS038kA'   # заменить на боевой токен DWH
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  'https://integram.io/r7ohr/report/17021?JSON_KV'
```

Ожидаемый успешный ответ — JSON-массив строк отчёта. Пример формы:

```json
[{"поле1":"значение","поле2":"значение"}, {"поле1":"...","поле2":"..."}]
```

## 5. Хранение токена в Airflow

Вариант с HTTP-коннекшеном (рекомендуется):

- **Admin → Connections → Add**
  - Conn Id: `integram_api`
  - Conn Type: `HTTP`
  - Host: `https://integram.io`
  - Password: `<ТОКЕН>`   (кладём токен в password, чтобы он не светился в логах)

Либо секрет-бэкенд (Vault/переменная окружения) — тогда токен читается в DAG из `Variable.get("integram_token")`.

## 6. DAG — вариант A: HttpOperator

Airflow 2.x, провайдер `apache-airflow-providers-http`.

```python
from datetime import datetime
from airflow import DAG
from airflow.providers.http.operators.http import HttpOperator
from airflow.hooks.base import BaseHook

conn = BaseHook.get_connection("integram_api")

with DAG(
    dag_id="integram_report_17021",
    schedule="0 6 * * *",          # каждый день в 06:00
    start_date=datetime(2026, 8, 25),
    catchup=False,
    tags=["dwh", "integram"],
) as dag:

    fetch = HttpOperator(
        task_id="fetch_report_17021",
        http_conn_id="integram_api",
        method="GET",
        endpoint="/r7ohr/report/17021?JSON_KV",
        headers={"Authorization": f"Bearer {conn.password}"},
        response_filter=lambda r: r.json(),   # вернёт распарсенный JSON в XCom
        log_response=False,                   # не писать тело (и токен) в лог
    )
```

## 7. DAG — вариант B: PythonOperator + requests

Больше контроля над ошибками и записью в DWH.

```python
from datetime import datetime
import requests
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.models import Variable

URL = "https://integram.io/r7ohr/report/17021?JSON_KV"

def fetch(**_):
    token = Variable.get("integram_token")           # секрет из Airflow
    r = requests.get(URL, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    r.raise_for_status()                             # 401/5xx -> падение таска
    data = r.json()

    # Integram отдаёт ошибку доступа с кодом 200 и телом-ошибкой — ловим явно:
    if isinstance(data, list) and data and isinstance(data[0], dict) and "error" in data[0]:
        raise ValueError(f"Integram вернул ошибку: {data[0]['error']}")

    # TODO: здесь запись data в DWH (staging-таблица)
    return len(data)

with DAG(
    dag_id="integram_report_17021_py",
    schedule="0 6 * * *",
    start_date=datetime(2026, 8, 25),
    catchup=False,
    tags=["dwh", "integram"],
) as dag:
    PythonOperator(task_id="fetch_report_17021", python_callable=fetch)
```

## 8. Диагностика ответов

| Что вернулось | Значит | Что делать |
|---|---|---|
| `200` + массив строк | Всё ок | — |
| `200` + `[{"error":"...нет доступа к реквизиту объекта 17021... Ваш глобальный доступ: ''"}]` | Токен валиден, но **прав на отчёт нет** | Назначить пользователю/токену роль с чтением отчёта 17021 (или роль на все отчёты) — см. §2 |
| `401` + `Basic auth: No authorization token provided` | Заголовок `Authorization` не дошёл | Проверить, что заголовок реально уходит (не `token=` в query) |
| `401` + `Invalid login/password` | Токен передан не тем способом (напр. Basic auth) | Использовать `Authorization: Bearer <токен>` |
| `302` (пустое тело) | Забыт `?JSON_KV` | Добавить `?JSON_KV` к URL |

## 9. Чек-лист перед первым запуском

1. В Integram создана роль с чтением отчёта 17021 (или всех отчётов) и **назначена** пользователю/токену DWH (§2).
2. Боевой токен получен; проверка curl'ом из §4 отдаёт данные, а не `{"error": ...}`.
3. Токен положен в Airflow Connection `integram_api` (password) или в Variable `integram_token`.
4. `log_response=False` / `log_response=...` не пишет токен и тело в логи.
5. DAG проверен ручным запуском, данные доходят до staging DWH.
