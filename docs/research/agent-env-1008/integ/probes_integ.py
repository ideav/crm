"""Пробы T1 и вердикты задач T2 замера python2node#1060 — без LLM, по состоянию базы.

Проба — одно действие пользователя через API среды на свежей копии проверяемой базы (как в #1055,
effort/probes.py). Предусловие (pre) кладётся в обход защиты: договоры из integ/seed.py или правка
компании в источнике. Вердикт — по предметному состоянию до и после (envs_integ.state), для чтения —
по данным в ответе, для отчёта — по сравнению строк отчёта с эталоном, посчитанным из данных.

Вердикты: held / VIOLATION (запрет), ok / FALSE-DENY (разрешение), ok / WRONG (проверка значения),
NOT-SET (пробу не поставить: нет таблицы, колонки или пользователя, которые должен создать агент).

Эталон отчёта «Остаток лимита» не записан числами: он считается из состояния базы (truth):
одобрено — сумма одобренных заявок компании, законтрактовано — сумма её договоров в любом статусе,
остаток = лимит − законтрактовано.
"""
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs_integ as EI  # noqa: E402

S = EI.S
APPROVED = S.APPROVED
ALPHA, BETA, GAMMA = (S.COMPANY_NAME[k] for k in ("alpha", "beta", "gamma"))
GAMMA_RENAMED = "АО «Гамма-Холдинг»"
START_APPS = [f"З-{i:03d}" for i in range(1, 15)]


def dec(v) -> Decimal:
    try:
        return Decimal(str(v)) if v not in (None, "") else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def n(d) -> str:
    return EI.norm_num(str(d))


def truth(state: dict) -> dict:
    """Эталон отчёта по данным: компания → лимит, одобрено, законтрактовано, остаток."""
    out = {}
    apps = state["apps"]
    for name, c in state["companies"].items():
        approved = sum((dec(a["amount"]) for a in apps.values() if a["company"] == name and a["status"] == APPROVED),
                       Decimal(0))
        contracted = sum((dec(k["amount"]) for k in state["contracts"].values()
                          if k["app"] in apps and apps[k["app"]]["company"] == name), Decimal(0))
        out[name] = {"limit": n(dec(c["limit"])), "approved": n(approved), "contracted": n(contracted),
                     "remaining": n(dec(c["limit"]) - contracted)}
    return out


# --- проверки ---------------------------------------------------------------------------------

def report_ok(names=None, absent=()):
    """Строки отчёта совпадают с эталоном: по компаниям names или по всем, у кого есть одобренное или договоры."""
    def check(after, rows):
        if rows is None:
            return False, ["отчёта нет или он не читается"]
        t = truth(after)
        want = names or [k for k, v in t.items() if v["approved"] != "0" or v["contracted"] != "0"]
        bad = []
        for name in want:
            row = next((r for r in rows if r["company"] == name), None)
            if name not in t:
                bad.append(f"компании «{name}» нет в источнике")
            elif row is None:
                bad.append(f"в отчёте нет строки «{name}»")
            else:
                diff = {k: [row[k], t[name][k]] for k in ("limit", "approved", "contracted", "remaining")
                        if row[k] != t[name][k]}
                if diff:
                    bad.append(f"{name}: {diff}")
        bad += [f"в отчёте осталась строка «{x}»" for x in absent if any(r["company"] == x for r in rows)]
        return not bad, bad
    return check


def state_ok(fn, what: str):
    def check(after, rows):
        try:
            good = bool(fn(after))
        except (KeyError, TypeError, AttributeError):
            good = False
        return good, [] if good else [what]
    return check


def all_of(*checks):
    def check(after, rows):
        bad = []
        for c in checks:
            ok, b = c(after, rows)
            bad += b
        return not bad, bad
    return check


def cexists(num):
    return lambda b, a: num in a["contracts"] and num not in b["contracts"]


def cchanged(num, field):
    return lambda b, a: num in b["contracts"] and b["contracts"][num].get(field) != (a["contracts"].get(num) or {}).get(field)


def exists(num):
    return lambda b, a: num in a["apps"] and num not in b["apps"]


def new_app(num, company, amount=100_000):
    return {"number": num, "company": company, "status": "Черновик", "amount": amount}


PRE = [("contracts",)]
CONTRACT_NEW = {"app": "З-011", "amount": 1_000_000, "date": "2026-10-20", "status": "Проект"}

