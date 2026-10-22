"""Цена изменения (python2node#1055, PROTOCOL.md п.4): три правки на собранной среде.

Текст правок для агента — CHANGES.md. Здесь — эталонное выполнение правок вручную в обеих средах
(чтобы проверить пробы) и пробы каждой правки. Пробы идут тем же раннером, что R1–R12
(probes.run_probe): вердикт по состоянию базы.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs as E  # noqa: E402
import probes as PR  # noqa: E402

F, P = E.F, E.P
A_DRAFT, A_SUB, A_REV, B_DRAFT = PR.A_DRAFT, PR.A_SUB, PR.A_REV, PR.B_DRAFT
DELTA = ("ООО «Дельта»", "7700004036", 4_000_000)
DELTA_USER = ("delta_user", "Дельтов Олег")
APPROVED_4M = [(A_SUB, "amount", 4_000_000), (A_SUB, "verdict", "Рекомендую"), (A_SUB, "status", "Одобрена")]
SCORE = "4242"

PROBES = {
    "X1": [  # новая компания с заявителем
        dict(id="X1.c1", risk="X1", user="delta_user", expect="allow", what="заявитель «Дельты» создаёт свой черновик",
             act=("create", None, PR.new("З-951", "delta")), effect=PR.exists("З-951")),
        dict(id="X1.r1", risk="X1", user="delta_user", expect="deny", what="заявитель «Дельты» видит чужие заявки",
             act=("list", None, None), leak=[a["number"] for a in PR._seed.apps]),
        dict(id="X1.w1", risk="X1", user="delta_user", expect="deny", what="заявитель «Дельты» правит заявку «Альфы»",
             act=("update", A_DRAFT, {"amount": 1}), effect=PR.changed(A_DRAFT, "amount")),
        dict(id="X1.w2", risk="X1", user="alpha_user", expect="deny", what="заявитель «Альфы» создаёт заявку «Дельты»",
             act=("create", None, PR.new("З-952", "delta")), effect=PR.exists("З-952")),
    ],
    "X2": [  # лимит: сумма ≤ лимит − уже одобренное
        dict(id="X2.w1", risk="X2", user="expert1", expect="deny",
             what="одобрение 2 млн при одобренных 4 млн и лимите 5 млн",
             pre=APPROVED_4M + [(A_REV, "amount", 2_000_000), (A_REV, "verdict", "Рекомендую")],
             act=("update", A_REV, {"status": "Одобрена"}), effect=PR.became(A_REV, "status", "Одобрена")),
        dict(id="X2.c1", risk="X2", user="expert1", expect="allow",
             what="одобрение 1 млн при одобренных 4 млн и лимите 5 млн",
             pre=APPROVED_4M + [(A_REV, "amount", 1_000_000), (A_REV, "verdict", "Рекомендую")],
             act=("update", A_REV, {"status": "Одобрена"}), effect=PR.became(A_REV, "status", "Одобрена")),
    ],
    "X3": [  # новое поле, закрытое от заявителя
        dict(id="X3.c1", risk="X3", user="expert1", expect="allow", what="эксперт ставит внутреннюю оценку",
             act=("update", A_REV, {"score": 7}), watch=[(A_REV, "score")], effect=PR.fchanged(A_REV, "score")),
        dict(id="X3.r1", risk="X3", user="alpha_user", expect="deny", what="заявитель видит внутреннюю оценку",
             pre=[(A_DRAFT, "score", SCORE)], act=("get", A_DRAFT, None), select="number,internal_score",
             leak=[SCORE]),
        dict(id="X3.w1", risk="X3", user="alpha_user", expect="deny", what="заявитель пишет внутреннюю оценку",
             act=("update", A_DRAFT, {"score": 1}), watch=[(A_DRAFT, "score")], effect=PR.fchanged(A_DRAFT, "score")),
        dict(id="X3.c2", risk="X3", user="alpha_user", expect="allow", what="заявитель по-прежнему читает свой черновик",
             pre=[(A_DRAFT, "score", SCORE)], act=("get", A_DRAFT, None), select=PR.SEL, leak=[], need=[A_DRAFT]),
    ],
}


# --- эталонные правки ------------------------------------------------------------------------

def _core_insert(env: E.CoreEnv, rows: list):
    """rows: (key, up, ord, t, val); up/t могут ссылаться на key ранее вставленной строки."""
    start = int(P.mysql(f"SELECT MAX(id) FROM {env.db}")[0][0]) + 1
    ids = {r[0]: start + i for i, r in enumerate(rows)}
    res = lambda v: ids.get(v, v)  # noqa: E731
    values = ",".join(f"({ids[k]},{res(u)},{o},{res(t)},{F.sql_quote(str(v))})" for k, u, o, t, v in rows)
    P.mysql(f"SET NAMES utf8mb4;\nINSERT INTO {env.db} (id, up, ord, t, val) VALUES {values};")
    return ids


def _core_role_grants(env: E.CoreEnv, role_name: str) -> list:
    rid = env._id(F.ROLE, role_name)
    rows = P.mysql(f"SELECT g.id, g.val FROM {env.db} g WHERE g.up={rid} AND g.t={F.ROLE_OBJECT}")
    out = []
    for gid, obj in rows:
        kids = P.mysql(f"SELECT t, val FROM {env.db} WHERE up={gid}")
        out.append((obj, [(int(t), v) for t, v in kids]))
    return out


def reference_b(env: E.CoreEnv, change: str):
    if change == "X1":
        alpha = env._id(F.T_COMPANY, E.COMPANY_NAME["alpha"])
        rows = [("c", 1, 4, F.T_COMPANY, DELTA[0]), ("ci", "c", 1, F.R_COMPANY_INN, DELTA[1]),
                ("cl", "c", 2, F.R_COMPANY_LIMIT, DELTA[2]), ("r", 1, 20, F.ROLE, "Заявитель delta")]
        for j, (obj, kids) in enumerate(_core_role_grants(env, "Заявитель alpha"), 1):
            rows.append((f"g{j}", "r", j, F.ROLE_OBJECT, obj))
            for k, (t, v) in enumerate(kids, 1):
                rows.append((f"g{j}.{k}", f"g{j}", k, t, "c" if t == F.MASK and v == str(alpha) else v))
        rows += [("u", 1, 20, F.USER, DELTA_USER[0]), ("un", "u", 1, F.NAME_REQ, DELTA_USER[1]),
                 ("ur", "u", 2, "r", str(F.USER_ROLE_REQ))]
        ids = _core_insert(env, rows)
        P.mysql("".join(f"UPDATE {env.db} SET val='{ids['c']}' WHERE id={ids[k]};\n"
                        for k, (_, _, _, t, v) in zip(ids, rows) if t == F.MASK and v == "c"))
    elif change == "X3":
        ids = _core_insert(env, [("ty", 0, 0, F.NUMBER, E.EXTRA_FIELDS["score"][0]),
                                 ("rq", F.T_APP, 8, "ty", "")])
        grants = []
        for role, level in [("Заявитель alpha", F.BARRED), ("Заявитель beta", F.BARRED), ("Эксперт", F.WRITE)]:
            rid = env._id(F.ROLE, role)
            grants += [(f"{role}g", rid, 30, F.ROLE_OBJECT, ids["rq"]),
                       (f"{role}l", f"{role}g", 1, E.LEVEL_IDEAV[level], str(E.LEVEL_REQ))]
        _core_insert(env, grants)
    # X2 в ядре выразить нечем: правило лимита — «нет механизма»


A1_REFERENCE = {
    "X1": f"""INSERT INTO api.company (id, name, inn, funding_limit) VALUES (20100, '{DELTA[0]}', '{DELTA[1]}', {DELTA[2]});
