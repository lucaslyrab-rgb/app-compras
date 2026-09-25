# Spec Delta

## Purpose

Garante que cada produto seja precificado pelo custo oficial realmente comprado mais recente e que a interface identifique sem ambiguidade a origem histórica utilizada.

## ADDED Requirements

### Requirement: Último custo oficial por produto
A Precificação SHALL selecionar, para cada produto, o custo aplicável mais recente com `purchased = true` e custo não nulo, ordenado pela data do ciclo e pelos critérios de desempate existentes.

#### Scenario: Draft posterior não substitui oficial
- **WHEN** o produto possuir custo oficial no ciclo A e existir um custo ou pedido posterior no ciclo B ainda não comprado
- **THEN** a Precificação SHALL continuar usando o custo oficial do ciclo A

#### Scenario: Novo custo comprado passa a oficial
- **WHEN** o produto no ciclo B posterior receber custo válido e `purchased = true`
- **THEN** a Precificação SHALL passar a usar o custo oficial do ciclo B

#### Scenario: Produtos com origens diferentes
- **WHEN** produtos diferentes tiverem seus últimos custos oficiais em ciclos distintos
- **THEN** cada produto SHALL ser calculado com seu próprio último custo oficial, sem exigir um ciclo comum

#### Scenario: Produto sem custo oficial
- **WHEN** nenhum custo comprado e válido existir para o produto
- **THEN** o produto SHALL permanecer como “Sem custo” e o sistema MUST NOT inventar custo zero ou preço

### Requirement: Limite do ciclo operacional
O sistema SHALL usar o ciclo operacional calculado pelo calendário vigente como limite de aplicabilidade, sem permitir que um registro de ciclo futuro substitua antecipadamente o custo oficial atual.

#### Scenario: Ciclo futuro comprado indevidamente
- **WHEN** existir um registro marcado como comprado com `purchase_cycle_date` posterior ao ciclo operacional vigente
- **THEN** esse registro MUST NOT ser selecionado até que seu ciclo se torne aplicável

### Requirement: Origem histórica inequívoca
Quando houver fallback histórico, a interface SHALL distinguir o ciclo/data do custo oficial utilizado do ciclo operacional atual e SHALL referenciar a data de ciclo do próprio custo selecionado.

#### Scenario: Sem compra recente
- **WHEN** o custo oficial selecionado pertencer a ciclo diferente do ciclo operacional atual
- **THEN** a interface SHALL exibir “Sem compra recente” e informar que está usando o custo oficial do ciclo `DD/MM/AAAA` correspondente ao registro selecionado

#### Scenario: Consulta permanece independente de pedido novo
- **WHEN** um novo pedido avançar o contexto operacional sem haver compra oficial nova para o produto
- **THEN** valor, `cost_is_unit`, ciclo e cálculo SHALL continuar derivados do mesmo custo oficial anterior
