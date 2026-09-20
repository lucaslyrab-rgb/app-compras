# Deploy com GHCR, GitHub Actions e Portainer

Procedimento proposto para `lucaslyrab-rgb/app-compras`. Segredos nunca devem ser enviados por chat, commitados, inseridos no `Dockerfile` ou impressos em logs.

## Fluxo

```text
push protegido em main
  → lint/tipos/testes/build/scan
  → GitHub Actions autentica no GHCR com GITHUB_TOKEN
  → publica ghcr.io/lucaslyrab-rgb/app-compras:sha-<commit>
  → promove essa tag imutável em infra/stack.yml
  → chama PORTAINER_WEBHOOK_URL
  → Portainer busca a stack Git e força pull/redeploy
  → Swarm atualiza com healthcheck e política de rollback
```

O Portainer documenta webhook como mecanismo de GitOps para disparar atualização sob demanda, inclusive por GitHub Actions. Este projeto promove no Git uma tag `sha-<commit>` imutável antes do webhook; assim o Portainer observa alteração real da stack e o rollback permanece auditável.

## 1. Publicação pelo GitHub Actions

Não crie PAT para o workflow publicar a imagem. No próprio repositório, `GITHUB_TOKEN` é efêmero e suficiente:

```yaml
permissions:
  contents: write
  packages: write
```

O login usa:

```yaml
registry: ghcr.io
username: ${{ github.actor }}
password: ${{ secrets.GITHUB_TOKEN }}
```

Fixe actions de terceiros por SHA, gere tag por commit e só invoque deploy depois de testes, publicação e promoção do manifesto concluídos. O job de imagem recebe `packages: write` para o GHCR e `contents: write` exclusivamente para atualizar `infra/stack.yml`; os demais jobs permanecem somente leitura. Em **Settings → Actions → General → Workflow permissions**, permita leitura/escrita e configure o ruleset de `main` para que GitHub Actions possa criar apenas essa promoção automatizada. Se o push for recusado, o webhook não é chamado.

## 2. Token de leitura para o Portainer

O GHCR, para login fora de Actions, exige PAT clássico. Crie uma credencial exclusiva e de menor privilégio:

1. Entre no GitHub como `lucaslyrab-rgb`.
2. Abra **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**.
3. Nome sugerido: `portainer-app-compras-read`.
4. Defina expiração curta/gerenciável (90 dias é uma política inicial razoável; registre renovação).
5. Marque somente `read:packages`. Não marque `write:packages`, `delete:packages` ou `repo` sem necessidade.
6. Gere, copie uma única vez e armazene no cofre de credenciais da organização.
7. Se a conta/organização usar SSO, autorize o token para a organização.

Observação: a UI comum pode selecionar `repo` ao marcar scopes de packages. A documentação do GitHub fornece o caminho direto `https://github.com/settings/tokens/new?scopes=read:packages` para solicitar somente leitura; revise os scopes antes de gerar.

### Acesso do pacote

Após a primeira publicação, abra **perfil/organização → Packages → app-compras → Package settings**:

- conecte o pacote ao repositório `app-compras`;
- mantenha privado até decisão explícita de publicação;
- confirme que o repositório possui acesso às Actions;
- não conceda acesso a repositórios desnecessários.

## 3. Registry no Portainer

Na UI do Portainer:

1. Vá a **Registries → Add registry → Custom registry** (ou GitHub Container Registry, se a versão oferecer preset).
2. Nome: `ghcr-lucaslyrab-rgb`.
3. Registry URL: `ghcr.io` (sem caminho do pacote).
4. Authentication: habilitada.
5. Username: `lucaslyrab-rgb` — não use o e-mail.
6. Password/token: cole o PAT clássico com `read:packages`.
7. Salve e valide puxando a imagem privada.

Nunca reutilize o token de publicação no Portainer. Para rotação, crie o novo PAT, atualize/teste a Registry e só então revogue o antigo.

## 4. Stack GitOps no Portainer

