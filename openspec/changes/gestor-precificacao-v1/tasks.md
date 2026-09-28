# Tasks

## 1. Pré-condições e linha de base

- [x] 1.1 Obter e inspecionar visualmente os arquivos `Gestor-Cadastro` e `Gestor-precificação`, registrar medidas/hierarquia relevantes e verificar que ambos estão disponíveis antes de editar as telas gerenciais.
- [x] 1.2 Registrar a linha de base do worktree e das suítes existentes sem tocar nas mudanças do usuário; verificar `git status --short`, lint, typecheck, unitários e build antes da implementação.
- [x] 1.3 Ler os guias locais relevantes do Next.js 16.3.5 para layouts, Server Components/Actions, segurança e CSS; verificar que as decisões de rotas e mutações seguem as APIs instaladas.

## 2. Persistência e carga inicial

- [x] 2.1 Criar `0005_pricing_parameters_and_cost_basis.sql` com `cost_is_unit`, parâmetros por produto, singleton global, constraints, índices e backfill idempotente; verificar aplicação sobre schema em `0004`, rerun e dados CX/SC/UND/PCT/BDJ em PostgreSQL de teste.
- [x] 2.2 Criar `0006_pricing_reviews.sql` com snapshots imutáveis, FKs, precisões e índices; verificar que INSERT funciona e UPDATE/DELETE são rejeitados em integração.
- [x] 2.3 Atualizar `src/db/schema.ts` e `scripts/migrate.ts` sem alterar migrations antigas; verificar typecheck e teste arquitetural de ordem das migrations.
- [x] 2.4 Atualizar o importador para inicializar somente parâmetros ausentes na mesma transação e rejeitar formato desconhecido; verificar importação repetida preservando configuração MANUAL.
- [x] 2.5 Unificar a execução em `scripts/migration-runner.mjs`, descobrindo e ordenando `migrations/*.sql`, rejeitando prefixos duplicados e fazendo desenvolvimento/CI e entrypoint de produção consumirem a mesma fonte sem listas hardcoded.

## 3. Domínio financeiro

- [x] 3.1 Implementar representação decimal/racional com `bigint`, parsing e serialização controlada; verificar testes de precisão, comparação nos limites e ausência de uso de `number` nas decisões financeiras.
- [x] 3.2 Implementar normalização do custo para CX/SC/UND/PCT/BDJ e validações de conversão; verificar os seis casos unitários exigidos para custo informado unitário e por formato.
- [x] 3.3 Implementar quantidade vendável, perda e custo efetivo; verificar caixa de 20 KG, custo 40 e perda 40%, além de perda negativa e maior/igual a 100%.
- [x] 3.4 Implementar preço matemático com percentuais sobre venda e erro de denominador; verificar `10 / 0,57` e rejeição de configuração inválida.
- [x] 3.5 Implementar uma única função de arredondamento comercial e separar preço calculado/sugerido; verificar todos os exemplos 9,99, 10,00–10,99 e 11,01 definidos na especificação.
- [x] 3.6 Implementar simulação não persistente de preço, margem líquida e markup; verificar preço válido, zero, negativo e entrada inválida.

## 4. Parâmetros e configurações do Gestor

- [x] 4.1 Criar domínio/repositório/serviço de parâmetros com DTO mínimo, filtros, indicadores e autorização GESTOR; verificar testes unitários e integração de busca por nome/ERP/formato e filtros de status.
- [x] 4.2 Implementar updates versionados de conversão, perda e margem, transição PROVISIONAL→MANUAL e auditoria; verificar sucesso, limites, margem nula e conflito otimista.
- [x] 4.3 Criar domínio/repositório/serviço do singleton global com 23%/20%, validação e auditoria; verificar acesso GESTOR, soma inválida e conflito de versão.
- [x] 4.4 Implementar `/gestor/produtos` e detalhe/edição responsivos conforme a referência disponível; verificar tabela/painel no desktop e cards/tela dedicada em 320–412 px.
- [x] 4.5 Implementar `/gestor/configuracoes` com inputs adequados a toque e feedback de conflito/erro; verificar persistência após reload sem expor a action a COMPRADOR ou LOJA.
- [x] 4.6 Redirecionar `/produtos` de forma compatível para a nova área e preservar bloqueio por papel; verificar acesso direto para GESTOR, COMPRADOR e LOJA.

## 5. Natureza unitária no Lançamento de Custos

