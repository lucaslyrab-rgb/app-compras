# SISTEMA DE COMPRAS MULTISHOW — FLV

## Planejamento Geral Consolidado — Versão 2.0

**Data:** 26 de outubro de 2026  
**Situação:** Aprovado para documentação (implementações futuras dependem de aprovação própria)  
**Repositório:** `lucaslyrab-rgb/app-compras`

---

# 1. Objetivo do sistema

Centralizar e organizar o processo de compras de frutas, legumes e verduras (FLV) das três lojas MultiShow, desde a solicitação de mercadorias até a conferência física, a identificação das notas fiscais e a apresentação de divergências.

O sistema deverá facilitar a operação diária, preservar os registros de cada etapa e permitir acompanhamento pelo comprador e pelo gestor.

## 1.1 Lojas

- MultiShow Ponta da Fruta
- MultiShow Balneário
- MultiShow Santa Mônica

## 1.2 Perfis de acesso

**Loja:** pedidos, estoque, conferência de recebimento, lançamento de perdas e consulta aos próprios registros.

**Comprador:** consolidação de pedidos, compras, custos, destinação, registro de notas fiscais e consulta de perdas.

**Gestor:** administração do sistema, acompanhamento das três lojas, custos, destinação, notas fiscais, divergências e consulta de perdas.

**CPD:** confirmação do recebimento físico das notas fiscais enviadas pelo comprador.

Os acessos deverão respeitar as permissões de cada perfil.

---

# 2. Visão geral das fases

| Fase | Descrição | Situação |
|---|---|---|
| 1 | Fundação e pedidos das lojas | Implementada |
| 2 | Consolidação, custos e operação de compras | Base implementada |
| 3 | Destinação, fornecedores e fechamento operacional | Em estabilização |
| 4 | Registro e vinculação de notas fiscais às destinações | Planejamento aprovado |
| 5 | Conferência das mercadorias e lançamento de perdas | Planejamento aprovado |
| 6 | Fechamento integrado, divergências e controle do CPD | Regras principais aprovadas |

As situações das fases já desenvolvidas representam o histórico conhecido do projeto, não uma nova auditoria técnica do ambiente de produção.

---

# FASE 1 — Fundação e Pedidos das Lojas

**Situação: implementada.**

## 3.1 Objetivo

Permitir que cada loja informe seu estoque e solicite mercadorias para o ciclo de compras.

## 3.2 Funcionalidades

- Login com identificação da loja.
- Cadastro centralizado de produtos, com código ERP.
- Digitação de estoque e pedido.
- Pesquisa por nome e código ERP.
- Filtros de produtos com pedido e sem pedido.
- Navegação por Enter entre campos.
- Preservação dos valores digitados durante a navegação.
- Envio do pedido.
- Histórico de pedidos por loja.
- Revisões de pedidos com confirmação.
- Cancelamento lógico com rastreabilidade.
- Relatório de contagem de estoque para impressão.
- Interface responsiva para celular e computador.

## 3.3 Regra do ciclo

O horário de corte é **19h**, considerando o fuso `America/Sao_Paulo`.

- Pedidos enviados antes do corte pertencem ao ciclo de compra do dia seguinte.
- Pedidos enviados após o corte pertencem ao ciclo subsequente.

O histórico deverá preservar o ciclo e as revisões correspondentes.

---

# FASE 2 — Consolidação, Custos e Operação de Compras

**Situação: base implementada, sujeita à validação operacional.**

## 4.1 Objetivo

Reunir as solicitações das três lojas e apoiar o comprador na realização das compras.

## 4.2 Funcionalidades

- Visualização consolidada dos pedidos das lojas.
- Identificação de lojas que ainda não enviaram pedido.
- Exibição de estoque e quantidade solicitada.
- Registro e atualização de custos de compra.
- Identificação de alterações de custos.
- Marcação dos produtos comprados.
- Filtros para acompanhamento dos produtos pendentes de compra.
- Consulta de custos e sugestões de preços, conforme permissões.
- Preparação de informações para separação e embarque.
- Identificação de produtos de fornecedor exclusivo.

## 4.3 Regras operacionais

- O comprador não deverá alterar livremente o cadastro mestre de produtos.
- As informações de estoque e pedido das lojas deverão ser preservadas.
- Os custos e suas alterações deverão permitir acompanhamento.
- Os produtos marcados como comprados servirão de referência para a etapa principal de destinação.

---

# FASE 3 — Destinação, Fornecedores e Fechamento Operacional

**Situação: em estabilização e validação funcional.**

## 5.1 Objetivo

