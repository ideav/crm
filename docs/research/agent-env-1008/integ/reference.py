"""Эталонные решения замера python2node#1060: T1 в каждой среде, правки E1–E6 и ответы Q1–Q4.

Нужны, чтобы проверить пробы (на эталоне — зелёные, на нетронутом старте — красные) и чтобы собрать
старт T2 (эталон T1 + договоры integ/seed.py). B строится через HTTP API ядра от имени админа фонда —
теми же вызовами, что доступны агенту (docs/kb: schema.md, queries.md, roles.md); A′ и A″ — SQL
(integ/a1/t1_reference.sql, integ/a2/t1_reference.sql) и PostgREST реестра.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs_integ as EI  # noqa: E402
import probes_integ as PI  # noqa: E402

E, F, P, S = EI.E, EI.F, EI.P, EI.S
READ, WRITE = F.READ, F.WRITE


# --- B: ядро ideav.ru --------------------------------------------------------------------------

def _func_id(env, name: str) -> int:
    """Функция колонки запроса (справочник «Функция», тип 63): SUM, GROUP_CONCAT, abn_ID."""
    return env._id(63, name)


def _grant(env, role, obj, level=None, mask=None, delete=False):
    form = {"up": role, "t116": obj}
    if level is not None:
        form["t136"] = E.LEVEL_IDEAV[level]
    if mask is not None:
        form["t49"] = mask
    if delete:
        form["t56"] = 1
    return env.api("admin_f", "POST", "_m_new/116?JSON=1", form)["id"]


def _apps_report(env, key: str, company_id: int) -> str:
    """Запрос apps_<компания>: id заявок компании одной строкой — для маски договоров её заявителя."""
    name = f"apps_{key}"
    rid = env.api("admin_f", "POST", "_m_new/22?JSON=1", {"up": 1, "t22": name})["id"]
    col = lambda form: env.api("admin_f", "POST", f"_m_new/28?JSON=1&up={rid}", {"up": rid, **form})  # noqa: E731
    col({"t28": F.T_APP, "t100": "ids", "t104": _func_id(env, "GROUP_CONCAT"),
         "t101": f"IF([THIS] IS NULL,NULL,a{F.T_APP}.id)"})
    col({"t28": F.R_APP_COMPANY, "t104": _func_id(env, "abn_ID"), "t102": company_id, "t107": 1})
    return name


def t1_b(env: EI.IntegCoreEnv):
    api = lambda m, p, f=None: env.api("admin_f", m, p, f)  # noqa: E731
    # таблица «Договор»: номер (уникальный), «Заявка» (ссылка), «Сумма», «Дата», «Статус договора» (справочник)
    tid = api("POST", "_d_new?JSON=1", {"t": 3, "val": "Договор", "unique": 1})["obj"]
    st_tab = api("POST", "_d_new?JSON=1", {"t": 3, "val": "Статус договора", "unique": 1})["obj"]
    for s in S.CONTRACT_STATUSES:
        api("POST", f"_m_new/{st_tab}?JSON=1", {"up": 1, f"t{st_tab}": s})
    ref_app = api("POST", f"_d_ref/{F.T_APP}?JSON=1")["obj"]
    ref_st = api("POST", f"_d_ref/{st_tab}?JSON=1")["obj"]
    amount_t = api("POST", "_d_new?JSON=1", {"t": 13, "val": "Сумма"})["obj"]
    date_t = api("POST", "_d_new?JSON=1", {"t": 9, "val": "Дата"})["obj"]
    r_app = api("POST", f"_d_req/{tid}?JSON=1", {"t": ref_app})["id"]
    api("POST", f"_d_alias/{r_app}?JSON=1", {"val": "Заявка"})
    r_amount = api("POST", f"_d_req/{tid}?JSON=1", {"t": amount_t})["id"]
    api("POST", f"_d_req/{tid}?JSON=1", {"t": date_t})
    api("POST", f"_d_req/{tid}?JSON=1", {"t": ref_st})

    # отчёт «Остаток лимита»: компания и лимит читаются из «Компании» при каждом запуске
    rid = api("POST", "_m_new/22?JSON=1", {"up": 1, "t22": EI.REPORT_NAME})["id"]
    col = lambda form: api("POST", f"_m_new/28?JSON=1&up={rid}", {"up": rid, **form})  # noqa: E731
    total = _func_id(env, "SUM")
    col({"t28": F.T_COMPANY, "t100": "Компания"})
    col({"t28": F.R_COMPANY_LIMIT, "t100": "Лимит"})
    col({"t28": F.R_APP_AMOUNT, "t100": "Одобрено", "t104": total})
    col({"t28": F.R_APP_STATUS, "t102": S.APPROVED, "t107": 1})
    col({"t28": r_amount, "t100": "Законтрактовано", "t104": total})
    col({"t28": 0, "t100": "Остаток",
         "t101": f"a{F.R_COMPANY_LIMIT}.val-IFNULL(SUM(CAST(a{r_amount}_val AS DOUBLE)),0)"})

    # роль «Юрист»: договоры — правка и удаление, заявки, компании, статусы, отчёт — чтение
    role = api("POST", "_m_new/42?JSON=1", {"up": 1, "t42": "Юрист"})["id"]
    _grant(env, role, tid, WRITE, delete=True)
    for obj in (F.T_APP, F.T_COMPANY, F.T_STATUS, st_tab, rid):
        _grant(env, role, obj, READ)
    api("POST", f"_m_set/{env._id(F.USER, 'lawyer1')}?JSON=1", {"t115": role})

    # заявители: договоры своей компании только на чтение — маска по id заявок компании
    for key in ("alpha", "beta"):
        arole = env._id(F.ROLE, f"Заявитель {key}")
        rep = _apps_report(env, key, env._company_id(key))
        _grant(env, arole, tid, READ)
        _grant(env, arole, r_app, mask=f"@IN([{rep}])")
        _grant(env, arole, st_tab, READ)


def _role_grants(env, role_id: int) -> list:
    """Гранты роли из строк ядра: (объект, уровень, маска, удаление)."""
    rows = env.rows()
    by = {r[0]: r for r in rows}
    level_of = {v: k for k, v in E.LEVEL_IDEAV.items()}
    out = []
    for gid, up, _, t, obj in rows:
        if up != role_id or t != F.ROLE_OBJECT:
            continue
        level = mask = None
        delete = False
        for i, u, _, kt, kv in rows:
            if u != gid:
                continue
            if kt in level_of and kv == str(E.LEVEL_REQ):
                level = level_of[kt]
            elif kt == F.MASK:
                mask = kv
            elif kt == F.DELETE:
                delete = True
        out.append((obj, level, mask, delete))
    del by
    return out


def e_b(env: EI.IntegCoreEnv, task: str):
    api = lambda m, p, f=None: env.api("admin_f", m, p, f)  # noqa: E731
    if task == "E1":
        api("POST", f"_m_set/{env._company_id('beta')}?JSON=1", {f"t{F.R_COMPANY_LIMIT}": 4_000_000})
    elif task == "E2":
        api("POST", f"_m_save/{env._company_id('beta')}?JSON=1", {f"t{F.T_COMPANY}": S.BETA_NEW_NAME})
    elif task == "E3":
        d = S.DELTA
        cid = api("POST", f"_m_new/{F.T_COMPANY}?JSON=1", {"up": 1, f"t{F.T_COMPANY}": d["name"],
                                                           f"t{F.R_COMPANY_INN}": d["inn"],
                                                           f"t{F.R_COMPANY_LIMIT}": d["limit"]})["id"]
        alpha = env._company_id("alpha")
        role = api("POST", "_m_new/42?JSON=1", {"up": 1, "t42": "Заявитель delta"})["id"]
        rep = _apps_report(env, "delta", cid)
        for obj, level, mask, delete in _role_grants(env, env._id(F.ROLE, "Заявитель alpha")):
            if mask == str(alpha):
                mask = str(cid)
            elif mask == "@IN([apps_alpha])":
                mask = f"@IN([{rep}])"
            _grant(env, role, obj, level, mask, delete)
        api("POST", f"_m_set/{env._id(F.USER, 'delta_user')}?JSON=1", {"t115": role})
    elif task == "E4":
        _ok(env.contract_act("lawyer1", "create", "Д-003", {"app": "З-012", "amount": 2_000_000, "status": "Проект"}))
    elif task == "E5":
        _ok(env.contract_act("lawyer1", "update", "Д-001", {"app": "З-011", "amount": 1_000_000}))
    elif task == "E6":
        api("POST", f"_m_set/{env._company_id('gamma')}?JSON=1", {f"t{F.R_COMPANY_INN}": S.GAMMA_NEW_INN})
    else:
        raise ValueError(task)


def _ok(resp):
    st, body = resp
    if st >= 400 or '"error"' in body[:200]:
        raise RuntimeError(f"HTTP {st} {body[:300]}")


# --- A′ и A″ ---------------------------------------------------------------------------------

def t1_pg(env):
    s1 = env.s1 if isinstance(env, EI.TwoSysEnv) else env
    s1.psql(s1.T1_REFERENCE.read_text("utf-8"))
    s1.ready()


A1_E = {
    "E1": f"UPDATE api.company SET funding_limit = 4000000 WHERE inn = '{S.COMPANY_INN['beta']}';",
    "E2": f"UPDATE api.company SET name = '{S.BETA_NEW_NAME}' WHERE inn = '{S.COMPANY_INN['beta']}';",
    "E3": f"""INSERT INTO api.company (id, name, inn, funding_limit)
        VALUES ((SELECT max(id) + 1 FROM api.company), '{S.DELTA['name']}', '{S.DELTA['inn']}', {S.DELTA['limit']});
        UPDATE api.app_user SET role = 'applicant',
            company_id = (SELECT id FROM api.company WHERE inn = '{S.DELTA['inn']}') WHERE login = 'delta_user';""",
    "E6": f"UPDATE api.company SET inn = '{S.GAMMA_NEW_INN}' WHERE inn = '{S.COMPANY_INN['gamma']}';",
}


def e_pg(env, task: str):
    if task in ("E4", "E5"):
        fields = {"app": "З-012", "amount": 2_000_000, "status": "Проект"} if task == "E4" else \
            {"app": "З-011", "amount": 1_000_000}
        _ok(env.contract_act("lawyer1", "create" if task == "E4" else "update", "Д-003" if task == "E4" else "Д-001",
                             fields))
        return
    if not isinstance(env, EI.TwoSysEnv):
        env.psql(A1_E[task])
        return
    reg, s1 = env.s2, env.s1
    beta, gamma = S.COMPANY_INN["beta"], S.COMPANY_INN["gamma"]
    if task == "E1":
        _ok(reg.call("PATCH", f"counterparty?inn=eq.{beta}", {"funding_limit": 4_000_000}))
    elif task == "E2":
        _ok(reg.call("PATCH", f"counterparty?inn=eq.{beta}", {"legal_name": S.BETA_NEW_NAME}))
    elif task == "E3":
        d = S.DELTA
        _ok(reg.call("POST", "counterparty", {"inn": d["inn"], "legal_name": d["name"], "funding_limit": d["limit"]}))
        s1.psql(f"UPDATE api.app_user SET role = 'applicant', company_inn = '{d['inn']}' WHERE login = 'delta_user';")
    elif task == "E6":
        _ok(reg.call("PATCH", f"counterparty?inn=eq.{gamma}", {"inn": S.GAMMA_NEW_INN}))
        s1.psql(f"UPDATE api.application SET company_inn = '{S.GAMMA_NEW_INN}' WHERE company_inn = '{gamma}';\n"
                f"UPDATE api.app_user SET company_inn = '{S.GAMMA_NEW_INN}' WHERE company_inn = '{gamma}';")
    else:
        raise ValueError(task)


# --- общий вход --------------------------------------------------------------------------------

def t1(env):
    t1_b(env) if isinstance(env, EI.IntegCoreEnv) else t1_pg(env)


def fix(env, task: str):
    e_b(env, task) if isinstance(env, EI.IntegCoreEnv) else e_pg(env, task)


def fmt(v) -> str:
    return f"{int(v):,}".replace(",", " ") if v == int(v) else str(v)


def answer(task: str, expected: list) -> str:
    """Эталонный ответ на вопрос: эталонные значения в обычной записи (числа с пробелами)."""
    return "ГОТОВО. Ответ: " + "; ".join(fmt(v) if kind == "num" else v for kind, v in expected)
