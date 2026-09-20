# Operação da stack

## Pré-requisitos

1. Criar database e role exclusivos no PostgreSQL 18.6 compartilhado. No host homologado, `app_compras` já foi criado.
2. Criar secret Swarm `app_compras_database_url` com a URL completa, sem registrá-la no shell history. O secret já existe neste Swarm.
3. Cadastrar GHCR no Portainer e configurar a stack Git conforme [runbook](../docs/operacao/deploy-ghcr-portainer.md).

## Validação local da stack

```sh
docker stack config -c infra/stack.yml
```

## Migração

Migrações não executam automaticamente em cada réplica. Antes de promover uma imagem, rode `npm run db:migrate` em job one-shot com a mesma credencial (os scripts aceitam `DATABASE_URL` ou `DATABASE_URL_FILE`), depois `npm run db:import-products` no primeiro deploy.

## Rollback

1. Identifique o último SHA saudável no histórico Git/Portainer.
2. Reverta o commit de promoção em `infra/stack.yml` e acione o webhook.
3. Confirme `/api/health`, login e pedido.
4. Não reverta schema destrutivamente; restaure backup somente segundo o runbook e com janela aprovada.
