# Proposal

## Why

O protótipo local prova o fluxo, mas não possui autenticação, isolamento, banco compartilhado ou caminho reproduzível de implantação. A fundação precisa entregar uma primeira fatia vertical segura — catálogo inicial e pedido de Loja — antes de expandir os módulos do Comprador e Gestor.

## What Changes

- Criar aplicação web/PWA responsiva com identidade, sessões e autorização por papel/vínculo de loja.
- Criar persistência transacional versionada e importar, de modo idempotente, os 74 produtos e 21 exclusivos.
- Entregar pedido diário de Loja com rascunho, cards mobile, busca/filtros, envio e histórico.
- Criar qualidade automatizada, imagem OCI, stack Swarm, healthchecks, logs, backup/restore e pipeline GHCR/Portainer.
- Preservar o protótipo e as referências visuais apenas como baseline funcional; não migrar `localStorage`.

## Capabilities

### New Capabilities

- `identity/access-control`: autenticação, sessões, RBAC e isolamento por loja.
- `catalog/product-catalog`: catálogo governado e importação inicial validada.
- `ordering/store-orders`: rascunho, envio versionado, histórico e UX móvel de pedidos.
- `platform/delivery`: build, imagem, deploy, healthcheck, backup e rollback verificáveis.

### Modified Capabilities

Nenhuma; o projeto ainda não possui specs consolidadas.

## Impact

Cria a base de código, schema/migrações, testes e infraestrutura do novo produto. Adiciona serviços web e PostgreSQL dedicado à rede overlay `externa`, uma imagem privada no GHCR e uma stack GitOps no Portainer. Não altera as stacks existentes nem seus dados.
