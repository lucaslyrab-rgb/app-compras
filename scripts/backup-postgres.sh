#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL obrigatória}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT obrigatório}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET obrigatório, exemplo s3://bucket/prefix}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="app-compras-${timestamp}.dump.age"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" | age --recipient "$AGE_RECIPIENT" --output "$tmp/$archive"
aws s3 cp --only-show-errors "$tmp/$archive" "$BACKUP_BUCKET/$archive"
printf '%s\n' "Backup enviado: $archive"