- [x] 5.1 Estender tipos, leitura e persistência de custos com `costIsUnit` na mesma versão/linha; verificar default falso, round-trip, correção e conflito em testes unitários e de integração.
- [x] 5.2 Integrar o checkbox “Custo informado é unitário” ao estado e autosave existentes sem duplicar lógica; verificar alteração isolada, reload, falha, comprado/desmarcado, blur e Enter desktop.
- [x] 5.3 Ajustar layout desktop/mobile de Custos somente no espaço necessário ao novo controle; verificar 320, 375, 390, 412, 768 e 1280 px sem overflow e com alvos de toque adequados.
- [x] 5.4 Executar regressão dedicada de Custos para custo anterior/atual, Alterado, busca, filtros, ciclos, P/B/S, ausência versus zero e exclusivo; verificar unitários, integração e `tests/e2e/purchase-costs.spec.ts` sem enfraquecimento.

## 6. Consulta e revisão de Precificação

- [x] 6.1 Implementar consulta em lote do custo oficial atual/histórico com `cost_is_unit`, ignorando drafts; verificar Sem custo, custo do ciclo, Sem compra recente, último histórico e desempate determinístico.
- [x] 6.2 Montar o pipeline por produto com parâmetros e configurações, retornando preço ou erro explicável; verificar DTOs para cálculo válido, parâmetros inválidos e ausência de custo.
- [x] 6.3 Implementar estado de revisão por fingerprint das entradas relevantes; verificar nunca revisado, custo alterado, conversão/perda/margem alteradas, margem global aplicável e draft irrelevante.
- [x] 6.4 Implementar action transacional de revisão explícita com releitura das fontes e snapshot; verificar autoria/data, imutabilidade, conflito entre abertura e confirmação e ausência de revisão ao apenas abrir.
- [x] 6.5 Implementar `/gestor/precificacao` com indicadores, busca, filtros e tabela/cards; verificar estados Custos alterados, Sem compra recente, Não revisados, Revisados e Sem custo com dados reais.
- [x] 6.6 Implementar `/gestor/precificacao/[id]` com painel desktop/tela mobile, cálculo explicável, preço sugerido destacado e simulação local; verificar que nenhum valor é rotulado como preço atual do ERP.
- [x] 6.7 Separar o fingerprint técnico da comparação semântica de custo, usando aritmética racional exata e o custo oficial imediatamente anterior; verificar igualdade normalizada, aumento/redução, ausência de anterior, parâmetros alterados e base historicamente não reconstruível.
- [x] 6.8 Validar a auditoria somente leitura de 25/09 sem corrigir dados: Batata Inglesa 100→100 fora de Custo alterado; Abacate, Aipim, Banana Nanica e Cebola Roxa como mudanças econômicas seguras; Banana Prata, Berinjela e Chuchu explicados individualmente conforme compatibilidade histórica da base.
- [x] 6.9 Derivar a pendência de custo do histórico oficial após o watermark da última revisão, preservando-a através de custos iguais, novas mudanças e retorno ao valor inicial; verificar N+1, N+2, encerramento pela revisão e tratamento conservador de bases incompatíveis.
- [x] 6.10 Criar migration aditiva para preço decidido/origem, persistir decisões sugeridas ou manuais e manter fallback de snapshots históricos nulos; verificar concorrência por fingerprint e ausência de mutação de custo/parâmetros.
- [x] 6.11 Manter todos os produtos calculáveis editáveis e separar visualmente pendência, sugerido, último preço decidido e nova decisão; verificar reload e ausência de badge Custo alterado em decisão puramente comercial.

## 7. Navegação e RBAC

- [x] 7.1 Implementar layout operacional com sidebar verde desktop, hierarquia expansível, item atual e drawer mobile conforme referências; verificar que o conteúdo não é encoberto em 320–1280+ px.
- [x] 7.2 Aplicar a matriz de visibilidade LOJA/COMPRADOR/GESTOR sem inserir o shell no fluxo da Loja; verificar menus por papel e regressão visual do workspace de pedido.
- [x] 7.3 Reforçar autorização em todas as páginas, consultas, serviços e Server Actions novas; verificar URLs/actions diretas para GESTOR permitido e COMPRADOR/LOJA negados.
- [x] 7.4 Verificar navegação de GESTOR para Consolidado e Custos sem alterar os workspaces internos homologados e validar saída/sessão no desktop e mobile.

## 8. Impressão

