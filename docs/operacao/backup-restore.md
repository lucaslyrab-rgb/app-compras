# Backup e restauração

O backup deve sair do volume e do host. A implementação usa `pg_dump` custom, criptografia `age` e destino S3 compatível.

## Backup

- Variáveis: `DATABASE_URL`, `AGE_RECIPIENT`, `BACKUP_BUCKET` e opcionalmente `AWS_REGION` (padrão `us-east-1`).
- Comando: `scripts/backup-postgres.sh`.
- Pré-requisitos do executor: `pg_dump`, `age`, `aws` (AWS CLI), `jq` e acesso ao PostgreSQL. No host estão instalados AWS CLI `2.36.49`, age `1.1.1` e clientes PostgreSQL `16.15`; como o host não alcança diretamente a rede overlay, o dump foi executado dentro do container PostgreSQL e cifrado/enviado pelo host.
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

### Evidência validada (2026-09-20)

Foi executado o primeiro backup oficial cifrado no S3:

- artefato: `s3://compras-bkp/app-compras-20260920T205933Z.dump.age`;
- checksum: arquivo `.sha256` enviado e validado após download;
- criptografia: AGE com identidade privada em `/var/lib/app-compras/backup/age-identity.txt`, modo `600`;
- notificação: SES enviada com status `SUCESSO`;
- restauração: banco isolado `app_compras_restore_test`, removido ao final;
- contagens restauradas: `3` lojas, `74` produtos e `21` exclusivos.

O backup foi produzido com `pg_dump --format=custom --no-owner --no-acl` dentro do container PostgreSQL, pois o host não possui rota direta para o endereço overlay do serviço. Nenhum dump em claro foi mantido após a execução.
