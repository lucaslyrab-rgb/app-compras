# Proposal

## Why

As lojas ainda dependem de WhatsApp e planilhas para informar estoque e necessidade de compra. A fundação já oferece identidade, catálogo e persistência; agora precisamos transformar o fluxo móvel da loja em um pedido rastreável, revisável e conferível.

## What Changes

- Entregar workspace móvel por cards, busca e filtros para lançamento de estoque e quantidade pedida.
- Persistir rascunhos por loja/data com controle de versão e recuperação após recarga.
- Permitir envio explícito, revisões históricas e consulta restrita à própria loja.
- Gerar conferência A4 somente com itens pedidos, incluindo campos manuais de recebimento.
- Cobrir isolamento por loja, valores não negativos, ausência de pedido e reenvio no mesmo dia.

## Capabilities

### New Capabilities

- `ordering/store-orders`: pedido móvel da loja, rascunho versionado, envio, histórico e conferência.

### Modified Capabilities

- Nenhuma; não há especificações principais existentes no repositório.

## Impact

- Rotas Next.js de pedido, histórico e conferência.
- Módulo de domínio/repositório de ordering, actions server-side e schema PostgreSQL.
- Testes unitários, integração e Playwright em viewport móvel.
- Nenhuma alteração de infraestrutura ou contrato externo; a entrega será publicada pelo pipeline GitOps existente após validação.
