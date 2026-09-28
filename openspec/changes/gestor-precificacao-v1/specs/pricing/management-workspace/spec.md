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
O sistema SHALL preservar um fingerprint técnico das entradas para auditoria e concorrência e SHALL derivar separadamente `costChanged`, `parametersChanged` e `reviewPending`. Em bases equivalentes, mudança de custo SHALL depender de comparação econômica exata posterior ao watermark da última revisão; mudança de id, versão, ciclo ou fingerprint MUST NOT ser usada como evidência semântica de alteração.

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

#### Scenario: Pendência atravessa ciclos iguais
- **WHEN** ocorreu uma mudança econômica ainda não revisada e um ou mais custos oficiais posteriores permanecem economicamente iguais
- **THEN** o produto continua em Custo alterado até uma revisão cobrir o estado oficial atual

#### Scenario: Múltiplas mudanças antes da revisão
- **WHEN** várias transições econômicas, inclusive retorno a um valor anterior, ocorrem depois do watermark e o histórico confiável as preserva
- **THEN** o produto mantém uma única pendência de Custo alterado

#### Scenario: Revisão como watermark
- **WHEN** o Gestor revisa o estado oficial atual
- **THEN** as mudanças econômicas até esse custo ficam cobertas e somente transições posteriores podem gerar nova pendência

#### Scenario: Base histórica não reconstruível
- **WHEN** uma transição posterior ao watermark possui bases incompatíveis ou metadata insuficiente para demonstrar equivalência
- **THEN** o produto é tratado conservadoramente como Parâmetros alterados sem inventar mudança econômica

#### Scenario: Ausência de custo oficial anterior
- **WHEN** existe custo oficial atual, mas nenhum custo oficial anterior reconstruível
- **THEN** o produto é identificado como Não revisado e não como Custo alterado

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
O sistema SHALL criar uma revisão somente por ação explícita do Gestor e SHALL registrar usuário, data, custo oficial analisado, natureza do custo, conversão, perda, percentuais, custos derivados, preço matemático, preço sugerido, preço aplicado, preço decidido e origem da decisão.

#### Scenario: Confirmar revisão
- **WHEN** o Gestor confirma a revisão de um produto calculável usando a versão atual e aceita o sugerido ou informa outro preço de venda positivo com até duas casas
- **THEN** o sistema grava um snapshot imutável com o preço aplicado, registra o autor e identifica o produto como Revisado

#### Scenario: Preço aplicado manual
- **WHEN** o preço sugerido é R$ 6,99 e o Gestor confirma R$ 6,49
- **THEN** a revisão preserva R$ 6,99 como sugerido e R$ 6,49 como aplicado, sem substituir o preço calculado

#### Scenario: Decisão sem pendência
- **WHEN** o Gestor altera ou aceita o preço de um produto sem Custo alterado ou Parâmetros alterados, inclusive já Revisado
- **THEN** o sistema permite a ação, registra uma nova revisão e não cria artificialmente Custo alterado

#### Scenario: Compatibilidade de revisão histórica
- **WHEN** uma revisão anterior não possui preço decidido nem origem
- **THEN** o sistema mantém o snapshot válido, mas não promove o preço sugerido a decisão explícita nem inclui a revisão no relatório

#### Scenario: Entradas mudaram antes da confirmação
- **WHEN** custo ou parâmetros mudam entre a abertura e a ação de revisar
- **THEN** o sistema rejeita o snapshot obsoleto e solicita nova análise

#### Scenario: Apenas abrir ou imprimir
- **WHEN** o Gestor abre o detalhe ou o relatório de impressão
- **THEN** nenhuma revisão é criada

### Requirement: Impressão de alterações
O sistema SHALL oferecer relatório autenticado em nova aba somente para produtos cuja mudança econômica real de custo ocorreu no ciclo oficial de referência atual e já foi coberta por revisão com decisão comercial explícita, contendo ERP, produto, unidade, custo efetivo, preço calculado, preço sugerido, preço decidido e espaço para anotação.

#### Scenario: Abrir relatório
- **WHEN** o Gestor aciona “Imprimir alterações de preço”
- **THEN** o sistema abre uma página preparada para impressão, identifica o ciclo de referência, lista somente as mudanças de custo da rodada já revisadas, destaca o preço decidido, oferece botão Imprimir e não dispara impressão automaticamente

#### Scenario: Imprimir relatório
- **WHEN** o Gestor usa o botão Imprimir
- **THEN** a caixa de impressão é aberta sem marcar os produtos como revisados

#### Scenario: Imprimir decisão recém-criada
- **WHEN** o Gestor abre o relatório pelos IDs das revisões recém-criadas
- **THEN** o relatório restringe as mudanças qualificadas da rodada aos IDs informados e usa o preço decidido como valor principal a aplicar

#### Scenario: Excluir pendência e revisão legada
- **WHEN** um produto está pendente ou sua revisão não possui `decided_price` nem `applied_price`
- **THEN** o produto não aparece no relatório e `suggested_price` não é interpretado como decisão

#### Scenario: Excluir custo igual e rodada anterior
- **WHEN** o custo permaneceu economicamente igual no ciclo atual ou a decisão cobre uma mudança de ciclo anterior
- **THEN** o produto não aparece no relatório da rodada atual, ainda que esteja Revisado

#### Scenario: Avançar o ciclo de referência
- **WHEN** um novo ciclo oficial passa a ser a referência sem nova mudança econômica de custo
- **THEN** as alterações confirmadas do ciclo anterior não são carregadas para o novo relatório

#### Scenario: Preço manual no relatório
- **WHEN** a revisão atual preserva preço sugerido R$ 10,49 e preço decidido manual R$ 9,99
- **THEN** o relatório mostra R$ 9,99 como preço principal e mantém sugerido e decidido distinguíveis

### Requirement: Identidade visual responsiva
O sistema SHALL seguir a hierarquia visual das referências aprovadas, com área clara, cards compactos, tabela gerencial e painel no desktop, cores semânticas discretas e experiências próprias em cards/telas no mobile.

#### Scenario: Viewports suportados
- **WHEN** as telas são usadas em 320, 375, 390, 412, 768 e 1280 px ou mais
- **THEN** navegação, filtros, badges, inputs, tabela ou cards e painéis permanecem utilizáveis sem overflow horizontal indesejado

#### Scenario: Painel de decisão no desktop
- **WHEN** o Gestor percorre uma lista longa de produtos em viewport desktop
- **THEN** o painel lateral permanece visível, limitado à viewport e com rolagem interna quando necessária, sem alterar o fluxo responsivo mobile
