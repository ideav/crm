-- S1 среды A″ (a3) замера python2node#1060: в S1 нет средств связи с внешними системами.
-- Расширения внешних баз и HTTP (postgres_fdw, dblink, file_fdw, http), недоверенные языки (plpython3u и др.),
-- внешние серверы и таблицы создать нельзя. Сама S2 из сети контейнера базы недоступна: сервис слушает
-- только loopback хоста (integ/a3/stand.sh). Схема stand — служебная, не публикуется.

CREATE SCHEMA stand;

CREATE FUNCTION stand.no_external() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
    IF tg_tag <> 'CREATE EXTENSION'
       OR current_query() ~* '(fdw|dblink|http|curl|plpython|plperlu|pltclu|plsh|pgsql_http)' THEN
        RAISE EXCEPTION 'S1 не связывается с внешними системами: % запрещено', tg_tag
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END $$;

CREATE EVENT TRIGGER no_external ON ddl_command_start
    WHEN TAG IN ('CREATE EXTENSION', 'CREATE SERVER', 'CREATE FOREIGN DATA WRAPPER', 'CREATE FOREIGN TABLE',
                 'CREATE USER MAPPING', 'CREATE LANGUAGE', 'IMPORT FOREIGN SCHEMA')
    EXECUTE FUNCTION stand.no_external();
