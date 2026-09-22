"use client";

export default function ConsolidatedError({ reset }: { reset: () => void }) {
  return (
    <main className="page stack">
      <h1>Não foi possível carregar o Consolidado</h1>
      <p>
        Nenhum pedido foi alterado. Tente novamente para consultar os dados.
      </p>
      <button className="btn" onClick={reset}>
        Tentar novamente
      </button>
    </main>
  );
}
