# Estado atual — índice e registro histórico

**Atualização documental: 26/10/2026.** O planejamento oficial aprovado está em [docs/PLANEJAMENTO.md](PLANEJAMENTO.md), e a sequência resumida em [docs/roadmap.md](roadmap.md).

## Situação funcional conhecida

- **Fase 1:** fundação e pedidos das lojas — implementada.
- **Fase 2:** consolidação, custos e operação de compras — base implementada.
- **Fase 3:** destinação, fornecedores e fechamento operacional — em estabilização, incluindo validação dos casos Maçã Fuji e Batata Bolinha.
- **Fases 4–6:** planejamento aprovado, **sem declaração de implementação**.
- **Fase 4:** registro de nota (número + fotografia) na tela de destinação; uma nota por loja; bloqueio de fechamento por destinações positivas sem nota somente depois de implementar e validar a fase.
- **Fase 5:** conferência do pedido original em KG, salvamento parcial e finalização após verificação de todos os produtos; perdas armazenadas no banco FLV.
- **Fase 6:** escopo refinado em 29/10/2026 — Fechamento integrado (`/fechamento`) com pedido (CX) × destinação (CX) × conferência (KG), peso esperado pela conversão cadastrada e faixas de cor da pesagem, apenas informativo; sem Área do CPD (fiscal e notas ficam no StarTwo). Implementação na branch `feat/phase6-fechamento-integrado`, aguardando homologação. Ver [OpenSpec](../openspec/changes/fase6-fechamento-integrado/proposal.md).

**Atenção:** o quadro acima reflete o planejamento e o histórico operacional informado; não substitui auditoria técnica de código ou produção.

## Evidências técnicas históricas (20/09/2026)

Os registros a seguir são um **retrato datado** da validação técnica de 20/09/2026. Não devem ser interpretados como identificação garantida da versão, imagem, estado do deploy ou pendências de hoje.

- O projeto foi preparado como PWA multiusuário para substituir o fluxo de WhatsApp/planilhas das três lojas.
- A mudança OpenSpec então ativa era `openspec/changes/fundacao-plataforma/`.
- Foram registrados testes de instalação, lint, typecheck, build, testes unitários e de integração, Playwright, importação administrativa, imagem OCI e verificação de segurança.
- O ambiente registrado incluía PostgreSQL 18.6, serviço Swarm `app-compras_web`, GHCR, Portainer e endpoint HTTPS `/api/health`.
- O procedimento de backup cifrado e restauração isolada foi validado naquela data, com armazenamento S3.
- O Portainer foi registrado como responsável pelo stack GitOps; os testes de webhook, healthcheck e pipeline tiveram evidências positivas.
- O roteiro de UAT está documentado em [docs/operacao/uat.md](operacao/uat.md). A aprovação de UAT em aparelhos reais não foi comprovada nesse registro.

## Cuidados operacionais

Este documento não contém credenciais, chaves privadas, senhas nem valores de secrets. Para operações e diagnósticos, consultar os runbooks atualizados e verificar diretamente o estado do ambiente antes de qualquer ação.

**Próximo passo de produto:** estabilizar a Fase 3. A aprovação documental v2.0 **não autoriza** alterações de código, banco, migrações, CI/CD ou produção.
