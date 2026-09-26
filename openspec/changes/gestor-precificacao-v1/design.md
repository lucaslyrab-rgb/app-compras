# Design

## Context

Veja `proposal.md` para a motivação e os arquivos em `specs/` para o contrato observável. A aplicação é um monólito modular Next.js 16.3.5 com Server Components/Actions, PostgreSQL 18, Drizzle e valores `NUMERIC` lidos como strings. O módulo de custos já possui autosave por linha, custo oficial definido por `purchased=true`, correção na mesma linha e versão otimista; o runner de migrations reaplica uma lista explícita de SQLs idempotentes.

Existem apenas as migrations `0001` a `0004`. As triggers de imutabilidade de pedidos e snapshots pertencem às migrations antigas e não serão tocadas. O catálogo atual possui formato de compra, mas não contém os parâmetros de venda necessários. Não há biblioteca decimal instalada. As referências `Gestor-Cadastro` e `Gestor-precificação` foram sincronizadas de `origin/main` e inspecionadas em resolução original antes da implementação.

As duas referências medem 1536 × 1024 px. A composição aprovada reserva aproximadamente 220–230 px para a sidebar verde e divide a área útil em uma lista/tabela de cerca de dois terços e um painel de trabalho de cerca de um terço. A hierarquia observada é breadcrumb/título, resumo de configurações, quatro indicadores, busca/filtros e área de trabalho; Cadastro destaca o formulário do produto à direita, enquanto Precificação usa o mesmo espaço para explicar o cálculo, dar destaque verde ao preço sugerido e manter a simulação abaixo. Badges amarelos, vermelhos, verdes e azuis foram mantidos com a semântica da referência.

A auditoria somente leitura de 25/09/2026 confirmou os dois últimos custos oficiais dos oito produtos investigados, sem alterar qualquer linha. Batata Inglesa permaneceu em 100→100 na mesma base e, portanto, não é `COST_CHANGED`. Abacate 50→60, Aipim 80→75, Banana Nanica 60→63 e Cebola Roxa 100→120 mantiveram `cost_is_unit=false`, logo são mudanças econômicas exatas e seguras. Banana Prata 3 não unitário→2,50 unitário e Berinjela 3 não unitário→3 unitário partem de registros de 23/09 anteriores à metadata histórica; Chuchu 70 não unitário→50 unitário tem custo anterior de 24/09 às 10:51, também anterior à criação dos parâmetros às 11:38. Nos três casos a mudança de base não pode ser reconstruída com segurança e resulta em `PARAMETERS_CHANGED`, sem inferência de aumento ou redução.

## Goals / Non-Goals

**Goals:**

- Introduzir dados de precificação de forma aditiva, idempotente e reversível, sem sobrescrever configuração manual.
- Manter o custo original como fonte auditável e realizar toda conversão em um domínio financeiro puro.
- Tornar revisão e invalidação derivadas das entradas efetivamente utilizadas, não de estado visual.
- Concentrar autorização no servidor e passar aos Client Components somente DTOs gerenciais necessários.
- Compartilhar apenas o chrome operacional entre Comprador e Gestor, preservando os workspaces internos e todo o fluxo da Loja.

**Non-Goals:**

- Alterar pedido, Consolidado, regra de custo oficial, ciclo, cancelamento ou triggers de imutabilidade.
- Implementar ERP, preço vigente externo, importação definitiva de parâmetros, fotos, fornecedores ou Separação/Embarque.
- Implementar agora a reabertura de “Falta comprar” após aumento de quantidade por loja.
- Usar a coluna legada `products.markup` como margem da nova Precificação; ela permanece intacta até haver decisão de migração específica.

## Decisions

### 1. Migrations aditivas e carga idempotente

Serão criadas duas migrations novas e acrescentadas, em ordem, à lista explícita de `scripts/migrate.ts`:

1. `0005_pricing_parameters_and_cost_basis.sql`: adiciona `cost_is_unit boolean NOT NULL DEFAULT false`, cria parâmetros por produto e configuração global e faz a carga inicial com `INSERT ... ON CONFLICT DO NOTHING`.
2. `0006_pricing_reviews.sql`: cria o histórico append-only de revisões e seus índices/guardas de imutabilidade.

Separar fundação e revisões facilita validar/backfill antes de introduzir snapshots. Alterar migrations antigas ou inserir colunas diretamente em `products` foi rejeitado porque mistura dados mestres com parâmetros evolutivos e dificulta histórico futuro.

`product_pricing_parameters` terá uma linha por produto, com `product_id` como chave/FK restritiva, `sale_unit`, `conversion_quantity NUMERIC(14,6)`, `conversion_origin` (`PROVISIONAL`, `UNIT`, `MANUAL`), `beneficiation_loss_percent NUMERIC(7,4)`, `specific_margin_percent NUMERIC(7,4) NULL`, `version`, `created_at` e `updated_at`. Checks de banco repetirão os limites do domínio.

`pricing_settings` será singleton identificado por `FLV`, com `operating_cost_percent NUMERIC(7,4)`, `default_margin_percent NUMERIC(7,4)`, `version` e timestamps. A soma menor que 100 será validada no domínio e em constraint. A linha inicial será 23/20 e nunca será sobrescrita em rerun.

