# Roteiro de UAT — primeiro fluxo FLV

Este roteiro deve ser executado em aparelhos reais, na URL HTTPS de homologação, antes de marcar a tarefa OpenSpec 5.3 como concluída. Não registre senhas, tokens ou cookies nesta evidência.

## Preparação

- Data/hora e responsável:
- URL e versão da imagem (`sha-...`):
- Aparelho, sistema e navegador:
- Conectividade (Wi‑Fi/4G/5G):
- Evidência anexada (captura sem dados sensíveis ou link interno):

## Loja

- [ ] Login válido e mensagem genérica para credencial inválida.
- [ ] Catálogo abre em 360 px sem rolagem horizontal.
- [ ] Busca e filtros `Todos`, `Sem pedido` e `Com pedido` funcionam.
- [ ] Estoque/pedido permanecem após recarregar antes do envio.
- [ ] `Salvar Pedido` cria revisão e aparece no histórico da própria loja.
- [ ] Pedido de outra loja não é acessível.
- Resultado: **Aprovado / Defeito P0 / P1 / P2** — observação:

## Comprador

- [ ] Login e sessão funcionam no aparelho usado.
- [ ] Pode consultar os pedidos autorizados para consolidação.
- [ ] Não consegue criar/inativar produto nem administrar usuários.
- [ ] Não acessa pedidos fora do escopo permitido.
- Resultado: **Aprovado / Defeito P0 / P1 / P2** — observação:

## Gestor

- [ ] Login e sessão segura funcionam.
- [ ] Pode administrar catálogo conforme autorização.
- [ ] Inativação preserva produto em histórico e impede nova seleção.
- [ ] Pode consultar auditoria sem visualizar segredos.
- Resultado: **Aprovado / Defeito P0 / P1 / P2** — observação:

## Aceite

- Defeitos P0/P1 abertos: `0`.
- Defeitos P2 abertos e responsável:
- Decisão: **Aprovado / Reprovado / Aprovado com ressalvas**.
- Assinatura/responsável:
