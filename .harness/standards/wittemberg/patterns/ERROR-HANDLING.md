# Error Handling

## Regra

Nenhum erro pode falhar silenciosamente.

## Classificação

- `P0`: bloqueia operação, segurança ou confiabilidade.
- `P1`: relevante, mas não bloqueia o fluxo principal.
- `P2`: melhoria/refinamento.

## Fail-closed

Quando entregar algo falso for pior que indisponibilidade, falhar fechado.

Exemplo aprovado: se um binário real não existe, retornar indisponibilidade; nunca entregar mock com extensão `.exe`.

## Mensagens

Para usuário final: linguagem simples.

Para TI: detalhes técnicos em `Ver detalhes`.

## Stacktrace

Stacktraces não devem ser exibidos diretamente ao usuário final em produção.
