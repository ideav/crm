-- Эталонная защита S1 среды A″ (python2node#1060): effort/a1/reference.sql #1055, где компания заявки —
-- ИНН из реестра контрагентов (S2). Лимит компании для R9 читается из S2 через postgres_fdw
-- логином crm_reader (только чтение): внешняя таблица reg.counterparty.
-- {READER_PASSWORD} подставляет драйвер среды (integ/envs_integ.py) из /root/crm1055c/.env.

-- Реестр контрагентов (S2) по сети
CREATE EXTENSION postgres_fdw;
CREATE SERVER registry FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'crm1055c-db', port '5432', dbname 'registry');
CREATE USER MAPPING FOR PUBLIC SERVER registry OPTIONS (user 'crm_reader', password '{READER_PASSWORD}');
CREATE SCHEMA reg;
IMPORT FOREIGN SCHEMA api LIMIT TO (counterparty) FROM SERVER registry INTO reg;

-- Вспомогательные функции — в схеме priv: PostgREST публикует только api.
CREATE SCHEMA priv;
GRANT USAGE ON SCHEMA priv TO fund_admin, expert, applicant;

CREATE FUNCTION priv.login() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT current_setting('request.jwt.claims', true)::json ->> 'login' $$;

CREATE FUNCTION priv.my_company() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = api AS
$$ SELECT company_inn FROM api.app_user WHERE login = priv.login() $$;

CREATE FUNCTION priv.status_ord(integer) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = api AS
$$ SELECT ord FROM api.status WHERE id = $1 $$;

CREATE FUNCTION priv.status_id(text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = api AS
$$ SELECT id FROM api.status WHERE name = $1 $$;

-- R1–R5: права на таблицы и колонки
GRANT SELECT ON api.status TO expert, applicant;
GRANT SELECT (login, fio) ON api.app_user TO expert;
GRANT SELECT ON api.application TO expert;
GRANT UPDATE (status_id, verdict) ON api.application TO expert;                       -- R4: сумма эксперту — чтение
GRANT SELECT (id, number, company_inn, status_id, amount, revenue, description, verdict)
    ON api.application TO applicant;                                                   -- R3: «Эксперт» не виден
GRANT INSERT (number, company_inn, status_id, amount, revenue, description) ON api.application TO applicant;
GRANT UPDATE (number, company_inn, status_id, amount, revenue, description) ON api.application TO applicant;  -- R4
GRANT DELETE ON api.application TO applicant;
GRANT USAGE ON SEQUENCE api.application_id_seq TO applicant;

-- R1, R2, R5: строки
ALTER TABLE api.application ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON api.application FOR ALL TO fund_admin USING (true) WITH CHECK (true);
CREATE POLICY expert_read ON api.application FOR SELECT TO expert USING (true);
CREATE POLICY expert_update ON api.application FOR UPDATE TO expert USING (true) WITH CHECK (true);
CREATE POLICY applicant_read ON api.application FOR SELECT TO applicant
    USING (company_inn = priv.my_company());
CREATE POLICY applicant_insert ON api.application FOR INSERT TO applicant
    WITH CHECK (company_inn = priv.my_company() AND priv.status_ord(status_id) < priv.status_ord(priv.status_id('На экспертизе')));
CREATE POLICY applicant_update ON api.application FOR UPDATE TO applicant
    USING (company_inn = priv.my_company() AND priv.status_ord(status_id) < priv.status_ord(priv.status_id('На экспертизе')))
    WITH CHECK (company_inn = priv.my_company() AND priv.status_ord(status_id) < priv.status_ord(priv.status_id('На экспертизе')));
CREATE POLICY applicant_delete ON api.application FOR DELETE TO applicant
    USING (company_inn = priv.my_company() AND status_id = priv.status_id('Черновик'));

-- R6, R7: сумма обязательна; тип numeric сам отклоняет нечисловое
ALTER TABLE api.application ALTER COLUMN amount SET NOT NULL;

-- R8–R10: правила процесса; лимит компании (R9) — из реестра контрагентов
CREATE FUNCTION priv.check_process() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = api AS $$
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
    IF new_name = 'Одобрена' AND NEW.amount > (SELECT funding_limit FROM reg.counterparty WHERE inn = NEW.company_inn) THEN
        RAISE EXCEPTION 'сумма больше лимита компании' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER check_process BEFORE INSERT OR UPDATE ON api.application
    FOR EACH ROW EXECUTE FUNCTION priv.check_process();

-- R12: журнал. Канал — заголовок X-Client: ai, который ставит MCP-обёртка агента.
CREATE TABLE api.audit (
    id     bigserial PRIMARY KEY,
    ts     timestamptz NOT NULL DEFAULT now(),
    actor  text,
    via    text NOT NULL,
    op     text NOT NULL,
    app_id integer,
    data   jsonb
);
GRANT SELECT ON api.audit TO fund_admin;

CREATE FUNCTION priv.audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = api AS $$
DECLARE
    via text := CASE WHEN current_setting('request.headers', true)::json ->> 'x-client' = 'ai' THEN 'ai' ELSE 'human' END;
    rec api.application := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
    INSERT INTO api.audit (actor, via, op, app_id, data)
    VALUES (coalesce(priv.login(), session_user), via, lower(TG_OP), rec.id, to_jsonb(rec));
    RETURN NULL;
END $$;
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON api.application
    FOR EACH ROW EXECUTE FUNCTION priv.audit();
