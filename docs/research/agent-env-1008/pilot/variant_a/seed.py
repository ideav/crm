"""Схема MariaDB варианта A и посев данных из funding.App (числа не дублируются)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "app"))
import funding as F  # noqa: E402
from db import q  # noqa: E402

SCHEMA = """
CREATE TABLE companies (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL, inn VARCHAR(32), limit_amount DOUBLE) ENGINE=InnoDB;
CREATE TABLE statuses (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, ord INT NOT NULL) ENGINE=InnoDB;
CREATE TABLE roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE) ENGINE=InnoDB;
CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, login VARCHAR(64) NOT NULL UNIQUE, fio VARCHAR(255),
  role_id INT NOT NULL, company_id INT NULL,
  FOREIGN KEY (role_id) REFERENCES roles(id), FOREIGN KEY (company_id) REFERENCES companies(id)) ENGINE=InnoDB;
CREATE TABLE sessions (token CHAR(64) PRIMARY KEY, user_id INT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE applications (id INT AUTO_INCREMENT PRIMARY KEY, number VARCHAR(64) NOT NULL UNIQUE,
  company_id INT NOT NULL, status_id INT NOT NULL, amount DOUBLE NULL, revenue DOUBLE NULL,
  description TEXT NULL, expert_user_id INT NULL, verdict TEXT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (status_id) REFERENCES statuses(id),
  FOREIGN KEY (expert_user_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE app_columns (name VARCHAR(100) PRIMARY KEY, type VARCHAR(10) NOT NULL, ord INT NOT NULL) ENGINE=InnoDB;
"""

OVERRIDE_KEYS = {"text", "amount", "revenue", "status", "company", "expert", "verdict"}


def extract(app: "F.App") -> dict:
    """Достаёт из строк-квартетов funding.App компании, заявки и пр. (revenue/text есть только там)."""
    rows = app.rows
    by_up = {}
    for r in rows:
        by_up.setdefault(r[1], []).append(r)
    inv_company = {v: k for k, v in app.company.items()}
    inv_status = {v: k for k, v in app.status.items()}
    inv_user = {v: k for k, v in app.user.items()}
    companies = []
    for r in rows:
        if r[3] == F.T_COMPANY and r[1] == 1:
            kids = {c[3]: c[4] for c in by_up.get(r[0], [])}
            companies.append(dict(id=r[0], code=inv_company[r[0]], name=r[4], inn=kids[F.R_COMPANY_INN],
                                  limit=int(kids[F.R_COMPANY_LIMIT])))
    statuses = [dict(id=r[0], name=r[4], ord=r[2]) for r in rows if r[3] == F.T_STATUS and r[1] == 1]
    apps = []
    for r in rows:
        if r[3] == F.T_APP and r[1] == 1:
            a = dict(id=r[0], number=r[4], company=None, status=None, amount=None, revenue=None, text="",
                     expert=None, verdict="")
            for c in by_up.get(r[0], []):
                if c[4] == str(F.R_APP_COMPANY):
                    a["company"] = inv_company[c[3]]
                elif c[4] == str(F.R_APP_STATUS):
                    a["status"] = inv_status[c[3]]
                elif c[4] == str(F.R_APP_EXPERT):
                    a["expert"] = inv_user[c[3]]
                elif c[3] == F.R_APP_AMOUNT:
                    a["amount"] = int(c[4])
                elif c[3] == F.R_APP_REVENUE:
                    a["revenue"] = int(c[4])
                elif c[3] == F.R_APP_TEXT:
                    a["text"] = c[4]
                elif c[3] == F.R_APP_VERDICT:
                    a["verdict"] = c[4]
            apps.append(a)
    return dict(companies=companies, statuses=statuses, apps=apps)


def seed_sql(app: "F.App", overrides: dict | None) -> str:
    d = extract(app)
    for number, ov in (overrides or {}).items():
        bad = set(ov) - OVERRIDE_KEYS
        if bad:
            raise ValueError(f"overrides[{number}]: неизвестные поля {sorted(bad)}")
        a = next((x for x in d["apps"] if x["number"] == number), None)
        if a is None:
            raise ValueError(f"overrides: нет заявки {number}")
        a.update(ov)
    cid = {c["code"]: c["id"] for c in d["companies"]}
    sid = {s["name"]: s["id"] for s in d["statuses"]}
    uid = app.user
    out = []
    out.append("INSERT INTO companies (id,code,name,inn,limit_amount) VALUES " + ",".join(
        f"({c['id']},{q(c['code'])},{q(c['name'])},{q(c['inn'])},{c['limit']})" for c in d["companies"]) + ";")
    out.append("INSERT INTO statuses (id,name,ord) VALUES " + ",".join(
        f"({s['id']},{q(s['name'])},{s['ord']})" for s in d["statuses"]) + ";")
    out.append("INSERT INTO roles (id,name) VALUES " + ",".join(f"({i},{q(n)})" for n, i in app.role.items()) + ";")
    urows = []
    for login, fio, role in F.USERS:
        comp = cid[role.split()[-1]] if role.startswith("Заявитель") else None
        urows.append(f"({uid[login]},{q(login)},{q(fio)},{app.role[role]},{q(comp)})")
    out.append("INSERT INTO users (id,login,fio,role_id,company_id) VALUES " + ",".join(urows) + ";")
    out.append("INSERT INTO sessions (token,user_id) VALUES " + ",".join(
        f"({q(app.tokens[login])},{uid[login]})" for login, _, _ in F.USERS) + ";")
    arows = []
    for a in d["apps"]:
        arows.append(f"({a['id']},{q(a['number'])},{cid[a['company']]},{sid[a['status']]},{q(a['amount'])},"
                     f"{q(a['revenue'])},{q(a['text'])},{q(uid[a['expert']] if a['expert'] else None)},{q(a['verdict'] or None)})")
    out.append("INSERT INTO applications (id,number,company_id,status_id,amount,revenue,description,expert_user_id,verdict) "
               "VALUES " + ",".join(arows) + ";")
    return "\n".join(out)
