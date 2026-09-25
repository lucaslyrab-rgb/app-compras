# Proposal

## Why

O cálculo atual do ciclo usa apenas “dia local + 1/+2” e cria ciclos em dias sem compra, o que diverge da operação da MultiShow e distorce a referência de ciclo exibida na Precificação. Precisamos tornar dias de compra, horário de corte e timezone configuráveis antes de continuar a homologação, preservando integralmente pedidos e custos já gravados.

## What Changes

- Persistir um calendário operacional semanal separado das configurações financeiras, com timezone, horário de corte, dias de compra habilitados, versão e timestamps.
- Inicializar a MultiShow com `America/Sao_Paulo`, corte às `19:00` e compras em segunda, terça, quinta e sexta.
- Calcular novos ciclos pelo próximo dia de compra habilitado; no corte ou depois dele, pular o primeiro dia habilitado e selecionar o seguinte.
- Usar a configuração persistida na apresentação da Loja e na gravação de novos pedidos, sem recalcular ou atualizar pedidos históricos.
- Permitir que somente GESTOR visualize e altere o calendário em uma nova seção da tela existente de Configurações, com validação server-side e concorrência otimista.
- Manter a seleção da Precificação baseada no último custo oficial por produto (`purchased = true` e custo não nulo), definir a recência pelo último ciclo efetivamente comprado até a data operacional local e tornar explícitos o ciclo de referência e o ciclo histórico utilizado.
- Criar a migration aditiva 0008 já alinhando o ownership dos novos objetos com o papel proprietário do database, inclusive quando executada por administrador.
- Documentar os oito pedidos recentes identificados que divergiriam do novo calendário, sem corrigi-los ou alterá-los neste change.
- Permanecem fora do escopo: exceções/feriados, recálculo histórico, correção de logo, sticky, paginação, cadastro de produtos, mudanças de layout e Separação/Embarque.

## Capabilities

### New Capabilities

- `ordering/purchase-calendar`: configuração, validação, RBAC e cálculo determinístico do calendário operacional usado somente em novos pedidos.
- `pricing/official-cost-selection`: seleção do último custo oficial por produto e apresentação inequívoca do ciclo/data histórica realmente utilizada.

### Modified Capabilities

Nenhuma capability publicada em `openspec/specs/` existe atualmente; os contratos acima serão adicionados como novas capabilities sem alterar migrations ou specs antigas.

## Impact

- Banco: nova tabela operacional e migration `0008`, sem `UPDATE` em `orders`, custos ou revisões.
- Backend: cálculo de ciclo deixa de ser constante síncrona e passa a consumir configuração persistida; envio de pedido continua persistindo o ciclo calculado no momento da criação.
- Frontend: seção adicional em GESTOR → Configurações, sem redesenho da página.
- Precificação: consulta oficial permanece restrita a custos comprados e válidos; a referência deixa de ser o próximo ciclo de pedidos e o fallback passa a informar o ciclo efetivamente comprado de referência e o ciclo oficial utilizado.
- Testes: unitários de calendário/timezone, integração de pedidos/RBAC/Precificação, migration descartável, E2E gerencial e regressões homologadas.