Registrar como as mercadorias compradas serão distribuídas entre as lojas, organizando a operação por fornecedor.

## 5.2 Fluxo operacional

1. Selecionar o ciclo de compra.
2. Selecionar a loja.
3. Selecionar o fornecedor.
4. Informar a destinação dos produtos.
5. Registrar a nota fiscal diretamente na tela de destinação, **quando disponível** (funcionalidade prevista para a Fase 4).
6. Concluir o trabalho com o fornecedor.
7. Revisar os cortes da loja.
8. Finalizar a destinação da loja.
9. Concluir o fechamento operacional do ciclo quando todas as lojas estiverem finalizadas e as regras de documentação **já implantadas** forem atendidas.

## 5.3 Regras aprovadas

- A lista principal de destinação deverá considerar os produtos marcados como comprados na etapa de Custos.
- A quantidade originalmente pedida poderá ser apresentada como sugestão.
- A sugestão não deverá ser gravada automaticamente como destinação efetiva.
- A opção **Não comprei deste fornecedor** deverá registrar a decisão negativa sem transformar sugestões em quantidades destinadas.
- Os cortes deverão ser identificáveis e consultáveis.
- Os registros deverão preservar a relação entre ciclo, loja, fornecedor e produto.
- O registro da nota fiscal deverá estar disponível na própria tela de destinação, evitando que o comprador precise acessar uma tela separada para anexar a documentação (**entrega da Fase 4**).

## 5.4 Pontos de estabilização

Verificar e concluir os ajustes relacionados a:

- **Maçã Fuji:** impedir que uma decisão negativa de compra seja sobrescrita por uma quantidade sugerida.
- **Batata Bolinha:** impedir que um produto não marcado como comprado apareça indevidamente na lista principal de destinação.

Esses pontos devem ser confirmados em testes antes de considerar a fase estabilizada.

## 5.5 Preparação para a Fase 4

A destinação será a base para vincular as notas fiscais aos produtos de cada loja.

O registro da nota poderá ser iniciado diretamente na tela de destinação por meio de um botão, como **Registrar nota** ou **Registrar NF**. Esse botão deverá abrir um modal para preenchimento do número da nota e inclusão da fotografia do documento.

**Importante:** a exigência de nota fiscal para fechar o ciclo somente deverá ser ativada quando a Fase 4 estiver implementada e validada. Não deve bloquear antecipadamente a operação atual da Fase 3.

---

# FASE 4 — Registro e Vinculação de Notas Fiscais às Destinações

**Situação: planejamento aprovado.**

## 6.1 Objetivo

Permitir que o comprador registre a nota fiscal diretamente na tela de destinação, por meio do número do documento e de uma fotografia, vinculando-a à loja, ao fornecedor, ao ciclo e às destinações correspondentes.

A destinação será a referência operacional para identificar os produtos que ainda estão sem nota vinculada.

## 6.2 Acesso ao registro da nota

O registro da nota deverá ser iniciado na própria tela de destinação.

Para cada combinação de ciclo, loja e fornecedor, deverá existir um botão com texto claro, preferencialmente:

- **Registrar nota**
- **Registrar NF**
- **Adicionar nota fiscal**

Ao acionar o botão, o sistema deverá abrir um modal de registro.

## 6.3 Modal de registro da nota fiscal

O modal deverá conter:

- Número da nota fiscal.
- Botão para anexar uma imagem existente no dispositivo.
- Botão para abrir a câmera do celular e fotografar a nota.
- Visualização da imagem anexada antes da confirmação.
- Opção para substituir ou remover a imagem antes de salvar.
- Identificação automática do ciclo, loja e fornecedor selecionados na tela de destinação.
- Botão para salvar ou confirmar o registro.
- Botão para cancelar sem salvar.

O número da nota deverá ser obrigatório.

A fotografia da nota também deverá ser obrigatória para considerar o registro válido para fins de fechamento.

## 6.4 Fluxo de registro

O comprador deverá:

1. Selecionar o ciclo de compra.
2. Selecionar a loja.
3. Selecionar o fornecedor.
4. Informar as quantidades destinadas.
5. Acionar o botão **Registrar nota** ou equivalente.
6. Informar o número da nota fiscal no modal.
7. Anexar uma fotografia ou abrir a câmera para fotografar o documento.
8. Conferir a imagem anexada.
9. Salvar o registro.
10. Consultar a nota vinculada às destinações correspondentes.

O sistema deverá permitir registrar mais de uma nota para a mesma loja e fornecedor quando necessário.

## 6.5 Vinculação da nota às destinações

