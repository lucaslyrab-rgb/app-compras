# Estado atual

- **Objetivo:** substituir WhatsApp/planilhas por uma PWA multiusuário para o fluxo FLV das três lojas.
- **Mudança ativa:** `openspec/changes/fundacao-plataforma/` (fundação técnica e primeiro fluxo vertical).
- **Revisão:** repositório inicial; branch `main`; materiais originais preservados na raiz.
- **Decisões válidas:** [TRD](trd.md), [ADRs](adrs/), [PRDs](prds/) e [roadmap](roadmap.md).
- **Última evidência (2026-09-19):** SSH autenticou como `lucaslyrab-rgb`; remoto `app-compras` respondeu vazio; Swarm single-node e serviços existentes auditados sem alteração.
- **Pendências:** validar premissas marcadas nos PRDs; criar credenciais no Portainer/GitHub; decidir janela de migração do PostgreSQL 14 compartilhado; implementar a fatia vertical.
- **Próxima ação autorizada:** implementar fundação, autenticação/RBAC, importação idempotente e pedido de loja, com testes.
