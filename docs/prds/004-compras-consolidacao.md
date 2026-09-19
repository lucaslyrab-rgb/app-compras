---
prd_number: "004"
status: rascunho
priority: crítica
created: 2026-09-19
issue: ""
depends_on: ["003"]
references: ["../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md", "../../referencias_visuais/01_consolidado_boxes_lojas.png", "../../referencias_visuais/02_comprador_custos_mobile.png"]
---

# PRD 004: Consolidação e compras

## 1. Contexto

O Comprador precisa saber se o consolidado está completo e usar pendências como lista de trabalho durante a compra.

## 2. Solução Proposta

### Visão de produto

- Consolidado por produto com estoque/pedido por loja e total.
- Loja pendente em vermelho-claro.
- Registro de custo histórico e estado Comprado/Falta comprar por ciclo.

### Decisões de produto

1. Não registrar quantidade efetivamente comprada.
2. Formato de compra é apenas exibido; total não converte unidades.

### Fora do escopo

- Cotação, múltiplos compradores e rateio/conversão automática.

## 3. Funcionalidades

### US01: Ver consolidado

Como Comprador, quero comparar lojas e total, para planejar a compra.

**Rules:** boxes distinguem lojas; ausência de envio é explícita.
**Edge cases:** revisão após abertura → indicar atualização e recarregar dados *(premissa)*.

### US02: Registrar custo e compra

Como Comprador, quero lançar custo e marcar comprado, para zerar pendências.

**Rules:** custo fica histórico por produto/data/autor; filtros Todos/Faltam/Comprados.
**Edge cases:** marcar comprado sem custo → impedir e focar o campo *(premissa)*.

## 5. Critérios de Aceite

### 5a

| Critério | Razão | Verificação |
|---|---|---|
| pendência por loja inequívoca | evitar compra incompleta | omitir envio de cada loja |
| item comprado sai de Faltam | lista operacional | marcar e filtrar |
| custo anterior não é sobrescrito | precificação confiável | registrar em duas datas |

### 5b

| Métrica | Baseline | Meta |
|---|---:|---:|
| pendências invisíveis | desconhecida | 0 |

## 6. Milestones

### Milestone 1: Compra conduzida pelo sistema

**Por que é um marco:** entrega a lista operacional do Comprador.
**Funcionalidades:** US01, US02
**Checklist:** [ ] consolidado; [ ] alerta; [ ] filtros; [ ] histórico.
**Aprovador:** Comprador.

## 7. Riscos e Dependências

| Risco | Impacto | Mitigação | Status |
|---|---|---|---|
| total com unidade de compra interpretado como conversão | Alto | texto e UAT explícitos | Monitorando |

**Dependências:** PRD 003.

## 8. Referências

- [Especificação](../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md)
- [Consolidado](../../referencias_visuais/01_consolidado_boxes_lojas.png)
- [Custos mobile](../../referencias_visuais/02_comprador_custos_mobile.png)

## 9. Registro de Decisões

- **2026-09-19:** quantidade comprada e conversões continuam excluídas.
