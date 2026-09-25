# Design

## Context

Ver `proposal.md` — Why. Hoje `purchaseCycle()` em `src/modules/ordering/repository.ts` converte o instante para `America/Sao_Paulo`, usa corte fixo às 19h e soma um ou dois dias corridos. A mesma função define o ciclo mostrado à Loja, o ciclo persistido no envio e, antes desta correção complementar, também alimentava indevidamente a referência de recência da Precificação.

A consulta da Precificação já filtra por produto, `purchased`, custo não nulo e ordena o custo oficial mais recente. Portanto, um draft posterior não substitui o custo oficial. O problema remanescente era conceitual: o próximo ciclo destinado a novos pedidos era usado como referência de recência e fazia uma compra oficial do próprio dia parecer histórica. A referência correta é o ciclo mais recente que possua ao menos um custo oficial comprado e válido, limitado à data operacional local; o texto de fallback deve mostrar essa referência e o ciclo do custo selecionado.

A auditoria somente leitura de 25/09/2026 encontrou 27 pedidos nos 30 dias anteriores: 8 ciclos divergiriam do calendário novo, todos em dias desabilitados; 6 registros estão ativos e 2 cancelados. Eles não serão alterados por este change.

## Goals / Non-Goals

**Goals:**

- Centralizar um algoritmo puro, determinístico e independente da MultiShow para calcular ciclos por timezone, corte e dias ISO habilitados.
- Persistir e versionar a configuração operacional separadamente de `pricing_settings`.
- Fazer leitura e atualização seguras pelo backend, com RBAC e concorrência otimista.
- Aplicar a configuração somente a novos envios, mantendo `purchase_cycle_date` como snapshot histórico.
- Preservar a consulta correta de custo oficial e eliminar ambiguidade na apresentação do fallback.

**Non-Goals:**

- Feriados, exceções por data, calendários por loja ou múltiplas organizações na mesma instalação.
- Correção automática ou manual dos oito pedidos divergentes.
- Mudanças visuais além da seção de calendário e do texto de origem do custo.
- Outros itens da homologação, inclusive logo, sticky, paginação, cadastro, Separação/Embarque ou deploy.

## Decisions

### 1. Tabela operacional própria

Criar `purchase_calendar_settings` como singleton operacional, com `id`, `timezone`, `cutoff_time`, `enabled_iso_weekdays` (`smallint[]`), `version`, `created_at` e `updated_at`. O array usa ISO 1–7; constraints exigem conjunto não vazio, valores dentro de 1–7 e versão positiva. O serviço normaliza, elimina duplicados e ordena antes de persistir.

Isso mantém calendário separado de `pricing_settings`, permite outro calendário semanal sem código e deixa espaço para futura tabela de exceções por data. Sete booleanos foram rejeitados por acoplar armazenamento e formulário; uma tabela filha foi rejeitada por exigir proteção adicional para impedir configuração vazia durante atualização.

### 2. Migration 0008 aditiva e com ownership correto

`0008_purchase_calendar_settings.sql` executará em transação, usará `CREATE TABLE IF NOT EXISTS`, seed `ON CONFLICT DO NOTHING` e terminará com `ALTER TABLE ... OWNER TO <owner do database>`, seguindo a estratégia validada na 0007. Não haverá `UPDATE` em `orders`, `purchase_cycle_product_costs` ou `pricing_reviews`.

O runner e o teste arquitetural serão atualizados para incluir 0008. A sequência 0001–0008 será executada em PostgreSQL descartável por administrador; em seguida, o papel proprietário da aplicação deverá conseguir SELECT/UPDATE na configuração e continuar sem privilégios amplos ou PUBLIC.

### 3. Algoritmo puro e serviço assíncrono

Extrair o domínio do calendário do repositório de pedidos. A função pura receberá `Date` e uma configuração validada, obterá componentes locais completos via `Intl.DateTimeFormat`, comparará o instante local com `cutoff_time` incluindo segundos e percorrerá no máximo 14 dias posteriores. Antes do corte escolhe o primeiro dia habilitado; no corte/depois escolhe o segundo. O limite finito é defesa adicional, embora a validação proíba conjunto vazio.

