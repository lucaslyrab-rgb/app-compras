# Spec Delta

## Purpose

Garantir identidade autenticada, sessões revogáveis e acesso estritamente limitado pelo papel e pela loja vinculada.

## ADDED Requirements

### Requirement: Autenticação segura
O sistema SHALL autenticar apenas contas ativas e MUST responder a falhas sem revelar se usuário ou senha estava incorreto.

#### Scenario: Credencial válida
- **WHEN** uma conta ativa fornece credenciais válidas
- **THEN** o sistema cria sessão segura e direciona à área autorizada

#### Scenario: Credencial inválida
- **WHEN** qualquer parte da credencial é inválida
- **THEN** o sistema nega acesso com mensagem genérica e registra a tentativa sem guardar a senha

### Requirement: Isolamento de loja
O sistema MUST aplicar o vínculo de loja no servidor para toda leitura e alteração executada por papel Loja.

#### Scenario: Loja tenta acessar outra unidade
- **WHEN** um usuário Loja solicita recurso pertencente a outra loja
- **THEN** o sistema nega a operação sem expor o recurso

### Requirement: Matriz de papéis
O sistema SHALL conceder a Loja, Comprador e Gestor somente as capacidades definidas na especificação funcional.

#### Scenario: Comprador tenta administrar produto
- **WHEN** um Comprador tenta criar, editar, ativar ou inativar produto
- **THEN** o sistema nega a operação
