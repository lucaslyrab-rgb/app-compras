# Consolidado do Comprador

## Uso

Acesse `/comprador/consolidado` com COMPRADOR ou GESTOR. Comprador entra diretamente após login; Gestor acessa pelo link. Loja não tem acesso. Escolha o ciclo no seletor ou nas setas (navegação entre ciclos, não paginação dos produtos).

Confira **lojas enviadas/total** antes de interpretar os totais. Uma loja sem revisão válida aparece como Não enviado, com células `—`. Zero informado aparece como `0`. Estoques são informativos e nunca descontados do pedido. Total é a soma dos pedidos no formato cadastrado (CX/SC/UND/etc.), sem conversão ou agregação entre formatos.

Use busca por nome/ERP e filtros simultaneamente. Todos os produtos ficam na mesma lista contínua. O botão Atualizar e a revalidação a cada 30s/retorno à janela atualizam as revisões consultadas sem apagar busca/filtro. Não é necessário aguardar todas as lojas para consultar.

## Testes reproduzíveis, sem produção

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Em **PostgreSQL descartável vazio**: configure DATABASE_URL; execute `npm run db:migrate`, `npm run db:import-products`, `npm run test:integration`. A suíte cria dados sintéticos e precisa de banco limpo, nunca produção.
- E2E: banco separado **local** chamado `consolidado_e2e`, importado com 74 produtos. Configure DATABASE_URL e uma CONSOLIDATED_E2E_PASSWORD temporária; execute `npx tsx scripts/seed-consolidated-e2e.ts`. O seed recusa host externo, nome de banco diferente e banco que já tenha pedidos.
- Execute `CONSOLIDATED_E2E_PASSWORD=... npx playwright test tests/e2e/consolidated.spec.ts --project=desktop`. O servidor da configuração existente usa DATABASE_URL do fixture. Contas sintéticas: comprador@consolidado.test, gestor@consolidado.test e loja@consolidado.test, todas com a senha temporária escolhida. Sem o fixture, a suíte marca explicitamente skip; não é evidência de teste executado.
- A suíte testa 320/375/390/412/768/1280px, DOM realmente filtrado, nomes longos, 74 produtos, scroll contínuo, cabeçalho sticky, ciclos parciais/vazios/cancelados, acessos reais e acessibilidade automatizada.

## Homologação manual pendente

Validar com Comprador em aparelho físico: escolher ciclo real; comparar cada célula com os pedidos das lojas; confirmar unidade de compra e totais; testar consulta com envio parcial e nova revisão; verificar legibilidade em operação. Testes automatizados não substituem esta aprovação.

## Implantação

Sem migration nova. Pipeline, GHCR, promoção GitOps, webhook e Verify live Swarm deployment permanecem inalterados. A confirmação de entrega exige imagem/digest efetivos, UpdateStatus completed, task running, container healthy, ausência de rollback e `/api/health` OK. Evidências finais de execução ficam no relatório da entrega e no workflow do commit.

Decisão técnica e semântica completa: [ADR 005](../adrs/005-consolidado-leitura.md).