A nota registrada na tela de destinação deverá ser vinculada ao contexto selecionado:

- Ciclo de compra.
- Loja.
- Fornecedor.
- Produtos e quantidades efetivamente destinados, conforme o fluxo definido.

Uma mesma nota poderá abranger vários produtos da mesma loja e do mesmo fornecedor.

A fotografia não precisará ser repetida para cada produto associado à mesma nota.

## 6.6 Regra: uma nota para cada loja

Cada nota fiscal deverá pertencer a **uma única loja**.

Exemplo: o fornecedor Simão poderá emitir uma nota para Ponta da Fruta, outra para Balneário e outra para Santa Mônica.

Regras:

- Uma nota pode abranger vários produtos da mesma loja e do mesmo fornecedor.
- Uma loja pode possuir várias notas do mesmo fornecedor.
- A mesma nota registrada não poderá ser vinculada às destinações de lojas diferentes.
- As vinculações deverão respeitar o ciclo de compra correspondente.
- O número da nota deverá ser validado para evitar duplicidade indevida no mesmo contexto.
- A fotografia deverá permanecer associada ao registro da nota.
- O comprador não precisará repetir o cadastro da mesma nota para cada produto destinado à loja.

## 6.7 Pendências de documentação

O sistema deverá identificar as destinações positivas que ainda não possuem nota fiscal válida vinculada.

Na tela de destinação, deverá ser possível visualizar o status da documentação, por exemplo:

- **Sem nota**
- **Nota registrada**
- **Nota pendente de imagem**
- **Nota inválida ou incompleta**

As decisões negativas de compra e os cortes sem quantidade efetivamente destinada não exigirão nota.

## 6.8 Bloqueio do fechamento

**Regra obrigatória:** o fechamento geral do ciclo de compras ficará bloqueado enquanto houver qualquer destinação positiva sem nota fiscal válida vinculada.

Para essa finalidade, a nota deverá possuir:

- Número identificado.
- Fotografia anexada.
- Loja correspondente.
- Fornecedor correspondente.
- Ciclo correspondente.
- Vínculo com as destinações aplicáveis.

A verificação deverá ser feita também no servidor, não apenas na interface.

## 6.9 Transporte das notas físicas

O comprador guardará os documentos fiscais físicos e os enviará com o caminhão no ciclo seguinte.

O recebimento desses documentos será confirmado posteriormente pelo CPD, conforme a Fase 6.

A confirmação do CPD não será necessária para o fechamento do ciclo de compras.

---

# FASE 5 — Conferência de Mercadorias e Lançamento de Perdas

**Situação: planejamento aprovado, com detalhes operacionais a validar.**

## 7.1 Objetivo

Disponibilizar às lojas duas ferramentas:

- Conferência física das mercadorias recebidas.
- Lançamento simples das perdas ocorridas durante o expediente.

## 7.2 Menu inicial das lojas

Após o login, apresentar um modal com três opções:

1. **Pedido**
2. **Conferência**
3. **Perdas**

A loja poderá acessar os módulos permitidos sem precisar encerrar a sessão.

## 7.3 Conferência — Origem das informações

A conferência será gerada a partir do **pedido originalmente digitado pela loja**.

Regras:

- Considerar os produtos solicitados no pedido.
- Exibir o produto mesmo quando o comprador não o marcou como comprado.
- Não depender da existência de destinação.
- Preservar a quantidade e a unidade do pedido como referência.
- Não modificar o pedido original ao realizar a conferência.
- Cada loja visualizará apenas suas próprias conferências.

## 7.4 Conferência — Registro do recebimento

Para cada produto, apresentar:

- Código ERP.
- Nome do produto.
- Quantidade originalmente solicitada e sua unidade.
- Campo para informar o peso recebido em **KG**.
- Botão **Não recebido**.

Ao selecionar **Não recebido**, o sistema registrará automaticamente **0 KG**.

Os estados deverão ser diferenciados:

- **Pendente:** produto ainda não verificado, sem peso preenchido.
- **Recebido:** peso informado em KG.
- **Não recebido:** registro confirmado de 0 KG.

O sistema não deverá presumir o peso de caixas ou outras unidades.

## 7.5 Conferência — Salvamento e finalização

**Salvamento parcial:**

- Permitido mesmo quando existirem produtos pendentes.
- Os valores informados deverão ser preservados.
- A loja poderá retornar posteriormente e continuar.
- Salvar parcialmente não significa finalizar.

**Finalização:**

