# Design

## Context

Veja [proposal.md](proposal.md). O host é Swarm single-node (4 vCPU/4 GiB), com Traefik 3.5.3 na rede overlay externa `externa`, Portainer EE e PostgreSQL 14 compartilhado próximo do EOL. O repositório contém somente especificação, planilha e protótipo `localStorage`.

## Goals / Non-Goals

**Goals:**

- Uma fatia vertical pronta para homologação: login → catálogo → pedido móvel → histórico.
- Isolamento verificável por papel/loja, dados transacionais e importação repetível.
- Build/release reproduzível, limites de recurso, backup e rollback.

**Non-Goals:**

- Migrar dados do `localStorage`, implantar módulos PRD 004–006 ou alterar stacks legadas.
- Converter unidades, integrar ERP ou introduzir microserviços.

## Decisions

### Monólito modular e fronteiras

Uma aplicação Next.js separa módulos de identidade, catálogo e pedidos por casos de uso e repositórios. Rotas nunca consultam dados de outra loja usando identificador recebido do cliente; o principal autenticado fornece o escopo. Alternativa SPA/API separada foi descartada por duplicar operação.

### Dados e concorrência

PostgreSQL 16 dedicado, migrations versionadas e constraints únicas. `orders` representa uma versão enviada; `order_items` é imutável após envio. Rascunho é separado e atualizável. Importação usa código ERP como chave natural, valida tudo antes da transação e produz resumo 74/21.

### Sessões

Senha com algoritmo resistente e parâmetros versionados; sessão opaca armazenada no banco e cookie seguro. Rate limit combina identidade/endereço sem registrar segredo. O primeiro Gestor é criado por comando one-shot que recebe secret em runtime.

### Entrega

Docker multi-stage com usuário não-root e healthcheck. Actions fixa actions por SHA, usa `GITHUB_TOKEN` com `packages: write`, gera tag `sha-<commit>` e chama o webhook somente após publicação. Portainer lê GHCR com PAT clássico `read:packages`; stack Git referencia imagem/versionamento e rede `externa`.

### Observabilidade e continuidade

Logs JSON em stdout, correlation ID e endpoints de liveness/readiness. Backup lógico diário é cifrado e copiado para destino fora do volume/host a selecionar antes da produção. Migrações forward compatíveis precedem a troca de imagem; mudanças destrutivas exigem mudança OpenSpec própria.

## Risks / Trade-offs

- [Dois PostgreSQL consomem memória] → limites de recurso, medição e possibilidade de migrar após upgrade do serviço comum.
- [Nó único continua SPOF] → backup externo e RTO explícito; HA futura não é fingida.
- [Webhook permite deploy] → secret de ambiente, proteção da branch, rotação e logs redigidos.
- [Rascunho concorrente em dois aparelhos] → controle otimista por versão e mensagem de conflito.
- [Next.js/Node atuais recebem patches] → dependências fixadas e atualização automatizada/revisada.

## Migration Plan

1. Criar schema, migrations e banco de teste; validar importação.
2. Construir e testar identidade/RBAC e pedidos.
3. Publicar imagem por SHA e criar stack de homologação com secrets.
4. Executar migrations one-shot, bootstrap do Gestor e smoke/UAT.
5. Configurar backup, ensaiar restauração e rollback para SHA anterior.
6. Promover a referência aprovada e habilitar webhook protegido.

Rollback de aplicação repõe a imagem anterior. Rollback de dados usa migrations compatíveis; se houver incompatibilidade, interrompe deploy e restaura backup conforme runbook, nunca executa downgrade destrutivo automático.

## Deferred Operational Inputs

- O destino S3 compatível e suas credenciais serão fornecidos na configuração de produção; sem eles, o go-live permanece bloqueado. A retenção inicial proposta é 7 diários, 4 semanais e 6 mensais.
- A implementação usa SLA 99,5%, RPO 24 h, RTO 4 h e sessão com 12 h de inatividade/7 dias absolutos até ratificação operacional.
- Um segundo envio no mesmo dia cria nova revisão imutável; a revisão mais recente é a corrente e as anteriores continuam consultáveis.
