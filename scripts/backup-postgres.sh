#!/bin/bash
# ==============================================================================
# backup-postgres.sh
# Rotina de Backup PostgreSQL resiliente para app-compras
#
# Pipeline:
#   PostgreSQL -> pg_dump -> Criptografia AGE -> SHA-256 -> Cópia Local Persistente -> Upload S3
#
# Regra de Ouro da Resiliência:
#   O backup local é validado e persistido no disco ANTES da tentativa de upload S3.
#   Se o upload S3 falhar, o backup local daquela execução permanece intacto.
# ==============================================================================

set -Eeuo pipefail

# ------------------------------------------------------------------------------
# Configurações e Variáveis
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVES_DIR="${ARCHIVES_DIR:-/var/lib/app-compras/backup/archives}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-/var/lib/app-compras/backup/age-identity.txt}"
S3_BUCKET="${S3_BUCKET:-compras-bkp}"
AWS_REGION="${AWS_REGION:-us-east-1}"
S3_PREFIX="${S3_PREFIX:-}"
SKIP_S3="${SKIP_S3:-0}"
LOCK_FILE="/var/lock/app-compras-backup.lock"

START_TIME=$(date +%s)

log() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(date -u +'%Y-%m-%d %H:%M:%SZ')" "$level" "$*"
}

log_error() {
  log "ERROR" "$*" >&2
}

# ------------------------------------------------------------------------------
# Concorrência: Prevenção de execuções simultâneas via flock
# ------------------------------------------------------------------------------
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log_error "Outro processo de backup já está em execução (lock ativo em $LOCK_FILE). Abortando."
  exit 1
fi

# ------------------------------------------------------------------------------
# Limpeza de Staging e Trap de Erro
# ------------------------------------------------------------------------------
STAGING_DIR="$(mktemp -d /tmp/app-compras-backup-staging.XXXXXX)"
UPLOADER_SERVICE=""

