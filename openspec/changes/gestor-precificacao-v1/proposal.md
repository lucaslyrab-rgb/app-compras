# Proposal

## Why

O Gestor ainda não dispõe de uma área segura para manter conversões, perdas e margens dos produtos nem para transformar o custo oficial de compra em preço unitário sugerido. Esta mudança cria essa capacidade com rastreabilidade financeira e revisão explícita, sem alterar as regras homologadas de Loja, Consolidado e Lançamento de Custos além da nova natureza unitária do custo por ciclo.

## What Changes

- Persistir parâmetros de precificação por produto, com conversão provisória inicial, unidade de venda, perda de beneficiamento, margem específica opcional, origem e versão.
- Persistir configurações globais de FLV, inicialmente com custo operacional de 23% e margem líquida padrão de 20%, editáveis apenas pelo Gestor.
- Acrescentar ao custo de produto/ciclo a indicação histórica `cost_is_unit`, com padrão desmarcado e participação no mesmo autosave e controle de concorrência já existentes.
- Implementar domínio financeiro preciso para normalização unitária, perda, preço matemático, arredondamento comercial em finais 0,49/0,99 e simulação de margem/markup.
- Criar as áreas responsivas `Gestor > Produtos`, `Gestor > Precificação` e `Gestor > Configurações`, com edição versionada, estados sem custo/sem compra recente, revisão explícita e relatório de impressão.
- Criar navegação operacional com sidebar no desktop e drawer no mobile, filtrada por papel e protegida no servidor; a experiência da Loja permanece fora desse shell.
- Registrar revisões de preço como snapshots auditáveis dos dados, versões e preços calculado, sugerido e aplicado utilizados, sem integração ou escrita no ERP.
- Separar mudança de custo, mudança de parâmetros e pendência de revisão para que alterações simultâneas de valor e base permaneçam visíveis nas duas dimensões.
- Imprimir somente decisões já revisadas, usando o preço aplicado confirmado pelo Gestor.
- Ampliar testes unitários, de integração, RBAC, regressão, E2E e responsividade, preservando pedidos, snapshots e triggers de imutabilidade existentes.

## Capabilities

### New Capabilities

- `pricing/product-parameters`: cadastro versionado de conversão, unidade de venda, perda, margem específica e configurações globais de FLV.
- `purchasing/cycle-cost-basis`: captura e preservação histórica da indicação de custo unitário em cada produto/ciclo, sem mudar o restante do fluxo homologado de custos.
- `pricing/financial-calculation`: normalização do custo oficial, aplicação de perda e percentuais sobre preço de venda, arredondamento comercial e simulações com precisão decimal.
- `pricing/management-workspace`: consulta gerencial, estados de atenção, detalhe, revisão explícita e impressão de alterações em desktop e mobile.
- `navigation/role-aware-shell`: sidebar/drawer operacional e acesso server-side coerentes com LOJA, COMPRADOR e GESTOR.

### Modified Capabilities

- Nenhuma; o repositório ainda não possui especificações principais sincronizadas. Os comportamentos já homologados serão tratados como contratos de regressão desta mudança.

## Impact

- Novas migrations sequenciais após `0004`, incluindo uma extensão aditiva e sem backfill para o preço aplicado, schema Drizzle e carga inicial idempotente para produtos existentes e futuros.
- Novos módulos de parâmetros, cálculo e revisão de precificação; extensão mínima do módulo `purchasing/costs` e do importador de produtos.
- Novas rotas sob `/gestor`, redirecionamento compatível da rota legada `/produtos` e shell compartilhado apenas para áreas não-LOJA.
- Novas Server Actions e consultas com autorização GESTOR no domínio/repositório, auditoria e concorrência otimista.
- Novos componentes e estilos responsivos, além de testes Vitest, PostgreSQL e Playwright.
- Nenhuma migration antiga, trigger de imutabilidade, regra de custo oficial ou integração externa será removida ou reescrita.
