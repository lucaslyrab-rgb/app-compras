# Spec Delta

## Purpose

Permitir que cada loja registre, envie e confira seus pedidos diários em um fluxo móvel, persistente e auditável, sem expor dados de outras unidades.

## ADDED Requirements

### Requirement: Lançamento móvel do pedido

O sistema SHALL exibir os produtos ativos em cards responsivos, permitindo informar estoque e quantidade pedida com valores numéricos não negativos.

#### Scenario: Preencher pedido em viewport móvel

- **WHEN** uma Loja acessa o pedido em viewport de 360 px e informa estoque e quantidade
- **THEN** os cards permanecem sem overflow horizontal e o item preenchido recebe indicação visual

#### Scenario: Valor inválido

- **WHEN** a Loja informa valor negativo ou não numérico
- **THEN** o sistema rejeita o valor e informa o erro sem persistir o item inválido

### Requirement: Rascunho persistente e versionado

O sistema SHALL salvar um rascunho por loja e data, permitir recuperá-lo após recarga e rejeitar gravação baseada em uma versão desatualizada.

#### Scenario: Recuperar rascunho

- **WHEN** a Loja salva parcialmente o pedido e recarrega a página
- **THEN** o sistema restaura os valores salvos e a versão correspondente

#### Scenario: Conflito de versão

- **WHEN** uma sessão tenta salvar usando versão anterior à já persistida
- **THEN** o sistema rejeita a gravação, preserva o rascunho existente e informa que outra sessão atualizou os dados

### Requirement: Envio e histórico isolados

O sistema SHALL criar uma revisão imutável ao enviar o pedido, registrar autor/data e permitir à Loja consultar somente o histórico da própria unidade.

#### Scenario: Primeiro envio

- **WHEN** a Loja envia um rascunho válido
- **THEN** o sistema cria revisão 1, registra autor e horário e informa confirmação

#### Scenario: Reenvio no mesmo dia

- **WHEN** a Loja envia novamente o mesmo dia
- **THEN** o sistema cria nova revisão sem sobrescrever a anterior

#### Scenario: Acesso cruzado

- **WHEN** uma Loja tenta consultar pedido de outra unidade
- **THEN** o sistema nega o acesso sem revelar os dados do pedido

### Requirement: Conferência de recebimento

O sistema SHALL oferecer relatório imprimível em formato A4 contendo somente itens com quantidade pedida maior que zero, código ERP, nome, unidade, quantidade e campos de recebimento.

#### Scenario: Gerar conferência

- **WHEN** a Loja abre a conferência de um pedido enviado
- **THEN** o relatório exibe os itens pedidos e campos em branco para data de recebimento e responsável

#### Scenario: Pedido sem itens

- **WHEN** a Loja tenta gerar conferência de pedido sem quantidade positiva
- **THEN** o sistema bloqueia a impressão e informa que não há itens para conferir