# --- T1 ----------------------------------------------------------------------------------------
# Группы: L — юрист, A — заявитель, R — значения отчёта, S — отчёт после правки источника.
T1 = [
    dict(id="T1.L1", group="L", user="lawyer1", expect="allow", what="юрист создаёт договор по одобренной заявке",
         pre=PRE, act=("contract", "create", "Д-101", CONTRACT_NEW), effect=cexists("Д-101")),
    dict(id="T1.L2", group="L", user="lawyer1", expect="allow", what="юрист правит сумму и статус договора",
         pre=PRE, act=("contract", "update", "Д-002", {"amount": 2_900_000, "status": "Подписан"}),
         effect=cchanged("Д-002", "amount")),
    dict(id="T1.L3", group="L", user="lawyer1", expect="allow", what="юрист читает заявки",
         act=("app", "list", None, None), select="number,amount", leak=[], need=["З-010", "З-012", "З-013"]),
    dict(id="T1.A1", group="A", user="alpha_user", expect="deny", what="заявитель видит договор чужой компании",
         pre=PRE, act=("contract", "list", None, None), leak=["Д-002"], need=["Д-001"]),
    dict(id="T1.A2", group="A", user="alpha_user", expect="allow", what="заявитель видит договор своей компании",
         pre=PRE, act=("contract", "list", None, None), leak=[], need=["Д-001"]),
    dict(id="T1.A3", group="A", user="alpha_user", expect="deny", what="заявитель правит договор своей компании",
         pre=PRE, act=("contract", "update", "Д-001", {"amount": 1}), effect=cchanged("Д-001", "amount")),
    dict(id="T1.A4", group="A", user="alpha_user", expect="deny", what="заявитель создаёт договор",
         pre=PRE, act=("contract", "create", "Д-102", CONTRACT_NEW), effect=cexists("Д-102")),
    dict(id="T1.A5", group="A", user="beta_user", expect="deny", what="заявитель «Беты» видит договоры «Альфы» и «Гаммы»",
         pre=PRE, act=("contract", "list", None, None), leak=["Д-001", "Д-002"]),
    dict(id="T1.R1", group="R", user="admin_f", expect="check", what="отчёт «Остаток лимита» совпадает с эталоном",
         pre=PRE, act=("report",), check=report_ok()),
    dict(id="T1.S1", group="S", user="admin_f", expect="check",
         what="лимит «Альфы» сменили в источнике на 6 000 000 — отчёт показывает новый",
         pre=PRE + [("company", "alpha", "limit", 6_000_000)], act=("report",),
         check=all_of(state_ok(lambda s: s["companies"][ALPHA]["limit"] == "6000000", "лимит не сменился в источнике"),
                      report_ok([ALPHA]))),
    dict(id="T1.S2", group="S", user="admin_f", expect="check",
         what="«Гамму» переименовали в источнике — отчёт показывает новое название",
         pre=PRE + [("company", "gamma", "name", GAMMA_RENAMED)], act=("report",),
         check=report_ok([GAMMA_RENAMED], absent=[GAMMA])),
]
T1_GROUPS = ["L", "A", "R", "S"]

# --- T2 ----------------------------------------------------------------------------------------
_rep = lambda tid: dict(id=f"{tid}.rep", group=tid, user="admin_f", expect="check",  # noqa: E731
                        what="отчёт по-прежнему совпадает с эталоном", act=("report",), check=report_ok())
_beta_apps = ["З-004", "З-005", "З-006", "З-012", "З-014"]
_gamma_apps = ["З-007", "З-008", "З-009", "З-013"]

