# Spec Delta

## Purpose

Disponibilizar uma navegação operacional responsiva que revele somente as áreas permitidas a cada papel e reforce a mesma autorização no servidor.

## ADDED Requirements

### Requirement: Navegação por papel
O sistema SHALL derivar a navegação do principal autenticado e SHALL limitar toda leitura e mutação no servidor independentemente da visibilidade do menu.

#### Scenario: Gestor autenticado
- **WHEN** um GESTOR acessa a área operacional
- **THEN** ele pode acessar Consolidado, Lançamento de Custos, Produtos, Precificação e Configurações de precificação

#### Scenario: Comprador autenticado
- **WHEN** um COMPRADOR acessa a área operacional
- **THEN** ele visualiza e acessa as funções de Comprador, mas não visualiza nem altera funções exclusivas do Gestor

#### Scenario: Loja autenticada
- **WHEN** uma LOJA tenta acessar diretamente Produtos, Precificação, Configurações ou actions do Gestor
- **THEN** o servidor nega o acesso sem revelar ou modificar os dados gerenciais

#### Scenario: URL ou action manipulada
- **WHEN** um usuário sem permissão envia diretamente uma URL ou requisição de mutação oculta na interface
- **THEN** a autorização server-side rejeita a operação

### Requirement: Sidebar desktop e drawer mobile
O sistema SHALL apresentar sidebar verde escura permanente em desktop e drawer acionado por hamburger no mobile, mantendo hierarquia, item atual e ações de saída.

#### Scenario: Desktop operacional
- **WHEN** o viewport comporta a navegação lateral
- **THEN** a sidebar permanece à esquerda e o conteúdo utiliza o restante da largura sem encobrir controles

#### Scenario: Mobile operacional
- **WHEN** o viewport não comporta a sidebar
- **THEN** a navegação vira drawer fechável, com alvos de toque adequados e sem reservar largura permanente

#### Scenario: Identidade do item atual
- **WHEN** o usuário navega para uma função disponível
- **THEN** o item correspondente é destacado e as seções mantêm hierarquia legível

### Requirement: Preservação da experiência da Loja
O sistema MUST NOT aplicar o novo shell gerencial ao fluxo homologado de pedido da LOJA.

#### Scenario: Loja abre sua operação
- **WHEN** uma LOJA entra no sistema
- **THEN** o workspace móvel, isolamento por loja e navegação homologada permanecem inalterados
