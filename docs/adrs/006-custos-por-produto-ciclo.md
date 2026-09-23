# ADR 006 — Custo operacional por produto e ciclo

Data: 2026-09-23. Status: aceito para implementação; homologação operacional pendente.

## Contexto

O Consolidado homologado responde o que foi pedido e não pode ser transformado em uma tabela mutável. O Comprador precisa manter um custo de trabalho por produto/ciclo, marcar a compra efetivamente realizada e recuperar o último custo oficial sem sobrescrever o histórico. `orders` e `order_items` continuam imutáveis e são a fonte exclusiva das quantidades P/B/S e do Total pedido.

## Decisão

Persistir o estado operacional em `purchase_cycle_product_costs`, separado dos pedidos, com chave lógica única `(product_id, purchase_cycle_date)`. `cost numeric(12,2)` é anulável; `purchased` é booleano; `purchased_at`, `updated_by`, timestamps e `version` fornecem rastreabilidade mínima e controle de concorrência. Constraints impedem custo não positivo/fora do limite e `purchased=true` sem custo.

O registro é criado de forma lazy. Sem registro no ciclo, a UI consulta o último custo de ciclo **anterior** com `purchased=true` e o apresenta como pré-preenchimento, sem materializá-lo. Um custo salvo com `purchased=false` continua sendo trabalho do ciclo, mas nunca vira referência. Desmarcar preserva `cost`, limpa `purchased_at` e retira o lançamento da referência. Corrigir custo comprado atualiza a única linha produto/ciclo; não há revisão por digitação nesta V1.

Não existe fechamento global do ciclo. COMPRADOR/GESTOR podem corrigir um ciclo consultável; não foi inventado bloqueio histórico. Uma política de fechamento/lock exige requisito e migration próprios no futuro.

## Consolidação e formato

`loadPurchaseCosts` consome `loadConsolidated`; não reimplementa revisão vigente, cancelamento, cutoff ou cálculo de total. A lista contém apenas produtos com `Total pedido > 0`. P/B/S e Total vêm dos pedidos operacionais; estoque não é carregado na tela de Custos. `purchase_format` é apenas preservado e exibido — não existe conversão.

`exclusive_supplier` do catálogo gera somente o selo EXCLUSIVO. Fornecedor comum, seleção de fornecedor, pedido fornecedor, conferência, separação, faturamento e upload de fotos permanecem fora do escopo.

## Autosave e concorrência

O custo é salvo ao sair do campo ou pressionar Enter; o checkbox salva imediatamente. Isso evita formatar dinheiro a cada tecla e deslocar o cursor no teclado móvel. O cliente mantém estado controlado, coalesce mudanças por produto e ignora visualmente resultados superados por uma intenção mais recente. Server Actions do Next.js são sequenciais por cliente, mas a persistência também exige `expectedVersion`: o `UPSERT` só atualiza a versão esperada. Conflitos retornam a versão atual e a intenção local mais recente pode ser reaplicada de forma determinística, limitada a três tentativas.

Dinheiro é normalizado sem `float`, em centavos inteiros/decimal canônico, e validado novamente no servidor. O destaque vermelho compara o custo atual válido com o custo anterior oficial; não depende de quantidade ou estoque.

## Consequências

- Histórico oficial por ciclo permanece reconstruível e independente do cadastro do produto.
- A migration 0004 não altera triggers nem tabelas de pedidos.
- Não há histórico de cada tecla; permanece somente o estado corrente por produto/ciclo e a autoria/timestamp da última alteração.
- Duas abas não sobrescrevem silenciosamente uma à outra; uma versão obsoleta recebe conflito.
