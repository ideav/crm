"""crm#5243: отчёт «Остаток лимита» по статье docs/kb/report-building.md на стенде #1008, база B.

Чистая копия снимка i60b_start → таблица «Договор» теми же вызовами, что в эталоне замера
python2node#1060 (integ/reference.py, t1_b, без отчёта и ролей) → отчёт по статье → пробы T1
групп R и S (integ/probes_integ.py) и проба размножения: второй договор на одобренную заявку.
Свои таблицы i60bkb*, в конце удаляются; index.php стенда не трогается.

Варианты:  sub2 — рецепт статьи (два подзапроса);  sub — то же с колонкой «Договор → Заявка»
в подзапросе договоров;  join — короткий вариант одним запросом. BYNAME=1 — функции колонок
(t104) передаются именами (SUM, abn_ID), а не id справочника 63.

  cd /root/crm1008-research && python3 <путь>/check_report_recipe.py sub2
"""
import json
import os
import sys

sys.path.insert(0, "/root/crm1008-research/integ")
import envs_integ as EI  # noqa: E402
import probes_integ as PI  # noqa: E402

F, S = EI.F, EI.S
VARIANT = sys.argv[1] if len(sys.argv) > 1 else "sub2"
BUILT, WORK, LIVE = "i60bkb_built", "i60bkbw", "i60bkb"


def contracts_table(api):
    """Таблица «Договор» — те же вызовы, что в reference.t1_b."""
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
    return tid, r_amount


def func(env, name):
    return env._id(63, name)  # справочник «Функция»: SUM, abn_ID …


def report(api, name, cols):
    rid = api("POST", "_m_new/22?JSON=1", {"up": 1, "t22": name})["id"]
    for c in cols:
        api("POST", f"_m_new/28?JSON=1&up={rid}", {"up": rid, **c})
    return rid


def build(env):
    api = lambda m, p, f=None: env.api("admin_f", m, p, f)  # noqa: E731
    tid, r_amount = contracts_table(api)
    md = api("GET", f"metadata/{tid}?JSON=1")
    r_ref_app = next(int(r["id"]) for r in md["reqs"] if r.get("ref") == str(F.T_APP) or r["val"] == "Заявка")
    SUM, ID = ("SUM", "abn_ID") if os.getenv("BYNAME") else (func(env, "SUM"), func(env, "abn_ID"))
    if VARIANT == "join":
        # Рецепт 1: суммы по связанным записям одной цепочкой Компания ← Заявка ← Договор
        report(api, EI.REPORT_NAME, [
            {"t28": F.T_COMPANY, "t100": "Компания"},
            {"t28": F.R_COMPANY_LIMIT, "t100": "Лимит", "t101": "Лимит"},
            {"t28": F.R_APP_AMOUNT, "t100": "Одобрено", "t104": SUM},
            {"t28": F.R_APP_STATUS, "t102": S.APPROVED, "t107": 1},
            {"t28": r_amount, "t100": "Законтрактовано", "t101": "Контракты", "t104": SUM},
            {"t28": 0, "t100": "Остаток", "t101": "Лимит-IFNULL(SUM(Контракты),0)"},
        ])
    else:
        # Рецепт 2: каждая сумма — свой запрос-подзапрос, связанный с внешним по [КомпанияID]
        report(api, "Одобрено компании", [
            {"t28": F.R_APP_AMOUNT, "t100": "Сумма", "t104": SUM},
            {"t28": F.R_APP_STATUS, "t102": S.APPROVED, "t107": 1},
            {"t28": F.R_APP_COMPANY, "t104": ID, "t102": "[КомпанияID]", "t107": 1},
        ])
        report(api, "Законтрактовано компании", [
            {"t28": r_amount, "t100": "Сумма", "t104": SUM},
        ] + ([] if VARIANT == "sub2" else [{"t28": r_ref_app, "t104": ID, "t107": 1}]) + [
            {"t28": F.R_APP_COMPANY, "t104": ID, "t102": "[КомпанияID]", "t107": 1},
        ])
        report(api, EI.REPORT_NAME, [
            {"t28": F.T_COMPANY, "t100": "Компания"},
            {"t28": F.T_COMPANY, "t100": "КомпанияID", "t101": "КомпанияID", "t104": ID, "t107": 1},
            {"t28": F.R_COMPANY_LIMIT, "t100": "Лимит", "t101": "Лимит"},
            {"t28": 0, "t100": "Одобрено", "t101": "[Одобрено компании]"},
            {"t28": 0, "t100": "Законтрактовано", "t101": "[Законтрактовано компании]"},
            {"t28": 0, "t100": "Остаток", "t101": "Лимит-IFNULL([Законтрактовано компании],0)"},
        ])


def main():
    live = EI.IntegCoreEnv(LIVE)
    live.clone("i60b_start")
    build(live)
    live.save(BUILT)
    work = EI.IntegCoreEnv(WORK)
    plan = [p for p in PI.T1 if p["group"] in ("R", "S")]
    # проба размножения: на одной одобренной заявке два договора
    fan = dict(id="KB.FAN", group="R", user="admin_f", expect="check",
               what="два договора на одну заявку: одобрено не удваивается",
               pre=[("kbfan",)], act=("report",), check=PI.report_ok())
    plan.append(fan)
    orig = PI.apply_pre

    def apply_pre(env, pre):
        if pre[0] == "kbfan":
            env.force_contracts(S.CONTRACTS + [("Д-003", "З-010", 500_000, "Проект", None)])
        else:
            orig(env, pre)
    PI.apply_pre = apply_pre
    res = PI.run_probes(work, BUILT, plan)
    for r in res:
        print(r["id"], r["verdict"], json.dumps(r.get("problems"), ensure_ascii=False),
              json.dumps(r.get("report"), ensure_ascii=False)[:600])
    # итоговый SQL отчёта для статьи
    rid = live._id(22, EI.REPORT_NAME)
    print("report id", rid)
    for t in (BUILT, LIVE, WORK):
        EI.IntegCoreEnv(t).drop()


if __name__ == "__main__":
    main()
