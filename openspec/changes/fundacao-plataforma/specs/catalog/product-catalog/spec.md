# Spec Delta

## Purpose

Fornecer um catálogo único, validado e historicamente seguro para todos os fluxos operacionais do produto.

## ADDED Requirements

### Requirement: Importação inicial idempotente
O sistema SHALL importar a base oficial sem duplicar produtos em execuções repetidas e MUST validar código, nome, unidade, formato de compra, markup e exclusividade.

#### Scenario: Base oficial válida
- **WHEN** a importação recebe a planilha-base fornecida
- **THEN** o resultado contém 74 produtos e 21 produtos exclusivos

#### Scenario: Importação repetida
- **WHEN** a mesma base é importada novamente
- **THEN** nenhum produto é duplicado e o relatório informa o resultado

### Requirement: Inativação preserva histórico
O sistema MUST impedir exclusão física de produto referenciado e SHALL permitir ativação/inativação somente ao Gestor.

#### Scenario: Produto histórico é inativado
- **WHEN** o Gestor inativa um produto presente em pedido antigo
- **THEN** o produto deixa novas seleções, mas continua legível no histórico

### Requirement: Unidade e compra independentes
O sistema MUST guardar e exibir unidade operacional e formato de compra sem realizar conversão automática.

#### Scenario: Produto em KG comprado em CX
- **WHEN** um produto possui unidade KG e formato de compra CX
- **THEN** ambos são exibidos conforme o contexto e nenhuma conversão é calculada
