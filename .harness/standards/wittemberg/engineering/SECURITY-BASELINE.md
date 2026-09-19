# Security Baseline

## Segredos

- Nunca hardcodar segredo em código-fonte.
- Nunca enviar segredo administrativo ao frontend.
- Tokens de daemon devem ser exibidos apenas no provisionamento inicial quando estritamente necessário.
- Backend persiste somente hash quando o protocolo permitir.

## Separação de papéis

Web/Admin e daemon/Agent devem possuir capacidades distintas.

## Tenant

Tenant deve ser resolvido server-side a partir de identidade autenticada, nunca confiando em `companyId` arbitrário do cliente.

## Sessões

Cookies Web em produção:

- HttpOnly
- Secure
- SameSite adequado
- Path explícito

## Logs

Nunca registrar tokens, senhas ou chaves.
