# Backup e restauração

O backup deve sair do volume e do host. A implementação usa `pg_dump` custom, criptografia `age` e destino S3 compatível.

## Backup

- Variáveis: `DATABASE_URL`, `AGE_RECIPIENT`, `BACKUP_BUCKET` e opcionalmente `AWS_REGION` (padrão `us-east-1`).
- Comando: `scripts/backup-postgres.sh`.
- Pré-requisitos do executor: `pg_dump`, `age`, `aws` (AWS CLI), `jq` e acesso de rede ao PostgreSQL. No host atual esses binários não estão instalados; use um executor/container operacional versionado ou instale-os por procedimento de mudança aprovado, sem colocar credenciais na imagem.
- Configuração recebida para este projeto: `BACKUP_BUCKET=s3://compras-bkp` e `AWS_REGION=us-east-1`.
- O script envia o dump já cifrado com `age` e um arquivo `.sha256` separado; credenciais AWS devem vir do ambiente/secret do job, nunca de arquivo versionado.
- Se `SES_FROM_EMAIL` e `SES_TO_EMAIL` estiverem configuradas, o script envia uma notificação SES de `SUCESSO` ou `FALHA` para cada execução. Falha no SES é registrada como aviso e não apaga o resultado do backup.
- Antes do primeiro backup oficial, gere/registre a identidade `age` em cofre separado, defina o `AGE_RECIPIENT` correspondente e valide a política IAM mínima (`s3:PutObject`, `s3:GetObject`, `s3:ListBucket` e `ses:SendEmail` quando notificações forem usadas).
- Retenção inicial: 7 diários, 4 semanais e 6 mensais; a política no bucket deve ser configurada e auditada.
- Não guarde chave privada `age` no host produtor junto do backup.

## Ensaio de restauração

1. Baixe um backup para ambiente isolado.
2. Crie database vazio que não seja produção.
3. Defina `RESTORE_DATABASE_URL`, `AGE_IDENTITY_FILE` e `BACKUP_FILE`.
4. Execute `scripts/restore-postgres.sh`.
5. Confira migrations, 3 lojas, 74 produtos, 21 exclusivos e login de teste. O script também imprime a contagem de produtos exclusivos.
6. Registre data, backup, duração, resultado e responsável.

Nunca aponte `RESTORE_DATABASE_URL` para produção. O script exige um nome contendo `app_compras_restore` e usa `--clean --if-exists`, sendo destrutivo no database alvo.

### Evidência local (2026-09-20)

Foi executado um ensaio isolado com `pg_dump --format=custom`, criptografia `age` e restauração em `app_compras_restore_test`. As contagens restauradas foram `3` lojas, `74` produtos e `21` exclusivos; o database temporário foi removido ao final. O ensaio efetivo S3/off-host e o rollback operacional da stack continuam pendentes até o executor versionado, a identidade `age`, as credenciais rotacionadas e a janela de mudança estarem definidos.
