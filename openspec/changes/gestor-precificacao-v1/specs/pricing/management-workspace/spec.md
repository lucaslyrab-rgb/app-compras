# Spec Delta

## Purpose

Fornecer ao Gestor uma área gerencial responsiva para analisar preços unitários, reconhecer pendências, registrar revisões explícitas e imprimir alterações.

## ADDED Requirements

### Requirement: Lista gerencial de precificação
O sistema SHALL apresentar produtos ativos com indicadores reais, busca por produto, ERP ou formato e filtros Todos, Custos alterados, Sem compra recente, Não revisados e Revisados.

#### Scenario: Tabela desktop
- **WHEN** o Gestor acessa a Precificação em viewport desktop
- **THEN** o sistema apresenta tabela com ERP, produto, formatos e unidades, custo oficial, custos unitários, preços calculado e sugerido, status, revisão e ações

#### Scenario: Cards mobile
- **WHEN** o Gestor acessa entre 320 e 412 px
- **THEN** o sistema apresenta cards sem scroll horizontal que priorizam produto, ERP, status, compra, conversão, perda, custos e preços, com ação para análise dedicada

#### Scenario: Nome longo e valor monetário
- **WHEN** um produto possui nome longo ou valores mais extensos
- **THEN** o conteúdo quebra de forma controlada sem encobrir ações ou criar overflow horizontal

### Requirement: Detalhe explicável da precificação
O sistema SHALL apresentar em conjunto os dados de origem e cada etapa do cálculo, destacando visualmente o preço sugerido sem rotular qualquer valor como preço atual do ERP.

#### Scenario: Análise completa
- **WHEN** o Gestor abre um produto com custo oficial e configuração válida
- **THEN** o detalhe mostra formato, unidade, conversão, perda, margem aplicada, custo original e sua natureza, ciclo/data, custo bruto, custo efetivo, custo operacional, preço calculado e preço sugerido

#### Scenario: Detalhe mobile
- **WHEN** o produto é aberto no mobile
- **THEN** a análise usa tela dedicada e a simulação pode ser expandida sem comprimir uma tabela desktop

### Requirement: Estado de revisão derivado das entradas
O sistema SHALL considerar uma revisão atual somente quando o custo oficial e sua versão, os parâmetros do produto e a configuração global aplicável corresponderem ao snapshot da última revisão.

#### Scenario: Produto nunca revisado
- **WHEN** existe preço calculável, mas nenhuma revisão explícita
- **THEN** o produto é identificado como Não revisado

#### Scenario: Custo oficial mudou
- **WHEN** o custo oficial atual não corresponde ao custo analisado na última revisão
- **THEN** o produto recebe badge Custo alterado e aparece no respectivo filtro

#### Scenario: Outro parâmetro relevante mudou
- **WHEN** conversão, perda, margem específica, custo operacional ou margem global aplicável muda após a revisão
- **THEN** a revisão deixa de ser atual e o produto volta a exigir análise

#### Scenario: Rascunho de custo mudou
- **WHEN** somente um custo não comprado muda
- **THEN** o estado da revisão e o preço oficial não mudam

### Requirement: Revisão explícita e auditável
O sistema SHALL criar uma revisão somente por ação explícita do Gestor e SHALL registrar usuário, data, custo oficial analisado, natureza do custo, conversão, perda, percentuais, custos derivados, preço matemático e preço sugerido.

#### Scenario: Confirmar revisão
- **WHEN** o Gestor confirma a revisão de um produto calculável usando a versão atual
- **THEN** o sistema grava um snapshot imutável, registra o autor e identifica o produto como Revisado

#### Scenario: Entradas mudaram antes da confirmação
- **WHEN** custo ou parâmetros mudam entre a abertura e a ação de revisar
- **THEN** o sistema rejeita o snapshot obsoleto e solicita nova análise

#### Scenario: Apenas abrir ou imprimir
- **WHEN** o Gestor abre o detalhe ou o relatório de impressão
- **THEN** nenhuma revisão é criada

### Requirement: Impressão de alterações
O sistema SHALL oferecer relatório autenticado em nova aba com produtos relevantes ou pendentes, contendo ERP, produto, unidade, custo efetivo, preço calculado, preço sugerido e espaço para anotação.

#### Scenario: Abrir relatório
- **WHEN** o Gestor aciona “Imprimir alterações”
- **THEN** o sistema abre uma página preparada para impressão com botão Imprimir e não dispara impressão automaticamente

#### Scenario: Imprimir relatório
- **WHEN** o Gestor usa o botão Imprimir
- **THEN** a caixa de impressão é aberta sem marcar os produtos como revisados

### Requirement: Identidade visual responsiva
O sistema SHALL seguir a hierarquia visual das referências aprovadas, com área clara, cards compactos, tabela gerencial e painel no desktop, cores semânticas discretas e experiências próprias em cards/telas no mobile.

#### Scenario: Viewports suportados
- **WHEN** as telas são usadas em 320, 375, 390, 412, 768 e 1280 px ou mais
- **THEN** navegação, filtros, badges, inputs, tabela ou cards e painéis permanecem utilizáveis sem overflow horizontal indesejado
