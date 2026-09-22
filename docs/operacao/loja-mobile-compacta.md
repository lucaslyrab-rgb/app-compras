# Loja: lista mobile compacta — 22/09/2026

Escopo exclusivamente visual: `OrderWorkspace`, CSS da tela e teste de navegador.
Referência existente, sem cópia ou uso na interface: `referencias_visuais/Imagem do Codex 22 de set. de 2026, 09_33_39.png`.
Adotadas as diretrizes de densidade, labels, toque e não regressão de `.harness/standards/wittemberg`.

## Interface

- Até 600 px: placeholder neutro de 40×40 px, nome/unidade e campos lado a lado.
- Propriedade opcional `imageUrl` preparada no componente; sem upload, banco ou URLs externas cadastradas.
- Inputs de 66×44 px, fonte de 16 px, espaço medido para `99999`, sem `maxlength` ou nova validação.
- Nomes longos quebram sem corte; linhas excepcionalmente longas podem crescer para preservar o nome completo.
- Labels visuais `Est.`/`Pedido`, nomes acessíveis completos com o produto.
- Footer fixo com `env(safe-area-inset-bottom)`, reserva inferior no conteúdo e margem de scroll para foco.
- Tablet/desktop mantêm a tabela; thumbnail não aparece nessas larguras.
- Actions, estado, handlers de edição/Enter, FormData, revisão, permissões, banco e migrations permanecem inalterados.

## Verificação

Prévia temporária local com o componente real, 74 produtos simulados e nomes longos;
nenhum pedido enviado ou dado de produção alterado. Prévia e cópia anterior removidas antes do build/publicação.
Chromium: 320×568, 375×667, 390×844, 412×915, 768×1024 e 1280×900.

Em 390×844, card anterior 146 px + 12 px de intervalo; novo 72 px + 4 px.
Campo anterior 163×44 px; novo 66×44 px. Com cabeçalho visível: 1 produto completo antes e 5 depois.
Com lista alinhada ao topo: aproximadamente 4 produtos antes e 9 depois, acima do footer.
Em 375×667: 3 → 8 produtos com lista alinhada ao topo. Em 320×568: 2 → 6.
Nome muito longo pode aumentar a altura; números dependem do conteúdo, viewport e área segura.
Tablet/desktop: altura comum de 65 px antes e depois.

Os seis cenários de `tests/e2e/loja-mobile.spec.ts` verificam valores após busca/filtros,
nome acessível, cinco dígitos, seleção no foco, Enter, ausência de overflow e foco acima do footer
com viewport reduzida a 430 px (simulação de área útil menor, não teclado nativo).
Busca por ERP foi verificada com código conhecido na prévia.

Para repetir em ambiente autenticado de testes:
`npm run test:e2e -- tests/e2e/loja-mobile.spec.ts --project=desktop`
com `E2E_EMAIL`/`E2E_PASSWORD`. `LOJA_PREVIEW_URL` permite uma prévia isolada do mesmo componente.
Os testes não clicam em salvar/enviar. Não há rota de prévia publicada.

Testes emulados não homologam Safari/iPhone físico: conferir teclado decimal, barra do Safari,
safe area real e digitação na loja após implantação. Nenhuma mudança no pipeline.
