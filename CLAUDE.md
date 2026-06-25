## integram-table.js — ВАЖНО

`js/integram-table.js` генерируется автоматически. **НИКОГДА не редактировать напрямую.**

- Исходники: `js/integram-table/*.js` (26 модулей)
- Сборка: `bash build.sh` из корня проекта
- После редактирования модуля — запустить build.sh и закоммитить оба: модуль + `js/integram-table.js`

---

## Разработка рабочих мест — ВАЖНО

Перед созданием или изменением рабочего места (workspace `templates/*.html`,
встраиваемого в `templates/main.html`) свериться с правилами в
[`docs/WORKSPACE_DEVELOPMENT_GUIDE.md`](docs/WORKSPACE_DEVELOPMENT_GUIDE.md):
шаблонизатор `{_global_.*}`, версионирование ресурсов, вызовы API `_m_*`, токен XSRF,
чтение данных из таблиц и отчётов, компонент IntegramTable, модальные окна
(не `alert`/`confirm`/`prompt`), подсказки `js/hints.js`. Каждое правило снабжено
ссылкой на закрытый тикет `issue #NNN` и/или место в коде `file:line`.

---

## База знаний Integram — `docs/kb/`

Источник истины по API/платформе Интеграм — [`docs/kb/`](docs/kb/README.md) (индекс +
темы: схема `_d_*`, данные `_m_*`, отчёты `report/`, роли, файлы `dir_admin`, деплой).
Каждый док: «На пальцах» (человек) → справочник (агент) → «Грабли». При затыке — сначала
сводный **индекс граблей** в [`docs/kb/README.md`](docs/kb/README.md).

**Правило пополнения:** наткнулся на грабли или нашёл рабочий рецепт — сразу допиши в
нужный `docs/kb/<тема>.md` (секция «Грабли», шаблон `Симптом → Причина → Фикс (дата/PR)`)
и добавь строку в индекс README. Источник истины — репозиторий; пополняют все агенты одинаково.
Обзор полного цикла разработки — [`docs/integram-app-workflow.md`](docs/integram-app-workflow.md).

**Конвенция рабочих мест:** новые рабочие места со **списком записей** строить на компоненте
`integram-table` (декларативный `<div data-integram-table>`; см. чек-лист в
[`docs/kb/table-component.md`](docs/kb/table-component.md)), а не верстать таблицу вручную.
Кастомные действия/формы — рядом с компонентом. Не таблицы (планирование/визуализации/калькуляторы) — как есть.

UI/UX-правила (поведение интерфейса для пользователя: верстка не прыгает при
правке, поля вписываются в ячейку и т.п.) — в
[`docs/UI_UX_GUIDELINES.md`](docs/UI_UX_GUIDELINES.md), дополняй при новых решениях.

---

## Планирование производства (atex) — ВАЖНО

