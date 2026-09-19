# Spec Delta

## Purpose

Assegurar que cada versão aprovada seja construída, publicada, implantada, observada e revertida de forma reproduzível.

## ADDED Requirements

### Requirement: Build verificável e imutável
O pipeline MUST executar verificações antes de publicar e SHALL identificar a imagem pelo commit de origem.

#### Scenario: Verificação falha
- **WHEN** lint, tipos, testes ou build falha
- **THEN** nenhuma imagem de produção é publicada e nenhum webhook é chamado

#### Scenario: Verificação aprovada
- **WHEN** todas as verificações aprovam na branch de entrega
- **THEN** o GHCR recebe imagem identificada pelo SHA e metadados de origem

### Requirement: Deploy sem segredo no repositório
O sistema MUST manter credenciais de registry, banco e webhook fora do Git, da imagem e dos logs.

#### Scenario: Pipeline solicita atualização
- **WHEN** a imagem aprovada está disponível
- **THEN** o pipeline chama o webhook a partir de secret protegido sem imprimir seu valor

### Requirement: Saúde e rollback
A stack SHALL expor healthcheck e MUST permitir reimplantar a referência imutável anterior sem perda de dados compatíveis.

#### Scenario: Nova versão não fica saudável
- **WHEN** o serviço falha no healthcheck durante atualização
- **THEN** a operação consegue restaurar a imagem anterior conforme runbook

### Requirement: Backup restaurável
O banco MUST possuir backup periódico fora do volume principal e a restauração MUST ser testada antes do go-live.

#### Scenario: Ensaio de restauração
- **WHEN** o operador executa o runbook em ambiente isolado
- **THEN** schema e dados de amostra são recuperados e a evidência é registrada
