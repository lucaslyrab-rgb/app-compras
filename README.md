# MultiShow FLV — Sistema de Compras

Sistema web/PWA para o fluxo de FLV das três lojas MultiShow: pedidos, consolidação, custos, destinação, documentação fiscal, conferência e registro de perdas.

> **Versão 1.0 em produção desde 02/11/2026.** Resumo do que está no ar e das decisões tomadas: [docs/versao-1.md](docs/versao-1.md). As regras de negócio de referência continuam no [Planejamento v2.0](docs/PLANEJAMENTO.md).

## Situação das fases

| Fase | Escopo | Situação |
|---|---|---|
| 1 | Fundação e pedidos das lojas | Em produção |
| 2 | Consolidação, custos e operação de compras | Em produção |
| 3 | Destinação, fornecedores e fechamento operacional | Em produção |
| 4 | Registro e vinculação de notas fiscais às destinações | Em produção (exigência de nota no fechamento controlada por `REQUIRE_INVOICES_FOR_CLOSURE`) |
| 5 | Conferência de mercadorias e lançamento de perdas | Em produção |
| 6 | Fechamento integrado: pedido × destinação × conferência | Em produção (informativo, sem Área do CPD) |
| — | Nova interface (mobile-first) e ajustes de operação | Em produção (PRs #10–#18) |

## Documentação

- **[Versão 1.0](docs/versao-1.md)** — o que está em produção, decisões registradas e histórico de entregas.
- **[Planejamento aprovado v2.0](docs/PLANEJAMENTO.md)** — fonte principal das regras de negócio e da sequência das seis fases.
- [Roadmap](docs/roadmap.md) — resumo da sequência de execução.
- [Estado atual](docs/estado-atual.md) — registro técnico/histórico; distinguir evidências datadas de situação atual.
- [Especificação funcional histórica](MULTISHOW_FLV_ESPECIFICACAO_CODEX.md) — referência anterior, sujeita às decisões do planejamento v2.0.
- [Brainstorm consolidado](docs/brainstorm-compras-multishow-flv.md)
- [PRDs](docs/prds/)
- [TRD](docs/trd.md)
- [ADRs](docs/adrs/)
- [Viabilidade e termo de abertura](docs/viabilidade-e-termo-de-abertura.md)
- [Deploy, GHCR, Portainer e GitHub Actions](docs/operacao/deploy-ghcr-portainer.md)

## Fluxo de desenvolvimento

Cada mudança é feita em uma branch, passa pelo CI (lint, tipos, testes unitários e de integração, build e auditoria) e só entra na `main` com aprovação do responsável (Lucas). O deploy é automático ao entrar na `main` (GHCR → Portainer). Ajustes pequenos podem ser acumulados em um único PR e publicados juntos.

O repositório preserva a baseline Wittemberg em `.harness/` e os artefatos OpenSpec. Para detalhes técnicos, consultar os documentos operacionais e o código vigente.

### Importação administrativa de produtos

`npm run db:import-products -- arquivo.xlsx` preserva por padrão o cadastro mestre e parâmetros existentes para o mesmo ERP, inserindo somente produtos ausentes e parâmetros faltantes. Para bootstrap administrativo deliberado que sincronize campos legados da planilha, usar `npm run db:import-products -- arquivo.xlsx --bootstrap-sync`; esse modo é explícito e incrementa a versão do produto.
