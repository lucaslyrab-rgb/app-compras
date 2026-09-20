#!/bin/sh
set -eu

status="${1:?status obrigatório}"
subject="${2:?assunto obrigatório}"
body="${3:?corpo obrigatório}"
: "${SES_FROM_EMAIL:?SES_FROM_EMAIL obrigatória}"
: "${SES_TO_EMAIL:?SES_TO_EMAIL obrigatória}"
AWS_REGION="${AWS_REGION:-us-east-1}"

payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT INT TERM
jq -n \
  --arg from "$SES_FROM_EMAIL" \
  --arg to "$SES_TO_EMAIL" \
  --arg subject "$subject" \
  --arg body "$body" \
  '{Source:$from,Destination:{ToAddresses:[$to]},Message:{Subject:{Data:$subject,Charset:"UTF-8"},Body:{Text:{Data:$body,Charset:"UTF-8"}}}}' \
  > "$payload"

aws ses send-email --region "$AWS_REGION" --cli-input-json "file://$payload" >/dev/null
printf '%s\n' "Notificação SES enviada: $status"
