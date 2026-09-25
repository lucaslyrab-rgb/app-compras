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

### Requirement: Referência efetiva de recência
O sistema SHALL definir a referência de recência da Precificação como o `purchase_cycle_date` mais recente que possua pelo menos um custo oficial com `purchased = true` e custo não nulo, limitado à data operacional local no timezone vigente. O ciclo calculado para novos pedidos MUST NOT ser usado como referência de recência.

#### Scenario: Novo pedido aponta para ciclo posterior
- **WHEN** a data operacional for 25/09 e novos pedidos forem destinados a 28/09, enquanto o último ciclo com compra oficial for 25/09
- **THEN** a referência de recência SHALL permanecer em 25/09 e os custos oficiais de 25/09 SHALL ser considerados atuais

#### Scenario: Dia sem compra oficial nova
- **WHEN** a data operacional avançar, mas nenhum ciclo posterior possuir ao menos um custo oficial comprado e válido
- **THEN** a referência de recência SHALL permanecer no último ciclo que possua compra oficial

#### Scenario: Custo oficial futuro
- **WHEN** existir registro comprado e válido com `purchase_cycle_date` posterior à data operacional local
- **THEN** esse registro MUST NOT definir a referência nem substituir antecipadamente o custo oficial aplicável

### Requirement: Origem histórica inequívoca
Quando houver fallback histórico, a interface SHALL distinguir o ciclo de referência efetivamente comprado do ciclo do custo oficial anterior utilizado e SHALL referenciar a data de ciclo do próprio custo selecionado.

#### Scenario: Sem compra recente
- **WHEN** o custo oficial selecionado for anterior ao ciclo de referência da Precificação
- **THEN** a interface SHALL exibir “Sem compra no ciclo DD/MM/AAAA — usando custo oficial do ciclo DD/MM/AAAA”, respectivamente com a referência e o registro selecionado

#### Scenario: Consulta permanece independente de pedido novo
- **WHEN** um novo pedido avançar o contexto operacional sem haver compra oficial nova para o produto
- **THEN** valor, `cost_is_unit`, ciclo, cálculo e indicador de recência SHALL continuar derivados da mesma referência efetivamente comprada
