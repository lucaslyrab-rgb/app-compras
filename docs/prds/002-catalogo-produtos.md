---
prd_number: "002"
status: rascunho
priority: alta
created: 2026-09-19
issue: ""
depends_on: ["001"]
references: ["../../base_produtos_atual.xlsx", "../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md"]
---

# PRD 002: Catálogo de produtos

## 1. Contexto

- **Estado atual:** 74 produtos estão em XLSX e duplicados no protótipo; exclusividade usa a coluna legada `jojo `.
- **Problema:** dados não têm governança central nem histórico seguro.

## 2. Solução Proposta

### Visão de produto

- Importar e validar código, nome, unidade, formato de compra, markup e exclusividade.
- Gestor cria, edita, ativa e inativa; exclusão física não é oferecida.
- Código ERP é único e produtos históricos continuam legíveis.

### Decisões de produto

1. A planilha inicial deve resultar exatamente em 74 produtos e 21 exclusivos.
2. Unidade e formato de compra são independentes e não possuem conversão.

### Fora do escopo

- Fornecedores/vendedores completos, conversões, integração ERP e fotos no primeiro marco.

## 3. Funcionalidades

### US01: Importar catálogo inicial

Como Gestor, quero importar a base validada, para iniciar sem digitação manual.

**Rules:** importação é repetível sem duplicar; divergências geram relatório.
**Edge cases:** código duplicado/campo inválido → item rejeitado e importação não publica estado parcial *(premissa)*.

### US02: Manter produto

Como Gestor, quero manter atributos e status, para refletir o sortimento.

**Rules:** somente Gestor altera; inativação preserva referências.
**Edge cases:** produto inativo em pedido antigo → continua visível no histórico.

## 5. Critérios de Aceite

### 5a

| Critério | Razão | Verificação |
|---|---|---|
| 74 produtos/21 exclusivos após importação | fidelidade da origem | relatório e consulta ao banco |
| segunda execução não duplica | operação segura | executar duas vezes e comparar |
| inativação preserva histórico | rastreabilidade | abrir pedido anterior |

### 5b

| Métrica | Baseline | Meta |
|---|---:|---:|
| divergências silenciosas | desconhecida | 0 |

## 6. Milestones

### Milestone 1: Catálogo governado

**Por que é um marco:** estabelece a referência para todos os fluxos.
**Funcionalidades:** US01, US02
**Checklist:** [ ] contagens; [ ] CRUD autorizado; [ ] histórico preservado.
**Aprovador:** Gestor.

## 7. Riscos e Dependências

| Risco | Impacto | Mitigação | Status |
|---|---|---|---|
| semântica de `jojo ` | Alto | mapear explicitamente e validar 21 itens | Monitorando |

**Dependências:** PRD 001 para autorização.

## 8. Referências

- [Planilha-base](../../base_produtos_atual.xlsx)
- [Especificação](../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md)

## 9. Registro de Decisões

- **2026-09-19:** inativação substitui exclusão; conversão permanece fora do escopo.
