# Design

## Context

Ver `proposal.md` — Why. Estado atual relevante, conferido na `main` em 29/10/2026 (commit `01743c9`, imagem `sha-a2fece68` em produção):

- **Pedido:** `orders` + `order_items` são imutáveis (trigger `prevent_order_mutation`). Cada revisão é uma linha nova; cancelamento preenche `cancelled_at`. A quantidade é digitada no formato de compra do produto (`products.purchase_format`, normalmente CX).
- **Destinação:** `purchase_cycle_product_allocations` por ciclo × fornecedor × produto × loja, com `ordered_quantity`, `destined_quantity`, `purchase_format`, `is_additional_purchase` e **`conversion_factor_kg`**, que é a cópia de `product_pricing_parameters.conversion_quantity` no momento da destinação e não é sobrescrita depois (`COALESCE` no upsert). Decisões de não compra ficam em `purchase_cycle_product_supplier_decisions`. O fechamento por loja (`purchase_cycle_store_closures`, `is_current`) registra `order_id`/`order_revision` e o resumo de cortes usado na Conferência Conjunta dos Cortes.
- **Conversão cadastrada:** `product_pricing_parameters` (`sale_unit`, `conversion_quantity`), editada em Gestor → Produtos → Parâmetros de precificação. Ex.: Abacate, formato CX, unidade de venda KG, conversão 20 → 1 CX = 20 kg. Para produtos com unidade de venda UND (ex.: Abacaxi, 10 und), a conversão não é em peso.
- **Conferência (Fase 5):** `store_delivery_conferences` (uma por ciclo × loja) e `store_delivery_conference_items` criados **a partir dos itens do pedido** com quantidade > 0, com peso em KG, `is_unreceived` e `removed_from_order`. Compras adicionais da destinação não geram item de conferência.
- **Permissões:** catálogo em `src/modules/identity/domain.ts` e constraint `users_permissions_valid_check` (última versão na 0018). Perfis-base `LOJA`, `COMPRADOR`, `GESTOR`.
- **Padrão de tela:** a Consulta de Perdas usa filtros em `searchParams`, KPIs agregados no banco e lista paginada.

## Goals / Non-Goals

**Goals:**

- Consulta somente leitura que mostre, por loja × ciclo × produto, pedido, destinação, peso esperado, peso conferido e destaques.
- Regras de classificação em funções puras, testáveis, separadas do SQL.
- Encontrar rapidamente as pesagens que não conferem, sem bloquear nada.
- Migration mínima, aditiva.

**Non-Goals:** ver `proposal.md` — Non-goals.

## Decisions

### 1. Confronto calculado na leitura

O confronto é montado a cada consulta a partir das tabelas de origem, seguindo o ADR-005 (consolidado como leitura). Materializar foi rejeitado: criaria outra “verdade” que poderia ficar desatualizada após uma revisão de pedido ou reconciliação de conferência. Consultas limitadas por período (decisão 7).

### 2. Grão e fontes

A linha é **ciclo × loja × produto** e existe quando o produto aparece em pelo menos uma das fontes.

| Coluna | Fonte e regra |
|---|---|
| Pedido | `order_items` da revisão de referência: a revisão do fechamento vigente da loja (`purchase_cycle_store_closures.is_current`) ou, sem fechamento, a maior revisão não cancelada. Mostra o número da revisão. |
| Destinado | Soma de `destined_quantity` entre fornecedores com o mesmo `purchase_format`. Formatos diferentes são exibidos separados, sem soma. Lista os fornecedores. |
| Situação | Integral, Corte parcial, Corte total ou Adicional (decisão 3). |
| Peso esperado | Destinado × fator de conversão em kg (decisão 4). |
| Conferido | Peso em KG, “Não recebido”, “Pendente” ou “Fora da conferência”. Mostra a revisão de pedido usada pela conferência quando for diferente da revisão de referência. |
| Diferença | Conferido − esperado, em kg e em %, quando houver peso esperado e peso conferido. |

### 3. Situação pedido × destinação (informativa)

Mesmas regras da Conferência Conjunta dos Cortes, comparando na mesma unidade:

