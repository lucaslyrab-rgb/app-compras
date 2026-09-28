# Spec Delta

## Purpose

Definir os parâmetros persistidos e administráveis que convertem cada produto comprado em uma unidade vendável e controlam perda e margem na formação de preço.

## ADDED Requirements

### Requirement: Parâmetros de precificação por produto
O sistema SHALL manter para cada produto unidade de venda, quantidade de conversão positiva, origem da conversão, perda de beneficiamento entre 0% inclusive e 100% exclusivo, margem específica opcional, versão e timestamps.

#### Scenario: Produto com margem herdada
- **WHEN** a margem específica do produto for nula
- **THEN** o sistema usa a margem líquida padrão global na precificação

#### Scenario: Parâmetro inválido
- **WHEN** o Gestor tentar salvar conversão menor ou igual a zero, perda negativa ou perda maior ou igual a 100%
- **THEN** o sistema rejeita a alteração sem substituir os parâmetros persistidos

### Requirement: Carga inicial não destrutiva
O sistema SHALL inicializar parâmetros ausentes sem sobrescrever parâmetros já configurados nem dados existentes do catálogo.

#### Scenario: Caixa ou saco ainda não configurado
- **WHEN** um produto CX ou SC não possuir parâmetros
- **THEN** o sistema cria unidade de venda KG, conversão 20, perda 0, margem específica nula e origem PROVISIONAL

#### Scenario: Formato inicialmente unitário
- **WHEN** um produto UND, PCT ou BDJ não possuir parâmetros
- **THEN** o sistema cria unidade de venda UND, conversão 1, perda 0, margem específica nula e origem UNIT

#### Scenario: Importação repetida
- **WHEN** a carga de produtos for executada após um produto ter parâmetros manuais
- **THEN** o sistema preserva o cadastro mestre e os parâmetros manuais e inicializa somente produtos ausentes ou sem parâmetros, salvo modo administrativo explícito de bootstrap

### Requirement: Configurações globais do FLV
O sistema SHALL persistir uma configuração global versionada com custo operacional e margem líquida padrão, inicializados respectivamente em 23,00% e 20,00%, e SHALL exigir que ambos sejam não negativos e que sua soma seja menor que 100%.

#### Scenario: Atualização válida das configurações
- **WHEN** o Gestor salva percentuais válidos com a versão atual
- **THEN** o sistema persiste os novos valores, incrementa a versão e registra a alteração

#### Scenario: Denominador global inválido
- **WHEN** o Gestor informa percentuais cuja soma seja maior ou igual a 100%
- **THEN** o sistema rejeita a alteração e explica que a formação do preço ficaria impossível

### Requirement: Administração responsiva de produtos
O sistema SHALL oferecer ao Gestor uma tela de Produtos com indicadores derivados dos dados, busca por produto, ERP ou formato, filtros Todos, Conversão padrão, Unitários e Configurados, e edição dos parâmetros.

#### Scenario: Lista desktop
- **WHEN** o Gestor acessa a tela em viewport desktop
- **THEN** o sistema apresenta tabela gerencial e uma experiência de edição integrada com ERP, produto, formato, unidade de venda, conversão, perda, margem, status e ações

#### Scenario: Lista mobile
- **WHEN** o Gestor acessa a tela entre 320 e 412 px
- **THEN** o sistema apresenta cards sem scroll horizontal e abre a edição em uma tela adequada para toque

#### Scenario: Conversão provisória editada
- **WHEN** o Gestor salva manualmente a conversão de um produto PROVISIONAL
- **THEN** o sistema altera sua origem para MANUAL e o identifica como Configurado

#### Scenario: Conflito de edição
- **WHEN** o Gestor salva com uma versão anterior à persistida
- **THEN** o sistema rejeita a gravação, preserva o estado mais recente e informa o conflito

### Requirement: Cadastro mestre versionado
O sistema SHALL permitir ao Gestor criar e editar código ERP, nome, unidade do catálogo, formato de compra e exclusividade em conjunto com os parâmetros iniciais de precificação, usando versões independentes para produto e parâmetros.

#### Scenario: Novo produto
- **WHEN** o Gestor informa cadastro e parâmetros válidos com ERP positivo e único
- **THEN** produto ativo e parâmetros MANUAL são criados na mesma transação, sem custo oficial ou revisão automática, e PRODUCT_CREATED é auditado

#### Scenario: Alteração de formato
- **WHEN** o Gestor altera o formato de compra
- **THEN** o sistema exige confirmação explícita da conversão informada e não recalcula a quantidade silenciosamente

#### Scenario: Concorrência do cadastro
- **WHEN** produto ou parâmetros foram atualizados após a abertura do formulário
- **THEN** a transação inteira é rejeitada e o estado persistido mais recente é apresentado

### Requirement: Ciclo de vida sem exclusão
O sistema SHALL permitir filtrar ativos, inativos e todos, inativar e reativar sem exclusão física nem alteração de históricos.

#### Scenario: Produto presente em rascunho preenchido
- **WHEN** existe rascunho com estoque ou quantidade positiva para o produto
- **THEN** a inativação é bloqueada sem apagar ou modificar o rascunho

#### Scenario: Produto inativado
- **WHEN** o Gestor inativa um produto sem rascunho preenchido
- **THEN** novos fluxos deixam de oferecê-lo e pedidos, custos, revisões e snapshots existentes permanecem intactos

### Requirement: Busca e paginação do catálogo
O sistema SHALL aplicar catálogo completo, busca global, filtros e paginação nessa ordem, com vinte produtos por página.

#### Scenario: Busca fora da página atual
- **WHEN** o Gestor busca por nome, ERP ou formato
- **THEN** todos os produtos são considerados antes da paginação e a interface retorna à primeira página

### Requirement: Preparação de fotos
O sistema SHALL manter `photo_key` e `photo_updated_at` opcionais no produto sem inventar URL ou persistir arquivos no container nesta etapa.

#### Scenario: Cadastro sem foto
- **WHEN** um produto é criado ou editado nesta versão
- **THEN** os campos de foto podem permanecer nulos e nenhum upload é executado
