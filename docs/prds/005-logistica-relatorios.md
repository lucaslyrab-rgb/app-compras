---
prd_number: "005"
status: rascunho
priority: alta
created: 2026-09-19
issue: ""
depends_on: ["003", "004"]
references: ["../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md"]
---

# PRD 005: Separação, embarque e fornecedor

## 1. Contexto

O processo físico precisa de relatórios simples e de um único estado digital de embarque. Itens exclusivos seguem para fornecedor fixo.

## 2. Solução Proposta

### Visão de produto

- Separação A4 por loja com checklist manual.
- Estado Não embarcado/Embarcado com horário.
- Pedido do fornecedor somente com exclusivos, custo e quebra por loja.

### Decisões de produto

1. Cada loja começa em nova página no pedido do fornecedor.
2. Paletização, volumes, QR e barcode não entram.

### Fora do escopo

- Rastreamento de transporte e assinatura digital.

## 3. Funcionalidades

### US01: Imprimir separação

Como Comprador, quero uma folha por loja, para separar fisicamente.

**Rules:** somente itens pedidos; rodapé tem embarcado, responsável e horário.
**Edge cases:** pedido revisado depois da impressão → relatório mostra revisão/data *(premissa)*.

### US02: Registrar embarque

Como Comprador, quero marcar embarcado, para o Gestor acompanhar.

**Rules:** apenas dois estados; embarcado grava data/hora e autor *(premissa)*.
**Edge cases:** desmarcar embarque → exigir confirmação e auditar *(premissa)*.

### US03: Emitir pedido do fornecedor

Como Comprador, quero relatório automático dos exclusivos, para faturamento.

**Rules:** apenas exclusivos com pedido > 0; alerta loja pendente; quebra antes de cada nova loja.
**Edge cases:** loja sem itens exclusivos → seção informa “sem itens” ou é omitida conforme validação do Comprador *(premissa)*.

## 5. Critérios de Aceite

### 5a

| Critério | Razão | Verificação |
|---|---|---|
| nova loja nunca inicia na folha anterior | regra de faturamento | PDF com conteúdos de tamanhos variados |
| somente exclusivos aparecem | contrato do fornecedor | comparar com os 21 marcados |
| horário de embarque persiste | rastreabilidade | marcar, reiniciar e consultar |

### 5b

| Métrica | Baseline | Meta |
|---|---:|---:|
| relatórios montados manualmente | 100% | 0% |

## 6. Milestones

### Milestone 1: Logística documentada

**Por que é um marco:** conecta o sistema ao trabalho físico.
**Funcionalidades:** US01, US02, US03
**Checklist:** [ ] PDFs; [ ] exclusivos; [ ] quebras; [ ] auditoria.
**Aprovador:** Comprador.

## 7. Riscos e Dependências

| Risco | Impacto | Mitigação | Status |
|---|---|---|---|
| diferenças de impressão por navegador | Médio | CSS print e testes PDF/browser | Pendente |

**Dependências:** PRDs 003 e 004.

## 8. Referências

- [Especificação](../../MULTISHOW_FLV_ESPECIFICACAO_CODEX.md)

## 9. Registro de Decisões

- **2026-09-19:** logística digital permanece binária e deliberadamente simples.
