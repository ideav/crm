-- Эталон T1 среды A″ (python2node#1060): «Договоры» в S1, компании — из реестра контрагентов (S2)
-- через postgres_fdw (внешняя таблица reg.counterparty, логин crm_reader). Данные компаний не копируются.

CREATE TABLE api.contract (
    id             serial PRIMARY KEY,
    number         text NOT NULL UNIQUE,
    application_id integer NOT NULL REFERENCES api.application,
    amount         numeric NOT NULL CHECK (amount > 0),
    signed_on      date,
    status         text NOT NULL DEFAULT 'Проект' CHECK (status IN ('Проект', 'Подписан'))
);

-- договор — только по одобренной заявке
CREATE FUNCTION priv.check_contract() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = api AS $$
BEGIN
    IF (SELECT status_id FROM api.application WHERE id = NEW.application_id) IS DISTINCT FROM priv.status_id('Одобрена') THEN
        RAISE EXCEPTION 'договор оформляется только по одобренной заявке' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER check_contract BEFORE INSERT OR UPDATE ON api.contract
    FOR EACH ROW EXECUTE FUNCTION priv.check_contract();

CREATE FUNCTION priv.app_company(integer) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = api AS
$$ SELECT company_inn FROM api.application WHERE id = $1 $$;

-- Компании для чтения в API S1 — представление над реестром
CREATE VIEW api.company AS SELECT inn, legal_name AS name, funding_limit FROM reg.counterparty;
GRANT SELECT ON api.company TO fund_admin, expert, applicant, lawyer;

-- Юрист: договоры — чтение и правка, заявки и компании — чтение
GRANT USAGE ON SCHEMA api, priv TO lawyer;
GRANT SELECT ON api.application, api.status TO lawyer;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.contract TO lawyer, fund_admin;
GRANT USAGE ON SEQUENCE api.contract_id_seq TO lawyer, fund_admin;
CREATE POLICY lawyer_read ON api.application FOR SELECT TO lawyer USING (true);
UPDATE api.app_user SET role = 'lawyer' WHERE login = 'lawyer1';

-- Заявитель: договоры своей компании, только чтение
GRANT SELECT ON api.contract TO applicant;
ALTER TABLE api.contract ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON api.contract FOR ALL TO fund_admin USING (true) WITH CHECK (true);
CREATE POLICY lawyer_all ON api.contract FOR ALL TO lawyer USING (true) WITH CHECK (true);
CREATE POLICY applicant_read ON api.contract FOR SELECT TO applicant
    USING (priv.app_company(application_id) = priv.my_company());

-- Отчёт «Остаток лимита»: название и лимит — из реестра при каждом запросе
CREATE VIEW api.limit_balance AS
SELECT r.legal_name AS company, r.funding_limit,
       coalesce(ap.approved, 0) AS approved, coalesce(k.contracted, 0) AS contracted,
       r.funding_limit - coalesce(k.contracted, 0) AS remaining
FROM reg.counterparty r
LEFT JOIN (SELECT company_inn, sum(amount) AS approved FROM api.application
           WHERE status_id = priv.status_id('Одобрена') GROUP BY company_inn) ap ON ap.company_inn = r.inn
LEFT JOIN (SELECT a.company_inn, sum(k.amount) AS contracted FROM api.contract k
           JOIN api.application a ON a.id = k.application_id GROUP BY a.company_inn) k ON k.company_inn = r.inn;
GRANT SELECT ON api.limit_balance TO fund_admin, lawyer;
