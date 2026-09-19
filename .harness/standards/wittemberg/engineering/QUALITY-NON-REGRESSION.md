# Qualidade e Não-Regressão

## Mudança mínima

Antes de alterar componente compartilhado:

1. localizar consumidores;
2. identificar dependências;
3. alterar o menor escopo possível;
4. testar consumidores afetados;
5. não modernizar por conveniência.

## Baseline congelada

Uma tela aprovada não deve ser redesenhada incidentalmente durante feature nova.

Toda entrega robusta deve declarar:

- componentes tocados;
- componentes congelados;
- risco de regressão;
- testes executados.

## Testes

Testes automatizados são necessários, mas não substituem teste real de produção quando o comportamento depende de ambiente, hardware, browser ou infraestrutura.

## Critério de aceite

Quando houver divergência entre relatório de testes e comportamento real, a evidência de produção prevalece até o problema ser explicado.
