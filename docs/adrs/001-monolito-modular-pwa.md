---
adr_number: "001"
status: proposto
created: 2026-09-19
supersedes: ""
superseded_by: ""
---

# ADR 001: Monólito modular PWA em Next.js

## Contexto

O produto tem vários módulos, mas baixa escala inicial e será operado por equipe pequena em Swarm single-node com 4 GiB. A UX móvel, formulários transacionais e relatórios exigem front e backend coesos.

## Alternativas Consideradas

- **Next.js full-stack/monólito modular** — um deploy e contratos internos tipados; exige disciplina de módulos.
- **SPA + API separada** — fronteira clara, porém dois builds/deploys e mais superfície operacional.
- **Microserviços** — isolamento forte, mas complexidade desproporcional.

## Decisão

Propor Next.js 16.3.3 sobre Node.js 24 LTS, em monólito modular e PWA responsiva. A decisão deve ser ratificada antes da primeira implementação.

## Consequências

- **Positivas:** implantação simples, menor latência interna e uma base de tipos/testes.
- **Negativas:** escala conjunta e necessidade de impedir acoplamento indevido.
- **Trade-offs:** módulos serão separados por domínio, sem serviços distribuídos prematuros.
