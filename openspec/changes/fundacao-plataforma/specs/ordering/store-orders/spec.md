# Spec Delta

## Purpose

Permitir que cada loja prepare, envie e consulte pedidos diários pelo celular com histórico persistente e sem acesso cruzado.

## ADDED Requirements

### Requirement: Pedido móvel sem overflow
O sistema SHALL apresentar produtos em cards verticais em viewport móvel, com busca, filtros Todos/Sem pedido/Com pedido e campos grandes de estoque e pedido.

#### Scenario: Uso em 360 pixels
- **WHEN** a Loja usa a tela de pedido em viewport de 360 pixels e zoom 100%
- **THEN** todas as ações permanecem acessíveis sem rolagem horizontal

### Requirement: Rascunho recuperável
O sistema SHALL persistir o rascunho da Loja e MUST distinguir visualmente rascunho de pedido enviado.

#### Scenario: Recarga antes do envio
- **WHEN** a Loja recarrega a página após preencher itens e antes de enviar
- **THEN** o rascunho reaparece com os mesmos valores

### Requirement: Envio versionado
O sistema MUST registrar loja, autor e data/hora de cada envio e SHALL preservar versões anteriores.

#### Scenario: Pedido enviado
- **WHEN** a Loja confirma Salvar Pedido
- **THEN** o sistema cria uma versão histórica e confirma o envio

#### Scenario: Loja consulta histórico
- **WHEN** a Loja abre seu histórico
- **THEN** visualiza somente pedidos da própria unidade

### Requirement: Relatório de conferência
O sistema SHALL gerar relatório A4 somente com itens de pedido maior que zero e os campos determinados na especificação.

#### Scenario: Conferência impressa
- **WHEN** a Loja imprime um pedido enviado
- **THEN** o documento contém código ERP, produto, unidade, quantidade e campos de recebimento/responsável
