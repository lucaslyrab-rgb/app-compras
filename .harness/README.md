# Harness Skills · Wittemberg

Biblioteca pessoal para iniciar e realinhar projetos com IA, preservando contexto e evitando instruções duplicadas.

**Comece pelo [manual passo a passo](docs/manual.md).** A entrada da IA é [AGENTS.md](AGENTS.md), não o catálogo inteiro.

## Fluxo recomendado

**Contexto → base compatível → mudança OpenSpec → implementar → verificar → arquivar.**

- **Projeto novo:** escolher a stack; usar [Boilerplates](catalog/sources/boilerplates.md) apenas quando compatível.
- **Projeto existente:** preservar a estrutura e especificar somente a mudança necessária.
- **OpenSpec:** um ciclo de requisitos e tarefas, sem empilhar outros orquestradores.
- **Padrões Wittemberg:** baseline com aplicabilidade e exceções registradas.
- **Demais skills:** abrir apenas para uma lacuna concreta. [Veja o filtro](docs/curadoria.md).

PRD, TRD e brainstorm continuam disponíveis, mas não são uma sequência obrigatória para cada feature. Nenhum processo garante ausência de falhas; o manual define critérios verificáveis, retomada e limites de escopo.

## Uso rápido

```sh
git clone https://github.com/Wittemberg/harness-skills.git
cd harness-skills
python scripts/validate.py
```

Para economizar cópias, mantenha este checkout e informe seu caminho à IA. No projeto, preserve as instruções existentes e acrescente uma referência curta ao `AGENTS.md` desta biblioteca. Para uma cópia portátil, com Python >=3.10:

```sh
python scripts/bootstrap.py --dest ../meu-projeto
python scripts/bootstrap.py --dest ../meu-projeto --apply
```

O primeiro comando é prévia. O segundo copia a biblioteca para `.harness/`, preserva o `AGENTS.md` existente e acrescenta um ponteiro. Recusa sobrescrever `.harness/`. Não instala OpenSpec, aplicações, hooks ou MCPs. Copiar arquivos não exige lê-los no contexto da IA.

**Prompt inicial:**

> Leia o AGENTS.md do projeto e o da biblioteca indicada. Quero [iniciar / realinhar] [objetivo]. Investigue apenas a área relevante, preserve decisões válidas e siga o manual da biblioteca. Selecione o menor conjunto de recursos necessário; mantenha uma mudança ativa com critérios de aceite e evidências. Não duplique requisitos em vários documentos. Execute o trabalho autorizado e registre o próximo passo.

## Navegação

| Preciso de | Leia |
| --- | --- |
| Passos para começar, realinhar e retomar | [Manual](docs/manual.md) |
| Seleção do essencial e eliminação de sobreposições | [Curadoria](docs/curadoria.md) |
| Uma skill específica | [Índice curto](skills/README.md) |
| Uma ferramenta, kit ou referência | [Catálogo](catalog/README.md) |
| Padrões de engenharia | [Baseline Wittemberg](standards/wittemberg/README.md) |
| Limitações de runtime e integrações | [Compatibilidade](docs/compatibilidade.md) |
| Atualizar ou verificar importações | [Manutenção](docs/manutencao.md) |

## Organização e proveniência

`skills/` contém sete entradas selecionadas; `standards/` guarda a baseline; `upstream/` preserva fontes para consulta. `catalog/` contém fichas e inventários. `docs/` orienta o uso. `scripts/` e `tests/` verificam a biblioteca.

As 25 URLs fornecidas correspondem a **23 repositórios GitHub**, registrados em [sources.lock.json](sources.lock.json). A [Skill Creator](catalog/sources/skill-creator.md), lida na instalação local do Codex, tem pacote completo e proveniência separada em [local-sources.lock.json](local-sources.lock.json).

Todas as fontes solicitadas permanecem acessíveis; nenhuma é obrigatória apenas por estar na coleção. A seleção de documentação não representa auditoria integral do código de terceiros. Veja [escopo da revisão](docs/revisao-das-fontes.md) e [autoria/licenças](THIRD_PARTY_NOTICES.md).

```sh
python scripts/validate.py
python -m unittest discover -s tests -v
python scripts/sources.py --check-upstream
```