- Todos os produtos do pedido deverão estar verificados.
- Cada produto deverá ter peso registrado ou estar marcado como Não recebido.
- Não será permitido finalizar com campos pendentes.
- A validação deverá ocorrer no servidor.
- O sistema registrará responsável e data/hora.
- O histórico deverá ser preservado.

## 7.6 Conferência — Interface mobile

Priorizar uma tela compacta para apresentar o maior número possível de produtos no celular.

Características:

- Lista vertical compacta.
- Sem rolagem horizontal.
- Nome do produto e pedido original visíveis.
- Campo de peso em KG e ação Não recebido na mesma linha, quando viável.
- Pesquisa por nome ou código ERP.
- Filtros Todos, Pendentes e Conferidos.
- Contador de produtos verificados e pendentes.
- Teclado numérico e navegação eficiente entre campos.
- Preservação dos valores ao trocar filtros ou pesquisar.
- Botões adequados para toque, sem excesso de espaços ou cartões grandes.

## 7.7 Lançamento de Perdas — Lojas

Criar uma tela simples para registrar perdas durante o expediente.

Funcionalidades:

- Selecionar ou buscar produto por nome ou código ERP.
- Informar a quantidade perdida.
- Registrar a loja automaticamente.
- Registrar usuário, data e horário.
- Permitir múltiplos lançamentos do mesmo produto no dia.
- Exibir os lançamentos realizados pela própria loja.
- Utilizar interface compacta para celular.

Não haverá, nesta etapa, processos de aprovação, metas, indicadores complexos ou um controle gerencial paralelo de perdas.

## 7.8 Armazenamento das Perdas

**Regra aprovada:** os lançamentos serão armazenados no banco PostgreSQL do próprio FLV.

- Reutilizar o cadastro de produtos e lojas existente no sistema.
- Persistir individualmente os lançamentos.
- Não criar outro banco de dados.
- Não gravar diretamente no banco do StarTwo.
- Preservar os registros para consultas posteriores.

## 7.9 Consulta de Perdas — Gestor e Comprador

Criar uma tela específica para os perfis Gestor e Comprador.

Permitir:

- Consultar lançamentos das três lojas.
- Filtrar por loja.
- Filtrar por data ou período.
- Buscar por produto ou código ERP.
- Visualizar produto, quantidade, loja, data, horário e responsável.

A consulta não deverá alterar os lançamentos originais.

---

# FASE 6 — Fechamento Integrado, Divergências e Controle do CPD

**Situação: regras principais aprovadas.**

## 8.1 Objetivo

Confrontar as informações do pedido, da destinação e da conferência física, permitindo acompanhar divergências.

Também disponibilizar uma área para o CPD confirmar o recebimento físico das notas fiscais.

## 8.2 Confronto das informações

Por loja, ciclo e produto, apresentar:

**Pedido:** o que a loja solicitou.

**Destinação:** o que o comprador destinou para a loja.

**Conferência:** o que a loja efetivamente recebeu e pesou.

O sistema deverá preservar os registros originais de cada etapa.

## 8.3 Divergências

Identificar diferenças entre:

- Quantidade solicitada e quantidade destinada.
- Quantidade destinada e quantidade recebida.
- Produtos pedidos e não recebidos.
- Destinações positivas sem documentação fiscal válida.
- Outras situações identificáveis pelos dados existentes.

**Regra aprovada: as divergências serão apenas apresentadas para acompanhamento.**

- Não bloquearão o fechamento integrado, exceto a pendência obrigatória de nota fiscal definida na Fase 4.
- Não será obrigatório apresentar justificativas.
- Permanecerão disponíveis para consulta posterior.
- Não alterarão automaticamente pedidos, destinações ou conferências.

## 8.4 Unidades de medida

O pedido e a destinação podem utilizar caixas, unidades ou outros formatos, enquanto a conferência será registrada em KG.

Portanto:

- Não realizar comparações numéricas diretas entre unidades incompatíveis.
- Não presumir pesos por caixa.
- Definir posteriormente os critérios necessários para comparações quantitativas válidas.
- Enquanto não houver critério aprovado, apresentar os valores originais sem gerar uma divergência numérica enganosa.

## 8.5 Área do CPD

Criar uma área para o CPD consultar as notas fiscais vinculadas aos ciclos anteriores.

O CPD deverá:

1. Consultar as notas aguardando recebimento físico.
2. Identificar os documentos que chegaram.
3. Confirmar o recebimento físico de cada nota.
4. Visualizar as notas ainda pendentes.

O sistema registrará responsável e data/hora da confirmação.

## 8.6 Lançamento no StarTwo

O lançamento fiscal continuará sendo realizado no **StarTwo**, fora do sistema FLV.