O importador fará, na mesma transação de cada upsert de produto, um `INSERT ... ON CONFLICT DO NOTHING` dos parâmetros padrão. Assim produtos importados depois da migration também ficam completos e configuração manual nunca é reinicializada. Formato fora de CX, SC, UND, PCT ou BDJ será rejeitado na importação/backfill com diagnóstico, em vez de receber conversão inventada.

### 2. Revisões como snapshots imutáveis

`pricing_reviews` será append-only e guardará: produto, usuário, instante, id/versão/data/valor/`cost_is_unit` do custo oficial, unidade de venda, conversão, origem, perda, custo operacional, margem aplicada e sua origem, custo bruto, custo efetivo, preço calculado e preço sugerido. Valores derivados usarão `NUMERIC(18,6)`; o sugerido usará duas casas.

Também serão guardadas as versões de parâmetro e configuração para diagnóstico. Um fingerprint canônico continuará cobrindo fonte/versão do custo oficial, `cost_is_unit`, unidade/conversão/perda e percentuais efetivamente aplicados, mas seu papel será estritamente técnico: detectar concorrência entre abertura e confirmação e provar quais entradas formaram o snapshot. Id, versão ou ciclo diferentes não provarão mudança econômica.

O estado `COST_CHANGED` será derivado separadamente pela comparação racional exata entre o custo oficial atual e o oficial imediatamente anterior. Custos com a mesma natureza serão comparados diretamente; quando a natureza unitária diferir, ambos serão normalizados pela conversão aplicável somente se a metadata histórica e a estabilidade dos parâmetros tornarem a equivalência demonstrável. Sem custo anterior, o estado será `NOT_REVIEWED`. Unidade, conversão, perda ou margem divergentes do snapshot, assim como base incompatível ou historicamente não reconstruível, resultarão em `PARAMETERS_CHANGED`. Um custo normalizado idêntico nunca resultará em `COST_CHANGED`.

Abrir detalhe, simular ou imprimir não escreve revisão. A action de revisão relê todas as fontes dentro de transação, compara o fingerprint esperado e só então insere o snapshot. UPDATE/DELETE de revisão serão bloqueados por trigger própria; isso não reutiliza nem modifica as triggers dos pedidos.

### 3. Aritmética racional baseada em `bigint`

O domínio financeiro receberá strings decimais canônicas do banco e as transformará em frações inteiras (`numerator`/`denominator` com `bigint`). Normalização, perda e fórmula de preço serão compostas como razões exatas; conversão para `NUMERIC(18,6)` ocorrerá apenas ao persistir snapshots e formatação monetária ocorrerá somente na borda da UI.

Adicionar uma biblioteca decimal foi rejeitado para evitar nova dependência e porque as fórmulas da V1 são pequenas e determinísticas. Usar `number` foi rejeitado por introduzir erros binários justamente nos limites 0,20 e 0,60.

O arredondamento comercial será uma função pura única que compara a parte fracionária exata com 20/100 e 60/100. Para fração menor que 0,20, retorna 0,99 do inteiro anterior; entre os limites inclusive, 0,49 do mesmo inteiro; acima de 0,60, 0,99 do mesmo inteiro. Preço calculado e sugerido permanecem campos distintos. Um resultado sugerido não positivo será tratado como erro de cálculo/configuração, pois o documento não define preço comercial abaixo de R$ 0,20 e o sistema não deve exibir valor negativo enganoso.

### 4. Fonte oficial e ciclo corrente

A consulta de Precificação partirá dos produtos ativos e do ciclo operacional retornado pelo calendário já existente em `purchaseCycle()`. Para cada produto, escolherá primeiro uma linha comprada nesse ciclo; na ausência, escolherá a linha comprada histórica mais recente pela mesma ordenação determinística usada no módulo de Custos. Linhas `purchased=false` são ignoradas mesmo quando mais novas.

Ausência total gera `NO_COST`; fonte anterior ao ciclo gera `STALE_PURCHASE`; fonte do ciclo não recebe esse aviso. O custo e `cost_is_unit` são consumidos diretamente da mesma linha oficial. Não será materializado custo convertido na tabela de custos.

### 5. Extensão mínima do autosave de Custos

`costIsUnit` entrará nos tipos de estado, DTO, schema da action e comando SQL de insert/upsert. A versão continuará sendo uma só para a linha inteira. O Client Component adicionará o checkbox ao estado mutável e à fila já existente; não haverá segundo autosave independente.

Uma linha ainda inexistente no novo ciclo começa com `costIsUnit=false`, conforme o padrão explicitado, mesmo quando a interface apresenta o último custo oficial como valor herdado. A gravação cria a metadata daquele ciclo sem alterar o registro histórico anterior. Valor, comprado, `purchased_at`, correção, destaque, Enter, blur, filtros e ciclos continuam com a lógica atual.

### 6. Serviços e autorização por domínio

