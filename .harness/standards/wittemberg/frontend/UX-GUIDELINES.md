# UX Guidelines

## Princípios

1. A interface deve ser previsível.
2. O usuário não deve precisar entender arquitetura para operar a ferramenta.
3. Se uma ação falhar, deve haver feedback.
4. O sistema deve antecipar erros comuns quando possível.
5. Informações avançadas ficam disponíveis sem competir com o fluxo principal.

## Densidade

- Evitar múltiplas barras de rolagem simultâneas.
- Preferir painéis compactos e seções avançadas recolhíveis.
- Não exibir informação derivada em vários lugares.

## Manipulação visual

Em editores gráficos:

- clique seleciona;
- arrasto move;
- marquee selection seleciona grupo;
- Shift/Ctrl permite seleção múltipla;
- handles visuais devem indicar resize/rotate;
- propriedades técnicas ficam em painel lateral.

## Atalhos e foco

Atalhos globais devem respeitar o foco. Se o usuário estiver em input/textarea/editor:

- Delete/Backspace editam conteúdo;
- não excluem elemento do canvas.

## Feedback

Toda ação assíncrona deve ter pelo menos um destes estados:

- carregando;
- concluído;
- falhou com orientação de próxima ação.
