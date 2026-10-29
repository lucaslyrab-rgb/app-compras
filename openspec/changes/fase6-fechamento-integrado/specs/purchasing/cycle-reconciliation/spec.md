# Spec Delta

## Purpose

Define o módulo Fechamento integrado, que apresenta por loja, ciclo e produto o pedido, a destinação, o peso esperado pela conversão cadastrada e o peso conferido, destacando o que precisa de atenção sem bloquear nem alterar os registros de origem.

## ADDED Requirements

### Requirement: Confronto por loja, ciclo e produto
O sistema SHALL apresentar uma linha por combinação de ciclo, loja e produto que exista em pelo menos uma das fontes: revisão de referência do pedido, destinação ou conferência.

#### Scenario: Produto presente nas três fontes
- **WHEN** a loja pediu 3 CX de um produto, o comprador destinou 3 CX e a conferência registrou 58,20 KG
- **THEN** a linha SHALL mostrar pedido 3 CX com o número da revisão, destinado 3 CX com os fornecedores e conferido 58,20 KG

#### Scenario: Produto apenas destinado
- **WHEN** um produto foi destinado como compra adicional e não consta no pedido
- **THEN** a linha SHALL existir com a coluna de pedido vazia e situação “Adicional”

### Requirement: Revisão de referência do pedido
O sistema SHALL usar como pedido de referência a revisão registrada no fechamento vigente da loja para o ciclo e, na ausência de fechamento, a maior revisão não cancelada do ciclo.

#### Scenario: Loja com fechamento vigente
- **WHEN** o fechamento vigente da loja aponta para a revisão 2 e existe uma revisão 3 posterior
- **THEN** o confronto SHALL usar a revisão 2 e exibir o número da revisão usada

#### Scenario: Conferência sobre revisão diferente
- **WHEN** a conferência da loja foi criada a partir de uma revisão diferente da revisão de referência
- **THEN** a linha SHALL indicar a revisão usada pela conferência

### Requirement: Registros originais preservados
A consulta SHALL ser calculada no momento da leitura e MUST NOT inserir, atualizar ou excluir pedidos, itens de pedido, destinações, decisões, conferências, itens de conferência, perdas, notas ou parâmetros de produtos.

#### Scenario: Consulta não altera dados
- **WHEN** um usuário consultar o Fechamento integrado de qualquer período
- **THEN** nenhuma linha das tabelas de origem SHALL ser modificada

#### Scenario: Dados de origem alterados depois
- **WHEN** a loja enviar uma nova revisão ou a conferência for reconciliada depois de uma consulta
- **THEN** a próxima consulta SHALL refletir o novo estado sem ação de sincronização

### Requirement: Situação do corte informativa
O sistema SHALL classificar a relação pedido × destinação como Integral, Corte parcial, Corte total ou Adicional, e essa situação MUST NOT ser tratada como destaque.

#### Scenario: Corte parcial
- **WHEN** a loja pediu 10 CX e o comprador destinou 8 CX
- **THEN** a linha SHALL mostrar “Corte parcial” com −2 CX e MUST NOT receber destaque por isso

#### Scenario: Corte total com decisão de não compra
- **WHEN** a loja pediu um produto, não houve destinação e existe decisão de não compra
- **THEN** a linha SHALL mostrar “Corte total” com a observação “Não comprado”

### Requirement: Peso esperado pela conversão cadastrada
Para produtos com unidade de venda em KG, o sistema SHALL calcular o peso esperado multiplicando a quantidade destinada pelo fator de conversão copiado na destinação e, na falta dele, pela conversão atual do cadastro, indicando essa origem.

#### Scenario: Conversão copiada na destinação
- **WHEN** foram destinadas 3 CX com fator de 20 kg por caixa
- **THEN** o peso esperado SHALL ser 60,00 kg

#### Scenario: Destinação sem fator copiado
- **WHEN** a destinação não possui fator copiado e o cadastro do produto indica 20 kg por caixa
- **THEN** o peso esperado SHALL ser calculado com 20 kg e a linha SHALL indicar “conversão atual do cadastro”

#### Scenario: Produto vendido por unidade
- **WHEN** a unidade de venda do produto não é KG
- **THEN** a linha SHALL mostrar “Sem conversão em kg” e MUST NOT receber destaque de pesagem

### Requirement: Faixas de cor da pesagem
Quando houver peso esperado e peso conferido, o sistema SHALL colorir a pesagem em verde para diferença de 0% a +5%, em laranja para diferença de −5% até 0% e em vermelho, com a linha destacada e mensagem explicativa, para diferença maior que 5% para mais ou para menos. Toda diferença SHALL ser exibida, sem tolerância que a oculte.

