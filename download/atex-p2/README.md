# Рабочие места Фазы 2 atex (этикетка, высечка)

Код рабочих мест Фазы 2 — `js/` и `css/` этого каталога, шаблоны — `templates/atex-p2/`.
Маппинги `update.conf` на сервере выкладывают их только в копию **ateh1**:

| Каталог репозитория | Куда выкладывается |
|---|---|
| `download/atex-p2/js/*` | `download/ateh1/js/` |
| `download/atex-p2/css/*` | `download/ateh1/css/` |
| `templates/atex-p2/*` | `templates/custom/ateh1/` |

Боевая база `ateh` этих файлов не получает. Маска `*` берёт файлы без подкаталогов: новый
подкаталог требует своей строки в `update.conf`. Этот README лежит в корне каталога и никуда
не выкладывается.

Состав рабочих мест и таблиц — [`docs/atex_phase2_solution_composition.md`](../../docs/atex_phase2_solution_composition.md).
Эпик — issue #5317.
