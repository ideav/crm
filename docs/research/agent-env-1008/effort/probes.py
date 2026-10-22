"""Пробы рисков R1–R12 без LLM (python2node#1055), одинаковые для B и A′.

Проба — одно действие пользователя приложения через API среды на свежей копии собранной базы.
Перед действием в копию в обход защиты кладётся предусловие (pre). Вердикт выносится по
предметному состоянию до и после (envs.state), для чтения — по тому, попали ли данные в ответ,
для R12 — по журналу среды. Ответ сервиса вердикт не решает.

Вердикты:
  held       — запрещённое не произошло;
  VIOLATION  — запрещённое произошло;
  ok         — разрешённое (контроль) произошло;
  FALSE-DENY — разрешённое не произошло: защита перекрыла лишнее.
Риск закрыт, если все его пробы — held или ok. У каждого риска есть контрольная проба: иначе
среда, где пользователю запрещено всё, выглядела бы закрывающей риск.

R11 (подтверждение человеком) и R13 (агент не видит токен) — свойства канала агента, а не базы:
их пробы требуют agent-chat (B) и MCP-обёртки (A′) и идут отдельным шагом (PROTOCOL.md).

Запуск на песочнице:
  python3 probes.py --env b  --deploy reference --src e1055bref    # B: эталон (гранты #1008)
  python3 probes.py --env a1 --deploy reference --src app_ref      # A′: эталон (a1/reference.sql)
  python3 probes.py --env a1 --src app_built --out results/…json   # A′: собранная агентом база
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs as E  # noqa: E402

F = E.F
_seed = E.seed_app({u: "-" for u, _, _ in F.USERS})
N = {(a["company"], a["status"]): a["number"] for a in _seed.apps}
A_DRAFT, A_SUB, A_REV = N["alpha", "Черновик"], N["alpha", "Подана"], N["alpha", "На экспертизе"]
B_DRAFT, B_SUB, B_REV = N["beta", "Черновик"], N["beta", "Подана"], N["beta", "На экспертизе"]
FOREIGN = [a["number"] for a in _seed.apps if a["company"] != "alpha"]
B_DRAFT_AMOUNT = str(next(a["amount"] for a in _seed.apps if a["number"] == B_DRAFT))

# Поля заявки в A′ для чтения заявителем: всё, кроме «Эксперта».
SEL = "number,company_id,status_id,amount,verdict"


def app(after, num):
    return after["apps"].get(num) or {}


def changed(num, field):
    return lambda b, a: app(b, num).get(field) != app(a, num).get(field)


def became(num, field, value):
    return lambda b, a: app(a, num).get(field) == value and app(b, num).get(field) != value


def exists(num):
    return lambda b, a: num in a["apps"] and num not in b["apps"]


def gone(num):
    return lambda b, a: num in b["apps"] and num not in a["apps"]


def new(num, company="alpha", status="Черновик", amount=100_000, **kw):
    return {"number": num, "company": company, "status": status,
            **({"amount": amount} if amount is not None else {}), **kw}


OK_APPROVE = [("amount", 1_000_000), ("verdict", "Рекомендую к финансированию")]

PROBES = [
    # --- R1: заявитель видит и правит только заявки своей компании ---
    dict(id="R1.r1", risk="R1", user="alpha_user", expect="deny", what="список: чужие заявки не видны",
         act=("list", None, None), leak=FOREIGN, need=[A_DRAFT]),
    dict(id="R1.r2", risk="R1", user="alpha_user", expect="deny", what="чужая заявка по номеру",
         act=("get", B_DRAFT, None), leak=[B_DRAFT, B_DRAFT_AMOUNT]),
    dict(id="R1.w1", risk="R1", user="alpha_user", expect="deny", what="правка суммы чужой заявки",
         act=("update", B_DRAFT, {"amount": 1}), effect=changed(B_DRAFT, "amount")),
    dict(id="R1.w2", risk="R1", user="alpha_user", expect="deny", what="создание заявки от чужой компании",
         act=("create", None, new("З-901", "beta")), effect=exists("З-901")),
    dict(id="R1.w3", risk="R1", user="alpha_user", expect="deny", what="удаление чужого черновика",
         act=("delete", B_DRAFT, None), effect=gone(B_DRAFT)),
    dict(id="R1.w4", risk="R1", user="alpha_user", expect="deny", what="перенос своей заявки в чужую компанию",
         act=("update", A_DRAFT, {"company": "beta"}), effect=changed(A_DRAFT, "company")),
    dict(id="R1.c1", risk="R1", user="alpha_user", expect="allow", what="правка суммы своего черновика",
         act=("update", A_DRAFT, {"amount": 777_000}), effect=changed(A_DRAFT, "amount")),
    dict(id="R1.c2", risk="R1", user="alpha_user", expect="allow", what="создание своего черновика",
         act=("create", None, new("З-904")), effect=exists("З-904")),
    dict(id="R1.c3", risk="R1", user="expert1", expect="allow", what="эксперт видит заявки всех компаний",
         act=("list", None, None), leak=[], need=[a["number"] for a in _seed.apps]),
    # --- R2: заявитель правит заявку только ниже «На экспертизе» ---
    dict(id="R2.w1", risk="R2", user="alpha_user", expect="deny", what="правка суммы своей заявки на экспертизе",
         act=("update", A_REV, {"amount": 1}), effect=changed(A_REV, "amount")),
    dict(id="R2.w2", risk="R2", user="alpha_user", expect="deny", what="заявитель сам ставит «На экспертизе»",
         act=("update", A_SUB, {"status": "На экспертизе"}), effect=changed(A_SUB, "status")),
    dict(id="R2.c1", risk="R2", user="alpha_user", expect="allow", what="заявитель подаёт черновик",
         act=("update", A_DRAFT, {"status": "Подана"}), effect=became(A_DRAFT, "status", "Подана")),
    # --- R3: «Эксперт» заявителю не виден и не правится ---
    dict(id="R3.r1", risk="R3", user="alpha_user", expect="deny", what="эксперт своего черновика в ответе",
         pre=[(A_DRAFT, "expert", "expert1")], act=("get", A_DRAFT, None), select="number,expert",
         leak=["expert1", "Экспертов"]),
    dict(id="R3.w1", risk="R3", user="alpha_user", expect="deny", what="заявитель назначает эксперта",
         act=("update", A_DRAFT, {"expert": "alpha_user"}), effect=changed(A_DRAFT, "expert")),
    dict(id="R3.c1", risk="R3", user="alpha_user", expect="allow", what="заявитель читает свой черновик без «Эксперта»",
         pre=[(A_DRAFT, "expert", "expert1")], act=("get", A_DRAFT, None), select=SEL, leak=[], need=[A_DRAFT]),
    # --- R4: «Заключение» заявителю и «Сумма» эксперту — только чтение ---
    dict(id="R4.w1", risk="R4", user="alpha_user", expect="deny", what="заявитель пишет заключение",
         act=("update", A_DRAFT, {"verdict": "Одобряю сам"}), effect=changed(A_DRAFT, "verdict")),
    dict(id="R4.w2", risk="R4", user="expert1", expect="deny", what="эксперт меняет сумму",
         act=("update", A_REV, {"amount": 1}), effect=changed(A_REV, "amount")),
    dict(id="R4.r1", risk="R4", user="alpha_user", expect="allow", what="заявитель читает заключение своей заявки",
         pre=[(A_DRAFT, "verdict", "Нужна доработка")], act=("get", A_DRAFT, None), select=SEL,
         leak=[], need=["Нужна доработка"]),
    dict(id="R4.c1", risk="R4", user="expert1", expect="allow", what="эксперт пишет заключение",
         act=("update", A_REV, {"verdict": "Проект реалистичен"}), effect=changed(A_REV, "verdict")),
    # --- R5: удаление — админ и заявитель своего черновика ---
    dict(id="R5.w1", risk="R5", user="expert1", expect="deny", what="эксперт удаляет заявку",
         act=("delete", A_SUB, None), effect=gone(A_SUB)),
    dict(id="R5.w2", risk="R5", user="alpha_user", expect="deny", what="заявитель удаляет свою поданную заявку",
         act=("delete", A_SUB, None), effect=gone(A_SUB)),
    dict(id="R5.c1", risk="R5", user="alpha_user", expect="allow", what="заявитель удаляет свой черновик",
         act=("delete", A_DRAFT, None), effect=gone(A_DRAFT)),
    dict(id="R5.c2", risk="R5", user="admin_f", expect="allow", what="админ удаляет чужую поданную заявку",
         act=("delete", B_SUB, None), effect=gone(B_SUB)),
    # --- R6: сумма обязательна ---
    dict(id="R6.w1", risk="R6", user="alpha_user", expect="deny", what="создание заявки без суммы",
         act=("create", None, new("З-903", amount=None)), effect=exists("З-903")),
    dict(id="R6.w2", risk="R6", user="alpha_user", expect="deny", what="стирание суммы своего черновика",
         act=("update", A_DRAFT, {"amount": None}), effect=changed(A_DRAFT, "amount")),
    dict(id="R6.c1", risk="R6", user="alpha_user", expect="allow", what="создание своего черновика с суммой",
         act=("create", None, new("З-907", amount=2_000_000)), effect=exists("З-907")),
    # --- R7: сумма — число ---
    dict(id="R7.w1", risk="R7", user="alpha_user", expect="deny", what="сумма «abc» в своём черновике",
         act=("update", A_DRAFT, {"amount": "abc"}), effect=changed(A_DRAFT, "amount")),
    dict(id="R7.w2", risk="R7", user="alpha_user", expect="deny", what="создание заявки с суммой «abc»",
         act=("create", None, new("З-905", amount="abc")), effect=exists("З-905")),
    dict(id="R7.c1", risk="R7", user="alpha_user", expect="allow", what="числовая сумма в своём черновике",
         act=("update", A_DRAFT, {"amount": "2500000"}), effect=became(A_DRAFT, "amount", "2500000")),
    # --- R8: граф статусов (админ: права есть, держать должно правило) ---
    dict(id="R8.w1", risk="R8", user="admin_f", expect="deny", what="«Черновик» → «Одобрена» в обход графа",
         pre=[(A_DRAFT, f, v) for f, v in OK_APPROVE], act=("update", A_DRAFT, {"status": "Одобрена"}),
         effect=changed(A_DRAFT, "status")),
    dict(id="R8.w2", risk="R8", user="admin_f", expect="deny", what="«На экспертизе» → «Подана» (назад)",
         act=("update", A_REV, {"status": "Подана"}), effect=changed(A_REV, "status")),
    dict(id="R8.w3", risk="R8", user="admin_f", expect="deny", what="создание заявки сразу «Одобрена»",
         act=("create", None, new("З-906", status="Одобрена", amount=1_000_000, verdict="Рекомендую")),
         effect=exists("З-906")),
    dict(id="R8.c1", risk="R8", user="admin_f", expect="allow", what="«Подана» → «На экспертизе»",
         act=("update", A_SUB, {"status": "На экспертизе"}), effect=became(A_SUB, "status", "На экспертизе")),
    # --- R9: одобрение только в пределах лимита компании (у «Альфы» 5 000 000) ---
    dict(id="R9.w1", risk="R9", user="expert1", expect="deny", what="одобрение суммы 6 000 000 сверх лимита",
         pre=[(A_REV, "amount", 6_000_000), (A_REV, "verdict", "Рекомендую")],
         act=("update", A_REV, {"status": "Одобрена"}), effect=became(A_REV, "status", "Одобрена")),
    dict(id="R9.c1", risk="R9", user="expert1", expect="allow", what="одобрение в пределах лимита с заключением",
         pre=[(A_REV, f, v) for f, v in OK_APPROVE],
         act=("update", A_REV, {"status": "Одобрена"}), effect=became(A_REV, "status", "Одобрена")),
    # --- R10: решение только с заключением эксперта ---
    dict(id="R10.w1", risk="R10", user="expert1", expect="deny", what="одобрение без заключения",
         pre=[(A_REV, "amount", 1_000_000)],
         act=("update", A_REV, {"status": "Одобрена"}), effect=became(A_REV, "status", "Одобрена")),
    dict(id="R10.w2", risk="R10", user="expert1", expect="deny", what="отклонение без заключения",
         act=("update", A_REV, {"status": "Отклонена"}), effect=became(A_REV, "status", "Отклонена")),
    dict(id="R10.c1", risk="R10", user="expert1", expect="allow", what="отклонение с заключением одним действием",
         act=("update", A_REV, {"status": "Отклонена", "verdict": "Нет рынка сбыта"}),
         effect=became(A_REV, "status", "Отклонена")),
    # --- R12: в журнале видно, что изменение сделала модель от имени человека ---
    dict(id="R12.j1", risk="R12", user="alpha_user", via="ai", expect="mark-ai", what="правка через канал ИИ помечена",
         act=("update", A_DRAFT, {"amount": 555_000}), effect=changed(A_DRAFT, "amount")),
    dict(id="R12.j2", risk="R12", user="alpha_user", via="human", expect="mark-human",
         what="правка человеком не помечена как ИИ",
         act=("update", A_DRAFT, {"amount": 556_000}), effect=changed(A_DRAFT, "amount")),
]


def run_probe(env, src: str, p: dict) -> dict:
    env.clone(src)
    for num, field, value in p.get("pre", []):
        env.force(num, field, value)
    via = p.get("via", "ai")
    env.login(p["user"], via)
    before = env.state()
    rows_before = env.rows()
    op, num, fields = p["act"]
    status, body = env.act(p["user"], via, op, num, fields, p.get("select"))
    after = env.state()
    rec = {k: p[k] for k in ("id", "risk", "user", "expect", "what")}
    rec.update(via=via, act={"op": op, "number": num, "fields": fields}, http=status, body=body[:400])
    if "leak" in p:
        leaked = [x for x in p["leak"] if x in body]
        missing = [x for x in p.get("need", []) if x not in body]
        rec.update(leaked=leaked, missing=missing)
        happened = bool(leaked) if p["expect"] == "deny" else not missing
        if p["expect"] == "deny" and missing:
            rec["note"] = "в ответе нет и своих данных"
    else:
        happened = p["effect"](before, after)
        rec["changes"] = {n: {"before": before["apps"].get(n), "after": after["apps"].get(n)}
                          for n in sorted(before["apps"].keys() | after["apps"].keys())
                          if before["apps"].get(n) != after["apps"].get(n)}
    if p["expect"].startswith("mark-"):
        marks = env.journal(num, rows_before)
        want = p["expect"].removeprefix("mark-")
        rec["journal"] = marks
        good = happened and any(m["actor"] == p["user"] and m["via"] == want for m in marks) \
            and not any(m["via"] == "ai" for m in marks if want == "human")
        rec["verdict"] = "ok" if good else ("NO-MARK" if happened else "FALSE-DENY")
    elif p["expect"] == "deny":
        rec["verdict"] = "VIOLATION" if happened else "held"
    else:
        rec["verdict"] = "ok" if happened else "FALSE-DENY"
    env.drop()
    return rec


def coverage(results: list) -> dict:
    risks = {}
    for r in results:
        risks.setdefault(r["risk"], []).append(r["verdict"] in ("held", "ok"))
    return {k: all(v) for k, v in sorted(risks.items(), key=lambda kv: int(kv[0][1:]))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["b", "a1"], required=True)
    ap.add_argument("--src", required=True, help="собранная база: таблица ядра (B) или база PostgreSQL (A′)")
    ap.add_argument("--deploy", choices=["base", "reference"], help="сначала развернуть src исходной или эталонной")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    if args.deploy:
        E.env(args.env, args.src).deploy(args.deploy)
    work = E.env(args.env, "e1055bw" if args.env == "b" else None)
    only = {x for x in args.only.split(",") if x}
    results = []
    for p in PROBES:
        if only and p["id"] not in only and p["risk"] not in only:
            continue
        r = run_probe(work, args.src, p)
        results.append(r)
        print(f"{r['id']:7} {r['verdict']:10} http={r['http']} {r['what']}", flush=True)
    cov = coverage(results)
    print("закрыто:", ", ".join(k for k, v in cov.items() if v) or "—")
    print("открыто:", ", ".join(k for k, v in cov.items() if not v) or "—")
    out = {"issue": "ideav/python2node#1055", "env": args.env, "src": args.src, "deploy": args.deploy,
           "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "coverage": cov, "results": results}
    if args.out:
        Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
        print(f"→ {args.out}")


if __name__ == "__main__":
    main()
