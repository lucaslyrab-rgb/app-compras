# Spec Delta

## Purpose

Fornecer ao Gestor uma área gerencial responsiva para analisar preços unitários, reconhecer pendências, registrar revisões explícitas e imprimir alterações.

## ADDED Requirements

### Requirement: Lista gerencial de precificação
O sistema SHALL apresentar produtos ativos com indicadores reais, busca por produto, ERP ou formato e filtros Todos, Custos alterados, Sem compra recente, Não revisados e Revisados.

#### Scenario: Tabela desktop
- **WHEN** o Gestor acessa a Precificação em viewport desktop
- **THEN** o sistema apresenta tabela com ERP, produto, formatos e unidades, custo oficial, custos unitários, preços calculado, sugerido e aplicado quando confirmado, status, revisão e ações

#### Scenario: Cards mobile
- **WHEN** o Gestor acessa entre 320 e 412 px
- **THEN** o sistema apresenta cards sem scroll horizontal que priorizam produto, ERP, status, compra, conversão, perda, custos e preços, com ação para análise dedicada

#### Scenario: Nome longo e valor monetário
- **WHEN** um produto possui nome longo ou valores mais extensos
- **THEN** o conteúdo quebra de forma controlada sem encobrir ações ou criar overflow horizontal

### Requirement: Detalhe explicável da precificação
O sistema SHALL apresentar em conjunto os dados de origem e cada etapa do cálculo, distinguindo preço calculado, sugerido e aplicado sem rotular qualquer valor como preço atual do ERP.

#### Scenario: Análise completa
- **WHEN** o Gestor abre um produto com custo oficial e configuração válida
- **THEN** o detalhe mostra formato, unidade, conversão, perda, margem aplicada, custo original e sua natureza, ciclo/data, custo bruto, custo efetivo, custo operacional, preço calculado e preço sugerido

#### Scenario: Detalhe mobile
- **WHEN** o produto é aberto no mobile
- **THEN** a análise usa tela dedicada e a simulação pode ser expandida sem comprimir uma tabela desktop

### Requirement: Estado de revisão derivado das entradas
O sistema SHALL preservar um fingerprint técnico das entradas para auditoria e concorrência e SHALL derivar separadamente `costChanged`, `parametersChanged` e `reviewPending`. Em bases equivalentes, mudança de custo SHALL depender de comparação econômica exata; mudança de id, versão ou ciclo MUST NOT ser usada como evidência semântica de alteração.

#### Scenario: Primeiro custo oficial
- **WHEN** existe o primeiro custo oficial calculável de um produto, sem custo anterior e sem revisão explícita
- **THEN** `costChanged` e `reviewPending` são verdadeiros, o produto recebe Custo alterado e entra para revisão

#### Scenario: Custo oficial mudou
- **WHEN** os custos oficiais atual e imediatamente anterior podem ser normalizados para a mesma base e os valores exatos diferem
- **THEN** o produto recebe badge Custo alterado e aparece no respectivo filtro

#### Scenario: Novo registro com o mesmo custo normalizado
- **WHEN** id, versão ou ciclo do custo oficial muda, mas os custos atual e imediatamente anterior são economicamente iguais na mesma base
- **THEN** o produto não recebe uma nova pendência nem o estado Custo alterado apenas pela identidade técnica

#### Scenario: Nova mudança após revisão
- **WHEN** um custo oficial economicamente diferente sucede o custo confirmado na última revisão
- **THEN** `costChanged` e `reviewPending` voltam a ser verdadeiros e uma nova revisão é exigida

#### Scenario: Outro parâmetro relevante mudou
- **WHEN** natureza unitária do custo, unidade de venda, conversão, perda, margem específica, custo operacional ou margem global aplicável muda após a revisão
- **THEN** a revisão deixa de ser atual e o produto recebe o estado Parâmetros alterados

#### Scenario: Bases sem equivalência demonstrável
- **WHEN** a natureza unitária ou outra base difere e os dados históricos não permitem reconstruir uma normalização equivalente com segurança
- **THEN** `parametersChanged` é verdadeiro e o produto recebe Parâmetros alterados sem inventar equivalência econômica

#### Scenario: Valor e base mudaram juntos
- **WHEN** o valor nominal do custo oficial muda e a base também muda sem equivalência histórica demonstrável
- **THEN** `costChanged`, `parametersChanged` e `reviewPending` permanecem verdadeiros, o produto aparece no fluxo de Custos alterados e a interface também informa Parâmetros alterados

#### Scenario: Rascunho de custo mudou
- **WHEN** somente um custo não comprado muda
- **THEN** o estado da revisão e o preço oficial não mudam

### Requirement: Revisão explícita e auditável
O sistema SHALL criar uma revisão somente por ação explícita do Gestor e SHALL registrar usuário, data, custo oficial analisado, natureza do custo, conversão, perda, percentuais, custos derivados, preço matemático, preço sugerido e preço aplicado confirmado.

#### Scenario: Confirmar revisão
- **WHEN** o Gestor confirma a revisão de um produto calculável usando a versão atual e aceita o sugerido ou informa outro preço de venda positivo com até duas casas
- **THEN** o sistema grava um snapshot imutável com o preço aplicado, registra o autor e identifica o produto como Revisado

#### Scenario: Preço aplicado manual
- **WHEN** o preço sugerido é R$ 6,99 e o Gestor confirma R$ 6,49
- **THEN** a revisão preserva R$ 6,99 como sugerido e R$ 6,49 como aplicado, sem substituir o preço calculado

#### Scenario: Entradas mudaram antes da confirmação
- **WHEN** custo ou parâmetros mudam entre a abertura e a ação de revisar
- **THEN** o sistema rejeita o snapshot obsoleto e solicita nova análise

#### Scenario: Apenas abrir ou imprimir
- **WHEN** o Gestor abre o detalhe ou o relatório de impressão
- **THEN** nenhuma revisão é criada

### Requirement: Impressão de alterações
O sistema SHALL oferecer relatório autenticado em nova aba somente com produtos cuja revisão atual foi confirmada, contendo ERP, produto, unidade, custo efetivo, preço calculado, preço sugerido e preço aplicado da revisão. Produtos pendentes MUST NOT ser impressos.

#### Scenario: Abrir relatório
- **WHEN** o Gestor aciona “Imprimir alterações”
- **THEN** o sistema abre uma página preparada para impressão com somente revisões atuais confirmadas, destaca o preço aplicado, oferece botão Imprimir e não dispara impressão automaticamente

#### Scenario: Imprimir relatório
- **WHEN** o Gestor usa o botão Imprimir
- **THEN** a caixa de impressão é aberta sem marcar os produtos como revisados

### Requirement: Identidade visual responsiva
O sistema SHALL seguir a hierarquia visual das referências aprovadas, com área clara, cards compactos, tabela gerencial e painel no desktop, cores semânticas discretas e experiências próprias em cards/telas no mobile.

#### Scenario: Viewports suportados
- **WHEN** as telas são usadas em 320, 375, 390, 412, 768 e 1280 px ou mais
- **THEN** navegação, filtros, badges, inputs, tabela ou cards e painéis permanecem utilizáveis sem overflow horizontal indesejado
