# Writing Guidelines

## Voz

A interface deve usar linguagem objetiva, profissional, curta e explicativa.

## Rótulos

Preferir rótulos completos:

- `Baixar Agent`
- `Conectar Agent`
- `Selecionar Nicho & Tamanho`

Evitar rótulos vagos como `OK`, `Executar` ou `Baixar` quando o contexto não for inequívoco.

## Mensagens de erro

Uma boa mensagem responde:

1. O que aconteceu?
2. Qual o impacto?
3. O que fazer agora?
4. Quem deve agir?

Exemplo:

> **Impressora não encontrada.** Verifique se está ligada ou se houve alteração de endereço. Caso o problema persista, solicite ao responsável de TI da sua empresa a verificação da impressora e da rede local.

## Separação de responsabilidade

Quando a causa for identificável, não usar `Erro no sistema`.

Categorias recomendadas:

- aplicação;
- agent;
- rede local;
- impressora;
- configuração de TI.
