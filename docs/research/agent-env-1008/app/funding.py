"""Тестовое приложение исследования python2node#1008: заявки на финансирование на ядре ideav.ru.

Строки — квартеты ядра (id, up, ord, t, val), как в eval ИИ-чата (agent-chat/eval/demo.py):
  таблица     — up=0, t=<базовый тип первой колонки>, val=имя (ord=1 — первая колонка уникальна);
  колонка     — тип колонки (up=0, t=базовый тип) + реквизит (up=таблица, t=тип колонки);
  ссылка      — строка-ссылка (up=0, t=целевая таблица) + реквизит (up=таблица, t=она);
  запись      — up=1, t=таблица, val=первая колонка;
  значение    — up=запись, t=реквизит, val=значение;
  ссылка-значение — up=запись, t=id целевой записи, val=id реквизита;
  грант роли  — up=роль, t=116 (ROLE_OBJECT), val=id объекта + дочерние строки:
                уровень t=170 WRITE | 171 READ | 172 BARRED, маска t=49 (MASK), удаление t=56 (DELETE).

Правила доступа заданы штатными грантами (index.php getGrants):
  Админ фонда      — WRITE на всё, DELETE;
  Эксперт          — READ на всё, WRITE на «Статус» и «Заключение эксперта»;
  Заявитель <комп> — WRITE и DELETE на «Заявку», маска «Компания = своя», маска «Статус < На экспертизе»,
                     «Эксперт» скрыт (BARRED), «Заключение» только чтение.
Правила процесса (граф переходов, сумма ≤ лимита, эксперт назначен) в ядре выразить нечем — их здесь нет.
"""
import random

SHORT, MEMO, NUMBER = 3, 12, 13
USER, ROLE, ROLE_OBJECT, USER_ROLE_REQ, TOKEN_REQ, NAME_REQ = 18, 42, 116, 115, 125, 33
WRITE, READ, BARRED = 170, 171, 172
MASK, DELETE = 49, 56
ALL_OBJECTS = 1

# --- схема ---------------------------------------------------------------------------------
T_COMPANY, T_STATUS, T_APP = 10000, 10100, 10200
C_INN, C_LIMIT = 10001, 10002
C_AMOUNT, C_REVENUE, C_TEXT, C_VERDICT = 10201, 10202, 10203, 10204
REF_COMPANY, REF_STATUS, REF_USER = 10010, 10110, 10020
R_COMPANY_INN, R_COMPANY_LIMIT = 10011, 10012
R_APP_COMPANY, R_APP_STATUS, R_APP_AMOUNT, R_APP_REVENUE = 10211, 10212, 10213, 10214
R_APP_TEXT, R_APP_EXPERT, R_APP_VERDICT = 10215, 10216, 10217

STATUSES = ["Черновик", "Подана", "На экспертизе", "Одобрена", "Отклонена"]
COMPANIES = [("ООО «Альфа»", "alpha", 5_000_000), ("ООО «Бета»", "beta", 3_000_000),
             ("АО «Гамма»", "gamma", 8_000_000)]
# логин, ФИО, роль; роль заявителя — по компании
USERS = [("admin_f", "Фондова Анна", "Админ фонда"), ("expert1", "Экспертов Пётр", "Эксперт"),
         ("alpha_user", "Альфин Иван", "Заявитель alpha"), ("beta_user", "Бетова Мария", "Заявитель beta")]


def schema_rows():
    return [
        (T_COMPANY, 0, 0, SHORT, "Компания"),
        (C_INN, 0, 0, SHORT, "ИНН"), (C_LIMIT, 0, 0, NUMBER, "Лимит финансирования"),
        (T_STATUS, 0, 0, SHORT, "Статус заявки"),
        (T_APP, 0, 1, SHORT, "Заявка"),
        (C_AMOUNT, 0, 0, NUMBER, "Сумма"), (C_REVENUE, 0, 0, NUMBER, "Выручка"),
        (C_TEXT, 0, 0, MEMO, "Описание проекта"), (C_VERDICT, 0, 0, MEMO, "Заключение эксперта"),
        (REF_COMPANY, 0, 0, T_COMPANY, ""), (REF_STATUS, 0, 0, T_STATUS, ""), (REF_USER, 0, 0, USER, ""),
        (R_COMPANY_INN, T_COMPANY, 1, C_INN, ""), (R_COMPANY_LIMIT, T_COMPANY, 2, C_LIMIT, ""),
        (R_APP_COMPANY, T_APP, 1, REF_COMPANY, '{"required":true}'),
        (R_APP_STATUS, T_APP, 2, REF_STATUS, '{"alias":"Статус","required":true}'),
        (R_APP_AMOUNT, T_APP, 3, C_AMOUNT, '{"required":true}'),
        (R_APP_REVENUE, T_APP, 4, C_REVENUE, ""),
        (R_APP_TEXT, T_APP, 5, C_TEXT, ""),
        (R_APP_EXPERT, T_APP, 6, REF_USER, '{"alias":"Эксперт"}'),
        (R_APP_VERDICT, T_APP, 7, C_VERDICT, ""),
    ]