| Situação | Regra |
|---|---|
| Integral | Pedido > 0 e destinado = pedido |
| Corte parcial | 0 < destinado < pedido |
| Corte total | Pedido > 0 e destinado = 0 (com “Não comprado” se houver decisão `NOT_PURCHASED`) |
| Adicional | Pedido = 0 ou ausente e destinado > 0; ou destinado > pedido (mostra a quantidade adicional) |

A situação **não** é destaque. Fica disponível como filtro.

### 4. Peso esperado pela conversão cadastrada

- O fator é usado somente quando a unidade de venda do produto (`product_pricing_parameters.sale_unit`, normalizada) for **KG**. Caso contrário a linha mostra “Sem conversão em kg” e não recebe destaque de pesagem.
- Fator preferencial: `allocations.conversion_factor_kg` (cópia do momento da destinação). Se nulo, usa `conversion_quantity` atual do produto, com a indicação “conversão atual do cadastro”.
- Se fornecedores tiverem fatores diferentes para o mesmo produto/loja, o peso esperado é a soma de `destined_quantity × fator` de cada destinação.
- Se a destinação já estiver em KG, o peso esperado é a própria quantidade destinada.
- O cálculo é exibido em destaque apenas visual; nenhum valor é gravado.

Exemplo: destinado 3 CX de Abacate, fator 20 → esperado 60,00 kg; conferido 52,30 kg → diferença −7,70 kg (−12,8%) → destaque “Peso abaixo do esperado”.

### 5. Faixas de pesagem e destaques

Quando houver peso esperado e peso conferido, a diferença percentual `(conferido − esperado) / esperado` define a faixa de cor da coluna de pesagem. Não há tolerância que esconda diferenças: toda diferença aparece, porque sobras e faltas de poucos quilos são tratadas no StarTwo. As faixas servem para leitura rápida.

| Faixa | Cor | Regra | Mensagem |
|---|---|---|---|
| `WEIGHT_OK` | Verde | 0% ≤ diferença ≤ +5% | — |
| `WEIGHT_SLIGHTLY_BELOW` | Laranja | −5% ≤ diferença < 0% | — |
| `WEIGHT_OUT_OF_RANGE` | Vermelho, linha destacada | diferença < −5% ou > +5% | “Pesagem X% abaixo do esperado (−Y kg)” ou “Pesagem X% acima do esperado (+Y kg)” |

Os limites de 5% ficam numa constante nomeada (`WEIGHT_RANGE_PERCENT = 5`). Somente `WEIGHT_OUT_OF_RANGE` é destaque; verde e laranja são apenas cor.

Demais destaques, devolvidos pela função pura `classifyReconciliationLine()`:

| Código | Rótulo | Regra |
|---|---|---|
| `NOT_RECEIVED` | Não recebido | Item de conferência `is_unreceived` com destinado > 0 |
| `RECEIVED_NOT_DESTINED` | Recebido sem destinação | Peso > 0 na conferência e destinado = 0 ou ausente |
| `DESTINED_OUT_OF_CONFERENCE` | Fora da conferência | Destinado > 0, conferência existente e produto sem item na conferência (adicionais) |
| `CONFERENCE_PENDING` | Conferência pendente | Destinado > 0 e conferência inexistente ou em andamento. Contado à parte, como contexto |

Visual: `WEIGHT_OUT_OF_RANGE` e `NOT_RECEIVED` usam faixa lateral vermelha na linha; `RECEIVED_NOT_DESTINED` e `DESTINED_OUT_OF_CONFERENCE` usam etiqueta azul; pendente usa cinza.

### 6. Exemplos

| Esperado | Conferido | Diferença | Resultado |
|---|---|---|---|
| 60,00 kg | 61,50 kg | +2,5% | Verde |
| 60,00 kg | 58,20 kg | −3,0% | Laranja |
| 60,00 kg | 52,30 kg | −12,8% | Vermelho: “Pesagem 12,8% abaixo do esperado (−7,70 kg)” |
| 60,00 kg | 66,60 kg | +11,0% | Vermelho: “Pesagem 11,0% acima do esperado (+6,60 kg)” |

### 7. Tela `/fechamento`

