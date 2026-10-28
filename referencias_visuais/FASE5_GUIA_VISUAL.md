# Guia Visual e Especificação de Telas — Fase 5 (Com Fotos dos Produtos)

Este documento e os arquivos complementares na pasta `referencias_visuais/` contêm a especificação visual e a simulação interativa das 4 interfaces principais da **Fase 5 (Conferência de Mercadorias e Lançamento de Perdas)** do Sistema MultiShow FLV, com base no planejamento consolidado v2.0 ([`docs/PLANEJAMENTO.md`](file:///var/www/compras.muitomaisatacado.com/docs/PLANEJAMENTO.md)), agora integradas nativamente com as **fotografias e miniaturas dos produtos** do catálogo FLV (`ProductPhoto`).

---

## 📂 Arquivos Disponíveis nesta Pasta

| Arquivo | Formato | Como Visualizar no VS Code | Conteúdo |
|---|---|---|---|
| [`PROTOTIPO_INTERATIVO_FASE5.html`](file:///var/www/compras.muitomaisatacado.com/referencias_visuais/PROTOTIPO_INTERATIVO_FASE5.html) | HTML Interativo | Clique com botão direito → *Open with Live Server* ou *Simple Browser* | **Protótipo completo com abas interativas** alternando entre as 4 telas com simulação mobile realista e fotos dos produtos |
| [`fase5_01_hub_loja.svg`](file:///var/www/compras.muitomaisatacado.com/referencias_visuais/fase5_01_hub_loja.svg) | Imagem Vetorial SVG | Clique diretamente no arquivo no VS Code | **Tela 1:** Hub de Navegação das Lojas (Modal Pedido / Conferência / Perdas) |
| [`fase5_02_conferencia_mobile.svg`](file:///var/www/compras.muitomaisatacado.com/referencias_visuais/fase5_02_conferencia_mobile.svg) | Imagem Vetorial SVG | Clique diretamente no arquivo no VS Code | **Tela 2:** Conferência Física com fotos dos produtos ao lado do código ERP e peso |
| [`fase5_03_perdas_loja_mobile.svg`](file:///var/www/compras.muitomaisatacado.com/referencias_visuais/fase5_03_perdas_loja_mobile.svg) | Imagem Vetorial SVG | Clique diretamente no arquivo no VS Code | **Tela 3:** Lançamento de Perdas com miniatura na seleção e no feed do dia |
| [`fase5_04_consulta_perdas_gestor.svg`](file:///var/www/compras.muitomaisatacado.com/referencias_visuais/fase5_04_consulta_perdas_gestor.svg) | Imagem Vetorial SVG | Clique diretamente no arquivo no VS Code | **Tela 4:** Painel de Consulta Consolidada de Perdas (Desktop para Gestor e Comprador com fotos) |

---

## 1. Tela 01: Hub de Navegação das Lojas (Seção 7.2)

```text
+-----------------------------------------------------------+
| MULTISHOW FLV • Ponta da Fruta                   [Sair ↪] |
+-----------------------------------------------------------+
|                                                           |
|    +-------------------------------------------------+    |
|    | Acesso Operacional                              |    |
|    | Selecione a atividade que deseja realizar:      |    |
|    +-------------------------------------------------+    |
|    | 📝 Fazer Pedido                                 |    |
|    |    Lançar estoque e pedidos para o ciclo        |    |
|    |    [✓ Ciclo 28/10 Aberto]                    ❯  |    |
|    +-------------------------------------------------+    |
|    | ⚖️ Conferência de Entrega                       |    |
|    |    Pesar mercadorias do caminhão (em KG)        |    |
|    |    [⚠️ 1 Ciclo pendente de peso]             ❯  |    |
|    +-------------------------------------------------+    |
|    | 🗑️ Lançamento de Perdas                         |    |
|    |    Registrar quebras e descartes no expediente  |    |
|    |    [📊 3 registros hoje]                     ❯  |    |
|    +-------------------------------------------------+    |
|    | Navegue entre os módulos a qualquer momento     |    |
|    | pelo menu superior sem refazer login.           |    |
|    +-------------------------------------------------+    |
|                                                           |
+-----------------------------------------------------------+
```

### Regras de Negócio e UX:
- **Acesso direto sem relogar:** A loja não precisa fazer logout para alternar entre enviar um pedido, pesar o caminhão ou registrar um descarte.
- **Badges informativos em tempo real:**
  - *Fazer Pedido:* indica se o ciclo atual está aberto ou encerrado.
  - *Conferência:* sinaliza se há mercadorias do ciclo anterior aguardando pesagem de recebimento.
  - *Perdas:* indica quantos registros de quebra foram feitos no dia.

---

## 2. Tela 02: Conferência Física de Recebimento com Fotos (Seções 7.3 a 7.6)

```text
+-----------------------------------------------------------+
| [‹ Menu] Conferência de Entrega       Ponta da Fruta      |
+-----------------------------------------------------------+
| CICLO 27/10 • CHEGADA                       75% Concluído |
| 18 de 24 itens conferidos (6 pendentes de peso)           |
| [██████████████████████████████░░░░░░░░░░]                |
+-----------------------------------------------------------+
| [ Todos (24) ]  [ ⏳ Pendentes (6) ]  [ ✓ Conferidos (18) ]|
+-----------------------------------------------------------+
| [🔍 Buscar produto ou código ERP...                     ] |
+-----------------------------------------------------------+
| [🍅 FOTO] [ERP 305] Tomate Débora Extra      [⏳ Pendente]|
|           Pedido original: 8 CX                           |
| [  Peso real...  ] KG   [ ✕ Não Recebido (0 KG) ]         |
+-----------------------------------------------------------+
| [🥔 FOTO] [ERP 412] Batata Inglesa Lisa      [⏳ Pendente]|
|           Pedido original: 5 SC                           |
| [  Peso real...  ] KG   [ ✕ Não Recebido (0 KG) ]         |
+-----------------------------------------------------------+
| [🍌 FOTO] [ERP 101] Banana Prata Especial   [✓ 215.40 KG] |
|           Pedido original: 10 CX • Recebido: 215.40 KG    |
|                                         [✏️ Alterar peso] |
+-----------------------------------------------------------+
| [🍉 FOTO] [ERP 204] Melancia Graúda   [✕ Não Recebido (0)]|
|           Pedido original: 15 UND • Confirmado corte/falta|
+-----------------------------------------------------------+
| [💾 Salvar Parcial]    [ ✓ Finalizar (6 pendentes) ]      |
+-----------------------------------------------------------+
```

### Regras de Negócio e Integração com Fotos:
1. **Identificação Visual Instantânea:** A miniatura da foto (componente `ProductPhoto`, 48x48px com cantos arredondados) permite ao conferente bater o olho na caixa descarregada do caminhão e achar o item na tela sem depender de ler o texto completo.
2. **Origem:** Itens baseados exclusivamente no **pedido enviado pela loja** no ciclo. Mesmo que o comprador não tenha comprado ou tenha cortado, o item consta na lista da loja para conferência no caminhão.
3. **Campo de Peso:** Em **KG**, com `inputMode="decimal"` para acionamento do teclado numérico no celular.
4. **Ação "Não recebido":** Um clique preenche o peso como `0.00 KG` e marca o item como verificado.
5. **Salvamento Parcial:** Salva o estado dos itens já pesados a qualquer momento (o status da conferência permanece `IN_PROGRESS`).
6. **Finalização com Validação no Servidor:** O botão de finalização só é liberado quando **todos os itens** estiverem verificados (com peso > 0 ou explicitamente marcados como Não recebido = 0 KG).

---

## 3. Tela 03: Lançamento de Perdas pela Loja com Fotos (Seções 7.7 e 7.8)

```text
+-----------------------------------------------------------+
| [‹ Menu] Lançamento de Perdas       Ponta da Fruta        |
+-----------------------------------------------------------+
| Registrar Nova Perda / Descarte                           |
| PRODUTO:                                                  |
| [ [🍅 FOTO] [305] Tomate Débora Extra                  ▾ ]|
| QUANTIDADE:                 UNIDADE:                      |
| [ 4.50                  ]   [ KG                       ▾ ]|
| MOTIVO DA PERDA:                                          |
| [ Avaria ] [✓ Maduro/Passado ] [ Quebra Int. ] [ Outro ]  |
| OBSERVAÇÃO:                                               |
| [ Ex: frutos amassados no fundo da caixa                ] |
|                                                           |
| [ + Confirmar e Salvar Perda                            ] |
+-----------------------------------------------------------+
| Perdas de Hoje nesta Loja         3 lançamentos (22.8 KG) |
|-----------------------------------------------------------|
| [🍅 FOTO] [305] Tomate Débora Extra             - 4.50 KG |
|           Maduro / Passado • 15:40            [✕ Excluir] |
|-----------------------------------------------------------|
| [🥬 FOTO] [120] Alface Crespa Hidropônica       - 6.00 UND|
|           Avaria no Transporte • 11:15        [✕ Excluir] |
|-----------------------------------------------------------|
| [🍌 FOTO] [101] Banana Prata Especial          - 12.30 KG |
|           Triagem Matinal • 09:20             [✕ Excluir] |
+-----------------------------------------------------------+
```

### Regras de Negócio e UX:
1. **Confirmação Visual:** Ao selecionar o produto na lista ou na busca, a foto do produto é exibida imediatamente ao lado do nome, evitando descartes no produto errado (ex: Tomate Débora vs. Tomate Italiano).
2. **Histórico Visual:** O feed de perdas do dia exibe a foto de cada produto lançado.

---

## 4. Tela 04: Consulta Consolidada de Perdas — Gestor e Comprador (Seção 7.9)

```text
+----------------------------------------------------------------------------------------------------+
| MULTISHOW | Painel Integrado     Consolidado | Custos | Destinação | [🗑️ Perdas FLV] | Gestor 👤   |
+----------------------------------------------------------------------------------------------------+
| FILTROS:                                                                                           |
| LOJA: [ Todas as Lojas (3) ▾ ]  PERÍODO: [ 20/10/2026 até 27/10/2026 ]  PRODUTO: [ Buscar... ]    |
| [ Aplicar Filtros ]                                                                                |
+----------------------------------------------------------------------------------------------------+
| [ KPI 1: Total Perdas: 342.80 KG ]  [ KPI 2: Maior Volume: Ponta da Fruta ]  [ KPI 3: Top Item ]   |
+----------------------------------------------------------------------------------------------------+
| DATA/HORA    LOJA            ERP / PRODUTO COM FOTO         QUANTIDADE   MOTIVO          RESPONSÁVEL|
| 27/10 15:40  Ponta da Fruta  [🍅 FOTO] [305] Tomate Débora  4.50 KG      Maduro/Passado  Marcos S.  |
| 27/10 14:15  Balneário       [🍉 FOTO] [204] Melancia       18.20 KG     Rachada/Avaria  Juliana P. |
| 27/10 11:15  Ponta da Fruta  [🥬 FOTO] [120] Alface Crespa  6.00 UND     Avaria Transp.  Marcos S.  |
| 27/10 09:30  Santa Mônica    [🥔 FOTO] [412] Batata Lisa    8.90 KG      Broto/Murcha    Carlos E.  |
| 27/10 09:20  Ponta da Fruta  [🍌 FOTO] [101] Banana Prata   12.30 KG     Triagem Matinal Marcos S.  |
+----------------------------------------------------------------------------------------------------+
```

### Regras de Negócio e UX:
1. **Visão Global:** Permite à gestão e aos compradores enxergar o desperdício real por loja e por produto com miniatura fotográfica na tabela.
2. **Filtros Flexíveis:** Filtrar por loja específica, período ou produto.
3. **Apenas Leitura:** Não permite alterar os registros originais das lojas.
