# Issue #3031: наполнение справочников Atex в `/ateh`

## Что сделано

- Перед загрузкой создан backup через пользователя `autotest`: `ateh_20260531_225823.dmp.zip`.
- Для роли `at` добавлено право выгрузки базы, чтобы backup проходил не от администратора.
- Из `docs/atex_upload_csv/` загружены справочники: виды сырья, слиттеры, втулкорезы, типы резки, полосы и партии сырья.
- Поля `Ширина, мм` и `Остаток, мм` переведены с `NUMBER` на `SIGNED`, чтобы сохранить значения вида `32.5` и `63.5` из CSV.

## Проверенные итоги в live `/ateh`

| Таблица | Было | Стало |
| --- | ---: | ---: |
| Вид сырья | 10 | 60 |
| Слиттер | 4 | 8 |
| Втулкорез | 3 | 6 |
| Тип резки | 11 | 501 |
| Полоса | 0 | 656 |
| Партия сырья | 9 | 35 |

Финальный dry-run импортера:

```text
Вид сырья: created=0, updated=0, unchanged=59
Слиттер: created=0, updated=0, unchanged=4
Втулкорез: created=0, updated=0, unchanged=3
Тип резки: created=0, updated=0, unchanged=490
Полоса: created=0, updated=0, unchanged=656
Партия сырья: created=0, updated=0, unchanged=26
live counts: {"Вид сырья": 60, "Втулкорез": 6, "Партия сырья": 35, "Полоса": 656, "Слиттер": 8, "Тип резки": 501}
```

## Команды проверки

```bash
python3 experiments/test-issue-3011-atex-upload-csv.py
python3 experiments/seed-issue-3031-ateh-dictionaries.py --token-file /path/to/token --dry-run
```
