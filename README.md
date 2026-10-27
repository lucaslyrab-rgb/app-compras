# MultiShow FLV — Sistema de Compras

Sistema web/PWA para o fluxo de FLV das três lojas MultiShow: pedidos, consolidação, custos, destinação, documentação fiscal, conferência e registro de perdas.

> **Planejamento oficial:** [Planejamento Geral Consolidado — Versão 2.0](docs/PLANEJAMENTO.md), aprovado em 26/10/2026. As fases 4, 5 e 6 estão **planejadas, não implementadas**.

## Situação das fases

| Fase | Escopo | Situação |
|---|---|---|
| 1 | Fundação e pedidos das lojas | Implementada |
| 2 | Consolidação, custos e operação de compras | Base implementada |
| 3 | Destinação, fornecedores e fechamento operacional | Em estabilização |
| 4 | Registro e vinculação de notas fiscais às destinações | Planejamento aprovado |
| 5 | Conferência de mercadorias e lançamento de perdas | Planejamento aprovado |
| 6 | Fechamento integrado, divergências e controle do CPD | Regras principais aprovadas |

As situações das fases implementadas são o histórico conhecido do projeto, não uma auditoria recente de produção.

## Documentação

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

A implementação de cada fase requer planejamento técnico, desenvolvimento, testes e aprovação específicos. **A aprovação do planejamento v2.0 autoriza somente atualização documental:** não autoriza alteração de código, migrações, deploy ou ativação antecipada de bloqueios.

O repositório preserva a baseline Wittemberg em `.harness/` e os artefatos OpenSpec. Para detalhes técnicos, consultar os documentos operacionais e o código vigente.

### Importação administrativa de produtos

`npm run db:import-products -- arquivo.xlsx` preserva por padrão o cadastro mestre e parâmetros existentes para o mesmo ERP, inserindo somente produtos ausentes e parâmetros faltantes. Para bootstrap administrativo deliberado que sincronize campos legados da planilha, usar `npm run db:import-products -- arquivo.xlsx --bootstrap-sync`; esse modo é explícito e incrementa a versão do produto.
