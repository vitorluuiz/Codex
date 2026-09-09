'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Checkbox, Input } from '@/components/ds';
import { loginAction, signupAction, startOAuthAction, type AuthFormState } from '@/lib/actions/auth';
import { cx } from '@/lib/cx';
import { PROVIDERS } from './ProviderIcons';
import styles from './AuthPanel.module.css';

type Mode = 'login' | 'signup';

const INITIAL_STATE: AuthFormState = { error: null };

function SubmitButton({ children, disabled }: { children: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block disabled={disabled || pending} className={styles.submit}>
      {pending ? 'Aguarde…' : children}
    </Button>
  );
}

/**
 * Um `<form>` com tres botoes de submit, e nao tres `onClick`: assim a falha do provedor tem
 * onde aparecer. Antes o retorno da action era descartado e um provedor fora do ar virava um
 * clique morto.
 */
function ProviderButtons() {
  const { pending } = useFormStatus();

  return (
    <>
      {PROVIDERS.map(({ id, label, Mark }) => (
        <button
          key={id}
          type="submit"
          name="provider"
          value={id}
          className={styles.provider}
          disabled={pending}
        >
          <Mark />
          Continuar com {label}
        </button>
      ))}
    </>
  );
}

function Providers({ mode, initialError }: { mode: Mode; initialError: string | null }) {
  const [state, formAction] = useActionState(startOAuthAction, { error: initialError });

  return (
    <>
      {state.error && <p className={styles.formError}>{state.error}</p>}
      <form
        action={formAction}
        className={cx(styles.providers, mode === 'signup' && styles.providersTight)}
      >
        <ProviderButtons />
      </form>
    </>
  );
}

function Divider({ label, tight }: { label: string; tight?: boolean }) {
  return (
    <div className={cx(styles.divider, tight && styles.dividerTight)}>
      <span className={styles.dividerLine} />
      <span className={styles.dividerLabel}>{label}</span>
      <span className={styles.dividerLine} />
    </div>
  );
}

function LoginForm() {
  const [state, formAction] = useActionState(loginAction, INITIAL_STATE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  return (
    <>
      <h1 className={styles.title}>Bem-vindo de volta!</h1>
      <p className={styles.lead}>Entre para continuar sua sequência de estudos.</p>

      {state.error && <p className={styles.formError}>{state.error}</p>}

      <form action={formAction} className={styles.fields}>
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@exemplo.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <input type="hidden" name="rememberMe" value={rememberMe ? 'on' : 'off'} />

        <div className={styles.row}>
          <Checkbox label="Lembrar de mim" checked={rememberMe} onChange={setRememberMe} />
          <Link href="/recuperar-senha" className={styles.forgot}>
            Esqueceu a senha?
          </Link>
        </div>

        <SubmitButton disabled={!email.trim() || !password.trim()}>Entrar</SubmitButton>
      </form>
    </>
  );
}

function SignupForm() {
  const [state, formAction] = useActionState(signupAction, INITIAL_STATE);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const emailMismatch = emailConfirm.length > 0 && email !== emailConfirm;
  const passwordMismatch = passwordConfirm.length > 0 && password !== passwordConfirm;
  const disabled =
    !name.trim() ||
    !email.trim() ||
    !password.trim() ||
    !emailConfirm ||
    !passwordConfirm ||
    emailMismatch ||
    passwordMismatch;

  return (
    <>
      <h1 className={styles.title}>Crie sua conta</h1>
      <p className={cx(styles.lead, styles.leadTight)}>Comece sua sequência de estudos hoje.</p>

      {state.error && <p className={styles.formError}>{state.error}</p>}

      <form action={formAction} className={cx(styles.fields, styles.fieldsTight)}>
        <Input
          label="Nome completo"
          name="name"
          autoComplete="name"
          placeholder="Seu nome"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@exemplo.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Confirmar email"
          type="email"
          placeholder="voce@exemplo.com"
          value={emailConfirm}
          onChange={(event) => setEmailConfirm(event.target.value)}
          error={emailMismatch ? 'Os emails não coincidem' : null}
        />
        <Input
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Crie uma senha"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          placeholder="Repita a senha"
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          error={passwordMismatch ? 'As senhas não coincidem' : null}
        />

        <SubmitButton disabled={disabled}>Criar conta</SubmitButton>
      </form>
    </>
  );
}

export function AuthPanel({
  initialMode,
  initialError = null,
}: {
  initialMode: Mode;
  /** Erro trazido de volta pelo callback do provedor (`/entrar?erro=oauth`). */
  initialError?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const isLogin = mode === 'login';

  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label="Entrar ou criar conta">
        <button
          type="button"
          role="tab"
          aria-selected={isLogin}
          className={cx(styles.tab, isLogin && styles.tabActive)}
          onClick={() => setMode('login')}
        >
          Entrar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isLogin}
          className={cx(styles.tab, !isLogin && styles.tabActive)}
          onClick={() => setMode('signup')}
        >
          Criar conta
        </button>
      </div>

      {isLogin ? <LoginForm /> : <SignupForm />}

      <Divider label={isLogin ? 'ou continue com' : 'ou cadastre-se com'} tight={!isLogin} />
      <Providers mode={mode} initialError={initialError} />

      <p className={cx(styles.footNote, !isLogin && styles.footNoteTight)}>
        {isLogin ? (
          <>
            Não tem uma conta?{' '}
            <button type="button" className={styles.linkButton} onClick={() => setMode('signup')}>
              Crie uma agora
            </button>
          </>
        ) : (
          <>
            Já tem uma conta?{' '}
            <button type="button" className={styles.linkButton} onClick={() => setMode('login')}>
              Entrar
            </button>
          </>
        )}
      </p>
    </div>
  );
}
