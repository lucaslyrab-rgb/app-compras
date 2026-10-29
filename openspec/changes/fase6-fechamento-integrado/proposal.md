# Proposal

## Why

As Fases 3, 4 e 5 já gravam, separadamente, o que cada loja pediu, o que o comprador destinou e o que a loja efetivamente recebeu e pesou. A tela “Conferência Conjunta dos Cortes” mostra pedido × destinação de uma loja por vez, mas não existe uma visão que junte pedido, destinação e pesagem e aponte rapidamente onde a pesagem não confere.

A Fase 6 do Planejamento Geral v2.0 (seção 8) prevê esse confronto. Em 29/10/2026 o responsável pelo sistema refinou o escopo:

- Pedido diferente da destinação é rotina: o comprador ajusta a compra conforme as oportunidades do mercado na madrugada. Isso é informação (corte, adicional), não erro.
- O fiscal, as notas e seus controles continuam no StarTwo. **Não haverá Área do CPD** nem bloqueio de qualquer tipo.
- A comparação destinação × pesagem deve usar a **conversão cadastrada de cada mercadoria** (ex.: 1 CX = 20 kg) apenas para **destacar** quando a pesagem não confere. Esta decisão substitui, para fins de destaque visual, a restrição do item 8.4 do planejamento sobre presumir pesos.
- O confronto será visto pelo **Gestor** e pelos usuários do CPD a quem a permissão for atribuída. O **Comprador não verá** e a **Loja não verá**.

## What Changes

- Criar o módulo **Fechamento integrado** (`/fechamento`): por loja, ciclo e produto, mostrar lado a lado o pedido (CX), a destinação (CX), o peso esperado pela conversão cadastrada, o peso conferido (KG) e a diferença.
- Classificar a relação pedido × destinação com o vocabulário já usado na Conferência Conjunta dos Cortes: **Integral**, **Corte parcial**, **Corte total** e **Adicional**, apenas como informação.
- Colorir a pesagem em faixas (verde, laranja, vermelho) e **destacar** as linhas que precisam de atenção: pesagem mais de 5% acima ou abaixo do esperado, não recebido, recebido sem destinação, destinado fora da conferência e conferência pendente.
- Calcular tudo na leitura, a partir dos registros originais, sem gravar cópias e sem alterar pedidos, destinações ou conferências.
- Adicionar a permissão `fechamento:consultar`, concedida por padrão ao Gestor e atribuível pela tela de Usuários a qualquer usuário sem permissão de loja (equipe do CPD).
- Criar a migration aditiva `0021_phase6_reconciliation_permission.sql`, que apenas registra a permissão e faz o backfill para Gestores.

## Capabilities

### New Capabilities

- `purchasing/cycle-reconciliation`: montagem do confronto loja × ciclo × produto, situação do corte, peso esperado pela conversão, destaques, filtros, indicadores e RBAC.

### Modified Capabilities

Nenhuma capability publicada em `openspec/specs/` existe hoje.

## Impact

- **Banco:** migration 0021 com nova lista da constraint `users_permissions_valid_check` e backfill de `fechamento:consultar` para Gestores. Nenhuma tabela nova. Nenhum `UPDATE` ou `DELETE` em pedidos, destinações, conferências, perdas ou notas.
- **Backend:** novo módulo `src/modules/purchasing/reconciliation` (domínio puro + repository somente leitura + service).
- **Frontend:** uma página nova no padrão visual da Consulta de Perdas e um item de menu exibido uma única vez.
- **Fases 4 e 5:** sem alteração de comportamento.
- **Testes:** unitários do classificador e do peso esperado, integração do repository/migration/RBAC e E2E em 390px e 1280px.

## Non-goals

- Área do CPD, confirmação de recebimento de notas e qualquer controle fiscal (ficam no StarTwo).
- Marcadores sobre notas fiscais no confronto.
- Bloqueio de fechamento, justificativas ou workflow de tratamento de divergências.
- Alterar a conversão cadastrada a partir do confronto ou corrigir pedidos, destinações e conferências.
- Relatórios gerenciais adicionais, exportação para planilha e gráficos.
- Visualização pelo Comprador ou pela Loja.

## Decisões registradas (29/10/2026)

1. Sem perfil-base novo: o acesso é controlado por permissão atribuída por usuário.
2. Sem Área do CPD; as perguntas sobre desfazer confirmação e exclusão de nota confirmada deixam de se aplicar.
3. Confronto visível para Gestor e CPD; não visível para Comprador e Loja.
4. Período máximo de 31 dias por consulta.
5. Faixas de pesagem sem tolerância: verde de 0% a +5%, laranja de −5% a 0%, vermelho com destaque e mensagem acima de 5% para mais ou para menos (ver `design.md`).
