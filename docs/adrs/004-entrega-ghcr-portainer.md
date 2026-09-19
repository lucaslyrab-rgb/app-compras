---
adr_number: "004"
status: aceito
created: 2026-09-19
supersedes: ""
superseded_by: ""
---

# ADR 004: Entrega por GHCR, stack Git e webhook Portainer

## Contexto

O usuário determinou Docker Swarm/Portainer, imagem no GHCR e atualização automatizada por GitHub Actions. O deploy precisa evitar credenciais Docker no runner e versões ambíguas.

## Alternativas Consideradas

- **Webhook de GitOps do Portainer:** atende o requisito e mantém a stack Git como fonte de verdade.
- **SSH no manager:** flexível, mas amplia credencial e acopla pipeline ao host.
- **Watchtower:** observa imagens, porém não aplica mudanças da stack Git e reduz controle.

## Decisão

GitHub Actions testa, constrói e publica imagem no GHCR com `GITHUB_TOKEN`, atualiza uma referência imutável na stack quando aplicável e chama o webhook guardado em `PORTAINER_WEBHOOK_URL`. Portainer usa credencial exclusiva `read:packages` para puxar imagem privada.

## Consequências

- **Positivas:** runner não acessa Docker/SSH do servidor; Git preserva configuração.
- **Negativas:** URL do webhook é uma credencial de deploy e precisa de rotação.
- **Trade-offs:** tag de ambiente pode disparar atualização, mas rollback deve apontar para SHA/digest anterior.
