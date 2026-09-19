# Design System Corporativo

## Regra de ouro

Em 100% de zoom, nenhum botão, badge, campo, texto, card, modal, menu, painel ou outro componente pode ultrapassar seu container, ficar cortado ou depender da redução do zoom para funcionar visualmente.

Validar no mínimo em 1920px, 1366px, 1280px, tablet e mobile.

## Hierarquia visual

- Um fluxo deve possuir um CTA principal claro.
- Não repetir a mesma ação no header e no conteúdo sem necessidade.
- Ações contextuais pertencem ao contexto em que fazem sentido.
- Header deve concentrar navegação e utilidades globais.
- Cards devem ter função clara, não apenas decoração.

## Layout

- Desktop amplo: preferir 4 colunas quando houver cards equivalentes.
- Notebook: 3 colunas.
- Tablet: 2 colunas.
- Mobile: 1 coluna.
- Usar `min-width: 0` em filhos de grid/flex quando necessário.
- Nunca usar `overflow:hidden` para mascarar erro de layout.

## Tipografia

- Hierarquia consistente entre título, subtítulo, legenda e corpo.
- Não criar tamanhos locais sem necessidade.
- Texto técnico deve ser mais discreto que ação principal.

## Cores

Usar tokens/variáveis semânticas:

- primary
- secondary
- success
- warning
- danger
- neutral
- surface
- border

Nunca hardcodar cores em componente se já existir token do tema.

## Estados

Toda funcionalidade operacional deve possuir estados claros, por exemplo:

- Online
- Offline
- Reconectando
- Degradado
- Em breve
- Erro
- Salvo
- Alterações não salvas

Cor reforça o texto; nunca substitui o texto.

## Baseline congelada

Quando uma tela for aprovada visualmente, passa a ser baseline congelada. Features novas não autorizam redesenho geral da tela.
