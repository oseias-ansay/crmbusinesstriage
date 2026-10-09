#!/bin/sh
# Executado UMA vez, na criação do volume do banco.
# Cria o usuário do app SEM superusuário e SEM BYPASSRLS e passa a ele a posse
# do banco — assim o Row Level Security vale sempre para o CRM.
set -eu
psql -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" --username postgres --dbname triage_crm <<'SQL'
CREATE ROLE triage_crm LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'pw';
ALTER DATABASE triage_crm OWNER TO triage_crm;
ALTER SCHEMA public OWNER TO triage_crm;
REVOKE ALL ON DATABASE triage_crm FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE triage_crm TO triage_crm;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
SQL
