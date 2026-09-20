---
adr_number: "002"
status: aceito
created: 2026-09-19
supersedes: ""
superseded_by: ""
---

# ADR 002: PostgreSQL 18.6 compartilhado com isolamento lógico

## Contexto

O serviço compartilhado foi atualizado e verificado em execução como PostgreSQL 18.6. O produto exige transações, histórico e integridade, mantendo credenciais e database próprios para reduzir o blast radius lógico.

## Alternativas Consideradas

- **Reusar PostgreSQL 18.6 com database/role próprios:** aproveita serviço suportado e economiza memória, mas compartilha disponibilidade e manutenção.
- **Banco PostgreSQL dedicado na stack:** isolamento operacional maior, com consumo adicional no host de 4 GiB.
- **Serviço gerenciado:** alta resiliência, mas custo e dependência externa não autorizados.

## Decisão

Adotar PostgreSQL 18.6 compartilhado, com database, owner e credenciais exclusivos da aplicação. Migrações ficam sob controle do projeto; backup e restauração precisam incluir explicitamente esse database.

## Consequências

- **Positivas:** versão atual suportada, menor consumo de memória e operação centralizada.
- **Negativas:** indisponibilidade ou manutenção do serviço compartilhado afeta a aplicação.
- **Trade-offs:** isolamento é lógico, não de processo; permissões, backup e restore devem ser testados por database.
