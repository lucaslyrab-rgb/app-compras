# Tasks

## 1. Base do projeto

- [x] 1.1 Criar aplicação Next.js/TypeScript com versões fixadas, scripts `lint`, `typecheck`, `test` e `build`, e verificar todos os comandos em ambiente limpo com `npm ci`.
- [x] 1.2 Estruturar módulos `identity`, `catalog`, `ordering`, `shared` e `db`, e verificar regras de importação/fronteira no lint ou teste arquitetural.
- [x] 1.3 Implementar tokens/componentes base conforme referências aprovadas e verificar teclado, foco, contraste, zoom 100% e ausência de overflow em 360 px.

## 2. Persistência e catálogo

- [x] 2.1 Definir schema/migrations de lojas, usuários, sessões, produtos, rascunhos, pedidos, itens e auditoria; verificar `up` em banco vazio e constraints por testes de integração.
- [x] 2.2 Implementar importador idempotente da planilha e verificar exatamente 74 produtos, 21 exclusivos, rejeição atômica e segunda execução sem duplicatas.
- [x] 2.3 Implementar manutenção/inativação de produto autorizada ao Gestor e verificar preservação de referências históricas.

## 3. Identidade e autorização

- [x] 3.1 Implementar hash de senha, bootstrap one-shot de Gestor, sessões opacas e cookies seguros; verificar login válido/inválido, expiração e revogação.
- [x] 3.2 Implementar RBAC e escopo de loja nas camadas de caso de uso/persistência; verificar a matriz com testes positivos e negativos de acesso direto.
- [x] 3.3 Implementar rate limit e auditoria sem dados sensíveis; verificar bloqueio temporário e redação de logs.

## 4. Pedido da Loja

- [x] 4.1 Implementar rascunho persistente com controle otimista e verificar recuperação após recarga e conflito entre sessões.
- [x] 4.2 Implementar cards mobile, busca, filtros, validação e indicadores; verificar cenários em 360 px e desktop por Playwright.
- [x] 4.3 Implementar envio/reenvio versionado e histórico isolado; verificar revisão corrente, preservação das anteriores e loja cruzada negada.
- [x] 4.4 Implementar relatório A4 de conferência e verificar campos obrigatórios e exclusão de itens com pedido zero em PDF/impressão.

## 5. Qualidade e segurança

- [x] 5.1 Cobrir regras de domínio com unitários e fluxos com PostgreSQL efêmero; verificar cobertura ≥ 80% nos módulos e 100% dos cenários críticos mapeados.
- [x] 5.2 Executar análise de dependências, secrets e imagem, corrigir achados P0/P1 e anexar evidências no job de CI.
- [ ] 5.3 Executar UAT dos três papéis em aparelhos reais e registrar aprovação ou defeitos P0/P1/P2.

## 6. Container, CI/CD e operação

- [x] 6.1 Criar Dockerfile multi-stage não-root, `.dockerignore` e healthcheck; verificar imagem local, usuário, tamanho e resposta saudável.
- [x] 6.2 Criar stack Swarm com imagem imutável, rede `externa`, secrets, limites, update/rollback e conexão ao PostgreSQL 18.6 compartilhado; validar sintaxe e deploy em homologação.
- [x] 6.3 Criar workflow com actions fixadas por SHA, permissões mínimas, build multiarch/scan/publicação GHCR e webhook pós-sucesso; verificar que falha não publica nem chama deploy.
- [ ] 6.4 Criar backup PostgreSQL cifrado off-host e runbooks de deploy/rollback/restauração; verificar restauração em ambiente isolado e rollback para SHA anterior.
- [x] 6.5 Validar OpenSpec estritamente, executar checklist Wittemberg de frontend/release e atualizar `docs/estado-atual.md` com evidências reais.
