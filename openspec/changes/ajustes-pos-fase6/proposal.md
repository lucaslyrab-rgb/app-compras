# Proposal

## Why

Na primeira semana de uso com as Fases 5 e 6 em produção, o responsável pelo sistema identificou (02/11/2026):

- Lançamentos de perda errados não tinham como ser corrigidos pelo Gestor; a loja só consegue excluir os do próprio dia.
- Perdas duplicadas: 4 lançamentos idênticos de Alho Importado, 5 kg, Balneário, às 18:57 de 30/10.
- O topo das telas da loja tinha atalhos Pedido/Conferência/Perdas redundantes com o botão Módulos.
- Mercadoria que chega sem constar no pedido (ex.: Maçã Gala no Balneário, ciclo 31/10) não podia ser registrada na conferência. Este é o ponto 1 em aberto do planejamento.
- O Fechamento precisa responsabilizar a decisão de envio: quem destinou e o que virou perda depois.

## What Changes

1. **Exclusão de perda pelo Gestor** — botão "Excluir" na Consulta de Perdas, qualquer loja e data, motivo obrigatório (3–300 caracteres), cancelamento lógico auditado (`store_loss.cancel_by_manager`). Nova permissão `perdas:excluir` (Gestor por padrão, atribuível em Usuários, não combinável com permissões de loja).
2. **Bloqueio de perdas duplicadas** — lançamento idêntico (loja, produto, quantidade, unidade, motivo) em até 120 s só é gravado com confirmação ("É outra perda: registrar mesmo assim"); lock transacional por loja × produto impede que toques simultâneos passem juntos; o formulário limpa quantidade e observação após salvar.
3. **Navegação da loja** — saem os atalhos do topo; a troca de tela é só pelo botão Módulos; um indicador não clicável mostra a tela atual.
4. **Item recebido fora do pedido** — botão na conferência em andamento para a loja lançar produto e peso; o item fica marcado com quem lançou e quando, com quantidade pedida 0; pode ser retirado se lançado por engano (fica no histórico); a sincronização com nova revisão do pedido preserva esses itens.
5. **Fechamento integrado** — mostra quem destinou cada item, as perdas do produto na loja do dia do ciclo até 3 dias depois, o destaque e o cartão "Recebido fora do pedido"; a tabela passa a quebrar textos longos e rolar horizontalmente quando necessário (corrige a coluna Destaques cortada).

Decisão de 02/11/2026: para mercadoria fora do pedido, adotar somente o lançamento pela loja (opção B). Itens destinados como adicional **não** entram automaticamente na conferência; isso preserva a evidência de que a loja não pediu.

## Impact

- **Banco:** migration `0022` aditiva — nova lista de permissões com backfill de `perdas:excluir` para Gestores; colunas `added_outside_order`, `added_by`, `added_at` em `store_delivery_conference_items` e constraint de quantidade pedida ajustada (0 somente para itens fora do pedido).
- **Sem mudança** em pedidos, destinações, notas ou regras de fechamento.