- **Filtros:** loja (todas ou uma), ciclo inicial e final (padrão: últimos 7 dias; máximo 31 dias), fornecedor, busca por produto/ERP, situação (Integral/Corte parcial/Corte total/Adicional), destaque, e “somente com destaque” (ligado por padrão).
- **Cartões:** pesagens fora da faixa de 5%, não recebidos, fora da conferência, conferências pendentes.
- **Tabela (desktop):** ciclo, loja, produto, pedido, destinado + situação, esperado, conferido, diferença, destaques.
- **Mobile (390px):** um cartão por linha, sem rolagem horizontal.
- Números em pt-BR (`1.234,50 kg`, `20,00 CX`), estado vazio com mensagem única, paginação de 50 linhas (“Carregar mais”) e KPIs calculados no servidor sobre todo o filtro de loja, período, fornecedor, produto e situação (sem o recorte de destaque, para os cartões continuarem úteis como atalhos). Os cartões funcionam como atalho para filtrar pelo destaque. Com um destaque escolhido, “somente com destaque” não esconde a conferência pendente.

### 8. Módulo

```
src/modules/purchasing/reconciliation/
  domain.ts       // tipos, normalizeUnit, cutSituation, expectedWeight, classifyReconciliationLine, buildKpis
  repository.ts   // somente SELECT das fontes do período/loja
  service.ts      // valida filtros, aplica o domínio, filtros finos, KPIs e paginação
  reconciliation-workspace.tsx
src/app/fechamento/page.tsx
```

Um teste arquitetural falha se `repository.ts` contiver `INSERT`, `UPDATE` ou `DELETE`.

### 9. Permissão e menu

- `fechamento:consultar`: backfill para `GESTOR`; incluída em `ROLE_DEFAULT_PERMISSIONS.GESTOR`; **não** incluída no padrão do Comprador; atribuível pela tela de Usuários a qualquer usuário sem permissão de loja, em um grupo “Controle”.
- A gestão de usuários recusa a combinação de `fechamento:consultar` com permissões de loja.
- Menu: grupo “Controle” com o item “Fechamento integrado”, exibido uma única vez para quem tiver a permissão. `resolveOperationalRoute` leva para `/fechamento` o usuário do CPD que só tem essa permissão (`/inicio` é exclusivo das lojas e não muda). `/fechamento` tem layout próprio com o menu, porque o usuário do CPD não passa pelos layouts de Comprador e Gestor.
- A página verifica a permissão no servidor e redireciona para `/sem-acesso`.

### 10. Migration 0021

`0021_phase6_reconciliation_permission.sql`, em transação e idempotente:

1. Recria `users_permissions_valid_check` com as 14 permissões atuais + `fechamento:consultar`.
2. `UPDATE users SET permissions = array_append(permissions, 'fechamento:consultar') WHERE role = 'GESTOR' AND NOT ('fechamento:consultar' = ANY(permissions))`.

Nenhuma tabela nova; nenhum outro `UPDATE`; nenhum `DELETE`.

## Risks / Trade-offs

- **Conversão é média, não exata.** Caixas de produtos pesados variam. As faixas de cor separam o que é variação normal (verde/laranja) do que merece olhar (vermelho), e o destaque é apenas visual. Se muitos produtos ficarem sempre fora, é sinal de conversão desatualizada no cadastro.
- **Destinações antigas sem fator copiado.** Usa-se a conversão atual com indicação visível.
- **Unidade do pedido não é snapshot.** A situação de corte compara na unidade da destinação; se o formato do produto mudar entre pedido e destinação, a linha indica “unidade atual do produto”.
- **Conferência sobre revisão anterior.** A linha indica a revisão usada pela conferência.
- **Carga no servidor.** Período limitado, paginação e KPIs no banco; build e testes fora do servidor de produção.

## Migration Plan

1. Executar 0001–0021 em PostgreSQL descartável; validar constraint, rerun e backfill (Gestor com a permissão, Comprador e Loja sem).
2. Deploy normal via `main` → GitHub Actions → GHCR → Portainer.
3. Rollback: reverter a imagem no Portainer. A constraint nova aceita o conjunto antigo; a permissão extra fica sem uso.

## Open Questions

Nenhuma.
