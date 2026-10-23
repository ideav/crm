-- A″ (python2node#1060), S2 «Реестр контрагентов»: отдельная система другого поставщика.
-- Ключ компании — ИНН. registry_admin — админ реестра (JWT PostgREST), crm_reader — логин только на
-- чтение для соседних систем (по сети из S1). Роли кластера создаёт integ/a2/stand.sh.

CREATE SCHEMA api;

CREATE TABLE api.counterparty (
    inn           text PRIMARY KEY,
    legal_name    text NOT NULL,
    funding_limit numeric NOT NULL
);

GRANT USAGE ON SCHEMA api TO registry_admin, crm_reader;
GRANT ALL ON api.counterparty TO registry_admin;
GRANT SELECT ON api.counterparty TO crm_reader;
