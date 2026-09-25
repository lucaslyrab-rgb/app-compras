# Tasks

## 1. Persistência e modelagem

- [x] 1.1 Criar `migrations/0008_purchase_calendar_settings.sql` com singleton, timezone, cutoff, dias ISO habilitados, versionamento, seed MultiShow, constraints e ownership final do owner do database; verificar que não há `UPDATE` de pedidos, custos ou revisões
- [x] 1.2 Adicionar a tabela ao schema Drizzle, incluir 0008 no runner e atualizar o teste arquitetural; verificar ordem exata 0001–0008 e `git diff --check`
- [x] 1.3 Executar 0001–0008 em PostgreSQL descartável como administrador e validar como `app_compras` SELECT/UPDATE, ownership, constraints, rerun e ausência de privilégios PUBLIC

## 2. Domínio do calendário

- [x] 2.1 Implementar tipos e validações server-side para timezone IANA, `HH:mm`, dias ISO únicos/não vazios e versão; verificar rejeições de timezone, cutoff e calendário vazios em testes unitários
- [x] 2.2 Implementar cálculo puro do próximo ciclo e do cutoff em tempo civil configurado, com busca limitada; verificar toda a matriz segunda–domingo em 18:59, 19:00, 18:59:59 e 19:00:00
- [x] 2.3 Cobrir travessia de fim de semana, fim de mês, fim de ano, `America/Sao_Paulo` e calendário/timezone alternativos; verificar que nenhum dia MultiShow está embutido no algoritmo

## 3. Serviço, concorrência e RBAC

- [x] 3.1 Implementar repository/service do calendário para leitura operacional e gestão versionada, autorizando escrita somente a GESTOR; verificar SELECT, update, conflito otimista e retorno do estado vigente em integração
- [x] 3.2 Implementar Server Action validada, auditoria e revalidação da tela; verificar que GESTOR salva e COMPRADOR/LOJA recebem negação server-side por chamada direta

## 4. Integração com pedidos

- [x] 4.1 Substituir o cálculo hard-coded da página da Loja pelo serviço configurável, mantendo o layout; verificar ciclo e cutoff mostrados para instantes determinísticos
- [x] 4.2 Recalcular server-side no envio e persistir o snapshot do novo ciclo sem alterar leituras históricas; verificar novo pedido, duplicidade, revisão no mesmo ciclo e numeração de revisão
- [x] 4.3 Ampliar testes de integração para provar que mudança posterior do calendário e cancelamento não movem pedidos/revisões existentes
- [x] 4.4 Rodar regressões da Loja em desktop/mobile e confirmar que rascunho, envio, confirmação de revisão, histórico e cancelamento continuam funcionais

## 5. Interface Gestor

- [x] 5.1 Ler a documentação local relevante do Next.js 16.3.5 para forms/Server Actions antes de editar componentes e registrar no relatório qualquer API específica adotada
- [x] 5.2 Adicionar seção “Calendário de compras” à página existente de Configurações com cutoff, sete dias e timezone, reutilizando estilos e sem redesenho; verificar touch, feedback, loading e ausência de overflow em 390px e 1280px
- [x] 5.3 Criar E2E de leitura/edição controlada e RBAC da seção, restaurando o valor de fixture no ambiente descartável; verificar Gestor permitido e Comprador/Loja bloqueados por URL/action

## 6. Precificação e diagnóstico

- [x] 6.1 Adaptar a Precificação para obter o ciclo operacional pelo calendário configurável sem relaxar `purchased = true`, custo não nulo ou limite de aplicabilidade; verificar consulta e revisão com o mesmo custo oficial
- [x] 6.2 Adicionar integração explícita ciclo A comprado + ciclo B draft e, depois, ciclo B comprado; verificar troca apenas após compra oficial e produtos distintos com custos oficiais de ciclos distintos
- [x] 6.3 Ajustar “Sem compra recente” para exibir inequivocamente o ciclo do custo oficial selecionado; verificar que a data vem de `officialCost.cycleDate`, não do pedido novo nem de `purchasedAt`
- [x] 6.4 Documentar no relatório que a seleção oficial existente estava correta e que o comportamento observado vinha do ciclo atual hard-coded/apresentação; não modificar a ordenação da consulta sem falha reproduzida

## 7. Histórico e validação final

- [x] 7.1 Reexecutar auditoria somente leitura dos pedidos recentes, listar os registros divergentes e confirmar que nenhuma correção histórica foi aplicada
- [x] 7.2 Executar lint, typecheck, unitários, integrações, E2E relevantes, regressões de Loja/Consolidado/Custos/Precificação, build e `git diff --check`; reportar qualquer falha preexistente separadamente
- [x] 7.3 Revisar o diff para excluir logo, sticky, paginação, cadastro, Separação/Embarque, arquivos locais preexistentes e qualquer alteração de migrations 0001–0007
- [x] 7.4 Se todas as validações passarem, criar commit local isolado sem push/deploy e informar SHA, arquivos, resultados e passos futuros de rollout da 0008

## 8. Correção da referência de recência da Precificação

- [x] 8.1 Corrigir spec e design para definir a referência como o ciclo oficial efetivamente comprado mais recente até a data operacional local, sem usar o ciclo destinado a novos pedidos
- [x] 8.2 Adaptar service/repository/domínio da Precificação preservando seleção oficial, fingerprints, revisões, cálculos e filtros; verificar proteção contra custo futuro
- [x] 8.3 Tornar o fallback inequívoco com ciclo de referência e ciclo do custo utilizado; verificar contadores e apresentação desktop/mobile
- [x] 8.4 Cobrir 25/09 com pedido novo para 28/09, dia sem compra, produto com custo anterior, produto sem custo e custo futuro; executar validações completas sem push/deploy