#### Scenario: Peso um pouco acima do esperado
- **WHEN** o esperado é 60,00 kg e o conferido é 61,50 kg
- **THEN** a pesagem SHALL aparecer em verde com +1,50 kg e +2,5%

#### Scenario: Peso um pouco abaixo do esperado
- **WHEN** o esperado é 60,00 kg e o conferido é 58,20 kg
- **THEN** a pesagem SHALL aparecer em laranja com −1,80 kg e −3,0%, sem destaque na linha

#### Scenario: Peso muito abaixo do esperado
- **WHEN** o esperado é 60,00 kg e o conferido é 52,30 kg
- **THEN** a linha SHALL ser destacada em vermelho com a mensagem “Pesagem 12,8% abaixo do esperado (−7,70 kg)”

#### Scenario: Peso muito acima do esperado
- **WHEN** o esperado é 60,00 kg e o conferido é 66,60 kg
- **THEN** a linha SHALL ser destacada em vermelho com a mensagem “Pesagem 11,0% acima do esperado (+6,60 kg)”

### Requirement: Destaques da conferência
O sistema SHALL destacar itens não recebidos, recebidos sem destinação, destinados fora da conferência e conferências pendentes.

#### Scenario: Não recebido
- **WHEN** a conferência marcou como não recebido um produto destinado à loja
- **THEN** a linha SHALL receber o destaque “Não recebido”

#### Scenario: Adicional fora da conferência
- **WHEN** um produto foi destinado como adicional e não tem item na conferência da loja
- **THEN** a linha SHALL receber o destaque “Fora da conferência”

### Requirement: Nenhum bloqueio
Situações e destaques SHALL ser apenas informativos: MUST NOT bloquear fechamento, MUST NOT exigir justificativa e MUST NOT alterar dados.

#### Scenario: Ciclo com destaques
- **WHEN** um ciclo possui destaques de qualquer tipo
- **THEN** o fechamento do comprador e a conferência da loja SHALL seguir as mesmas regras de hoje

### Requirement: Filtros, indicadores e paginação
A consulta SHALL oferecer filtros de loja, ciclo inicial e final, fornecedor, produto ou código ERP, situação, destaque e “somente com destaque”; SHALL calcular os indicadores sobre todo o filtro; e SHALL paginar a lista.

#### Scenario: Período padrão
- **WHEN** o usuário abrir a consulta sem filtros
- **THEN** o sistema SHALL mostrar os ciclos dos últimos 7 dias com “somente com destaque” ativado

#### Scenario: Período acima do limite
- **WHEN** o intervalo entre ciclo inicial e final exceder 31 dias
- **THEN** o sistema SHALL recusar o filtro com mensagem clara e MUST NOT executar a consulta

### Requirement: Apresentação legível em celular e computador
A tela SHALL exibir números no formato brasileiro, SHALL funcionar em 390px sem rolagem horizontal da página e SHALL mostrar uma única mensagem quando não houver resultados.

#### Scenario: Celular
- **WHEN** a consulta for aberta em uma tela de 390px
- **THEN** cada linha SHALL ser apresentada como cartão legível sem rolagem horizontal

### Requirement: Acesso restrito a Gestor e CPD
Somente principais com a permissão `fechamento:consultar` SHALL acessar a consulta; a permissão SHALL ser concedida por padrão ao Gestor, MUST NOT fazer parte do padrão do Comprador e SHALL ser atribuível pela tela de Usuários a usuários sem permissão de loja.

#### Scenario: Gestor após a migration
- **WHEN** a migration 0021 for aplicada
- **THEN** todos os usuários Gestor SHALL possuir `fechamento:consultar` e nenhum Comprador ou Loja SHALL recebê-la

#### Scenario: Usuário do CPD
- **WHEN** o gestor atribuir `fechamento:consultar` a um usuário do CPD sem permissões de loja
- **THEN** esse usuário SHALL ver o item “Fechamento integrado” no menu e acessar a consulta

#### Scenario: Comprador sem a permissão
- **WHEN** um Comprador sem `fechamento:consultar` acessar `/fechamento` pela URL
- **THEN** o sistema SHALL redirecionar para a página de acesso negado

#### Scenario: Combinação com permissão de loja
- **WHEN** o gestor tentar atribuir `fechamento:consultar` a um usuário vinculado a loja
- **THEN** o sistema SHALL recusar a combinação
