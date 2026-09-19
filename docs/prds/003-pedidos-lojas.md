---
prd_number: "003"
status: rascunho
priority: crítica
created: 2026-09-19
issue: ""
depends_on: ["001", "002"]
references: ["../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md", "../../referencias_visuais/03_loja_pedido_e_comprador_mobile.png"]
---

# PRD 003: Pedidos das lojas

## 1. Contexto

Lojas hoje enviam dados por WhatsApp/planilha. O celular é o dispositivo prioritário e tabela horizontal foi rejeitada.

## 2. Solução Proposta

### Visão de produto

- Cards móveis com estoque e pedido, busca e filtros.
- Rascunho recuperável e envio explícito do pedido diário.
- Histórico próprio e relatório A4 de conferência.

### Decisões de produto

1. Nomes reais das três lojas aparecem sempre.
2. Enviar cria versão histórica; não sobrescreve pedidos anteriores.

### Fora do escopo

- Sugestão automática, aprovação do pedido e conversão de unidades.

## 3. Funcionalidades

### US01: Preencher pedido móvel

Como Loja, quero lançar estoque e pedido em cards, para trabalhar sem rolagem horizontal.

**Rules:** valores ≥ 0; filtros Todos/Sem/Com pedido; preenchido tem indicador visual.
**Edge cases:** perda de conexão ao salvar → manter rascunho e informar que não foi enviado *(premissa)*.

### US02: Enviar e consultar histórico

Como Loja, quero enviar e reabrir pedidos, para comprovar o que foi solicitado.

**Rules:** envio registra autor/data; Loja vê somente sua unidade.
**Edge cases:** reenvio no mesmo dia → criar revisão explícita, mantendo a anterior *(premissa)*.

### US03: Imprimir conferência

Como Loja, quero relatório A4 somente com quantidades > 0, para conferir o recebimento.

**Rules:** inclui ERP, produto, unidade, pedido e campos em branco.
**Edge cases:** nenhum item pedido → impressão bloqueada com explicação *(premissa)*.

## 4. Fluxo de Negócio

`Rascunho → preencher/buscar/filtrar → Salvar Pedido → confirmação → histórico → conferência.`

## 5. Critérios de Aceite

### 5a

| Critério | Razão | Verificação |
|---|---|---|
| viewport 360 px sem overflow horizontal | operação móvel | teste visual automatizado e aparelho real |
| rascunho sobrevive a recarga | evitar retrabalho | preencher, recarregar e conferir |
| histórico não é sobrescrito | auditoria | dois envios/revisões e consulta |

### 5b

| Métrica | Baseline | Meta |
|---|---:|---:|
| pedidos feitos fora do sistema | 100% | 0% após adoção |

## 6. Milestones

### Milestone 1: Pedido móvel rastreável

**Por que é um marco:** substitui o principal fluxo manual da Loja.
**Funcionalidades:** US01, US02, US03
**Checklist:** [ ] mobile; [ ] persistência; [ ] isolamento; [ ] impressão.
**Aprovador:** representantes das três lojas.

## 7. Riscos e Dependências

| Risco | Impacto | Mitigação | Status |
|---|---|---|---|
| ambiguidade sobre reenvio | Alto | validar regra no UAT | Pendente |

**Dependências:** PRDs 001 e 002.

## 8. Referências

- [Especificação](../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md)
- [Referência mobile](../../referencias_visuais/03_loja_pedido_e_comprador_mobile.png)

## 9. Registro de Decisões

- **2026-09-19:** cards móveis e histórico persistente são requisitos congelados de UX/produto.
