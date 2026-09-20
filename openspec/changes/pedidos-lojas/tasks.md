# Tasks

## 1. Dados e domínio

- [x] 1.1 Auditar schema e migrations de rascunho, itens e pedidos; verificar constraints de não negatividade, unicidade loja/data e revisão.
- [x] 1.2 Completar validação de domínio e mensagens de erro para valores inválidos; verificar testes unitários de limites e conflitos.
- [x] 1.3 Confirmar autorização server-side em todas as leituras/escritas; verificar teste de acesso cruzado entre lojas.

## 2. Fluxo móvel

- [x] 2.1 Implementar ou ajustar cards, busca, filtros e indicador de preenchimento; verificar viewport de 360 px sem overflow.
- [x] 2.2 Implementar persistência/recuperação do rascunho e feedback de versão; verificar recarga e conflito entre sessões.
- [x] 2.3 Implementar envio explícito e revisões históricas; verificar dois envios no mesmo dia sem sobrescrita.

## 3. Conferência

- [x] 3.1 Implementar conferência A4 com somente quantidades positivas, código ERP, unidade e campos de recebimento; verificar impressão visual.
- [x] 3.2 Bloquear conferência sem itens e preservar itens históricos após inativação de produto; verificar casos de borda.

## 4. Qualidade e entrega

- [x] 4.1 Ampliar testes unitários e de integração para rascunho, revisão, isolamento e conferência; verificar `npm run test`.
- [x] 4.2 Ampliar Playwright para fluxo móvel, reload, revisão e impressão; verificar `npm run test:e2e` e acessibilidade.
- [x] 4.3 Executar lint, typecheck e build; verificar `npm run lint`, `npm run typecheck` e `npm run build`.
- [ ] 4.4 Publicar imagem imutável pelo GitHub Actions, validar webhook Portainer, `/api/health` e rollback; registrar evidências no runbook.
- [ ] 4.5 Executar UAT com representantes das três lojas e decidir formalmente a regra de reenvio; anexar evidências e atualizar PRD 003.
