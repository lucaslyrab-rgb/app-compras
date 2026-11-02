# Estado atual — índice e registro histórico

**Atualização documental: 02/11/2026.** A primeira versão completa está em produção; o resumo está em [docs/versao-1.md](versao-1.md). O planejamento de referência continua em [docs/PLANEJAMENTO.md](PLANEJAMENTO.md).

## Situação funcional conhecida

- **Fases 1 a 6:** em produção (pedidos, consolidação, custos, destinação, notas fiscais, conferência, perdas e Fechamento integrado).
- **Fase 6:** confronto pedido (CX) × destinação (CX) × conferência (KG) apenas informativo, visível a Gestor e CPD; sem Área do CPD (fiscal e notas no StarTwo).
- **Interface:** identidade visual única e telas mobile-first para Destinação, Custos, Consolidado e telas da loja (Início, Perdas com fotos, cabeçalho único).
- **Pendências operacionais:** encerrar ciclos antigos ainda abertos; acompanhar o uso da Destinação e de Custos no celular.

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

**Próximo passo de produto:** acompanhar a operação da versão 1.0 e corrigir o que surgir no uso diário; relatórios gerenciais depois de observar a operação.
