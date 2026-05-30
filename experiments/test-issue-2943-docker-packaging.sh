#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_file() {
    local path="$1"
    if [[ ! -f "$root/$path" ]]; then
        echo "FAIL: missing $path" >&2
        exit 1
    fi
}

require_text() {
    local path="$1"
    local pattern="$2"
    if ! grep -Eq "$pattern" "$root/$path"; then
        echo "FAIL: $path does not match $pattern" >&2
        exit 1
    fi
}

require_file "Dockerfile"
require_file "compose.yaml"
require_file ".env.docker.example"
require_file "docker/entrypoint.sh"
require_file "docker/mysql/010-integram-bootstrap.sql"
require_file "scripts/install-local-docker.sh"
require_file "docs/LOCAL_DOCKER_INSTALL.md"

require_text "Dockerfile" "docker-php-ext-install .*mysqli"
require_text "Dockerfile" "a2enmod .*rewrite .*ssl"
require_text "compose.yaml" "mariadb:"
require_text "compose.yaml" "INTEGRAM_HTTPS_PORT:-8443.*:443"
require_text ".env.docker.example" "INTEGRAM_MASTER_PASSWORD="
require_text ".gitignore" "^/\\.env\\.local$"
require_text "include/connection.php" "INTEGRAM_DB_HOST"
require_text "include/connection.php" "INTEGRAM_MASTER_PASSWORD"
require_text "docker/mysql/010-integram-bootstrap.sql" "CREATE TABLE IF NOT EXISTS my"
require_text "docker/mysql/010-integram-bootstrap.sql" "CREATE TABLE IF NOT EXISTS ru"
require_text "docker/mysql/010-integram-bootstrap.sql" "CREATE TABLE IF NOT EXISTS en"
require_text "scripts/install-local-docker.sh" "read -rs .*master"
require_text "scripts/install-local-docker.sh" "openssl req -x509"
require_text "docs/LOCAL_DOCKER_INSTALL.md" "master"
require_text "docs/LOCAL_DOCKER_INSTALL.md" "https://localhost:8443"
require_text "docs/LOCAL_DOCKER_INSTALL.md" "certificate"

echo "issue-2943 docker packaging checks: ok"
