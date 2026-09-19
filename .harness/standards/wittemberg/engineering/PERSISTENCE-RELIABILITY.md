# Persistência e Confiabilidade

## Regra

Dados que precisam sobreviver a restart, redeploy ou reboot não podem ter memória de processo como única fonte da verdade.

Persistência é obrigatória para:

- identidades;
- tokens hash;
- configurações;
- vínculos;
- estados administrativos relevantes.

Cache pode existir, mas não como única fonte da verdade.

## Reconexão

Falhas transitórias não devem encerrar processos permanentes.

Padrão sugerido de backoff:

2s → 5s → 10s → 20s → 30s → 60s, mantendo tentativas indefinidamente com jitter.

## Startup

Rede, DNS ou backend indisponíveis durante boot devem gerar estado `RECONNECTING`, não encerramento fatal.
