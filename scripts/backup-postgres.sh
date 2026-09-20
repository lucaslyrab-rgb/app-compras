#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL obrigatória}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT obrigatório}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET obrigatório, exemplo s3://bucket/prefix}"

AWS_REGION="${AWS_REGION:-us-east-1}"
script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="app-compras-${timestamp}.dump.age"
tmp="$(mktemp -d)"
umask 077

notify() {
  status="$1"
  if [ -n "${SES_FROM_EMAIL:-}" ] && [ -n "${SES_TO_EMAIL:-}" ]; then
    if ! "$script_dir/notify-ses.sh" \
      "$status" \
      "[app-compras] Backup $status" \
      "Backup PostgreSQL app-compras: $status\n\nArtefato: $archive\nDestino: $BACKUP_BUCKET\nRegião: $AWS_REGION"; then
      printf '%s\n' "Aviso: notificação SES não enviada" >&2
    fi
  fi
}

finish() {
  rc=$?
  if [ "$rc" -eq 0 ]; then notify "SUCESSO"; else notify "FALHA"; fi
  rm -rf "$tmp"
  exit "$rc"
}
trap finish EXIT INT TERM

plain_dump="$tmp/$archive.dump"
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$plain_dump"
age --recipient "$AGE_RECIPIENT" --output "$tmp/$archive" "$plain_dump"
rm -f "$plain_dump"

# Upload cifrado e verificável; o checksum é calculado sobre o artefato já
# cifrado, nunca sobre o dump em claro.
sha256sum "$tmp/$archive" > "$tmp/$archive.sha256"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$tmp/$archive" "$BACKUP_BUCKET/$archive"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$tmp/$archive.sha256" "$BACKUP_BUCKET/$archive.sha256"
printf '%s\n' "Backup cifrado enviado: $BACKUP_BUCKET/$archive"
