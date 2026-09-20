# Backup e restauração

O backup deve sair do volume e do host. A implementação usa `pg_dump` custom, criptografia `age` e destino S3 compatível.

## Backup

- Variáveis: `DATABASE_URL`, `AGE_RECIPIENT`, `BACKUP_BUCKET`.
- Comando: `scripts/backup-postgres.sh`.
- Retenção inicial: 7 diários, 4 semanais e 6 mensais; a política no bucket deve ser configurada e auditada.
- Não guarde chave privada `age` no host produtor junto do backup.

## Ensaio de restauração

1. Baixe um backup para ambiente isolado.
2. Crie database vazio que não seja produção.
3. Defina `RESTORE_DATABASE_URL`, `AGE_IDENTITY_FILE` e `BACKUP_FILE`.
4. Execute `scripts/restore-postgres.sh`.
5. Confira migrations, 3 lojas, 74 produtos, 21 exclusivos e login de teste.
6. Registre data, backup, duração, resultado e responsável.

Nunca aponte `RESTORE_DATABASE_URL` para produção. O script usa `--clean --if-exists` e é destrutivo no database alvo.
