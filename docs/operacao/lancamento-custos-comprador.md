# Lançamento de Custos — Comprador V1

## Uso operacional

Acesse `/comprador/custos` com perfil COMPRADOR ou GESTOR e selecione a data da compra. A tela lista somente produtos cujo Total pedido do ciclo seja maior que zero. As quantidades P/B/S e o Total são os mesmos do Consolidado, no formato de compra cadastrado. Estoque não participa desta tela nem de qualquer cálculo.

- **Custo anterior:** último custo de um ciclo anterior que permaneça marcado Comprado.
- **Custo atual:** estado de trabalho do produto no ciclo selecionado. Sem registro próprio, o custo anterior aparece pré-preenchido, mas ainda não é gravado no ciclo.
- **Comprado:** a compra daquele produto foi efetivamente realizada nesse ciclo. Só então o custo passa a servir como referência futura.
- **Desmarcar:** mantém o custo digitado, mas o retira da referência oficial.
- **EXCLUSIVO:** informação do catálogo; não seleciona fornecedor e não cria pedido fornecedor.

Digite valores como `75`, `75,5` ou `75,50`. Ao sair do campo ou pressionar Enter, aguarde `Salvo`. Enter avança para o próximo custo visível no desktop. Marcar/desmarcar Comprado salva imediatamente. Produto sem custo não pode ser marcado e recebe orientação inline. Se o custo atual divergir do anterior, o campo recebe o indicador `Alterado` em vermelho.

Busca por nome/ERP combina com Todos, Faltam comprar e Comprados. O filtro usa exclusivamente o checkbox, nunca a simples presença de custo. No mobile, P/B/S, Total, custos e checkbox continuam no próprio cartão, sem tela de detalhe.

Não há fechamento global nem lock de ciclo nesta V1. Correções autorizadas em ciclos consultáveis atualizam a linha daquele produto/ciclo. Fornecedores comuns, Pedido Fornecedor, Conferência, Separação, faturamento, conversões e fotos não estão implementados.

## Persistência e recuperação

`purchase_cycle_product_costs` possui uma linha por produto/ciclo, custo `numeric(12,2)`, status, autoria, timestamps e versão otimista. Recarregar ou reiniciar a aplicação recupera o último estado salvo. Em conflito entre abas, a gravação com versão antiga é recusada; a tela tenta reaplicar apenas a intenção local mais recente e informa se não conseguir.

## Verificação reproduzível

1. Execute `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.
2. Em PostgreSQL descartável vazio, execute `npm run db:migrate`, `npm run db:import-products` e `npm run test:integration`.
3. Para E2E, use exclusivamente o banco local descartável `consolidado_e2e`, execute `npx tsx scripts/seed-consolidated-e2e.ts` e depois `npx playwright test tests/e2e/purchase-costs.spec.ts`. O seed recusa host externo, outro nome de banco ou banco que já possua pedidos.
4. Valide 320, 375, 390, 412, 768 e 1280 px; fluxo de custo/checkbox/reload; COMPRADOR/GESTOR; bloqueio de LOJA; ausência de overflow e navegação por Enter.

Testes automatizados não substituem a homologação operacional do comprador em aparelho físico.
