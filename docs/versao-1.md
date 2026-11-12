# Versão 1.0 — primeira versão completa em produção

**Data:** 02/11/2026 · **Ambiente:** compras.muitomaisatacado.com · **Commit em produção:** `4b39d1b` (PR #18)

Este documento registra o que está em uso na primeira versão completa do Sistema de Compras MultiShow FLV e as decisões de produto tomadas até aqui. As regras de negócio de referência continuam no [Planejamento v2.0](PLANEJAMENTO.md); quando houver diferença, valem as decisões registradas abaixo, que são mais recentes.

## O que está em produção

### Lojas (Ponta da Fruta, Balneário, Santa Mônica)

| Tela | O que faz |
|---|---|
| **Início** (`/inicio`) | Entrada após o login. Cartões com a situação do dia: pedido (não enviado, rascunho ou enviado, com o prazo), conferência (itens pesados e pendentes), perdas de hoje e histórico. Mostra um aviso do que falta fazer. |
| **Pedido de hoje** (`/`) | Estoque e quantidade por produto, com foto, busca e filtros; salvar rascunho e enviar pedido (com revisão até o prazo). |
| **Conferência da chegada** (`/conferencia`) | Pesagem em KG a partir do pedido original, “Não recebido (0 KG)”, item recebido fora do pedido (registra quem lançou), salvamento parcial e finalização só com tudo verificado. |
| **Perdas** (`/perdas`) | Escolha do produto por fotos (“Chegaram na última compra” e lista A–Z), quantidade em KG ou UND, motivo e observação. Bloqueio de lançamento duplicado em até 120 s, com confirmação explícita. |

Cabeçalho único em todas as telas da loja: “‹ Início” para voltar, nome da tela e da loja, e menu da conta (Minha senha / Sair). Não existe mais o botão “Módulos”: a escolha da atividade é feita no Início.

### Comprador

| Tela | O que faz |
|---|---|
| **Consolidado** | Pedidos das três lojas por produto; no celular, lista com as cores das lojas e estoque opcional. **Relatório A4** em uma folha com todos os produtos (traço onde não há pedido, para anotar oportunidades). |
| **Lançamento de custos** | Custo atual, custo anterior, “custo unitário” e marcação de comprado, com salvamento automático. No celular, cartão compacto (máximo de produtos por tela) e contadores dentro dos filtros. |
| **Destinação** | Fluxo Loja → Fornecedor → Produtos pensado para o celular: escolha de loja com progresso, troca de fornecedor em folha com busca, cartões com − / + e “Usar pedido”, filtro de pendentes, rodapé Salvar / Próximo e conferência de cortes em tela cheia. Notas fiscais (número + foto) vinculadas por loja. |
| **Perdas FLV** | Painel de perdas das lojas. |

### Gestor e CPD

- **Fechamento integrado** (`/fechamento`): desde a 1.2, um ciclo por vez em duas abas — **Caminho dos produtos** (pedido → compra → destinação → conferência e o desfecho de cada produto) e **Valor por loja** (comprado, recebido pela conferência e diferença, por fornecedor e nota). Usa a conversão cadastrada de cada produto e as perdas dos dias seguintes. Somente informativo, sem bloqueio.
- **Perdas:** o Gestor pode excluir um lançamento errado (com registro de quem excluiu).
- **Configurações:** calendário de compras e **encerrar ciclo** antigo (fecha Destinação e conferências do ciclo de uma vez).
- Cadastros de **fornecedores** (nome fantasia obrigatório; inativos não aparecem na Destinação), **produtos**, **precificação** e **usuários/permissões**.

## Decisões registradas

| Data | Decisão |
|---|---|
| 29/10 | Fase 6 sem “Área do CPD”: lançamento fiscal e notas continuam no StarTwo. O confronto é apenas informativo. |
| 29/10 | Pesagem: verde de 0 a +5% do peso esperado, laranja de −5% a 0, vermelho além de ±5% com mensagem. |
| 29/10 | O confronto é visto por Gestor e CPD (permissão `fechamento:consultar`); Comprador e Loja não veem. |
| 01/11 | Item recebido sem pedido: a loja lança na conferência (“recebido fora do pedido”), registrando quem lançou, para responsabilização. |
| 01/11 | Encerrar ciclo (Gestor) fecha o ciclo inteiro: Destinação e conferências. |
| 01/11 | “Sem fornecedor” é calculado por loja; nome fantasia obrigatório (preenchido com os 15 primeiros caracteres da razão social quando vazio). |
| 02/11 | Identidade visual única: fonte Inter, verde da marca #006B4F, cores fixas por loja (PF azul, BA verde, SM laranja) e selos de situação padronizados. |
| 02/11 | Destinação e Custos são telas do comprador usadas **exclusivamente no celular**: a regra é caber o máximo de itens por tela. |
| 02/11 | Pedido, Conferência e Custos mantêm a estrutura já usada pelas lojas e pelo comprador; mudam só as cores. |
| 02/11 | Perdas começam sem produto selecionado (antes vinha o primeiro da lista), para evitar lançamento no produto errado. |
| 02/11 | O Início mostra primeiro a conferência ainda em andamento (a mais antiga) e ignora ciclos encerrados. |
| 04/11 | Destinação começa em zero; zero = não comprou daquele fornecedor. Comprado sem destino trava a finalização da loja; zerado só para a loja pede confirmação do corte. |
| 11/11 | Cada versão é testada no ambiente local do Lucas (PC e celular) antes de ir para produção; sem homologação no servidor. |
| 12/11 | Fechamento integrado por ciclo, com o caminho de cada produto e o valor por loja. Valor comprado = destinado × custo do ciclo; valor recebido = valor comprado ajustado pelo peso da conferência finalizada (não recebido conta zero; sem pesagem conta o comprado). |

## Histórico de entregas (PRs)

| PR | Data | Entrega |
|---|---|---|
| #1 | 13/10 | Cadastro de fornecedores |
| #3 | 24/10 | Destinação: seleção de loja, saldo por fornecedor e decisões de compra |
| #4 | 27/10 | Planejamento consolidado v2.0 |
| #6 | 27/10 | Fase 4 — notas fiscais na Destinação |
| #7, #8 | 28/10 | Fase 5 — conferência de entregas e perdas |
| #9 | 29/10 | Fase 6 — Fechamento integrado |
| #10 | 02/11 | Ajustes pós-Fase 6: exclusão de perda pelo Gestor, bloqueio de duplicadas, item fora do pedido, quem destinou |
| #11 | 02/11 | Destinação e ciclos: fornecedores inativos, nome fantasia, encerrar ciclo, “sem fornecedor” por loja |
| #12 | 02/11 | Base visual, Consolidado no celular e relatório A4 |
| #13 | 02/11 | Menu lateral com rolagem e ícones |
| #14, #15 | 02/11 | Destinação redesenhada para o celular |
| #16 | 02/11 | Custos compacto, Início da loja, Perdas com fotos, cores novas em Pedido e Conferência |
| #18 | 02/11 | Cabeçalho único da loja e conferência pendente no Início |
| #20, #21 | 04–05/11 | **1.1** — Destinação começa em zero, travas de fechamento, notas mais rápidas |
| #22, #23, #24 | 06–11/11 | **1.1** — Lista de fornecedores fixa, imagem do servidor atualizada, ambiente local |
| #25 | 12/11 | **1.2** — Fechamento integrado novo (caminho dos produtos e valor por loja), pedidos e ciclo de teste |

## Como seguimos

- Ajustes pequenos são acumulados em um PR e publicados quando o Lucas pedir.
- Todo PR passa pelo CI (lint, tipos, testes unitários e de integração, build, auditoria) antes do merge; o deploy é automático ao entrar na `main` (GHCR → Portainer).
- Propostas visuais ficam no quadro de design “MultiShow FLV — Nova interface” antes de virar código.

### Pendências e ideias anotadas

- Cadastro de lojas pelo Gestor (incluir, inativar), antes da loja nova de dezembro e do fechamento do Balneário.
- Destinação mais compacta (mesmo critério de Custos), se o comprador sentir falta no uso.
- Relatórios gerenciais: especificar depois de observar a operação.