# shellcheck disable=SC2317
cleanup() {
  local exit_code=$?
  # Garante destruição imediata de qualquer dump em texto plano
  rm -f "$STAGING_DIR"/*.plain.tmp
  rm -rf "$STAGING_DIR"

  # Remove serviço temporário Swarm caso tenha restado ativo
  if [ -n "$UPLOADER_SERVICE" ]; then
    docker service rm "$UPLOADER_SERVICE" >/dev/null 2>&1 || true
  fi

  flock -u 200 >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

umask 077
mkdir -p "$ARCHIVES_DIR"

# ------------------------------------------------------------------------------
# Validação de Pré-requisitos
# ------------------------------------------------------------------------------
if ! command -v age >/dev/null 2>&1; then
  log_error "Utilitário 'age' não encontrado no PATH."
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  log_error "Utilitário 'sha256sum' não encontrado no PATH."
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  log_error "Utilitário 'docker' não encontrado no PATH."
  exit 1
fi

# ------------------------------------------------------------------------------
# Identidade AGE e Recipiente
# ------------------------------------------------------------------------------
if [ -z "${AGE_RECIPIENT:-}" ]; then
  if [ ! -f "$AGE_IDENTITY_FILE" ]; then
    log_error "Arquivo de identidade AGE não encontrado: $AGE_IDENTITY_FILE"
    exit 1
  fi
  AGE_RECIPIENT=$(age-keygen -y "$AGE_IDENTITY_FILE" 2>/dev/null || true)
  if [ -z "$AGE_RECIPIENT" ] || [[ "$AGE_RECIPIENT" != age1* ]]; then
    log_error "Não foi possível derivar uma chave pública válida de $AGE_IDENTITY_FILE"
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# Nomenclatura dos Artefatos
# ------------------------------------------------------------------------------
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE_NAME="app-compras-${TIMESTAMP}.dump.age"
PLAIN_TMP="$STAGING_DIR/${ARCHIVE_NAME}.plain.tmp"
AGE_TMP="$STAGING_DIR/${ARCHIVE_NAME}.age.tmp"
SHA_TMP="$STAGING_DIR/${ARCHIVE_NAME}.sha256.tmp"

log "INFO" "Iniciando rotina de backup PostgreSQL..."
log "INFO" "Artefato alvo: $ARCHIVE_NAME"

# ------------------------------------------------------------------------------
# Etapa 1: pg_dump sem expor a porta 5432
# ------------------------------------------------------------------------------
PG_CONTAINER=$(docker ps -q --filter "name=postgres_postgres.1" | head -n 1)

if [ -n "$PG_CONTAINER" ]; then
  log "INFO" "Extraindo pg_dump diretamente do container PostgreSQL Swarm ($PG_CONTAINER)..."
  if ! docker exec -i "$PG_CONTAINER" pg_dump -U app_compras -d app_compras --format=custom --no-owner --no-acl > "$PLAIN_TMP"; then
    log_error "Falha na execução do pg_dump via container PostgreSQL."
    exit 1
  fi
elif [ -n "${DATABASE_URL:-}" ]; then
  log "INFO" "Executando pg_dump via DATABASE_URL fornecida no ambiente..."
  if ! pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$PLAIN_TMP"; then
    log_error "Falha na execução do pg_dump via DATABASE_URL."
    exit 1
  fi
else
  log_error "Nenhum container postgres_postgres.1 ativo encontrado e DATABASE_URL não configurada."
  exit 1
fi

if [ ! -s "$PLAIN_TMP" ]; then
  log_error "Dump gerado está vazio (0 bytes). Abortando."
  exit 1
fi

PLAIN_SIZE=$(stat -c %s "$PLAIN_TMP")
log "INFO" "pg_dump concluído com sucesso. Tamanho descompactado: $PLAIN_SIZE bytes."

# ------------------------------------------------------------------------------
# Etapa 2: Criptografia com AGE e destruição do dump em claro
# ------------------------------------------------------------------------------
log "INFO" "Criptografando dump com AGE..."
if ! age --recipient "$AGE_RECIPIENT" --output "$AGE_TMP" "$PLAIN_TMP"; then
  log_error "Falha na criptografia com AGE."
  exit 1
fi

# Eliminação imediata do dump em texto plano
rm -f "$PLAIN_TMP"
log "INFO" "Dump em claro destruído com sucesso. Artefato cifrado gerado."

if [ ! -s "$AGE_TMP" ]; then
  log_error "Artefato cifrado resultante está vazio. Abortando."
  exit 1
fi

# ------------------------------------------------------------------------------
# Etapa 3: Cálculo e validação local do SHA-256
# ------------------------------------------------------------------------------
HASH=$(sha256sum "$AGE_TMP" | awk '{print $1}')
printf '%s  %s\n' "$HASH" "$ARCHIVE_NAME" > "$SHA_TMP"

# Valida localmente o checksum antes de prosseguir
if ! (cd "$STAGING_DIR" && sha256sum -c <(printf '%s  %s\n' "$HASH" "$(basename "$AGE_TMP")") >/dev/null 2>&1); then
  log_error "Validação de integridade SHA-256 local falhou."
  exit 1
fi
log "INFO" "Integridade local SHA-256 verificada: $HASH"

# ------------------------------------------------------------------------------
# Etapa 4: Cópia Local Persistente Atômica
# ------------------------------------------------------------------------------
LOCAL_ARCHIVE_PATH="$ARCHIVES_DIR/$ARCHIVE_NAME"
LOCAL_SHA_PATH="$ARCHIVES_DIR/$ARCHIVE_NAME.sha256"

mv "$AGE_TMP" "$LOCAL_ARCHIVE_PATH"
mv "$SHA_TMP" "$LOCAL_SHA_PATH"
chmod 600 "$LOCAL_ARCHIVE_PATH" "$LOCAL_SHA_PATH"

ARCHIVE_SIZE=$(stat -c %s "$LOCAL_ARCHIVE_PATH")
log "INFO" "BACKUP LOCAL PRESERVADO COM SUCESSO: $LOCAL_ARCHIVE_PATH ($ARCHIVE_SIZE bytes)"

# ------------------------------------------------------------------------------
# Etapa 5: Upload S3 via Tarefa Efêmera Swarm (Consome Swarm Secrets de Backup)
# ------------------------------------------------------------------------------
S3_STATUS="IGNORADO"

if [ "$SKIP_S3" = "1" ]; then
  log "INFO" "Upload S3 ignorado por configuração (SKIP_S3=1)."
  S3_STATUS="IGNORADO"
else
  log "INFO" "Iniciando upload S3 para bucket '$S3_BUCKET' na região '$AWS_REGION'..."
  UPLOADER_SCRIPT="$SCRIPT_DIR/s3-backup-uploader.mjs"

  if [ ! -f "$UPLOADER_SCRIPT" ]; then
    log_error "Script de upload $UPLOADER_SCRIPT não encontrado."
    log_error "O backup local permanece íntegro em: $LOCAL_ARCHIVE_PATH"
    exit 2
  fi

  UPLOADER_SERVICE="app-compras-s3-upload-$(date +%s)-$RANDOM"

  # Criação do serviço efêmero em modo detached (-d)
  if ! docker service create -d \
    --name "$UPLOADER_SERVICE" \
    --secret app_compras_s3_backup_access_key_id \
    --secret app_compras_s3_backup_secret_access_key \
    --mount type=bind,src="$ARCHIVES_DIR",dst=/archives,ro=true \
    --mount type=bind,src="$UPLOADER_SCRIPT",dst=/uploader.mjs,ro=true \
    --env S3_BUCKET="$S3_BUCKET" \
    --env S3_REGION="$AWS_REGION" \
    --env S3_PREFIX="$S3_PREFIX" \
    --restart-condition none \
    node:24.21.0-bookworm-slim \
    node /uploader.mjs "$ARCHIVE_NAME" >/dev/null 2>&1; then
    log_error "Não foi possível criar o serviço efêmero de upload S3 no Docker Swarm."
    log_error "O backup local permanece íntegro em: $LOCAL_ARCHIVE_PATH"
    exit 2
  fi

  # Monitora a conclusão da tarefa efêmera (timeout: 120 segundos)
  UPLOAD_OK=0
  for _ in $(seq 1 60); do
    CURRENT_STATE=$(docker service ps "$UPLOADER_SERVICE" --format '{{.CurrentState}}' 2>/dev/null | head -n 1 || true)
    if echo "$CURRENT_STATE" | grep -q "Complete"; then
      UPLOAD_OK=1
      break
    elif echo "$CURRENT_STATE" | grep -qE "Failed|Rejected"; then
      UPLOAD_OK=0
      break
    fi
    sleep 2
  done

  UPLOADER_LOGS=$(docker service logs "$UPLOADER_SERVICE" 2>&1 || true)
  docker service rm "$UPLOADER_SERVICE" >/dev/null 2>&1 || true
  UPLOADER_SERVICE=""

  if [ "$UPLOAD_OK" -eq 1 ]; then
    log "INFO" "Upload e conferência remota S3 concluídos com SUCESSO."
    S3_STATUS="SUCESSO"
  else
    log_error "Upload S3 FALHOU ou excedeu o timeout."
    if [ -n "$UPLOADER_LOGS" ]; then
      log_error "Log do uploader: $UPLOADER_LOGS"
    fi
    log "WARN" "RESILIÊNCIA: O backup local foi preservado em $LOCAL_ARCHIVE_PATH."
    S3_STATUS="FALHA"
  fi
fi

# ------------------------------------------------------------------------------
# Resumo Final e Observabilidade
# ------------------------------------------------------------------------------
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

log "INFO" "==================== RESUMO DO BACKUP ===================="
log "INFO" "Artefato:       $ARCHIVE_NAME"
log "INFO" "Tamanho:        $ARCHIVE_SIZE bytes"
log "INFO" "SHA-256:        $HASH"
log "INFO" "Local:          $LOCAL_ARCHIVE_PATH (PRESERVADO)"
log "INFO" "S3 Remoto:      $S3_STATUS (s3://$S3_BUCKET/$S3_PREFIX$ARCHIVE_NAME)"
log "INFO" "Duração total:  $DURATION segundos"
log "INFO" "=========================================================="

if [ "$S3_STATUS" = "FALHA" ]; then
  # Retorna código 2 para sinalizar erro no S3, embora o backup local tenha sido bem-sucedido
  exit 2
fi

exit 0
