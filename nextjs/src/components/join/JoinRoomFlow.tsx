'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { AVATAR_COUNT, toAvatarIndex } from '@/components/avatar/avatars';
import { Button, Dialog, Input } from '@/components/ds';
import { checkRoomCodeAction, joinRoomAction } from '@/lib/actions/room';
import { cx } from '@/lib/cx';
import type { AvatarIndex, JoinRejectionReason } from '@/lib/types';
import { JOIN_ERRORS } from './joinErrors';
import styles from './JoinRoomFlow.module.css';

interface JoinRoomFlowProps {
  initialCode: string;
  suggestedName: string;
  isAuthenticated: boolean;
}

export function JoinRoomFlow({ initialCode, suggestedName, isAuthenticated }: JoinRoomFlowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<'code' | 'name'>('code');
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(suggestedName);
  const [avatarIndex, setAvatarIndex] = useState<AvatarIndex>(0);
  const [errorReason, setErrorReason] = useState<JoinRejectionReason | null>(null);

  function confirmCode() {
    startTransition(async () => {
      const result = await checkRoomCodeAction(code);
      if (result.ok) {
        setStep('name');
        setErrorReason(null);
      } else {
        setErrorReason(result.reason);
      }
    });
  }

  function join() {
    startTransition(async () => {
      const result = await joinRoomAction(code, name.trim(), avatarIndex);
      if (result.ok) {
        router.push(`/sala/${code}/lobby`);
      } else {
        setErrorReason(result.reason);
      }
    });
  }

  const error = errorReason ? JOIN_ERRORS[errorReason] : null;

  function runPrimaryAction() {
    if (!error) return;
    switch (error.primaryAction) {
      case 'retry-code':
        setCode('');
        setStep('code');
        break;
      case 'change-name':
        setName('');
        break;
      case 'login':
        router.push('/entrar');
        return;
      case 'retry-network':
        setErrorReason(null);
        if (step === 'code') confirmCode();
        else join();
        return;
      default:
        break;
    }
    setErrorReason(null);
  }

  const primaryLabel =
    error?.primaryAction === 'retry-code'
      ? 'Tentar de novo'
      : error?.primaryAction === 'change-name'
        ? 'Trocar nome'
        : error?.primaryAction === 'login'
          ? 'Fazer login'
          : error?.primaryAction === 'retry-network'
            ? 'Tentar de novo'
            : 'Entendi';

  return (
    <>
      {step === 'code' ? (
        <>
          <div className={styles.head}>
            <h1 className={styles.title}>Entrar na sala</h1>
            <p className={styles.lead}>Digite o código da sala para continuar.</p>
          </div>

          <form
            className={styles.fields}
            onSubmit={(event) => {
              event.preventDefault();
              confirmCode();
            }}
          >
            <Input
              label="Código da sala"
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              codeStyle
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <div className={styles.actions}>
              <Button type="submit" size="lg" wide disabled={!code.trim() || pending}>
                {pending ? 'Verificando…' : 'Continuar'}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className={styles.roomBadgeRow}>
            <span className={styles.roomBadge}>Sala {code}</span>
            <button type="button" className={styles.linkButton} onClick={() => setStep('code')}>
              Trocar código
            </button>
          </div>

          <div className={styles.head}>
            <h1 className={styles.title}>Quase lá!</h1>
            <p className={styles.lead}>Escolha um avatar e um nome, ou entre com sua conta.</p>
          </div>

          <div className={styles.avatarPicker}>
            <div className={styles.avatarRow}>
              <button
                type="button"
                className={styles.avatarNav}
                aria-label="Avatar anterior"
                onClick={() => setAvatarIndex(toAvatarIndex(avatarIndex - 1))}
              >
                ‹
              </button>
              <Avatar index={avatarIndex} size="xl" />
              <button
                type="button"
                className={styles.avatarNav}
                aria-label="Próximo avatar"
                onClick={() => setAvatarIndex(toAvatarIndex(avatarIndex + 1))}
              >
                ›
              </button>
            </div>
            <span className={styles.avatarCaption}>
              Escolha seu avatar ({avatarIndex + 1} de {AVATAR_COUNT})
            </span>
          </div>

          <form
            className={styles.fields}
            onSubmit={(event) => {
              event.preventDefault();
              join();
            }}
          >
            <Input
              label="Nome de usuário"
              placeholder="Como quer ser chamado?"
              autoComplete="nickname"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className={cx(styles.actions, styles.actionsTight)}>
              <Button type="submit" size="lg" wide disabled={!name.trim() || pending}>
                {pending ? 'Entrando…' : 'Entrar'}
              </Button>
            </div>
          </form>

          {!isAuthenticated && (
            <>
              <div className={styles.divider}>
                <span className={styles.dividerLine} />
                <span className={styles.dividerLabel}>ou</span>
                <span className={styles.dividerLine} />
              </div>
              <div className={styles.actions}>
                <Button variant="secondary" wide onClick={() => router.push('/entrar')}>
                  Entrar com minha conta
                </Button>
              </div>
            </>
          )}
        </>
      )}

      <Dialog
        open={Boolean(error)}
        title={error?.title}
        onClose={() => setErrorReason(null)}
        actions={
          error?.primaryAction ? (
            <>
              <Button variant="ghost" onClick={() => setErrorReason(null)}>
                Fechar
              </Button>
              <Button onClick={runPrimaryAction}>{primaryLabel}</Button>
            </>
          ) : (
            <Button onClick={() => setErrorReason(null)}>Entendi</Button>
          )
        }
      >
        {error && (
          <div className={styles.errorBody}>
            <span className={cx(styles.errorIcon, styles[error.toneClass])}>{error.icon}</span>
            <p className={styles.errorMessage}>{error.message({ code, name })}</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