Será criado um módulo `pricing` com subdomínios para parâmetros, cálculo, consulta gerencial e revisões. Repositórios serão server-only e receberão `Principal`. Leitura e escrita gerencial exigirão GESTOR, exceto Consolidado/Custos, que continuarão permitindo COMPRADOR e GESTOR. Toda Server Action fará autenticação e o serviço/repositório repetirá a autorização crítica, seguindo defesa em profundidade.

Os DTOs não exporão linhas completas de usuário, sessão ou auditoria. Atualizações de parâmetros/configurações usarão `WHERE version = expectedVersion`, retornarão conflito explícito e gravarão `audit_events`. A rota e a action serão igualmente protegidas; ocultar o menu não será controle de acesso.

### 7. Rotas e composição responsiva

As rotas previstas são:

- `/gestor/produtos` e `/gestor/produtos/[id]`;
- `/gestor/precificacao` e `/gestor/precificacao/[id]`;
- `/gestor/precificacao/impressao`;
- `/gestor/configuracoes`.

`/produtos` passará a redirecionar Gestor para `/gestor/produtos`, mantendo proteção server-side para outros papéis. Um layout operacional autenticado fornecerá sidebar em desktop e drawer em mobile. Ele envolverá rotas de Comprador e Gestor sem modificar os componentes de negócio internos; rotas da Loja continuarão usando a composição atual.

Produtos e Precificação usarão tabela a partir do breakpoint de desktop e cards abaixo dele. O detalhe de desktop poderá ocupar painel lateral controlado pela seleção; no mobile a rota dinâmica será uma página dedicada. Inputs permanecerão com fonte mínima de 16 px no iOS e alvos interativos de pelo menos 44 px. Cores terão semântica estável: vermelho somente para atenção, amarelo para provisório, verde para revisado e azul para informação.

### 8. Relatório de impressão HTML

A impressão será uma rota autenticada renderizada no servidor, com CSS A4 e botão cliente que chama `window.print()`. A rota listará produtos calculáveis cuja revisão não está atual, sem criar revisão nem alterar estados. Gerar PDF no servidor foi rejeitado por adicionar dependência e não trazer benefício à V1.

### 9. Estratégia de teste

O domínio puro terá testes de normalização para CX/SC/UND/PCT/BDJ, perda, denominador, todos os limites comerciais e simulação. Integração PostgreSQL cobrirá backfill, constraints, concorrência, `cost_is_unit`, seleção oficial/histórica, drafts ignorados, snapshot e RBAC.

Playwright cobrirá os fluxos gerenciais e regressões de Custos, Consolidado e Loja. Os viewports mínimos serão 320, 375, 390, 412, 768 e 1280 px; serão verificados overflow, drawer, edição, detalhe, simulação e impressão. A suíte atual não será relaxada.

## Risks / Trade-offs

- **[Risco] Registros históricos anteriores à migration recebem `cost_is_unit=false`, embora algum fornecedor possa ter informado valor unitário no passado.** → Tornar o backfill explícito, permitir correção versionada pelo fluxo atual e não inferir metadata inexistente.
- **[Risco] Valor herdado em novo ciclo começa com checkbox desmarcado.** → Exibir o controle junto ao custo e cobrir o comportamento em E2E; segue o padrão solicitado, mas exige atenção operacional quando o custo anterior era unitário.
- **[Risco] Consultas de lista podem crescer com produtos e revisões.** → Resolver custo oficial/revisão em uma consulta por conjuntos com índices por produto/data e evitar N+1; paginação fica preparada, mas não é necessária para o catálogo atual.
- **[Risco] O singleton global pode ser atualizado em duas sessões.** → Usar versão otimista e reler o registro no conflito.
- **[Risco] Migrations são reaplicadas em todo deploy.** → Usar DDL idempotente e inserts não destrutivos; validar primeira aplicação e reaplicação em PostgreSQL efêmero.
- **[Risco] Uma migration aplicada não deve ser revertida apagando dados em produção.** → Rollback de aplicação usa a imagem anterior, mantendo colunas/tabelas aditivas compatíveis; remoção física exigiria mudança separada e aprovada.

## Migration Plan

1. Obter e inspecionar `Gestor-Cadastro` e `Gestor-precificação` antes de implementar a camada visual.
2. Criar as migrations novas, atualizar o schema e o runner; testar aplicação limpa, upgrade de `0004` e reaplicação idempotente.
3. Implantar domínio financeiro e repositórios com testes unitários/integrados antes de expor rotas.
4. Estender Custos com `cost_is_unit` e concluir suas regressões antes das telas gerenciais.
5. Implementar Produtos, Configurações, Precificação, navegação e impressão incrementalmente.
6. Executar lint, typecheck, unitários, integração, E2E relevante e build de produção.
7. Somente após revisão do relatório e autorização de deploy, publicar imagem imutável pelo pipeline existente, aplicar migrations, validar digest, UpdateStatus, tarefa/contêiner, RestartCount e `/api/health`.
8. Em rollback, restaurar a imagem anterior; as adições de schema permanecem sem afetar o código antigo porque `cost_is_unit` possui default e as novas tabelas são independentes.
