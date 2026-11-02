# Proposal

## Why

Anotações do responsável pelo sistema em 02/11/2026, após o uso das Fases 5 e 6:

1. Fornecedores inativos apareciam para escolha na Destinação.
2. Nome fantasia era opcional; a lista da Destinação mostrava a razão social.
3. Ciclos antigos (implantação/testes) continuavam aparecendo na Conferência e na Destinação, sem forma de encerrá-los.
4. O aviso e o modal "Produtos comprados sem fornecedor" eram calculados para todas as lojas juntas: um produto destinado a qualquer loja deixava de aparecer pendente nas demais.

## What Changes

1. **Destinação** — fornecedores inativos não aparecem para escolha; exceção: inativo com destinação no ciclo continua visível, marcado "(inativo)". O servidor já recusava gravar para inativo.
2. **Nome fantasia obrigatório** — vazio vira os 15 primeiros caracteres da razão social (cadastro e migration 0023 para os antigos); a Destinação exibe o nome fantasia em destaque e a razão social entre parênteses.
3. **Encerrar ciclo (Gestor → Configurações)** — lista ciclos anteriores a hoje com Destinação aberta ou loja com pedido sem conferência encerrada, mostrando a situação de cada loja. "Encerrar ciclo" exige motivo e: fecha a Destinação (fechamento do comprador, valendo todas as travas existentes), cancela conferências em andamento com o motivo, registra o encerramento em `purchase_cycle_archives` e na auditoria. O ciclo some da Conferência; a Destinação passa a listar só ciclos abertos, com "Ver ciclos fechados". Nada é apagado; o Fechamento integrado continua mostrando o ciclo. Reabrir continua possível pelo botão existente da Destinação.
4. **"Sem fornecedor" por loja** — produtos pedidos pela loja selecionada, comprados, sem destinação para ela e sem "Não comprado"; compras que nenhuma loja pediu e sem destinação aparecem em uma seção separada do modal.

## Impact

- Migration `0023`: preenchimento de `suppliers.trade_name` vazio e tabela `purchase_cycle_archives`.
- Regras de fechamento do ciclo pelo comprador não mudam.
