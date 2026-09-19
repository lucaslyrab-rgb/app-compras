---
prd_number: "006"
status: rascunho
priority: alta
created: 2026-09-19
issue: ""
depends_on: ["002", "004"]
references: ["../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md"]
---

# PRD 006: Gestão, precificação e notas fiscais

## 1. Contexto

O Gestor precisa transformar custos em preços e identificar compras sem nota, preservando histórico e o desenho de precificação aprovado.

## 2. Solução Proposta

### Visão de produto

- Comparar custo anterior/atual e calcular preço pelo markup individual.
- Vermelho apenas em alteração real de custo.
- Controlar NF por produto e compra/data com filtros e indicadores.
- Consultar pedidos de todas as lojas.

### Decisões de produto

1. `preço = custo atual × (1 + markup/100)`.
2. Primeiro custo não é tratado como alteração a partir de zero.

### Fora do escopo

- Integração fiscal, cobrança automática e vínculo completo a fornecedor/vendedor.

## 3. Funcionalidades

### US01: Precificar

Como Gestor, quero comparar custos e preço sugerido, para decidir preço de venda.

**Rules:** destaque vermelho só para custo alterado; filtro Somente custos alterados.
**Edge cases:** sem custo anterior → “Sem histórico”, sem destaque.

### US02: Controlar NF

Como Gestor, quero marcar NF recebida por compra, para localizar pendências.

**Rules:** datas diferentes criam controles independentes; marcação grava data/hora.
**Edge cases:** compra desmarcada como comprada → preservar NF e sinalizar inconsistência *(premissa)*.

### US03: Consultar histórico global

Como Gestor, quero filtrar pedidos por loja/data, para acompanhar operação.

**Rules:** inclui as três lojas e revisões.
**Edge cases:** período sem pedidos → estado vazio claro.

## 5. Critérios de Aceite

### 5a

| Critério | Razão | Verificação |
|---|---|---|
| fórmula usa markup individual | margem correta | casos 0%, 70%, 100%, 150%, 200% |
| só custo realmente alterado fica vermelho | leitura gerencial | primeiro/igual/maior/menor custo |
| NF pertence à compra/data | cobrança correta | mesmo produto em duas datas |

### 5b

| Métrica | Baseline | Meta |
|---|---:|---:|
| NF pendente sem identificação por data | desconhecida | 0 |

## 6. Milestones

### Milestone 1: Gestão do ciclo

**Por que é um marco:** fecha custo, preço, histórico e documento fiscal.
**Funcionalidades:** US01, US02, US03
**Checklist:** [ ] fórmula; [ ] destaque; [ ] filtros; [ ] NF por compra.
**Aprovador:** Gestor.

## 7. Riscos e Dependências

| Risco | Impacto | Mitigação | Status |
|---|---|---|---|
| custo por embalagem interpretado incorretamente | Alto | explicitar formato sem conversão | Monitorando |

**Dependências:** PRDs 002 e 004.

## 8. Referências

- [Especificação](../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md)

## 9. Registro de Decisões

- **2026-09-19:** precificação aprovada é preservada; NF é movimentação, não atributo do produto.
