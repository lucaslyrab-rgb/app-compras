---
prd_number: "001"
status: rascunho
priority: crítica
created: 2026-09-19
issue: ""
depends_on: []
references: ["../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md", "../trd.md"]
---

# PRD 001: Fundação, acesso e isolamento

## 1. Contexto

- **Produto/área:** plataforma MultiShow FLV.
- **Estado atual:** protótipo troca o papel em um seletor e guarda tudo no navegador.
- **Problema:** não existe identidade, isolamento entre lojas nem persistência compartilhada.

## 2. Solução Proposta

### Visão de produto

- Login individual com papel Loja, Comprador ou Gestor.
- Loja vinculada a uma única unidade; Comprador e Gestor têm visões autorizadas.
- Sessão persiste com segurança e encerra de modo previsível.
- Eventos relevantes guardam autor e data/hora.

### Decisões de produto

1. Não haverá auto cadastro; contas são provisionadas pelo Gestor *(premissa — confirme ou corrija)*.
2. Um usuário Loja pertence a exatamente uma loja *(premissa — confirme ou corrija)*.

### Fora do escopo

- Login social, SSO e permissões personalizadas por usuário.
- Recuperação autônoma por e-mail no primeiro release *(premissa — confirme ou corrija)*.

## 3. Funcionalidades

### US01: Autenticar

Como usuário, quero entrar com credenciais, para acessar meu trabalho.

**Rules:** credencial inválida não revela qual campo falhou; conta inativa não entra.
**Edge cases:** tentativas repetidas → bloqueio temporário e mensagem acionável *(premissa)*.

### US02: Isolar por papel e loja

Como Gestor, quero garantir que cada papel veja apenas o permitido, para proteger dados operacionais.

**Rules:** Loja acessa somente o `store_id` vinculado; autorização ocorre no servidor.
**Edge cases:** URL de outra loja → acesso negado, sem exposição do registro.

### US03: Administrar contas

Como Gestor, quero criar, inativar e redefinir acesso, para manter a operação.

**Rules:** inativação preserva histórico; ações administrativas são auditadas.
**Edge cases:** último Gestor ativo → inativação impedida *(premissa)*.

## 4. Fluxo de Negócio

`Credenciais → conta ativa? → papel/vínculo → área autorizada; caso contrário → negar e orientar.`

## 5. Critérios de Aceite

### 5a. Critérios da feature

| Critério | Razão | Verificação |
|---|---|---|
| Loja não lê/escreve outra loja | confidencialidade | testes de integração por papel e acesso direto a URL/API |
| Sessão inválida volta ao login | previsibilidade | expirar/revogar sessão e repetir ação |
| Inativação preserva autoria histórica | auditoria | consultar evento anterior após inativação |

### 5b. Métricas de sucesso

| Métrica | Baseline | Meta |
|---|---:|---:|
| acessos indevidos em testes | não testável | 0 |
| usuários compartilhando seletor de papel | 100% no protótipo | 0% |

## 6. Milestones

### Milestone 1: Acesso isolado

**Por que é um marco:** torna o sistema apto a dados reais.
**Funcionalidades:** US01, US02, US03
**Checklist:** [ ] login; [ ] matriz RBAC; [ ] isolamento; [ ] auditoria.
**Aprovador:** Gestor.

## 7. Riscos e Dependências

| Risco | Impacto | Mitigação | Status |
|---|---|---|---|
| conta inicial mal protegida | Alto | bootstrap único e troca obrigatória *(premissa)* | Pendente |

**Dependências:** nenhuma feature de produto; depende da fundação técnica no TRD.

## 8. Referências

- [Especificação consolidada](../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md)
- [TRD](../trd.md)

## 9. Registro de Decisões

- **2026-09-19:** isolamento é regra de servidor; UI não constitui controle de acesso.