1. **Stacks → Add stack → Git Repository**.
2. Nome: `app-compras`.
3. Repository URL: `git@github.com:lucaslyrab-rgb/app-compras.git` ou HTTPS com credencial de leitura.
4. Reference: `refs/heads/main`.
5. Compose path: `infra/stack.yml`.
6. Habilite autenticação do repositório se ele for privado. A chave de deploy de leitura do repositório é preferível a PAT amplo.
7. Habilite **GitOps updates → Webhook**.
8. Não habilite tag mutável: o workflow altera a referência `sha-<commit>` no manifesto antes de acionar o webhook.
9. Copie a URL gerada e trate-a como segredo.
10. Selecione a registry `ghcr-lucaslyrab-rgb`, configure os secrets/variáveis não sensíveis e faça primeiro deploy manual em homologação.

Configuração esperada da stack:

- rede externa `externa` para Traefik;
- imagem `ghcr.io/lucaslyrab-rgb/app-compras:sha-<commit>` promovida automaticamente no Git;
- labels Traefik para `compras.muitomaisatacado.com`, entrypoint `websecure` e resolver existente `letsencryptresolver`;
- banco não publicado; volume dedicado; secrets do Swarm;
- `healthcheck`, limites/reservas, `update_config` com monitoramento e `rollback_config`.

## 5. Secret do webhook no GitHub

No repositório:

1. **Settings → Secrets and variables → Actions**.
2. Em **Repository secrets**, clique **New repository secret**.
3. Nome: `PORTAINER_WEBHOOK_URL`.
4. Valor: URL completa copiada do Portainer.
5. Clique **Add secret**.

Não é necessário cadastrar `GHCR_TOKEN` nem `GHCR_USERNAME` para publicar. `GITHUB_TOKEN` e `github.actor` são fornecidos na execução. Caso o deploy use GitHub Environment `production`, prefira secret de ambiente e required reviewer; o repositório pessoal precisa permitir esse recurso no plano/configuração vigente.

## 5.1 Notificação de release por Amazon SES

O workflow envia uma mensagem após cada release, inclusive quando `verify` ou `image/deploy` falha. O remetente e o destinatário padrão são `lucaslyrab@hotmail.com`, que deve permanecer verificado no SES. A região padrão é `us-east-1`.

Em **Settings → Secrets and variables → Actions → Repository secrets**, cadastre:

| Secret | Valor |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access key rotacionada com permissão mínima `ses:SendEmail`/`ses:SendRawEmail` na região usada |
| `AWS_SECRET_ACCESS_KEY` | Secret key correspondente; nunca comitar ou imprimir |
| `AWS_REGION` | `us-east-1` (opcional; esse é o padrão) |
| `SES_FROM_EMAIL` | `lucaslyrab@hotmail.com` (opcional; esse é o padrão) |
| `SES_TO_EMAIL` | `lucaslyrab@hotmail.com` (opcional; esse é o padrão) |

Recomenda-se usar um usuário IAM exclusivo para notificações, com política restrita ao envio SES e, se possível, credenciais de curta duração/OIDC. Se a conta SES estiver em sandbox, o destinatário também precisa estar verificado. A action AWS é fixada por SHA e o corpo do e-mail contém apenas status, commit, resultados dos jobs e link do workflow.

## 6. Proteções recomendadas

- Branch protection/ruleset em `main`: PR, checks obrigatórios e bloqueio de force-push.
- Environment `production` com aprovação manual no começo; automatização total somente após UAT/rollback confiáveis.
- Concorrência de deploy: cancelar execução antiga ou serializar por ambiente.
- Timeout no `curl` do webhook, `--fail-with-body` e nenhum modo verbose.
- Rotação do webhook/PAT em incidente ou mudança de responsável.
- Package retention e limpeza nunca devem remover a imagem atualmente implantada nem o rollback anterior.

## 7. Validação e rollback

Antes de produção:

1. Publicar imagem de teste e confirmar visibilidade no GHCR.
2. Confirmar pull pelo Portainer sem expor o token.
3. Chamar webhook e observar novo task saudável.
4. Testar HTTPS, login e `/api/health` externamente.
5. Reimplantar o SHA anterior e confirmar rollback.
6. Restaurar backup em banco isolado e validar contagens.

Se webhook retornar sucesso mas a versão não mudar, verifique: tag/digest da stack, “force redeployment”, acesso do PAT ao package, logs da stack e healthcheck. Não repita o webhook indefinidamente sem identificar a causa.

## Fontes verificadas em 2026-09-19

- [Portainer — Add a new stack / GitOps updates](https://docs.portainer.io/user/docker/stacks/add)
- [GitHub — Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [GitHub — Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub — Using secrets in Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
