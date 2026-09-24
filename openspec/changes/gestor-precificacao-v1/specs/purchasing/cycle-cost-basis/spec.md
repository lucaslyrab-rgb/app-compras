# Spec Delta

## Purpose

Preservar em cada custo de produto e ciclo se o valor informado já representa a unidade de venda ou ainda representa o formato de compra.

## ADDED Requirements

### Requirement: Natureza unitária do custo por ciclo
O sistema SHALL persistir `cost_is_unit` junto ao valor original de custo, produto e ciclo, com valor padrão falso para registros existentes e novos custos ainda não informados.

#### Scenario: Custo por formato de compra
- **WHEN** o Comprador salva um custo com “Custo informado é unitário” desmarcado
- **THEN** o sistema preserva o valor original e registra `cost_is_unit=false` naquele produto e ciclo

#### Scenario: Custo já unitário
- **WHEN** o Comprador salva um custo com “Custo informado é unitário” marcado
- **THEN** o sistema preserva o valor original e registra `cost_is_unit=true` naquele produto e ciclo

#### Scenario: Ciclo novo sem registro próprio
- **WHEN** um produto ainda não possui linha de custo no ciclo selecionado
- **THEN** o controle unitário é apresentado desmarcado até que o usuário o altere

### Requirement: Autosave atômico e versionado
O sistema SHALL salvar valor, comprado e natureza unitária como um único estado versionado, usando a concorrência otimista e os feedbacks já existentes.

#### Scenario: Alteração somente do checkbox unitário
- **WHEN** o usuário marca ou desmarca “Custo informado é unitário”
- **THEN** o autosave persiste a alteração, incrementa a versão e mantém o estado após reload

#### Scenario: Conflito concorrente
- **WHEN** uma sessão tenta salvar custo ou natureza unitária com versão desatualizada
- **THEN** o sistema preserva o registro mais recente e segue o tratamento de conflito homologado do módulo

#### Scenario: Correção de custo comprado
- **WHEN** o usuário corrige o valor ou sua natureza após o produto estar comprado
- **THEN** o sistema atualiza a mesma linha versionada e preserva as regras atuais de custo oficial e `purchased_at`

### Requirement: Compatibilidade do Lançamento de Custos
O sistema MUST preservar seleção Comprado, custo anterior e atual, autosave, filtros, busca, ciclos históricos, destaque Alterado, ausência versus zero, P/B/S e comportamento desktop/mobile.

#### Scenario: Uso normal sem marcar custo unitário
- **WHEN** o usuário executa um fluxo já homologado e deixa o novo checkbox desmarcado
- **THEN** o comportamento observável anterior permanece igual e o custo é tratado como custo do formato de compra apenas pela Precificação

#### Scenario: Erro de gravação
- **WHEN** a persistência do checkbox ou do custo falha
- **THEN** o sistema mantém feedback de erro claramente visível sem afirmar que salvou

### Requirement: Separação entre custo original e custo derivado
O sistema MUST NOT substituir o custo persistido pelo resultado da conversão unitária.

#### Scenario: Caixa de cem reais
- **WHEN** é salvo R$ 100,00 por CX com `cost_is_unit=false` e conversão 20 KG
- **THEN** o registro do ciclo continua armazenando R$ 100,00 e a Precificação deriva R$ 5,00 por KG
