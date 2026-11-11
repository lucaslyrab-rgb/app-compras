# Ambiente local: testar no computador antes de subir para o servidor

O sistema roda inteiro no seu computador, com banco próprio. Nada do que for feito
aqui chega às lojas. Só depois de aprovado aqui a mudança entra na `main` e vai
para produção.

```
Branch com a mudança  →  testar no PC e no celular  →  aprovar  →  merge na main  →  produção
                         (este guia)                              (deploy automático)
```

O que roda onde:

| Parte | Local (seu PC) | Produção (servidor) |
|---|---|---|
| Sistema | `npm run dev` em `http://localhost:3000` | Portainer, `compras.muitomaisatacado.com` |
| Banco | Docker (`docker-compose.dev.yml`), porta 5433 | PostgreSQL do servidor |
| Fotos e notas | pasta `.local-storage` do projeto | S3 |
| Usuários | de teste (`@local.test`) ou cópia da produção com senha trocada | reais |

Nada disso usa memória do servidor.

## 1. Preparar uma vez

Precisa de: **Git**, **Node 24**, **Docker Desktop** (aberto) e **VS Code**.

No VS Code, abra o terminal (**Terminal → Novo terminal**) e rode:

```powershell
cd $HOME\Documents
git clone https://github.com/lucaslyrab-rgb/app-compras.git
cd app-compras
code .
```

No terminal da janela nova do VS Code:

```powershell
copy .env.development.example .env
npm install
```

Abra o arquivo `.env` e troque `DEV_PASSWORD` por uma senha só sua para os testes
(mínimo 8 caracteres; **não use a senha de produção**).

## 2. Subir o banco e criar os dados de teste

```powershell
npm run dev:db       # sobe o PostgreSQL no Docker
npm run dev:setup    # cria tabelas, importa os 74 produtos e os usuários de teste
```

No fim aparece a lista de logins, todos com a senha `DEV_PASSWORD`:

- `gestor@local.test` — Gestor
- `comprador@local.test` — Comprador
- `loja-ponta-da-fruta@local.test`, `loja-balneario@local.test`, `loja-santa-monica@local.test` — Lojas

`npm run dev:setup` pode ser repetido quando quiser; ele não duplica nada.

### Pedidos de teste

```powershell
npm run dev:pedidos
```

Cria um pedido de cada loja no ciclo de compra atual (15 a 25 produtos, com
produtos em comum entre as lojas) e 5 fornecedores fictícios marcados "(teste)".
Depois é só entrar como `comprador@local.test` e seguir Consolidado → Custos →
Destinação, e como loja para a Conferência. Loja que já tem pedido no ciclo é
pulada; para um ciclo novo, rode no dia seguinte ou recomece o banco (ver
"Problemas comuns").

## 3. Rodar o sistema

```powershell
npm run dev
```

Abra `http://localhost:3000`. Cada arquivo salvo atualiza a tela na hora. Para
parar, `Ctrl+C` no terminal.

## 4. Testar no celular (você e o Christian)

Celular e computador precisam estar **no mesmo Wi-Fi**.

1. Descubra o IP do computador: no terminal, `ipconfig` → linha **Endereço IPv4**
   do Wi-Fi (ex.: `192.168.0.15`).
2. No `.env`, preencha `DEV_LAN_HOSTS=192.168.0.15` e reinicie o `npm run dev`.
3. No celular, abra `http://192.168.0.15:3000`.
4. Se o Windows perguntar sobre o firewall para o **Node.js**, permita em **Redes privadas**.
   Se a rede de casa estiver marcada como "Pública", mude para "Privada" nas
   configurações de Wi-Fi do Windows.

O IP pode mudar quando o roteador reinicia; se o celular parar de abrir, confira de novo.

## 5. Testar uma mudança (fluxo de cada versão)

Cada mudança vem num branch, com um PR no GitHub (ex.: `chore/ambiente-local`).

```powershell
git fetch
git switch nome-do-branch     # troca o código para a versão em teste
npm install                   # só se o PR mudou dependências
npm run db:migrate            # só se o PR trouxe mudança de banco
npm run dev
```

Teste no PC e no celular. Depois:

- **Aprovado** → avise no chat; o merge na `main` publica em produção.
- **Precisa ajuste** → mande o print/descrição; o branch é atualizado e você roda
  `git pull` para pegar a correção.

Para voltar à versão de produção: `git switch main` e `git pull`.

## 6. Testar com uma cópia da produção (opcional)

Para reproduzir uma situação real (ex.: um ciclo com problema), dá para carregar
uma cópia do banco de produção **só no seu PC**:

1. Pegue o backup mais recente no bucket de backups (`compras-bkp`, arquivo
   `app-compras-AAAAMMDDTHHMMSSZ.dump.age`).
2. Descriptografe com a chave `age` guardada no cofre
   ([age para Windows](https://github.com/FiloSottile/age/releases)):
   ```powershell
   age -d -i caminho\age-identity.txt -o backup.dump app-compras-....dump.age
   ```
3. Carregue no banco local (isso **apaga o banco local** e recria a partir da cópia):
   ```powershell
   npm run dev:restore -- backup.dump
   ```

O script troca a senha de **todos** os usuários da cópia para `DEV_PASSWORD` e
encerra as sessões copiadas; no fim lista os e-mails para entrar como qualquer
loja ou como o Christian. As fotos de produtos e notas ficam no S3 de produção e
não vêm junto, por isso aparecem sem imagem.

Cuidados: a cópia tem dados reais das lojas. Guarde o `.dump` fora de pastas
sincronizadas (OneDrive, Google Drive) e apague quando terminar. Os arquivos
`*.dump` não vão para o GitHub.

## Segurança

- Os scripts `dev:setup` e `dev:restore` **recusam** qualquer banco que não seja
  `localhost`; um `.env` copiado errado não consegue alterar a produção.
- O `.env` e a pasta `.local-storage` não vão para o GitHub nem para a imagem de produção.
- O armazenamento em pasta (`LOCAL_STORAGE_DIR`) é recusado em produção.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `npm run dev:db` dá erro de conexão com o Docker | Abra o Docker Desktop e espere ficar "running". |
| `port is already allocated` (5433) | Outro programa usa a porta; troque `5433` no `docker-compose.dev.yml` e no `.env`. |
| Celular não abre a página | Mesmo Wi-Fi? IP certo no `.env`? Firewall liberado para Node.js em rede privada? |
| Tela pede login toda hora no celular | Use sempre o mesmo endereço (IP), não alterne com `localhost`. |
| Quero começar do zero | `docker compose -f docker-compose.dev.yml down -v` (apaga o banco local) e repita o passo 2. |