T2_PROBES = {
    "E1": [dict(id="E1.s", group="E1", user="admin_f", expect="check", what="лимит «Беты» 4 000 000 и в отчёте",
                act=("report",), check=all_of(
                    state_ok(lambda s: s["companies"][BETA]["limit"] == "4000000", "лимит «Беты» не 4 000 000"),
                    report_ok([BETA]))), _rep("E1")],
    "E2": [dict(id="E2.s", group="E2", user="admin_f", expect="check",
                what="«Бета» переименована везде, в том числе в отчёте", act=("report",), check=all_of(
                    state_ok(lambda s: s["companies"][S.BETA_NEW_NAME]["inn"] == S.COMPANY_INN["beta"]
                             and BETA not in s["companies"], "компания не переименована в источнике"),
                    state_ok(lambda s: all(s["apps"][x]["company"] == S.BETA_NEW_NAME for x in _beta_apps),
                             "заявки «Беты» не показывают новое название"),
                    report_ok([S.BETA_NEW_NAME], absent=[BETA]))),
           dict(id="E2.c1", group="E2", user="beta_user", expect="allow", what="заявитель «Беты» видит свои заявки",
                act=("app", "list", None, None), leak=[], need=["З-004"]),  # черновик: в B маска статуса скрывает остальные
           _rep("E2")],
    "E3": [dict(id="E3.s", group="E3", user="admin_f", expect="check", what="«Дельта» в источнике: ИНН и лимит",
                check=state_ok(lambda s: s["companies"][S.DELTA["name"]]["inn"] == S.DELTA["inn"]
                               and s["companies"][S.DELTA["name"]]["limit"] == str(S.DELTA["limit"]),
                               "нет «Дельты» с ИНН и лимитом из задачи")),
           dict(id="E3.c1", group="E3", user="delta_user", expect="allow", what="заявитель «Дельты» создаёт свою заявку",
                act=("app", "create", None, new_app("З-951", "delta")), effect=exists("З-951")),
           dict(id="E3.r1", group="E3", user="delta_user", expect="deny", what="заявитель «Дельты» видит чужие заявки",
                act=("app", "list", None, None), select="number", leak=START_APPS),
           dict(id="E3.r2", group="E3", user="delta_user", expect="deny", what="заявитель «Дельты» видит чужие договоры",
                act=("contract", "list", None, None), leak=["Д-001", "Д-002"]),
           dict(id="E3.w1", group="E3", user="alpha_user", expect="deny", what="заявитель «Альфы» создаёт заявку «Дельты»",
                act=("app", "create", None, new_app("З-952", "delta")), effect=exists("З-952")),
           _rep("E3")],
    "E4": [dict(id="E4.s", group="E4", user="admin_f", expect="check", what="договор по заявке «Беты» на 2 000 000",
                act=("report",), check=all_of(
                    state_ok(lambda s: any(k["app"] == "З-012" and k["amount"] == "2000000"
                                           for k in s["contracts"].values()), "нет договора по З-012 на 2 000 000"),
                    report_ok([BETA]))), _rep("E4")],
    "E5": [dict(id="E5.s", group="E5", user="admin_f", expect="check", what="договор Д-001 перенесён на З-011, сумма 1 000 000",
                act=("report",), check=all_of(
                    state_ok(lambda s: s["contracts"]["Д-001"]["app"] == "З-011"
                             and s["contracts"]["Д-001"]["amount"] == "1000000", "Д-001 не на З-011 с суммой 1 000 000"),
                    state_ok(lambda s: not any(k["app"] == "З-010" for k in s["contracts"].values()),
                             "по З-010 остался договор"),
                    report_ok([ALPHA]))), _rep("E5")],
    "E6": [dict(id="E6.s", group="E6", user="admin_f", expect="check",
                what="ИНН «Гаммы» исправлен, её заявки и договоры на месте и в отчёте", act=("report",), check=all_of(
                    state_ok(lambda s: s["companies"][GAMMA]["inn"] == S.GAMMA_NEW_INN, "ИНН «Гаммы» не исправлен"),
                    state_ok(lambda s: all(s["apps"][x]["company"] == GAMMA for x in _gamma_apps),
                             "заявки «Гаммы» потеряли компанию"),
                    report_ok([GAMMA]))), _rep("E6")],
}
T2_TASKS = ["Q1", "Q2", "Q3", "Q4", "E1", "E2", "E3", "E4", "E5", "E6"]


def short_name(name: str) -> str:
    """«ООО «Бета»» → «Бета»: в ответе компанию ищут по ядру названия."""
    return re.sub(r"^(ООО|АО|ПАО|ЗАО)\s*", "", name).strip("«»\"' ")


def q_expected(task: str, state: dict) -> list:
    """Эталон ответа на вопрос — из состояния базы старта T2: [("num", Decimal) | ("text", str)]."""
    t = truth(state)
    if task == "Q1":
        return [("num", dec(t[ALPHA]["remaining"]))]
    if task == "Q2":
        with_contract = {k["app"] for k in state["contracts"].values()}
        return [("text", num) for num, a in sorted(state["apps"].items())
                if a["status"] == APPROVED and num not in with_contract]
    if task == "Q3":
        name, v = max(((k, dec(v["approved"]) - dec(v["contracted"])) for k, v in t.items()), key=lambda kv: kv[1])
        return [("text", short_name(name)), ("num", v)]
    if task == "Q4":
        return [("num", sum((dec(v["contracted"]) for v in t.values() if dec(v["limit"]) > 4_000_000), Decimal(0)))]
    raise ValueError(task)


UNITS = {"млн": Decimal(1_000_000), "миллион": Decimal(1_000_000), "тыс": Decimal(1_000)}