Алгоритм рабочего места «Планирование производства»
(`download/atex/js/production-planning.js`) описан в
[`docs/atex_production_planning_algorithm.md`](docs/atex_production_planning_algorithm.md) —
это **источник истины**. ВСЕГДА сверяйся с ним ПЕРЕД правкой логики очереди/расписания/
переналадки/фольги и ОБНОВЛЯЙ его в ТОМ ЖЕ PR при изменении поведения (код и документ —
в синхроне). Критичные инварианты (например **фольга всегда в конец каждого дня**, #3717)
обязаны соблюдаться во всех путях упорядочивания (`orderCuts` при генерации и
`planCutOperations`/preserveOrder при по-дневном разбиении).

---

## Стиль документации — ВАЖНО

Документы делаем самодостаточными: пиши **как есть**, прямо констатируя, что
чем является. Выкидывай не относящиеся к делу вещи.

- **Не** пиши «это не X, а на самом деле Y», «раньше тут было X», «похоже на
  расхождение между разными поколениями/версиями базы», «возможно legacy» и
  прочие сравнения с прошлыми/ошибочными трактовками. Просто опиши текущее
  положение дел.
- Если старый текст оказался неверным — **замени** его правильным, а не
  оставляй рядом разбор «почему прежняя версия была неправа».
- Не ссылайся в тексте документа на номера PR/итераций как на источник
  «правды»; вместо этого приводи проверяемый факт (метаданные, `file:line`,
  закрытый `issue #NNN`).

---

Issue to solve: https://github.com/ideav/crm/issues/78
Your prepared branch: issue-78-4001031cf921
Your prepared working directory: /tmp/gh-issue-solver-1769973978122
Your forked repository: konard/ideav-crm
Original repository (upstream): ideav/crm

Proceed.

---

Issue to solve: https://github.com/ideav/crm/issues/194
Your prepared branch: issue-194-a99b419acd96
Your prepared working directory: /tmp/gh-issue-solver-1770224220702
Your forked repository: konard/ideav-crm
Original repository (upstream): ideav/crm

Proceed.


Run timestamp: 2026-02-04T16:57:06.541Z

---

Issue to solve: https://github.com/ideav/crm/issues/207
Your prepared branch: issue-207-17c4002a4199
Your prepared working directory: /tmp/gh-issue-solver-1770275672972
Your forked repository: konard/ideav-crm
Original repository (upstream): ideav/crm

Proceed.


Run timestamp: 2026-02-05T07:14:37.917Z

---

Issue to solve: https://github.com/ideav/crm/issues/213
Your prepared branch: issue-213-f0c78294f49b
Your prepared working directory: /tmp/gh-issue-solver-1770289951286
Your forked repository: konard/ideav-crm
Original repository (upstream): ideav/crm

Proceed.


Run timestamp: 2026-02-05T11:12:36.941Z

---

Issue to solve: https://github.com/ideav/crm/issues/236
Your prepared branch: issue-236-286c2317a292
Your prepared working directory: /tmp/gh-issue-solver-1770375015322
Your forked repository: konard/ideav-crm
Original repository (upstream): ideav/crm

Proceed.


Run timestamp: 2026-02-06T10:50:20.957Z

---

Issue to solve: https://github.com/ideav/crm/issues/247
Your prepared branch: issue-247-05935020011e
Your prepared working directory: /tmp/gh-issue-solver-1770390533889

Proceed.


Run timestamp: 2026-02-06T15:08:55.260Z

---

Issue to solve: https://github.com/ideav/crm/issues/253
Your prepared branch: issue-253-ef8d39130aa6
Your prepared working directory: /tmp/gh-issue-solver-1770391302691

Proceed.


Run timestamp: 2026-02-06T15:21:44.003Z

---

Issue to solve: https://github.com/ideav/crm/issues/292
Your prepared branch: issue-292-8397d61ce69a
Your prepared working directory: /tmp/gh-issue-solver-1770486595407

Proceed.


Run timestamp: 2026-02-07T17:49:56.650Z

---

Issue to solve: https://github.com/ideav/crm/issues/294
Your prepared branch: issue-294-1d94c76aa3a4
Your prepared working directory: /tmp/gh-issue-solver-1770487956922

Proceed.


Run timestamp: 2026-02-07T18:12:38.187Z

---

Issue to solve: https://github.com/ideav/crm/issues/329
Your prepared branch: issue-329-258abe4c74c9
Your prepared working directory: /tmp/gh-issue-solver-1770558451043

Proceed.


Run timestamp: 2026-02-08T13:47:32.315Z

---

Issue to solve: https://github.com/ideav/crm/issues/364
Your prepared branch: issue-364-38e152f87ddb
Your prepared working directory: /tmp/gh-issue-solver-1770620034227

Proceed.


Run timestamp: 2026-02-09T06:53:55.496Z

---

Issue to solve: https://github.com/ideav/crm/issues/445
Your prepared branch: issue-445-09d06d235863
Your prepared working directory: /tmp/gh-issue-solver-1770920530775

Proceed.


Run timestamp: 2026-02-12T18:22:12.318Z

---

Issue to solve: https://github.com/ideav/crm/issues/447
Your prepared branch: issue-447-d1804bb77c3d
Your prepared working directory: /tmp/gh-issue-solver-1771226796229

Proceed.


Run timestamp: 2026-02-16T07:26:37.486Z

---

Issue to solve: https://github.com/ideav/crm/issues/523
Your prepared branch: issue-523-dd94d688bc81
Your prepared working directory: /tmp/gh-issue-solver-1771440107450

Proceed.


Run timestamp: 2026-02-18T18:41:49.117Z

---

Issue to solve: https://github.com/ideav/crm/issues/648
Your prepared branch: issue-648-9108cfe9f750
Your prepared working directory: /tmp/gh-issue-solver-1772478108327

Proceed.


Run timestamp: 2026-03-02T19:01:49.734Z

---

Issue to solve: https://github.com/ideav/crm/issues/650
Your prepared branch: issue-650-8a39e093f7f9
Your prepared working directory: /tmp/gh-issue-solver-1772478730366

Proceed.


Run timestamp: 2026-03-02T19:12:11.881Z

---

Issue to solve: https://github.com/ideav/crm/issues/656
Your prepared branch: issue-656-a5b7f7bc8f60
Your prepared working directory: /tmp/gh-issue-solver-1772479904186

Proceed.


Run timestamp: 2026-03-02T19:31:45.523Z

---

Issue to solve: https://github.com/ideav/crm/issues/705
Your prepared branch: issue-705-a4b26204b5e5
Your prepared working directory: /tmp/gh-issue-solver-1772564139932

Proceed.


Run timestamp: 2026-03-03T18:55:41.313Z