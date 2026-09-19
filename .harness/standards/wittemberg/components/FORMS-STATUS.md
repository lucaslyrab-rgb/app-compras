# Formulários e Estados

## Formulários

- Não repetir campos que podem ser derivados.
- Quando uma fonte externa é `source of truth`, o campo visual não deve competir com ela.
- Campos condicionais devem ser desabilitados ou ocultados quando não aplicáveis.
- Placeholder não substitui label.

## Badges de estado

Todo badge deve conter texto e cor coerentes.

Exemplos:

- 🟢 Online
- 🟠 Reconectando
- 🔴 Offline
- ⚠ Atenção
- ✓ Salvo

## Histerese

Estados operacionais não devem piscar entre online/offline por uma falha isolada. Sistemas conectados devem considerar tolerância a perdas transitórias.
