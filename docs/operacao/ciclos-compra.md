# Ciclos de compra e revisões

O ciclo operacional é calculado no fuso `America/Sao_Paulo`, com corte às 19:00.

- Envio antes das 19:00: ciclo da data local seguinte.
- Envio às 19:00 ou depois: ciclo da segunda data local seguinte.
- `orders.purchase_cycle_date` e `orders.cutoff_at` são persistidos no pedido.
- A revisão operacional é o último envio da combinação loja + ciclo, desde que não cancelado. Primeiro identifica-se o último envio (`submitted_at`), depois verifica-se `cancelled_at`. Cancelar o último NÃO reativa o anterior. O Consolidado segue o critério já usado no Histórico da Loja; em empates utiliza `revision` e `id` para resultado determinístico.

Uma nova tentativa no mesmo ciclo não cria silenciosamente um pedido independente. O servidor exige confirmação explícita (`allowRevision`) e cria uma nova revisão, preservando o registro anterior.

Pedidos anteriores à migration 0003 são preenchidos deterministicamente a partir de `submitted_at AT TIME ZONE 'America/Sao_Paulo'`. Como o timestamp de envio é obrigatório, essa conversão é determinística; nenhum horário é inferido de `created_at` ou do timezone UTC do servidor.

Cancelamentos continuam lógicos. Revisões canceladas não participam da revisão operacional vigente e permanecem disponíveis para auditoria.
