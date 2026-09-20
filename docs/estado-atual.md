# Estado atual

- **Objetivo:** substituir WhatsApp/planilhas por uma PWA multiusuário para o fluxo FLV das três lojas.
- **Mudança ativa:** `openspec/changes/fundacao-plataforma/` (fundação técnica e primeiro fluxo vertical).
- **Revisão:** branch `main`; commit inicial já sincronizado com `lucaslyrab-rgb/app-compras`; materiais originais preservados na raiz.
- **Decisões válidas:** [TRD](trd.md), [ADRs](adrs/), [PRDs](prds/) e [roadmap](roadmap.md).
- **Última evidência (2026-09-20):** `npm ci`, lint, typecheck, build, 17 testes unitários (cobertura de linhas 80,35%), 5 testes de integração em PostgreSQL 18.6 efêmero, importação repetida 74/21 e Playwright (7 testes verdes + 1 skip desktop, acessibilidade/zoom/login inválido/fluxo móvel) executados; imagem multi-stage não-root saudável e Trivy local sem HIGH/CRITICAL.
- **Implementado:** schema/migration, autenticação/RBAC, sessões revogáveis, catálogo/inativação, pedido móvel persistente/versionado, conferência A4, Docker, stack Swarm e workflows CI/release. O GitHub Actions publicou a imagem e promoveu `sha-408ce082dd7e47a169e57321387f3c3e03bf7d38` no manifesto; o webhook não foi chamado por secret ausente.
- **Pendências externas:** publicar a primeira imagem GHCR; criar database/role e secret Swarm `app_compras_database_url`; cadastrar Registry/Webhook no Portainer e secret `PORTAINER_WEBHOOK_URL`; executar deploy homologado, ensaio de backup/restauração/rollback e UAT dos papéis Loja/Comprador/Gestor em aparelhos reais.
- **Próxima ação autorizada:** concluir os itens OpenSpec que exigem esses recursos operacionais, sem marcar evidência ausente como concluída; PostgreSQL compartilhado confirmado na versão 18.6.
