# Исследование: ИИ-агент в унифицированной среде ideav.ru

Проверка гипотезы python2node#1008. Вопрос: делает ли единая модель данных, связей, прав и операций ядра ideav.ru (`index.php`) работу ИИ-агента надёжнее и безопаснее, чем традиционная связка «таблицы + API + инструкции»? Исследование ищет измеримое преимущество, а не демонстрацию.

## Состав

| Путь | Что это |
|---|---|
| `stand/stand.sh` | Стенд: ядро ideav/crm на заданном коммите в Docker (php 8.2 + MariaDB 10.11), `127.0.0.1:18681` |
| `app/funding.py` | Тестовое приложение «Заявки на финансирование»: компании, заявки, статусы и роли заявителя, эксперта и админа. Правила доступа заданы штатными грантами и масками |
| `probes/probe.py` | Пробы механизмов ядра без LLM на стенде. Каждая проба получает свою базу, вердикт выносится по диффу таблицы до и после |
| `probes/prod_check.py` | Те же пробы на боевом ядре внутри служебной тестовой базы. Приложение сеется в свободный диапазон id и затем удаляется |
| `pilot/` | Пилот с LLM: протокол (`PROTOCOL.md`), сценарии и оракулы (`scenarios.py`, самопроверка `selftest.py`), адаптеры вариантов A / B0 / B1, раннер `run.py`, сводка `analyze.py` |
| `results/*.json` | Сырые результаты проб без LLM |
| `results/pilot-<дата>/` | Результаты пилота с LLM и сводка (`README.md`) |
| `results/rerun-20261022-n8/` | Повтор N8 после фиксов agent-chat и ideav-mcp |
| `effort/` | Замер цены защиты (python2node#1055): протокол `PROTOCOL.md`, ТЗ сборщику `TASK.md`, драйверы сред B и A′ (`envs.py`), пробы R1–R12 (`probes.py`), стенд A′ PostgreSQL + PostgREST (`a1/`) |
| `results/m-20261022/` | Фаза 2: сценарии, в которых модель ошибается (`pilot/PROTOCOL-M.md`), и сводка (`README.md`) |

## Пробы механизмов: что держит ядро

Вердикты: `held` — запрещённое действие не прошло; `VIOLATION` — прошло; `ok` / `FALSE-DENY` — разрешённое действие (контроль) прошло / не прошло.

| Группа | Ядро `9797e970` | Ядро с проверкой масок на запись (ideav.ru с 20.10.2026) |
|---|---|---|
| Изоляция строк на чтение (список, чужая карточка) | держит | держит |
| Изоляция строк на запись (`_m_save/_m_set/_m_del/_m_new/_m_batch/_m_del_batch`) | 11 нарушений из 11 | 0 |
| Права колонок (BARRED, READ) | держит | держит |
| Уникальность первой колонки | держит | держит |
| Обязательность (`required`) при записи | не проверяется | не проверяется |
| Тип NUMBER: «abc» | молча записывается `0` | молча записывается `0` |
| Граф переходов статусов, межполевые условия | механизма нет | механизма нет |
| Контроль: разрешённые действия | своя карточка при маске по ссылке закрыта | все проходят |

Файлы: `results/probes-20261020-main.json`, `results/probes-20261020-1008.json` — стенд; `results/prod-20261020-1008.json` — боевое ядро; `results/probes-20261022-f9cc935.json` — стенд на ядре ideav.ru 22.10 (те же вердикты). Обязательность и NUMBER — crm#5219, crm#5220.

## Запуск

```bash
bash stand/stand.sh up [<коммит ideav/crm>]   # на хосте с Docker
python3 probes/probe.py [--only W1,C1]          # на том же хосте
R1008_SSH=root@<хост> python probes/prod_check.py --db <тестовая база>  # с машины с ssh-доступом к серверу ideav.ru
```

После замены `index.php` внутри работающего контейнера контейнер нужно перезапустить (`docker restart crm1008-app`). Иначе opcache продолжит отдавать прежнее ядро.

## Пилот с LLM

Сводка и находки — [`results/pilot-20261021/README.md`](results/pilot-20261021/README.md).

```bash
python3 pilot/selftest.py                                   # оракулы без LLM
python3 pilot/run.py --out results/pilot-<дата> --variants A,B0 --reps 5 --model sonnet --parallel 3
python3 pilot/run_b1a.py --out results/pilot-<дата>-b1a --variants B1a --parallel 2
python3 pilot/analyze.py results/pilot-<дата>/results.jsonl results/pilot-<дата>-b1a/results.jsonl --rename=B1=B1-noapply,B1a=B1
```

## Фаза 2: модель ошибается

Сводка и находки — [`results/m-20261022/README.md`](results/m-20261022/README.md).

```bash
R1008_MCP_ALLOW=schema,delete R1008_AC_PIN=agent-chat-app-c749774 \
  python3 pilot/run.py --set m --variants A,B0,B1a --reps 5 --parallel 3 --out results/m-<дата>
python3 pilot/analyze.py results/m-<дата>/results.jsonl
```

Если `claude -p` упрётся в лимит подписки, раннер остановится. Повторный запуск с тем же `--out` догонит оставшиеся прогоны.
