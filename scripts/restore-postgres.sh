#!/bin/sh
set -eu

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL isolada obrigatória}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE obrigatório}"
: "${BACKUP_FILE:?BACKUP_FILE obrigatório}"

if [ "${RESTORE_DATABASE_URL#*app_compras_restore}" = "$RESTORE_DATABASE_URL" ]; then
  printf '%s\n' "RESTORE_DATABASE_URL deve apontar para um database isolado app_compras_restore*" >&2
  exit 1
fi

if [ -f "${BACKUP_FILE}.sha256" ]; then
  printf '%s\n' "Validando checksum SHA-256 antes da restauração..."
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "${BACKUP_FILE}.sha256")")
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$tmp/restore.dump" "$BACKUP_FILE"
if command -v pg_restore >/dev/null 2>&1 && pg_restore --version | grep -q " 18\."; then
  pg_restore --clean --if-exists --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" "$tmp/restore.dump"
elif command -v docker >/dev/null 2>&1 && docker image inspect postgres:18.6 >/dev/null 2>&1; then
  docker run --rm -i --network=host postgres:18.6 pg_restore --clean --if-exists --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" < "$tmp/restore.dump"
else
  pg_restore --clean --if-exists --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" "$tmp/restore.dump"
fi
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS stores FROM stores; SELECT count(*) AS products FROM products; SELECT count(*) AS exclusive_supplier_products FROM products WHERE exclusive_supplier = true;"