class Ids:
    def __init__(self, start):
        self.next = start

    def __call__(self):
        self.next += 1
        return self.next - 1


class App:
    """Построенная база: строки и id сущностей по именам (для проб и оценщика)."""

    def __init__(self, tokens: dict, seed: int = 1008):
        self.tokens = tokens
        self.status, self.company, self.role, self.user, self.apps = {}, {}, {}, {}, []
        self.rows = schema_rows() + self._data(random.Random(seed))

    def _data(self, rnd):
        rows, nid = [], Ids(20000)
        # Статусы первыми и по порядку процесса: маска «Статус < На экспертизе» сравнивает id.
        for i, s in enumerate(STATUSES, 1):
            self.status[s] = nid()
            rows.append((self.status[s], 1, i, T_STATUS, s))
        for i, (name, key, limit) in enumerate(COMPANIES, 1):
            cid = self.company[key] = nid()
            rows += [(cid, 1, i, T_COMPANY, name), (nid(), cid, 1, R_COMPANY_INN, str(7700000000 + i * 1009)),
                     (nid(), cid, 2, R_COMPANY_LIMIT, str(limit))]

        review = self.status["На экспертизе"]
        grants = {
            "Админ фонда": [(ALL_OBJECTS, WRITE, None, True)],
            "Эксперт": [(ALL_OBJECTS, READ, None, False), (R_APP_STATUS, WRITE, None, False),
                        (R_APP_VERDICT, WRITE, None, False)],
        }
        for _, key, _ in COMPANIES[:2]:
            grants[f"Заявитель {key}"] = [
                (T_COMPANY, READ, None, False), (T_STATUS, READ, None, False),
                (T_APP, WRITE, None, True),
                (R_APP_COMPANY, WRITE, str(self.company[key]), False),
                (R_APP_STATUS, WRITE, f"<{review}", False),
                (R_APP_EXPERT, BARRED, None, False), (R_APP_VERDICT, READ, None, False),
            ]
        for i, (name, items) in enumerate(grants.items(), 1):
            rid = self.role[name] = nid()
            rows.append((rid, 1, 10 + i, ROLE, name))
            for j, (obj, level, mask, delete) in enumerate(items, 1):
                gid = nid()
                rows += [(gid, rid, j, ROLE_OBJECT, str(obj)), (nid(), gid, 1, level, "")]
                if mask is not None:
                    rows.append((nid(), gid, 2, MASK, mask))
                if delete:
                    rows.append((nid(), gid, 3, DELETE, "1"))

        for i, (login, fio, role) in enumerate(USERS, 1):
            uid = self.user[login] = nid()
            rows += [(uid, 1, 10 + i, USER, login), (nid(), uid, 1, NAME_REQ, fio),
                     (nid(), uid, 2, self.role[role], str(USER_ROLE_REQ)),
                     (nid(), uid, 3, TOKEN_REQ, self.tokens[login])]

        # По три заявки на компанию: Черновик, Подана, На экспертизе.
        n = 0
        for ci, (_, key, _) in enumerate(COMPANIES):
            for si, status in enumerate(STATUSES[:3]):
                n += 1
                aid = nid()
                amount = rnd.randrange(5, 60) * 100_000
                rec = {"id": aid, "number": f"З-{n:03d}", "company": key, "status": status, "amount": amount}
                self.apps.append(rec)
                rows += [(aid, 1, n, T_APP, rec["number"]),
                         (nid(), aid, 1, self.company[key], str(R_APP_COMPANY)),
                         (nid(), aid, 2, self.status[status], str(R_APP_STATUS)),
                         (nid(), aid, 3, R_APP_AMOUNT, str(amount)),
                         (nid(), aid, 4, R_APP_REVENUE, str(amount * rnd.randrange(3, 12))),
                         (nid(), aid, 5, R_APP_TEXT, f"Проект {n}: модернизация производства")]
                if status == "На экспертизе":
                    rows.append((nid(), aid, 6, self.user["expert1"], str(R_APP_EXPERT)))
        return rows

    def app(self, company: str, status: str) -> dict:
        return next(a for a in self.apps if a["company"] == company and a["status"] == status)


def sql_quote(v) -> str:
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


def build_sql(db: str, app: App, template: str = "ru") -> str:
    """SQL, создающий базу db с нуля: копия шаблона + строки приложения."""
    values = ",\n".join("(" + ",".join(sql_quote(x) for x in r) + ")" for r in app.rows)
    # Корень записей id=1 в базах ideav.ru — сам себе родитель (up=1); в docker-шаблоне crm он up=0.
    return (f"SET NAMES utf8mb4;\nDROP TABLE IF EXISTS {db};\nCREATE TABLE {db} LIKE {template};\n"
            f"INSERT INTO {db} SELECT * FROM {template};\nUPDATE {db} SET up=1 WHERE id=1;\n"
            f"INSERT INTO {db} (id, up, ord, t, val) VALUES\n{values};\n")