- [x] 8.1 Implementar `/gestor/precificacao/impressao` autenticada e, após homologação, restringi-la a revisões atuais com preço aplicado confirmado; verificar conteúdo, ausência de pendentes e RBAC.
- [x] 8.2 Adicionar botão Imprimir com CSS A4 e abertura manual da caixa do navegador; verificar nova aba, ausência de impressão automática e ausência de revisão colateral.
- [x] 8.3 Persistir preço aplicado e preço decidido com origem durável em migrations aditivas 0009 e 0010, separar flags de custo/parâmetros/pendência, permitir relatório por IDs de revisões recém-criadas ou revisões confirmadas; verificar primeiro custo, igualdade econômica, reabertura, CHUCHU com flags simultâneas, decisão manual e ausência de backfill histórico.
- [x] 8.4 Restringir a impressão às revisões atuais com decisão explícita, usar `decided_price` como fonte canônica com compatibilidade exclusiva por `applied_price` e excluir pendências e snapshots legados sem decisão; verificar preço manual diferente do sugerido.
- [x] 8.7 Restringir o relatório às mudanças econômicas reais do ciclo oficial de referência atual cobertas por revisão ancorada no custo da rodada; excluir custos iguais, pendências e decisões anteriores sem criar migration.
- [x] 8.5 Manter o painel lateral de decisão visível no desktop com limite de viewport e rolagem interna, preservando largura, seleção e comportamento mobile.
- [x] 8.6 Exibir o asset horizontal MultiShow existente na sidebar e no cabeçalho mobile com cores originais, removendo o filtro monocromático sem redesenhar a navegação.

## 9. Qualidade, responsividade e regressão

- [x] 9.1 Ampliar seed/fixtures sem depender de quantidades hardcoded de produção; verificar cenários de custo unitário, histórico, sem custo, alteração, revisão e conversões nos E2E.
- [x] 9.2 Executar E2E de Produtos, Configurações, Precificação, detalhe, simulação, drawer e impressão nos viewports 320, 375, 390, 412, 768 e 1280; verificar ausência de overflow e legibilidade de nomes/valores/badges.
- [x] 9.3 Executar regressões completas de LOJA, Consolidado e Lançamento de Custos; verificar que latest valid revision, cutoff/ciclo, cancelamento, snapshots e triggers continuam iguais.
- [x] 9.4 Executar `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, E2E relevante, `git diff --check` e `npm run build`; registrar resultado individual e não alterar regra para contornar falha.
- [x] 9.5 Revisar o diff para confirmar ausência de migration antiga alterada, migration destrutiva, integração ERP, upload de fotos ou funcionalidade fora do escopo; verificar `git diff --stat` e inspeção arquivo a arquivo.
- [x] 9.6 Executar lint, typecheck, unitários, integração em PostgreSQL descartável, build, validação OpenSpec e `git diff --check` para a pendência durável e decisões comerciais; registrar cada resultado sem commit, push ou deploy.
- [x] 9.7 Validar descoberta automática de 0001–0009, reaplicação em banco vazio e em estado legado equivalente à produção, rejeição de prefixo duplicado e conteúdo do artefato de produção; executar lint, typecheck, unitários, integração, build e `git diff --check`.
- [x] 9.8 Executar testes relacionados, unitários, integração PostgreSQL descartável, lint, typecheck, build, OpenSpec strict e `git diff --check` para o pacote de homologação, sem modificar recência, calendário, fórmulas, migrations ou regras de custo.
- [x] 9.9 Validar o relatório da rodada com custo alterado pendente/revisado, custo igual revisado, decisão anterior, preço manual e avanço de ciclo; executar unitários, integração PostgreSQL descartável, lint, typecheck, build, OpenSpec strict e `git diff --check`.

## 10. Entrega controlada

- [x] 10.1 Produzir relatório pré-deploy com arquivos, migrations, banco, rotas, regras, pendências, testes, viewports, riscos e passos de rollout/rollback; verificar que qualquer falha legada é separada do escopo.
- [x] 10.2 Criar commit focado sem incluir mudanças preexistentes do usuário e registrar o SHA; verificar `git status --short` e conteúdo do commit.
- [ ] 10.3 Somente após autorização explícita de deploy, acompanhar GitHub Actions→GHCR→GitOps→Portainer→Swarm e registrar tag, digest, UpdateStatus, tarefa, health, RestartCount e rollback; verificar `/api/health` e saúde do container.