O FLV servirá para identificar os documentos, armazenar a fotografia da nota e acompanhar a confirmação de chegada.

**A confirmação do CPD não bloqueará o fechamento do ciclo de compras.**

## 8.7 Relatórios gerenciais

Os relatórios serão definidos posteriormente, após análise das necessidades reais da operação.

Nesta fase, a prioridade será disponibilizar:

- Consulta do confronto entre pedido, destinação e conferência.
- Visualização das divergências.
- Consulta das notas recebidas e pendentes no CPD.
- Consulta das notas registradas diretamente nas telas de destinação.

Não serão criados modelos adicionais de relatórios sem especificação aprovada.

---

# 9. Regras gerais do sistema

## 9.1 Rastreabilidade

Preservar os registros e a identificação dos responsáveis pelas operações relevantes.

## 9.2 Separação por loja

Cada loja terá acesso somente às informações operacionais autorizadas para sua unidade.

## 9.3 Acesso gerencial

Gestor e Comprador terão as consultas previstas para seus perfis, respeitando a separação de responsabilidades.

## 9.4 Integridade

O sistema não deverá alterar automaticamente os dados originais de pedido, destinação, conferência ou perdas para corrigir divergências.

## 9.5 Operação mobile

As telas utilizadas nas lojas e pelo comprador deverão priorizar facilidade de digitação, legibilidade, velocidade e ausência de rolagem horizontal desnecessária.

O modal de registro da nota deverá funcionar adequadamente em celulares, permitindo anexar uma imagem da galeria ou abrir diretamente a câmera do dispositivo.

## 9.6 Implantação gradual

Novas regras de bloqueio só deverão ser ativadas quando as funcionalidades correspondentes estiverem implementadas, testadas e prontas para uso operacional.

## 9.7 Validação de arquivos

As imagens anexadas deverão ser validadas quanto ao formato e ao tamanho permitido, com mensagens claras quando o arquivo não puder ser aceito.

## 9.8 Segurança e privacidade

O acesso às fotografias das notas deverá respeitar as permissões do usuário e o contexto da loja, do fornecedor e do ciclo de compra.

---

# 10. Pontos ainda não definidos

Os seguintes assuntos permanecerão abertos para decisões futuras:

1. Tratamento de mercadorias recebidas que não constavam no pedido original.
2. Procedimento para recebimentos parciais ou em múltiplas entregas.
3. Regras de correção de conferências já finalizadas.
4. Unidade e eventual motivo obrigatório nos lançamentos de perdas.
5. Procedimento para corrigir ou cancelar lançamentos de perdas incorretos.
6. Critérios de conversão para comparar destinação e conferência em KG.
7. Modelos específicos de relatórios gerenciais.
8. Detalhes de armazenamento, limites, compressão e manutenção das fotografias das notas fiscais.
9. Definição do limite máximo de tamanho e dos formatos aceitos para as imagens.
10. Procedimento para substituir uma fotografia ou corrigir o número de uma nota já registrada.
11. Definição sobre permitir ou não o registro de várias notas no mesmo modal ou exigir um novo registro para cada documento.

Esses pontos não impedem a aprovação do planejamento geral, mas deverão ser definidos antes da implementação das funcionalidades afetadas.

---

# 11. Ordem recomendada de execução

**Etapa atual — Fase 3**

Concluir a estabilização da destinação e validar os fluxos operacionais existentes.

**Próxima etapa — Fase 4**

Implementar o botão **Registrar nota** na tela de destinação, o modal com número da nota, o anexo de imagem e a abertura da câmera do celular. Implementar a vinculação da nota ao ciclo, à loja, ao fornecedor e às destinações correspondentes.

Ativar a validação obrigatória de notas no fechamento somente quando o módulo estiver pronto.

**Etapa seguinte — Fase 5**

Implementar a conferência física das lojas, o lançamento de perdas e a consulta de perdas para Gestor e Comprador.

**Etapa posterior — Fase 6**

Implementar o confronto das informações, a apresentação de divergências e o controle de recebimento físico das notas pelo CPD.

**Evoluções futuras**

Especificar e desenvolver relatórios gerenciais conforme a experiência real de utilização.

---

# 12. Controle de aprovação

**Documento consolidado aprovado em 26 de outubro de 2026 para atualização documental do repositório.**

A aprovação deste documento autoriza a atualização da documentação do repositório GitHub, mas não significa autorização automática para alterar o código, executar migrações ou implantar novas funcionalidades em produção.

O desenvolvimento de cada fase deverá seguir seu próprio planejamento, implementação, testes e aprovação.
