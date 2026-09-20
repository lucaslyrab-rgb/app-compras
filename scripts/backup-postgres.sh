#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL obrigatória}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT obrigatório}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET obrigatório, exemplo s3://bucket/prefix}"

AWS_REGION="${AWS_REGION:-us-east-1}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="app-compras-${timestamp}.dump.age"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" | age --recipient "$AGE_RECIPIENT" --output "$tmp/$archive"

# Upload cifrado e verificável; o checksum é calculado sobre o artefato já
# cifrado, nunca sobre o dump em claro.
sha256sum "$tmp/$archive" > "$tmp/$archive.sha256"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$tmp/$archive" "$BACKUP_BUCKET/$archive"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$tmp/$archive.sha256" "$BACKUP_BUCKET/$archive.sha256"
printf '%s\n' "Backup cifrado enviado: $BACKUP_BUCKET/$archive"
