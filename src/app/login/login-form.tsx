"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: undefined });
  return (
    <form action={action} className="panel stack" aria-describedby={state.error ? "login-error" : undefined}>
      <div>
        <h1>Entrar no MultiShow FLV</h1>
        <p className="muted">Use as credenciais fornecidas pelo Gestor.</p>
      </div>
      {state.error ? <p id="login-error" className="error" role="alert">{state.error}</p> : null}
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" minLength={16} required />
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
