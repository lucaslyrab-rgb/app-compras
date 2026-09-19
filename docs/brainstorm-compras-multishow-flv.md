# Brainstorm — Compras MultiShow FLV

**Lente:** especificação de projeto de desenvolvimento
**Última sessão:** 2026-09-19

## Problema

O fluxo diário de FLV depende de WhatsApp e planilhas, fragmenta o histórico e não oferece isolamento entre lojas, consolidação confiável nem rastreabilidade de custos, embarques e notas fiscais. O produto precisa reduzir atrito no celular sem transformar o processo em um ERP.

## Requisitos de negócio

- Três lojas registram estoque e pedido em poucos toques e consultam apenas seu histórico.
- Comprador identifica pedidos pendentes, consolida quantidades, registra custos históricos e conduz a lista “Faltam comprar”.
- Separação e embarque permanecem binários; relatórios físicos preservam o processo real.
- Gestor administra catálogo, markup, precificação e NF por compra/data.
- Itens exclusivos geram pedido do fornecedor, com uma loja iniciando em cada folha.
- Histórico é imutável por evento; inativação substitui exclusão física.
- Conversões de unidade, ERP, balança, QR code, paletização e cadastro completo de fornecedores ficam fora da primeira entrega.

## Requisitos técnicos

- RT01 → todos os requisitos: aplicação web responsiva/PWA, banco compartilhado e autenticação; `localStorage` não é fonte de verdade.
- RT02 → isolamento de lojas: autorização no servidor por papel e vínculo de loja, nunca apenas ocultação na interface.
- RT03 → histórico: modelo transacional com eventos datados, auditoria mínima e migrações versionadas.
- RT04 → uso operacional: monólito modular para reduzir pontos de falha no Swarm single-node existente.
- RT05 → implantação: imagem OCI imutável no GHCR, stack Git no Portainer, atualização por webhook após build/testes.
- RT06 → recuperação: backup testável, healthcheck, rollback por digest/tag imutável e logs estruturados.

## Não-funcionais

- **Escala:** 3 lojas e poucos usuários simultâneos; modelagem não deve bloquear expansão para novas lojas *(Inferido)*.
- **Resposta:** interações normais com p95 ≤ 500 ms no servidor e primeira carga útil ≤ 3 s em rede móvel razoável *(Inferido)*.
- **Segurança:** HTTPS, sessão segura, hash de senha resistente, menor privilégio, rate limit no login e segredos fora da imagem *(Inferido)*.
- **Disponibilidade:** alvo inicial 99,5%; RPO 24 h e RTO 4 h *(Inferido; depende da política operacional)*.
- **Operação:** equipe local via Portainer; logs, healthcheck, backup e runbook obrigatórios *(Inferido)*.
- **Infraestrutura:** Docker Swarm single-node, Traefik e Portainer existentes *(Verificado em 2026-09-19)*.

## Estados

| Item | Estado | Fonte/Premissa | Data |
|---|---|---|---|
| Fluxo, papéis e escopo | Decidido | Especificação consolidada | 2026-09-19 |
| 74 produtos / 21 exclusivos | Verificado | XLSX e protótipo local | 2026-09-19 |
| Swarm/Traefik/Portainer/PostgreSQL | Verificado | inspeção somente-leitura do host | 2026-09-19 |
| Next.js 16.3.3 e Node 24 LTS | Verificado | documentação oficial; versões em 2026-09-19 | 2026-09-19 |
| PostgreSQL dedicado 16+ | Inferido | 14 entra em EOL em 2026-11-12; evita acoplamento ao cluster legado | 2026-09-19 |
| Metas de SLA/RPO/RTO | Inferido | operação pequena em nó único | 2026-09-19 |
| Usuário inicial e política de senha | Em aberto | exige definição antes da homologação | 2026-09-19 |

## Alternativas descartadas

- **Evoluir o HTML/localStorage:** não oferece multiusuário, isolamento ou persistência confiável.
- **Supabase/Cloudflare:** tecnicamente viável, mas contraria a decisão atual de operar via stack local e adiciona dependência externa.
- **Microserviços:** custo operacional injustificado para escala e equipe atuais.
- **Reutilizar PostgreSQL 14 sem plano:** versão perto do EOL e blast radius compartilhado.
- **Webhook armazenado no Git:** URL é credencial de deploy; deve ser secret.

## Pendências

- Confirmar SLA/RPO/RTO e volume de retenção antes da produção.
- Confirmar se imagens de produto entram no primeiro release ou no seguinte; a especificação contém sinais conflitantes (direção futura, mas prioridade 13).
- Definir responsáveis nominais por homologação, operação e resposta a incidentes.
- Validar estratégia de banco dedicado versus upgrade planejado do PostgreSQL compartilhado.