Datas serão incrementadas como datas civis, não como blocos de 24 horas no timezone. A conversão do cutoff local para instante UTC usará componentes do timezone, sem offset `-03:00` fixo, preservando compatibilidade com outros fusos e mudanças de offset.

O acesso normal passa por um serviço assíncrono que lê a configuração persistida. A página da Loja e o envio chamam esse serviço; o valor definitivo é recalculado no servidor no momento do envio. `cutoff_at` mantém a semântica atual: corte local do próprio dia antes das 19h e corte do dia civil seguinte quando o envio ocorre no corte/depois.

### 4. Snapshot histórico e revisão

Nenhuma leitura histórica recalcula ciclos. Novos pedidos persistem a data calculada; listagem, cancelamento e detalhes continuam lendo a coluna. A duplicidade e a revisão continuam chaveadas por loja + ciclo calculado. Alteração futura da configuração não move revisões existentes.

### 5. Módulo e interface isolados

Adicionar um subdomínio de calendário em `src/modules/ordering/calendar` com domínio, repository, service, action e formulário. A página `/gestor/configuracoes` carregará em paralelo configurações financeiras e calendário, renderizando dois painéis independentes. O formulário expõe horário, sete checkboxes e timezone controlado, reutilizando estilos existentes e mantendo inputs com área de toque adequada.

A action exige principal autenticado, mas o service/repository executa autorização GESTOR antes de leitura gerencial ou escrita. A atualização usa `expectedVersion`, auditoria própria e retorno de conflito com o estado vigente.

### 6. Precificação: seleção oficial preservada e recência efetiva

`readPricingAnalysisSources` e `persistPricingReview` manterão os filtros `purchased AND cost IS NOT NULL`, a ordenação oficial e os critérios de desempate. O limite de aplicabilidade será a data operacional local no timezone configurado. A referência de recência será calculada por `MAX(purchase_cycle_date)` entre custos oficiais aplicáveis; o custo de cada produto continuará sendo o seu oficial mais recente até essa referência.

O serviço de Precificação lerá somente o timezone do calendário para determinar a data operacional local, sem chamar o cálculo do próximo ciclo de pedidos. A nota de fallback exibirá “Sem compra no ciclo DD/MM/AAAA — usando custo oficial do ciclo DD/MM/AAAA”, usando respectivamente a referência efetiva e `officialCost.cycleDate`. Fingerprints, revisões, cálculos financeiros e status primários permanecem inalterados.

Um custo oficial com data futura não participa da referência nem da seleção antes da sua data operacional. Em dias sem compra oficial nova, a referência permanece no último ciclo efetivamente comprado, evitando que a mera passagem do calendário torne todos os produtos históricos.

## Risks / Trade-offs

- **[Configuração alterada enquanto a Loja está com a tela aberta]** → o envio recalcula server-side e persiste a configuração vigente; a resposta de conflito/revisão continua baseada no ciclo efetivamente calculado.
- **[Timezone IANA inválido ou sem suporte no runtime]** → validação server-side instancia `Intl.DateTimeFormat` antes de persistir; a configuração anterior permanece intacta.
- **[Loop ou data ausente]** → conjunto vazio é rejeitado no domínio e no banco; o algoritmo possui busca limitada e falha explicitamente.
- **[Ciclos históricos em dias agora desabilitados]** → permanecem consultáveis e não são tocados; relatório identifica os oito registros para decisão separada.
- **[Dois changes ativos tratam Precificação]** → este change adiciona somente um contrato explícito de seleção/apresentação e não reabre matemática, revisões ou parâmetros homologados.

## Migration Plan

1. Executar validações locais e a sequência 0001–0008 em banco descartável com papéis admin/aplicação distintos.
2. Auditar novamente, somente leitura, os pedidos divergentes e anexar a lista ao relatório; não corrigi-los.
3. Criar commit local isolado, sem push ou deploy.
4. Em rollout futuro autorizado: backup, preflight, aplicar somente 0008 por job one-shot, validar ownership e acesso como `app_compras`, depois promover a aplicação.
5. Rollback da aplicação pode usar a imagem anterior; a tabela nova é aditiva e não deve ser removida automaticamente.
