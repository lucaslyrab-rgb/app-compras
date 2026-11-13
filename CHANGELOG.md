# Histórico de versões

Cada versão vai para produção quando o Lucas aprova, depois de testada no
ambiente local ([docs/desenvolvimento-local.md](docs/desenvolvimento-local.md)).
Detalhes da primeira versão completa: [docs/versao-1.md](docs/versao-1.md).

## 1.4.0 — 13/11/2026

**Seção Embalados**
- Produtos embandejados (comprados do WG Embalados) ficam depois de todos os
  outros, sob o título **Embalados**, em Pedido, Consolidado (tela e A4),
  Custos, Destinação, Conferência, Perdas e Fechamento integrado. Cadastro de
  Produtos e Precificação seguem em ordem alfabética.
- Marcação no cadastro do produto: caixa **Embalado (seção Embalados)**. De
  início, ficam marcados os produtos com vínculo exclusivo com o WG Embalados.

**Cadastro de produtos (Gestor)**
- Lista mais limpa: sem o quadro de configurações (continua em Precificação) e
  sem os cartões de números; filtros **Todos, Conversão padrão, Unitários,
  Configurados, Embalados e Inativos**, com contagem; selo **Embalado**.
- Painel lateral sem rolagem para os lados, em abas **Dados · Fornecedores ·
  Precificação · Foto**, com rodapé fixo: **Alterações não salvas**, Desfazer e
  Salvar.
- Aba Fornecedores: uma linha por fornecedor (Principal, Exclusivo,
  Alternativo), ações no menu ⋯ e "+ Vincular fornecedor".
- Sai a caixa duplicada **Fornecedor exclusivo**: a exclusividade é marcada só
  na aba Fornecedores. Produtos que eram exclusivos só pela caixa antiga
  ganharam o vínculo Principal + Exclusivo com a JEB Distribuidora.

## 1.3.0 — 13/11/2026

**Notas no Fechamento integrado (Gestor e CPD)**
- Coluna **Nota** no detalhe de cada produto (por loja) e na aba Valor por loja:
  o número abre a foto anexada na Destinação.
- Caixa **Entrada dada** por nota, com quem marcou e quando; vale para a nota
  inteira (todos os produtos e as duas abas).
- Loja sem nota: Gestor/CPD informa **só o número**, sem foto. Na Destinação o
  comprador vê "Usar NF …"; ao anexar a foto com o mesmo número, vira a mesma
  nota e a marcação de entrada continua.
- Contador e filtro **Notas sem entrada N de M**.
- Produto fica em **verde claro** quando todas as notas das lojas dele têm entrada.
- Seletor de ciclo e de loja trocam a tela ao escolher e acompanham as setas
  (sai o botão "Ver").

## 1.2.0 — 12/11/2026

**Fechamento integrado novo (Gestor e CPD)**
- Um ciclo por vez, com setas para trocar de ciclo.
- Aba **Caminho dos produtos**: o que aconteceu com cada produto no ciclo —
  pedido → compra → destinação → conferência — e o desfecho (pedido e não
  comprado, comprado sem destinação, corte, adicional, diferença na conferência,
  conferência pendente, tudo certo). Ao tocar no produto: loja por loja,
  fornecedores, notas fiscais e quem lançou a compra.
- Aba **Valor por loja**: valor comprado (destinado × custo do ciclo), valor
  recebido pela conferência finalizada (ajustado pelo peso) e diferença, com
  detalhe por fornecedor e número da nota.
- Substitui a consulta antiga por período.

**Ambiente local**
- `npm run dev:pedidos`: pedidos de teste das lojas.
- `npm run dev:ciclo`: ciclo completo de teste (custos, destinação com cortes e
  adicionais, notas e conferências com diferenças).
- Scripts de importação e administração funcionam no Windows.

## 1.1.0 — 04/11 a 11/11/2026

- Destinação: quantidade começa em zero com atalho "Usar pedido"; a loja não
  finaliza com produto comprado sem destino, e o corte de produto comprado só
  para outras lojas pede confirmação (#20, #21).
- Notas fiscais salvam mais rápido (foto reduzida no celular antes do envio) (#21).
- Lista de fornecedores da Destinação não desce mais ao pesquisar (#22).
- Imagem do servidor com pacotes do Alpine atualizados (segurança) (#23).
- Ambiente local para testar cada versão antes da produção (#24).

## 1.0.0 — 02/11/2026

Primeira versão completa em produção: pedidos das lojas, consolidado, custos,
destinação no celular, notas fiscais, conferência, perdas, Fechamento integrado
e cadastros. Ver [docs/versao-1.md](docs/versao-1.md).
