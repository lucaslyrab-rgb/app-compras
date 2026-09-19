---
adr_number: "002"
status: proposto
created: 2026-09-19
supersedes: ""
superseded_by: ""
---

# ADR 002: PostgreSQL suportado e isolado logicamente

## Contexto

O host possui PostgreSQL 14 compartilhado, cuja manutenção comunitária termina em 12/11/2026. O produto exige transações, histórico e integridade. Compartilhar ciclo de vida e credenciais amplia o blast radius.

## Alternativas Consideradas

- **Reusar PostgreSQL 14:** menor esforço imediato, mas dívida urgente e risco compartilhado.
- **Banco PostgreSQL 16 dedicado na stack:** suporte até 2028, isolamento operacional e consumo adicional.
- **Serviço gerenciado:** alta resiliência, mas custo e dependência externa não autorizados.

## Decisão

Propor PostgreSQL 16 na própria stack, com volume, usuário e database exclusivos. Upgrade futuro será planejado por backup/restore testado; não haverá migração silenciosa do serviço legado.

## Consequências

- **Positivas:** ciclo de atualização controlado e menor acoplamento.
- **Negativas:** mais um processo de banco no host de 4 GiB.
- **Trade-offs:** iniciar com limites de recurso e monitorar memória; consolidar só após upgrade seguro do cluster comum.
