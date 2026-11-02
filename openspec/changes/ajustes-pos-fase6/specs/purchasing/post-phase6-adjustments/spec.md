# Spec Delta

## Purpose

Ajustes operacionais pós-Fase 6 em perdas, navegação da loja, conferência e Fechamento integrado.

## ADDED Requirements

### Requirement: Exclusão de perda pelo Gestor
Um principal com `perdas:excluir` SHALL poder excluir qualquer lançamento de perda informando motivo; a exclusão MUST NOT apagar o registro e SHALL ser auditada.

#### Scenario: Exclusão com motivo
- **WHEN** o Gestor excluir um lançamento informando "lançamento duplicado"
- **THEN** o lançamento SHALL sair dos totais da consulta e SHALL guardar quem excluiu, quando e o motivo

#### Scenario: Comprador sem a permissão
- **WHEN** um Comprador sem `perdas:excluir` abrir a Consulta de Perdas
- **THEN** a coluna de ações MUST NOT ser exibida e a action SHALL negar a exclusão

### Requirement: Bloqueio de perdas duplicadas
O sistema SHALL recusar um lançamento de perda idêntico a outro da mesma loja feito há até 120 segundos, salvo confirmação explícita da loja.

#### Scenario: Toque duplo
- **WHEN** dois envios idênticos chegarem ao mesmo tempo
- **THEN** somente um SHALL ser gravado e o outro SHALL receber o aviso de duplicidade

#### Scenario: Outra perda igual
- **WHEN** a loja confirmar "É outra perda: registrar mesmo assim"
- **THEN** o lançamento SHALL ser gravado

### Requirement: Navegação da loja pelo botão Módulos
As telas da loja MUST NOT exibir atalhos de módulos no topo e SHALL exibir um indicador não clicável da tela atual.

#### Scenario: Tela de conferência
- **WHEN** a loja estiver na conferência
- **THEN** o topo SHALL mostrar "Conferência de Entrega" e a troca de tela SHALL ocorrer pelo botão Módulos

### Requirement: Item recebido fora do pedido
Na conferência em andamento, a loja SHALL poder lançar um produto recebido que não consta na conferência, com peso maior que zero; o item SHALL registrar quem lançou e quando.

#### Scenario: Maçã não pedida
- **WHEN** a loja lançar Maçã Gala com 36 kg como recebida fora do pedido
- **THEN** o item SHALL entrar na conferência com quantidade pedida 0 e marcação "Recebido fora do pedido"

#### Scenario: Produto já na conferência
- **WHEN** a loja tentar lançar fora do pedido um produto já presente
- **THEN** o sistema SHALL recusar e orientar a pesar o item existente

#### Scenario: Lançado por engano
- **WHEN** a loja retirar um item lançado fora do pedido
- **THEN** o item SHALL sair da conferência e permanecer no histórico

### Requirement: Responsabilização no Fechamento integrado
O Fechamento SHALL exibir quem destinou cada item, as perdas do produto na loja do dia do ciclo até 3 dias depois e o destaque "Recebido fora do pedido".

#### Scenario: Enviado sem pedido e perdido
- **WHEN** a loja não pediu, o comprador destinou, a loja lançou o recebimento e depois registrou perda do produto
- **THEN** a linha SHALL mostrar situação Adicional, quem destinou, o peso recebido e o total de perdas
