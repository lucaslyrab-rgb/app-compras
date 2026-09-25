# Spec Delta

## Purpose

Define um calendário operacional semanal configurável para calcular e persistir a data efetiva dos novos ciclos de compra sem alterar pedidos históricos.

## ADDED Requirements

### Requirement: Configuração operacional persistida
O sistema SHALL persistir timezone operacional, horário de corte, conjunto não vazio de dias ISO da semana habilitados, versão e timestamps em domínio separado das configurações financeiras.

#### Scenario: Configuração inicial MultiShow
- **WHEN** a migration do calendário for aplicada em uma instalação sem configuração
- **THEN** o sistema SHALL criar a configuração com `America/Sao_Paulo`, corte `19:00` e dias habilitados segunda, terça, quinta e sexta

#### Scenario: Configuração sobrevive a reinício
- **WHEN** o serviço da aplicação reiniciar
- **THEN** o cálculo SHALL continuar usando a configuração persistida vigente, sem depender de constantes do frontend ou do processo

### Requirement: Próximo ciclo antes do corte
Antes do horário de corte, o sistema SHALL selecionar o primeiro dia de compra habilitado estritamente posterior à data local do pedido.

#### Scenario: Matriz MultiShow antes do corte
- **WHEN** um pedido for calculado às 18:59 ou 18:59:59 no timezone configurado
- **THEN** segunda SHALL resultar em terça, terça em quinta, quarta em quinta, quinta em sexta, sexta em segunda, sábado em segunda e domingo em segunda

### Requirement: Próximo ciclo no corte ou depois
No horário de corte ou depois, o sistema SHALL ignorar o primeiro dia de compra habilitado posterior à data local do pedido e selecionar o dia habilitado seguinte.

#### Scenario: Matriz MultiShow no corte
- **WHEN** um pedido for calculado às 19:00 ou 19:00:00 no timezone configurado
- **THEN** segunda SHALL resultar em quinta, terça em sexta, quarta em sexta, quinta em segunda, sexta em terça, sábado em terça e domingo em terça

### Requirement: Cálculo local e configurável
O cálculo SHALL interpretar o instante no timezone configurado, SHALL comparar hora, minuto e segundo locais com o corte e MUST NOT depender de offset UTC fixo nem de dias MultiShow hard-coded.

#### Scenario: Mudança de mês
- **WHEN** o próximo dia habilitado estiver no mês seguinte
- **THEN** o sistema SHALL produzir a data ISO correta do novo mês

#### Scenario: Mudança de ano
- **WHEN** o próximo dia habilitado estiver no ano seguinte
- **THEN** o sistema SHALL produzir a data ISO correta do novo ano

#### Scenario: Calendário alternativo
- **WHEN** outra instalação habilitar um conjunto semanal diferente e outro corte válido
- **THEN** o mesmo algoritmo SHALL calcular o ciclo usando apenas essa configuração

### Requirement: Persistência do ciclo no pedido
Um novo pedido SHALL persistir `purchase_cycle_date` como a data efetiva calculada com a configuração vigente no momento do envio e SHALL manter o valor como snapshot histórico.

#### Scenario: Novo pedido
- **WHEN** uma Loja enviar um novo pedido
- **THEN** o pedido SHALL receber o ciclo calculado pelo calendário vigente e as regras existentes de duplicidade por loja/ciclo SHALL continuar válidas

#### Scenario: Revisão no mesmo ciclo
- **WHEN** a Loja confirmar uma revisão enquanto o cálculo ainda apontar para o mesmo ciclo
- **THEN** a revisão SHALL permanecer vinculada ao mesmo `purchase_cycle_date` e SHALL seguir a numeração vigente

#### Scenario: Cancelamento
- **WHEN** um pedido for cancelado
- **THEN** o cancelamento MUST NOT alterar seu `purchase_cycle_date`

### Requirement: Histórico imutável diante de mudanças de calendário
Salvar uma nova configuração SHALL afetar apenas cálculos posteriores e MUST NOT recalcular, mover ou atualizar ciclos de pedidos já persistidos.

#### Scenario: Alteração de dias habilitados
- **WHEN** o Gestor alterar os dias semanais ou o corte
- **THEN** pedidos existentes SHALL conservar seus ciclos originais e somente novos envios SHALL usar a nova versão

#### Scenario: Pedidos recentes divergentes
- **WHEN** a migration 0008 for executada sobre o banco existente
- **THEN** os pedidos previamente identificados em quarta ou sábado SHALL permanecer inalterados até autorização explícita para eventual correção individual

### Requirement: Gestão do calendário com validação e RBAC
O sistema SHALL exibir o calendário em GESTOR → Configurações e SHALL aceitar mudanças somente de um principal GESTOR, com validação server-side e concorrência otimista.

#### Scenario: Gestor atualiza configuração válida
- **WHEN** um Gestor salvar timezone válido, horário válido e ao menos um dia habilitado usando a versão vigente
- **THEN** o sistema SHALL persistir a nova versão e confirmar o salvamento

#### Scenario: Nenhum dia habilitado
- **WHEN** uma alteração não contiver dias de compra habilitados
- **THEN** o sistema SHALL rejeitar a alteração sem modificar a configuração vigente

#### Scenario: Corte ou timezone inválido
- **WHEN** o horário não for válido ou o timezone não for reconhecido pelo runtime
- **THEN** o sistema SHALL rejeitar a alteração sem modificar a configuração vigente

#### Scenario: Conflito de versão
- **WHEN** o Gestor tentar salvar uma versão desatualizada
- **THEN** o sistema SHALL recusar o lost update e retornar a configuração vigente

#### Scenario: Comprador ou Loja tenta alterar
- **WHEN** um COMPRADOR ou LOJA invocar diretamente a ação de atualização
- **THEN** o servidor SHALL negar a operação independentemente da visibilidade da interface
