# Tasks

## 0. Pré-requisitos

- [x] 0.1 Registrar as decisões de 29/10/2026 em `proposal.md` (sem Área do CPD, sem bloqueio, Gestor e CPD veem, Comprador e Loja não veem, conversão cadastrada para destaque, período de 31 dias)
- [x] 0.2 Definir as faixas de pesagem: verde 0% a +5%, laranja −5% a 0%, vermelho acima de 5% para mais ou para menos
- [x] 0.3 Seguir as APIs já usadas no projeto para páginas com `searchParams` (Promise) e `redirect` (mesmo padrão de `/gestor/perdas`); a documentação local do Next.js não pôde ser lida porque as dependências não puderam ser instaladas no ambiente de desenvolvimento
- [x] 0.4 Executar toda validação pesada (build, lint, testes, Postgres descartável) fora do servidor de produção

## 1. Permissão

- [x] 1.1 Criar `migrations/0021_phase6_reconciliation_permission.sql`: nova `users_permissions_valid_check` com 15 permissões e backfill somente para `GESTOR`; verificar ausência de outros `UPDATE` e de `DELETE`
- [x] 1.2 Atualizar `tests/unit/architecture.test.ts` para a sequência 0001–0021 e o caráter aditivo da 0021
- [x] 1.3 Executar 0001–0021 em PostgreSQL descartável; validar rerun, constraint e backfill (Gestor com a permissão; Comprador e Loja sem)
- [x] 1.4 Incluir `fechamento:consultar` em `PERMISSIONS`, `ROLE_DEFAULT_PERMISSIONS.GESTOR` e `PERMISSION_GROUPS` (grupo “Controle”); recusar a combinação com permissões de loja na gestão de usuários; cobrir em `identity-permissions.test.ts` e `user-management-domain.test.ts`

## 2. Domínio

- [x] 2.1 Criar `src/modules/purchasing/reconciliation/domain.ts` com `normalizeUnit`, `cutSituation`, `expectedWeight`, `classifyReconciliationLine`, `weightRange`, `buildKpis` e `WEIGHT_RANGE_PERCENT`
- [x] 2.2 Testar situação do corte: Integral, Corte parcial, Corte total (com e sem `NOT_PURCHASED`), Adicional sem pedido e acima do pedido
- [x] 2.3 Testar peso esperado: fator copiado, fallback para conversão atual, unidade de venda diferente de KG, destinação já em KG, fornecedores com fatores diferentes
- [x] 2.4 Testar faixas de pesagem (0%, +5%, +5,01%, −0,01%, −5%, −5,01%) e destaques: não recebido, recebido sem destinação, fora da conferência e conferência pendente
- [x] 2.5 Testar revisão de referência (fechamento vigente, sem fechamento, cancelada), conferência sobre revisão diferente e itens `removed_from_order`

## 3. Leitura

- [x] 3.1 Criar `reconciliation/repository.ts` somente com `SELECT`, com filtros, paginação e KPIs no banco; adicionar teste arquitetural que falha com `INSERT`, `UPDATE` ou `DELETE` no arquivo
- [x] 3.2 Criar `reconciliation/service.ts` validando filtros (padrão últimos 7 dias, máximo 31 dias, “somente com destaque” ligado)
- [x] 3.3 Criar `tests/integration/reconciliation.test.ts` com ciclo semeado cobrindo pedido, destinação com e sem fator, adicional, não recebido, revisão posterior ao fechamento e conferência pendente; comparar a contagem das tabelas de origem antes e depois da consulta

## 4. Tela

- [x] 4.1 Criar `src/app/fechamento/page.tsx` com verificação server-side de `fechamento:consultar` e redirecionamento para `/sem-acesso`
- [x] 4.2 Criar `reconciliation-workspace.tsx` no padrão da Consulta de Perdas: filtros, cartões, tabela desktop, cartões mobile, legenda das faixas verde/laranja/vermelho, cores dos destaques, números pt-BR, estado vazio único e paginação
- [x] 4.3 Adicionar o grupo “Controle” com “Fechamento integrado” no menu (uma vez) e o redirecionamento inicial do usuário do CPD
- [ ] 4.4 Verificar em 390px e 1280px: sem rolagem horizontal, legibilidade, teclado e checagem axe

## 5. E2E e regressão

- [ ] 5.1 Criar `tests/e2e/phase6.spec.ts` com seed descartável: Gestor consulta e filtra por destaque; usuário CPD com a permissão acessa; Comprador e Loja bloqueados pela URL; desktop e mobile
- [ ] 5.2 Rodar regressões de destinação, conferência, perdas, consolidado, precificação e gestão de usuários
- [ ] 5.3 Gerar capturas da tela em 390px e 1280px para homologação visual

## 6. Documentação e entrega

- [x] 6.1 Atualizar `README.md` e `docs/estado-atual.md` com a situação da Fase 6 e a decisão sobre o item 8.4
- [x] 6.2 Executar lint, typecheck, unitários, integrações, E2E relevantes, build e `git diff --check`; reportar falhas preexistentes separadamente (CI do PR #9: lint, typecheck, unitários com cobertura, migrations 0001–0021, integração e build aprovados; E2E pendente)
- [x] 6.3 Revisar o diff para garantir que nenhuma migration 0001–0020 foi alterada e que não há mudanças fora do escopo
- [x] 6.4 Abrir pull request para a `main` com resumo, resultados e capturas; não mesclar sem aprovação explícita, pois o merge dispara o deploy em produção (PR #9 aberto como rascunho)
