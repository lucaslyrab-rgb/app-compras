#!/bin/bash
# ==============================================================================
# test-backup-resilience.sh
# Validação automatizada de caminhos de erro, concorrência e integridade do backup
# ==============================================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_SCRIPT="$REPO_DIR/scripts/backup-postgres.sh"

TEST_TMP="$(mktemp -d /tmp/app-compras-backup-test.XXXXXX)"
trap 'rm -rf "$TEST_TMP"' EXIT

TEST_ARCHIVES="$TEST_TMP/archives"
mkdir -p "$TEST_ARCHIVES"

# Gera chave AGE efêmera de teste
TEST_IDENTITY="$TEST_TMP/test-age-identity.txt"
age-keygen -o "$TEST_IDENTITY" 2>/dev/null
TEST_RECIPIENT=$(age-keygen -y "$TEST_IDENTITY")

echo "=== TESTE 1: ShellCheck nos scripts ==="
shellcheck "$BACKUP_SCRIPT"
shellcheck "$REPO_DIR/scripts/restore-postgres.sh"
echo "PASS: ShellCheck 0 avisos."

echo "=== TESTE 2: Concorrência (bloqueio via flock) ==="
# Simula outro processo segurando o lockfile
(
  exec 200>/var/lock/app-compras-backup.lock
  flock -x 200
  sleep 4
) &
LOCK_PID=$!
sleep 1

# Tenta executar o backup com o lock ocupado
set +e
CONCURRENCY_OUTPUT=$(
  ARCHIVES_DIR="$TEST_ARCHIVES" \
  AGE_IDENTITY_FILE="$TEST_IDENTITY" \
  AGE_RECIPIENT="$TEST_RECIPIENT" \
  SKIP_S3=1 \
  bash "$BACKUP_SCRIPT" 2>&1
)
CONCURRENCY_RC=$?
set -e

wait "$LOCK_PID" || true

if [ "$CONCURRENCY_RC" -ne 0 ] && echo "$CONCURRENCY_OUTPUT" | grep -q "Outro processo de backup já está em execução"; then
  echo "PASS: Concorrência bloqueada com sucesso (código de saída $CONCURRENCY_RC)."
else
  echo "FAIL: Concorrência não foi bloqueada adequadamente."
  echo "$CONCURRENCY_OUTPUT"
  exit 1
fi

echo "=== TESTE 3: Falha de criptografia não gera backup falso e elimina plain ==="
set +e
CRYPTO_OUTPUT=$(
  ARCHIVES_DIR="$TEST_ARCHIVES" \
  AGE_IDENTITY_FILE="$TEST_IDENTITY" \
  AGE_RECIPIENT="age1invalido999999999999999999999999999999999999999999999999999999" \
  SKIP_S3=1 \
  bash "$BACKUP_SCRIPT" 2>&1
)
CRYPTO_RC=$?
set -e

# Nenhum arquivo deve ter sido gravado em TEST_ARCHIVES
COUNT_ARCHIVES=$(find "$TEST_ARCHIVES" -type f | wc -l)
# Nenhum dump plain deve ter ficado em /tmp
COUNT_PLAINTEXT=$(find /tmp/app-compras-backup-staging.* -name "*.plain.tmp" 2>/dev/null | wc -l || true)

if [ "$CRYPTO_RC" -ne 0 ] && [ "$COUNT_ARCHIVES" -eq 0 ] && [ "$COUNT_PLAINTEXT" -eq 0 ]; then
  echo "PASS: Falha de criptografia abortou sem deixar artefatos espúrios e limpou dump em claro."
else
  echo "FAIL: Artefatos espúrios encontrados após falha de criptografia."
  exit 1
fi

echo "=== TESTE 4: S3 indisponível preserva backup local ==="
# Executa com S3 apontando para bucket inexistente ou simulando falha de uploader
set +e
S3_FAIL_OUTPUT=$(
  ARCHIVES_DIR="$TEST_ARCHIVES" \
  AGE_IDENTITY_FILE="$TEST_IDENTITY" \
  AGE_RECIPIENT="$TEST_RECIPIENT" \
  S3_BUCKET="bucket-inexistente-simulacao-falha-$(date +%s)" \
  SKIP_S3=0 \
  bash "$BACKUP_SCRIPT" 2>&1
)
S3_FAIL_RC=$?
set -e

# O script deve ter saído com código 2 (erro de S3)
# Mas o arquivo local .dump.age e .sha256 DEVEM existir e ser válidos!
LOCAL_AGE_FILES=( "$TEST_ARCHIVES"/*.dump.age )
LOCAL_SHA_FILES=( "$TEST_ARCHIVES"/*.dump.age.sha256 )

if [ "$S3_FAIL_RC" -eq 2 ] && [ -f "${LOCAL_AGE_FILES[0]}" ] && [ -f "${LOCAL_SHA_FILES[0]}" ]; then
  # Valida integridade do backup local que restou
  (cd "$TEST_ARCHIVES" && sha256sum -c "$(basename "${LOCAL_SHA_FILES[0]}")" >/dev/null 2>&1)
  echo "PASS: S3 indisponível retornou código 2 e preservou integralmente o backup local com SHA-256 válido."
else
  echo "FAIL: Backup local não foi preservado ou código de saída incorreto ($S3_FAIL_RC)."
  echo "$S3_FAIL_OUTPUT"
  exit 1
fi

echo "=== TESTE 5: Verificação de Ausência de Vazamento de Segredos ==="
# Verifica se os logs emitidos contêm padrões de segredos AWS ou senhas
ALL_LOGS="$CONCURRENCY_OUTPUT $CRYPTO_OUTPUT $S3_FAIL_OUTPUT"
if echo "$ALL_LOGS" | grep -E -q "AKIA[0-9A-Z]{16}|AGE-SECRET-KEY-1|postgres://|POSTGRES_PASSWORD"; then
  echo "FAIL: Padrão sensível detectado nos logs!"
  exit 1
else
  echo "PASS: Nenhum segredo ou credencial vazada nos logs de execução."
fi

echo ""
echo "TODOS OS 5 TESTES DE RESILIÊNCIA PASSARAM COM SUCESSO!"
