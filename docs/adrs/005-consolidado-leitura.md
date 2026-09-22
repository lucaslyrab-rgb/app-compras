# ADR 005 — Consolidado como leitura consistente dos pedidos

Data: 2026-09-22. Status: aceito para implementação; homologação operacional pendente.

## Contexto e decisão

O módulo Loja foi homologado e não deve mudar. O Consolidado responde somente **o que foi pedido**, para COMPRADOR/GESTOR. Não cria estado de compra, conversão, custo ou novas tabelas.

`/comprador/consolidado` autentica com `requirePrincipal`. O serviço de purchasing reutiliza `purchaseCycle` do backend apenas como fallback sem ciclos persistidos; a consulta usa `purchase_cycle_date`. Repositórios não importam repositórios de outros módulos. O guard também existe na camada de leitura.

Uma transação PostgreSQL `REPEATABLE READ READ ONLY` executa no máximo quatro consultas em lote: ciclos disponíveis, lojas/último envio, itens desses pedidos e catálogo. Todos os dados pertencem ao mesmo snapshot transacional, mesmo com envio/cancelamento concorrente. Não há N+1 nem materialização redundante.

## Revisão vigente e compatibilidade

O Histórico homologado identifica o último envio por `submitted_at` dentro de loja/ciclo e só então verifica cancelamento. O Consolidado reproduz esse critério, desempata por `revision DESC, id DESC`, e não busca uma revisão anterior quando o último envio está cancelado. Revisões novas já recebem número crescente pelo fluxo existente. A documentação antiga que indicava simplesmente a maior revisão **não cancelada** foi corrigida, pois permitiria uma reativação indevida.

Nenhuma escrita em orders/order_items, nenhuma mudança nos triggers, snapshots, datas, ações ou formulário da Loja. Nenhuma migration. O único ponto compartilhado alterado é a página inicial: COMPRADOR redireciona à nova tela; GESTOR recebe um link; o ramo LOJA é preservado.

## Semântica de leitura

- Lojas são carregadas do banco: ativas e, ao consultar ciclo antigo, também as que possuem histórico naquele ciclo.
- Catálogo: produtos ativos mais produtos inativados que ainda constem em um pedido vigente selecionado, para não ocultar demanda já enviada. Estes recebem indicação de inatividade.
- Formato e descrição vêm do cadastro do produto. Não há snapshot de formato de compra, nem tentativa de inferir conversões históricas. Os snapshots originais dos pedidos continuam intocados.
- Célula `0`: item enviado explicitamente com zero. Célula `—`: sem pedido operacional ou produto ausente naquele snapshot. Ausência não vira zero na célula.
- Total soma apenas `quantity` por produto, com aritmética inteira de centésimos (precisão numeric(12,2)). Estoque é exclusivamente exibido. O total usa `purchase_format`, nunca `unit` como base universal.
- Nenhuma soma global de formatos incompatíveis. Resumo: produtos ativos, produtos com pedido, lojas enviadas/total.
- Seleção inicial: ciclo persistido mais recente; sem histórico, calendário backend. Navegação por ciclos existentes e consulta explícita de data válida. Horários exibidos em America/Sao_Paulo.

## Interface e atualização

Referência existente: `referencias_visuais/Comprador-Consolidado.png`, não duplicada nem usada como asset.

Filtros Todos/Com pedido/Sem pedido usam somente total. Busca instantânea por nome/ERP combinada com filtro. Ordenação pt-BR alfabética, desempate ERP. Lista inteira sem paginação, detalhe ou coluna de ações. Desktop/tablet: cabeçalho sticky e grupos por loja; mobile até 700px: cartões compactos com as três lojas visíveis. Paletas estáveis por slug: Ponta azul, Balneário verde, Santa Mônica laranja; novas lojas usam neutro. Componentes visuais usam tokens existentes e placeholder neutro, sem fotos/storage.

Revalidação manual, ao retornar à janela e a cada 30s quando a página está visível; busca/filtro permanecem no estado do cliente. Horário da consulta e alerta de total parcial são explícitos. Não é um bloqueio/transação de compra nem atualização instantânea por push.

## Qualidade e escopo futuro

Baseline Harness aplicada: preservação de interfaces, estados vazios/parciais, acessibilidade, responsividade, fronteiras de módulos e evidências reais de teste. Cobertura inclui soma/revisões/cancelamento, PostgreSQL e navegador autenticado em seis larguras. Testes e instruções: `docs/operacao/consolidado-comprador.md`.

Lançar custos, fornecedor, embarque, conferência, conversões, edição pelo comprador e upload ficam fora desta entrega.
