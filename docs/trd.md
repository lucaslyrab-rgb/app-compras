# TRD — Technical Requirements Document

> Documento técnico global. Versões e fatos externos consultados em 2026-09-19.

## Stack

| Dimensão | Valor |
|---|---|
| Linguagem principal | TypeScript estrito |
| Runtime / plataforma | Node.js 24 LTS; container Linux OCI |
| Framework principal | Next.js 16.3.3, App Router, PWA responsiva |
| Banco de dados | PostgreSQL 16 dedicado *(proposto; ADR 002)* |
| Acesso a dados | ORM/migrações TypeScript a selecionar na mudança ativa |
| Ferramentas de build | Next.js, Docker BuildKit |
| Gerenciador de pacotes | npm com lockfile e `npm ci` |

## Arquitetura

### Padrão arquitetural

Monólito modular orientado a domínios, com UI, casos de uso e persistência separados. Uma imagem atende web/API; jobs administrativos (migração/importação) são comandos explícitos, não efeitos colaterais de toda réplica.

### Estrutura de pastas dominante

```text
src/
├── app/                 # rotas e composição web
├── modules/             # auth, catálogo, pedidos, compras, logística e gestão
├── shared/              # componentes, observabilidade e utilitários estáveis
└── db/                  # schema, migrações e seeds/importação
tests/                   # unitários, integração e e2e
infra/                   # stack Swarm e runbooks
```

### Módulos / camadas principais

| Módulo | Responsabilidade |
|---|---|
| Identidade | contas, sessões, papéis, vínculo de loja e auditoria |
| Catálogo | produtos, status, markup, formato e exclusividade |
| Pedidos | rascunhos, envios, revisões e histórico |
| Compras | consolidado, custos históricos e status comprado |
| Logística | separação, embarque e fornecedor exclusivo |
| Gestão | precificação, histórico global e NF |

## Requisitos Não-Funcionais

| Dimensão | Requisito |
|---|---|
| Performance | p95 servidor ≤ 500 ms em operações normais; primeira carga útil ≤ 3 s em rede móvel razoável *(premissa)* |
| Disponibilidade / SLA | 99,5%; RPO 24 h; RTO 4 h *(premissas a ratificar)* |
| Escalabilidade | três lojas/baixa concorrência inicial; stateless web permite réplicas futuras |
| Segurança | HTTPS; menor privilégio; sessões seguras; senha resistente; rate limit de login; segredos via Swarm/Portainer; dependências verificadas |
| Integridade | transações, constraints, migrações versionadas, timestamps UTC e apresentação `America/Sao_Paulo` |
| Observabilidade | logs JSON sem dados sensíveis, request/correlation ID, health/readiness e métricas básicas |
| Acessibilidade | teclado, foco visível, contraste, rótulos e alvos de toque; WCAG 2.2 AA como referência *(premissa)* |
| Responsividade | sem overflow a 360 px; validar mobile/tablet/notebook/desktop e zoom 100% |
| Recuperação | backup diário externo ao volume, retenção a definir, restauração ensaiada antes do go-live |

## Dependências Externas

| Serviço / Sistema | Tipo | Constraint relevante | Dono |
|---|---|---|---|
| GHCR | registry OCI | Actions publica com `GITHUB_TOKEN`; Portainer lê com PAT clássico `read:packages` | GitHub |
| Portainer EE | GitOps/Swarm | webhook é secreto; stack Git é fonte de verdade | infraestrutura |
| Traefik 3.5.3 | proxy/TLS | rede overlay externa `externa`; HTTPS via Let's Encrypt | infraestrutura |
| PostgreSQL | persistência | 14 atual termina suporte em 12/11/2026; usar serviço suportado | infraestrutura |
| DNS | CNAME/A | `compras.muitomaisatacado.com` resolve para `177.136.234.214` em 2026-09-19 | DNS local |

## Padrões

### Testes

| Item | Valor |
|---|---|
| Framework | Vitest (unit/integração) e Playwright (fluxos críticos) *(proposto)* |
| Comando completo | `npm run lint && npm run typecheck && npm test && npm run build`; e2e em job próprio |
| Cobertura mínima | 80% nos módulos de domínio; 100% das regras críticas por cenários *(premissa)* |
| Estratégia | pirâmide unit + integração com PostgreSQL efêmero + e2e móvel/desktop |

### Estilo de código

- **Linter:** ESLint versionado.
- **Formatter:** Prettier versionado.
- **Nomenclatura:** componentes/tipos `PascalCase`, funções/variáveis `camelCase`, banco `snake_case`.

### Error handling

Erros de validação/domínio são explícitos; conflitos retornam orientação; falhas inesperadas recebem ID e mensagem pública neutra. Nenhuma ação falha silenciosamente.

### Logging

- **Formato:** JSON estruturado, sem senha, token, cookie, webhook ou dados desnecessários.
- **Nível:** `INFO` produção; `DEBUG` somente temporário.
- **Correlação:** request ID propagado a eventos e logs.

### Autenticação / autorização

Sessões opacas server-side e RBAC, conforme ADR 003. Defesa em profundidade em rotas, casos de uso e filtros de consulta.

### Baseline de qualidade

Baseline Wittemberg adotada: UI aprovada é congelada; alterações cirúrgicas; criticidades P0/P1/P2; testes de regressão proporcionais; checklist de frontend e release antes da entrega.

## Decisões Globais (ADRs)

| # | Título | Data | Status | Link |
|---|---|---|---|---|
| 001 | Monólito modular PWA em Next.js | 2026-09-19 | proposto | [ADR 001](adrs/001-monolito-modular-pwa.md) |
| 002 | PostgreSQL suportado e isolado | 2026-09-19 | proposto | [ADR 002](adrs/002-postgresql-dedicado.md) |
| 003 | Sessões server-side e RBAC | 2026-09-19 | proposto | [ADR 003](adrs/003-sessoes-rbac.md) |
| 004 | Entrega por GHCR, stack Git e webhook Portainer | 2026-09-19 | aceito | [ADR 004](adrs/004-entrega-ghcr-portainer.md) |
