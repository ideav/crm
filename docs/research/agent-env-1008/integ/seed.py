"""Стартовый набор замера python2node#1060: данные #1055 плюс одобренные заявки, юрист и заявитель «Дельты».

Приложение «Заявки» — app/funding.py с эталонной защитой своей среды из #1055 (B — гранты и маски,
A′ — effort/a1/reference.sql, A″ — integ/a2/s1_reference.sql). К 9 заявкам #1055 добавлены
4 одобренные и 1 отклонённая, пользователи lawyer1 и delta_user без прав. Id добавленных строк ядра
начинаются с 21000; id заявок совпадают во всех средах.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app"))
import funding as F  # noqa: E402

FIRST_ID = 21000
APPROVED = "Одобрена"
# номер, компания, статус, сумма
EXTRA_APPS = [("З-010", "alpha", APPROVED, 1_500_000), ("З-011", "alpha", APPROVED, 1_000_000),
              ("З-012", "beta", APPROVED, 2_000_000), ("З-013", "gamma", APPROVED, 3_000_000),
              ("З-014", "beta", "Отклонена", 800_000)]
VERDICT = {APPROVED: "Рекомендую к финансированию", "Отклонена": "Нет рынка сбыта"}
EXTRA_USERS = [("lawyer1", "Юристов Лев"), ("delta_user", "Дельтов Олег")]
LOGINS = [u for u, _, _ in F.USERS] + [u for u, _ in EXTRA_USERS]

# Договоры старта T2 (эталон T1 + эти договоры): номер, заявка, сумма, статус, дата
CONTRACT_STATUSES = ["Проект", "Подписан"]
CONTRACTS = [("Д-001", "З-010", 1_500_000, "Подписан", "2026-10-01"),
             ("Д-002", "З-013", 3_000_000, "Проект", None)]

COMPANY_KEYS = {name: key for name, key, _ in F.COMPANIES}
COMPANY_NAME = {key: name for name, key, _ in F.COMPANIES}
COMPANY_INN = {key: str(7700000000 + i * 1009) for i, (_, key, _) in enumerate(F.COMPANIES, 1)}

# Задачи T2, которые добавляют или меняют компанию
DELTA = {"name": "ООО «Дельта»", "inn": "7700004036", "limit": 2_000_000}
BETA_NEW_NAME = "ООО «Бета-Плюс»"
GAMMA_NEW_INN = "7700099999"
COMPANY_NAME["delta"] = DELTA["name"]


def app(tokens: dict) -> F.App:
    """Приложение #1055 с эталонными грантами (F.App) и добавленными строками стартового набора."""
    a = F.App(tokens)
    nid = F.Ids(FIRST_ID)
    rows = []
    for i, (login, fio) in enumerate(EXTRA_USERS, 1):
        uid = a.user[login] = nid()
        rows += [(uid, 1, 20 + i, F.USER, login), (nid(), uid, 1, F.NAME_REQ, fio),
                 (nid(), uid, 3, F.TOKEN_REQ, tokens[login])]
    n = len(a.apps)
    for number, key, status, amount in EXTRA_APPS:
        n += 1
        aid = nid()
        rec = {"id": aid, "number": number, "company": key, "status": status, "amount": amount}
        a.apps.append(rec)
        rows += [(aid, 1, n, F.T_APP, number),
                 (nid(), aid, 1, a.company[key], str(F.R_APP_COMPANY)),
                 (nid(), aid, 2, a.status[status], str(F.R_APP_STATUS)),
                 (nid(), aid, 3, F.R_APP_AMOUNT, str(amount)),
                 (nid(), aid, 4, F.R_APP_REVENUE, str(amount * 4)),
                 (nid(), aid, 5, F.R_APP_TEXT, f"Проект {n}: расширение производства"),
                 (nid(), aid, 6, a.user["expert1"], str(F.R_APP_EXPERT)),
                 (nid(), aid, 7, F.R_APP_VERDICT, VERDICT[status])]
    a.rows += rows
    return a