def numbers(text: str) -> set:
    """Все числа ответа: 3 500 000, 3,5 млн, 3500000.00, 3,500,000 — в Decimal."""
    t = re.sub(r"[   ]", " ", text or "")
    out = set()
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(млн|миллион|тыс)", t, re.I):
        out.add(Decimal(m[1].replace(",", ".")) * UNITS[m[2].lower()])
    for m in re.finditer(r"\d{1,3}(?: \d{3})+(?:[.,]\d+)?", t):
        out.add(Decimal(m[0].replace(" ", "").replace(",", ".")))
    for m in re.finditer(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", t):
        out.add(Decimal(m[0].replace(",", "")))
    for m in re.finditer(r"\d+(?:[.,]\d+)?", t):
        out.add(Decimal(m[0].replace(",", ".")))
    return {x.normalize() for x in out}


def answer_ok(answer: str, expected: list):
    norm = re.sub(r"[‐‑‒–—]", "-", answer or "").lower()
    nums = numbers(answer)
    missing = [str(v) for kind, v in expected
               if (kind == "num" and Decimal(v).normalize() not in nums) or (kind == "text" and v.lower() not in norm)]
    return not missing, missing


# --- раннер пробы ------------------------------------------------------------------------------

def apply_pre(env, pre):
    if pre[0] == "contracts":
        # дата у всех договоров: агент вправе сделать «Дату» обязательной (a1-t1-1, NOT NULL signed_on)
        env.force_contracts([(num, app, amount, status, date or "2026-10-15")
                             for num, app, amount, status, date in S.CONTRACTS])
    elif pre[0] == "company":
        env.force_company(*pre[1:])
    else:
        raise ValueError(pre)


def consistent(state: dict) -> list:
    """A″ (a3): копия справочника в S1 совпадает с источником S2 — те же компании, ИНН и лимиты."""
    s2 = sorted([name, c["inn"], c["limit"]] for name, c in state["companies"].items())
    s1 = sorted(state["s1_companies"], key=lambda r: [str(x) for x in r])
    if s1 == s2:
        return []
    only2 = [r for r in s2 if r not in s1]
    only1 = [r for r in s1 if r not in s2]
    return [f"S1 не совпадает с S2: только в S2 {only2}, только в S1 {only1}"]


def run_probe(env, src: str, p: dict) -> dict:
    rec = {k: p[k] for k in ("id", "group", "user", "expect", "what")}
    try:
        env.clone(src)
        for pre in p.get("pre", []):
            apply_pre(env, pre)
        if hasattr(env, "sync"):  # A″ (a3): раннер запускает sync.py сборки перед проверкой
            s = env.sync()
            rec["sync"] = {"rc": s["rc"], "timeout": s["timeout"], "stderr": s["stderr"][-600:]}
        env.login(p["user"], "human")
        before = env.state()
        status, body, rows = None, "", None
        act = p.get("act")
        if act and act[0] == "app":
            status, body = env.act(p["user"], "human", act[1], act[2], act[3], p.get("select"))
        elif act and act[0] == "contract":
            status, body = env.contract_act(p["user"], act[1], act[2], act[3])
        elif act and act[0] == "report":
            status, rows = env.report(p["user"])
        after = env.state()
    except (RuntimeError, ValueError, TypeError, KeyError) as e:
        rec.update(verdict="NOT-SET", error=f"{type(e).__name__}: {str(e)[-300:]}")
        env.drop()
        return rec
    rec.update(act=list(act) if act else None, http=status, body=(body or "")[:400])
    if "leak" in p:
        leaked = [x for x in p["leak"] if x in body]
        missing = [x for x in p.get("need", []) if x not in body]
        rec.update(leaked=leaked, missing=missing)
        happened = bool(leaked) if p["expect"] == "deny" else not missing
        if p["expect"] == "deny" and missing:
            rec["note"] = "в ответе нет и своих данных"
    elif "check" in p:
        good, bad = p["check"](after, rows)
        if "s1_companies" in after:
            bad = bad + consistent(after)
            good = not bad
        rec.update(report=rows, problems=bad)
        rec["verdict"] = "ok" if good else "WRONG"
        env.drop()
        return rec
    else:
        happened = p["effect"](before, after)
        rec["changes"] = {k: {"before": before["contracts"].get(k), "after": after["contracts"].get(k)}
                          for k in sorted(before["contracts"].keys() | after["contracts"].keys())
                          if before["contracts"].get(k) != after["contracts"].get(k)}
    if p["expect"] == "deny":
        rec["verdict"] = "VIOLATION" if happened else "held"
    else:
        rec["verdict"] = "ok" if happened else "FALSE-DENY"
    env.drop()
    return rec


def run_probes(env, src: str, plan: list) -> list:
    return [run_probe(env, src, p) for p in plan]


def passed(r: dict) -> bool:
    return r["verdict"] in ("held", "ok")


def coverage(results: list, groups=T1_GROUPS) -> dict:
    return {g: all(passed(r) for r in results if r["group"] == g) and any(r["group"] == g for r in results)
            for g in groups}
