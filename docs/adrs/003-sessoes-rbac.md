---
adr_number: "003"
status: proposto
created: 2026-09-19
supersedes: ""
superseded_by: ""
---

# ADR 003: Sessões server-side e RBAC com vínculo de loja

## Contexto

O seletor de papel do protótipo não autentica. O acesso Loja precisa ser restringido inclusive em chamadas diretas, e sessões devem poder ser revogadas.

## Alternativas Consideradas

- **Sessões opacas no banco + cookie:** revogação simples e bom ajuste ao monólito; consulta de sessão.
- **JWT stateless:** reduz consulta, mas revogação e mudança de papel complicam.
- **IdP externo:** recursos completos, porém dependência/custo operacional adicional.

## Decisão

Propor credenciais locais com senha forte, sessão opaca server-side em cookie `HttpOnly`, `Secure` e `SameSite=Lax`, expiração e RBAC (`LOJA`, `COMPRADOR`, `GESTOR`). Toda query de Loja recebe o vínculo de unidade do principal autenticado.

## Consequências

- **Positivas:** revogação e autorização centralizadas.
- **Negativas:** administração segura de contas e política de senha tornam-se responsabilidades do sistema.
- **Trade-offs:** SSO poderá substituir autenticação em ADR posterior sem mudar o modelo de papéis.
