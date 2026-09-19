# Botões, Cards e Modais

## Botões

- Mesma altura dentro do mesmo contexto.
- Ícone e texto centralizados.
- `primary`, `secondary` e `destructive` claramente diferenciados.
- Ações paralelas devem ter proporção visual equivalente.
- Nenhum botão pode extrapolar o container.

## Card actions

Padrão recomendado:

```css
.card { min-width: 0; max-width: 100%; }
.card-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .5rem;
  width: 100%;
}
.card-actions > button,
.card-actions > a {
  min-width: 0;
  width: 100%;
  justify-content: center;
}
```

Em largura insuficiente, empilhar em uma coluna.

## Cards

Estrutura preferida:

1. ícone + título;
2. status/badge;
3. descrição breve;
4. informações essenciais;
5. ações.

## Modais

- overlay fixo;
- conteúdo centralizado;
- z-index previsível;
- largura responsiva;
- título + subtítulo;
- ações no rodapé;
- fechar sempre disponível.

Classes de referência:

- `.wizard-modal-overlay`
- `.wizard-modal-content`
