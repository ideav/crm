-- Эталон T1 среды A′ (python2node#1060): приложение «Договоры» в той же базе app.
-- Нужен, чтобы проверить пробы T1 и как старт T2 (вместе с договорами из integ/seed.py).

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

CREATE FUNCTION priv.app_company(integer) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = api AS
$$ SELECT company_id FROM api.application WHERE id = $1 $$;

-- Юрист: договоры — чтение и правка, заявки и компании — чтение
GRANT USAGE ON SCHEMA api, priv TO lawyer;
GRANT SELECT ON api.application, api.company, api.status TO lawyer;
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

-- Отчёт «Остаток лимита»: компания и лимит читаются из api.company при каждом запросе
CREATE VIEW api.limit_balance AS
SELECT c.name AS company, c.funding_limit,
       coalesce(ap.approved, 0) AS approved, coalesce(k.contracted, 0) AS contracted,
       c.funding_limit - coalesce(k.contracted, 0) AS remaining
FROM api.company c
LEFT JOIN (SELECT company_id, sum(amount) AS approved FROM api.application
           WHERE status_id = priv.status_id('Одобрена') GROUP BY company_id) ap ON ap.company_id = c.id
LEFT JOIN (SELECT a.company_id, sum(k.amount) AS contracted FROM api.contract k
           JOIN api.application a ON a.id = k.application_id GROUP BY a.company_id) k ON k.company_id = c.id;
GRANT SELECT ON api.limit_balance TO fund_admin, lawyer;
