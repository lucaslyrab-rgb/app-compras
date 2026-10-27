# Roadmap — Sistema de Compras MultiShow FLV

**Referência oficial:** [Planejamento Geral Consolidado — Versão 2.0](PLANEJAMENTO.md), aprovado em 26/10/2026.

Este roadmap resume a **sequência de fases de negócio**. O antigo roadmap técnico R0–R5 foi substituído como referência principal de prioridades; as decisões e evidências técnicas históricas permanecem nos demais documentos.

| Ordem | Fase | Objetivo | Situação |
|---|---|---|---|
| 1 | Fundação e pedidos das lojas | Registrar estoque, pedidos, revisões e histórico por loja | Implementada |
| 2 | Consolidação, custos e operação de compras | Consolidar solicitações, registrar custos e compras | Base implementada |
| **3 — atual** | Destinação, fornecedores e fechamento operacional | Distribuir produtos comprados por loja/fornecedor e estabilizar regras de corte | Em estabilização |
| 4 | Registro e vinculação de notas fiscais | Registrar número e foto da nota **na tela de destinação**, vinculando a produtos de uma única loja | Planejamento aprovado |
| 5 | Conferência e perdas | Conferir o pedido original em KG e registrar perdas no PostgreSQL FLV | Planejamento aprovado |
| 6 | Fechamento integrado e CPD | Confrontar pedido/destinação/conferência, mostrar divergências e confirmar chegada das notas | Regras principais aprovadas |

## Dependências e limites

1. **Estabilizar a Fase 3:** validar decisões negativas de fornecedor e a lista de produtos marcados como comprados.
2. **Entregar a Fase 4:** comprador registra número e fotografia da nota em modal na destinação; cada nota pertence a uma loja e pode cobrir vários produtos do mesmo fornecedor. Somente **após** implementação e validação, impedir fechamento geral com destinações positivas sem nota vinculada.
3. **Entregar a Fase 5:** login de loja com opções Pedido, Conferência e Perdas; conferência a partir do pedido original, independentemente de marcação de compra, com peso em KG, botão Não recebido (0 KG), salvamento parcial e finalização só com todos verificados. Perdas gravadas no banco FLV, consultáveis por Gestor e Comprador.
4. **Entregar a Fase 6:** mostrar diferenças entre pedido, destinação e conferência sem bloquear o fechamento por divergências operacionais; não comparar unidades incompatíveis sem regra de conversão. CPD confirma recebimento físico das notas no ciclo posterior; lançamento fiscal permanece no StarTwo. Confirmação do CPD não bloqueia o fechamento do ciclo.
5. **Relatórios gerenciais:** especificar posteriormente, após observação da operação.

## Governança

O planejamento v2.0 está aprovado **como documentação**. Nenhuma fase futura deve ser considerada implementada por constar neste roadmap. Código, banco, infraestrutura, migrações e produção requerem autorização e validação separadas.
