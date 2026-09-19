# Padrão para Agents Locais

## Filosofia

Um Agent operacional deve ser infraestrutura invisível.

## Não negociável

Depois do primeiro pareamento, o Agent não deve depender de:

- navegador aberto;
- sessão web ativa;
- terminal aberto;
- login do usuário;
- novo pareamento após reboot;
- intervenção diária do TI.

## Requisitos

- auto-start;
- auto-recovery;
- identidade persistente;
- reconexão automática;
- backoff exponencial com jitter;
- logs sem segredos;
- diferenciação entre falha do Agent e falha do hardware local;
- modo de serviço no SO quando aplicável.

## Princípio central

> Se o sistema consegue se recuperar sozinho, ele deve se recuperar sozinho. Se não consegue, deve identificar a causa com precisão e dizer quem deve agir.

## Estados recomendados do Agent

- STARTING
- ONLINE
- RECONNECTING
- DEGRADED
- OFFLINE
- UNAUTHORIZED

## Estados recomendados do hardware

- ONLINE
- OFFLINE
- UNREACHABLE
- CONFIG_ERROR
- UNKNOWN