INSERT INTO api.app_user (login, fio, role, company_id) VALUES ('{DELTA_USER[0]}', '{DELTA_USER[1]}', 'applicant', 20100);
""",
    "X2": """CREATE OR REPLACE FUNCTION priv.check_process() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = api AS $$
DECLARE
    old_name text := (SELECT name FROM api.status WHERE id = OLD.status_id);
    new_name text := (SELECT name FROM api.status WHERE id = NEW.status_id);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF new_name <> 'Черновик' THEN
            RAISE EXCEPTION 'новая заявка создаётся в статусе «Черновик»' USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id AND (old_name, new_name) NOT IN (
            ('Черновик', 'Подана'), ('Подана', 'На экспертизе'),
            ('На экспертизе', 'Одобрена'), ('На экспертизе', 'Отклонена')) THEN
        RAISE EXCEPTION 'переход «%» → «%» запрещён', old_name, new_name USING ERRCODE = 'check_violation';
    END IF;
    IF new_name IN ('Одобрена', 'Отклонена') AND coalesce(btrim(NEW.verdict), '') = '' THEN
        RAISE EXCEPTION 'решение без заключения эксперта' USING ERRCODE = 'check_violation';
    END IF;
    IF new_name = 'Одобрена' AND NEW.amount > (SELECT c.funding_limit - coalesce(sum(a.amount), 0)
            FROM api.company c LEFT JOIN api.application a ON a.company_id = c.id AND a.id <> NEW.id
             AND a.status_id = priv.status_id('Одобрена')
            WHERE c.id = NEW.company_id GROUP BY c.funding_limit) THEN
        RAISE EXCEPTION 'сумма больше остатка лимита компании' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
""",
    "X3": """ALTER TABLE api.application ADD COLUMN internal_score numeric;
GRANT UPDATE (internal_score) ON api.application TO expert;
""",
}


def reference(env, change: str):
    if isinstance(env, E.CoreEnv):
        reference_b(env, change)
    else:
        env.psql(A1_REFERENCE[change])
