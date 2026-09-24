# Spec Delta

## Purpose

Definir um cálculo financeiro unitário, auditável e preciso a partir do custo oficial, incluindo perda, percentuais sobre venda, arredondamento comercial e simulação.

## ADDED Requirements

### Requirement: Seleção exclusiva do custo oficial
O sistema SHALL usar o custo comprado mais recente do produto, ignorando rascunhos não comprados, e SHALL informar a origem temporal desse custo.

#### Scenario: Compra oficial no ciclo atual
- **WHEN** existe custo com `purchased=true` no ciclo atual
- **THEN** o sistema usa esse custo e sua natureza unitária como base oficial

#### Scenario: Somente custo histórico
- **WHEN** não existe compra oficial no ciclo atual, mas existe custo oficial anterior
- **THEN** o sistema usa o último custo oficial anterior e identifica o produto como Sem compra recente com data ou ciclo de origem

#### Scenario: Rascunho mais novo
- **WHEN** existe um rascunho não comprado mais recente do que o último custo oficial
- **THEN** o rascunho não substitui a base oficial

#### Scenario: Produto sem custo oficial
- **WHEN** o produto nunca teve custo comprado
- **THEN** o sistema identifica Sem custo e não produz preço calculado ou sugerido

### Requirement: Normalização do custo para unidade de venda
O sistema SHALL calcular o custo bruto unitário como custo oficial quando `cost_is_unit=true` e como custo oficial dividido pela conversão quando `cost_is_unit=false`.

#### Scenario: Caixa não unitária
- **WHEN** o custo oficial é 100, a conversão é 20 KG e `cost_is_unit=false`
- **THEN** o custo bruto unitário é 5 por KG

#### Scenario: Caixa já cotada por KG
- **WHEN** o custo oficial é 5, a conversão é 20 KG e `cost_is_unit=true`
- **THEN** o custo bruto unitário é 5 por KG sem nova divisão

#### Scenario: Formatos unitários iniciais
- **WHEN** o formato é UND, PCT ou BDJ com conversão 1
- **THEN** o custo bruto unitário corresponde ao custo oficial por UND

### Requirement: Aplicação da perda de beneficiamento
O sistema SHALL calcular `effectiveUnitCost = grossUnitCost / (1 - lossPercent / 100)` e SHALL rejeitar perda fora do intervalo permitido.

#### Scenario: Perda de quarenta por cento
- **WHEN** uma caixa de 20 KG custa 40 e possui perda de 40%
- **THEN** a quantidade vendável é 12 KG, o custo bruto é 2 por KG e o custo efetivo é 3,333... por KG

### Requirement: Percentuais sobre o preço de venda
O sistema SHALL calcular `calculatedPrice = effectiveUnitCost / (1 - operatingCostPercent / 100 - desiredMarginPercent / 100)` e MUST NOT usar markup multiplicativo simples.

#### Scenario: Custo efetivo dez
- **WHEN** o custo efetivo é 10, o custo operacional é 23% e a margem desejada é 20%
- **THEN** o preço matemático é 10 dividido por 0,57, aproximadamente 17,543859

#### Scenario: Denominador inválido
- **WHEN** a soma do custo operacional e da margem aplicável for maior ou igual a 100%
- **THEN** o sistema não produz preço e apresenta erro de configuração

### Requirement: Precisão financeira
O sistema MUST calcular valores monetários e percentuais sem decisões baseadas em `number` de ponto flutuante binário e MUST arredondar somente nos limites de persistência ou apresentação definidos.

#### Scenario: Pipeline com dízima
- **WHEN** conversão, perda e percentuais produzem uma dízima
- **THEN** o preço calculado preserva precisão interna suficiente para que o arredondamento comercial seja determinístico

### Requirement: Arredondamento comercial centralizado
O sistema SHALL manter separadamente preço matemático e preço sugerido e SHALL escolher o final 0,49 quando a fração do preço estiver entre 0,20 e 0,60 inclusive, o final 0,99 do mesmo inteiro acima de 0,60 e o final 0,99 imediatamente anterior abaixo de 0,20.

#### Scenario: Valores abaixo de vinte centavos
- **WHEN** o preço calculado é 10,00, 10,01, 10,10 ou 10,19
- **THEN** o preço sugerido é 9,99

#### Scenario: Valores entre vinte e sessenta centavos
- **WHEN** o preço calculado é 10,20, 10,37, 10,49, 10,55 ou 10,60
- **THEN** o preço sugerido é 10,49

#### Scenario: Valores acima de sessenta centavos
- **WHEN** o preço calculado é 10,61, 10,75 ou 10,99
- **THEN** o preço sugerido é 10,99

#### Scenario: Mudança de inteiro
- **WHEN** o preço calculado é 9,99 ou 11,01
- **THEN** os preços sugeridos são respectivamente 9,99 e 10,99

#### Scenario: Margem após arredondamento para baixo
- **WHEN** o arredondamento comercial reduz ligeiramente a margem efetiva
- **THEN** o sistema mantém o preço sugerido da regra 0,49/0,99 e não o eleva para proteger a margem objetivo

### Requirement: Simulação não persistente de preço
O sistema SHALL permitir informar um preço simulado positivo e calcular margem líquida resultante e markup sobre custo efetivo sem alterar produto, configuração ou revisão.

#### Scenario: Simular preço de venda
- **WHEN** o Gestor informa um preço simulado válido
- **THEN** o sistema exibe `1 - operatingCostFraction - effectiveUnitCost / simulatedPrice` como margem líquida e `simulatedPrice / effectiveUnitCost - 1` como markup

#### Scenario: Simulação inválida
- **WHEN** o preço simulado for zero, negativo ou não numérico
- **THEN** o sistema não calcula indicadores e informa o erro
