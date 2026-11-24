'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { AVATAR_COUNT, toAvatarIndex } from '@/components/avatar/avatars';
import { Button, Input } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { recordLastActiveRoom } from '@/components/nav/sidebarSubmenus';
import { ROOM_STATUS_LABEL, describeActiveRoom } from '@/components/room/activeRoomLabels';
import { checkRoomCodeAction, joinRoomAction } from '@/lib/actions/room';
import { cx } from '@/lib/cx';
import { roomPath } from '@/lib/roomPath';
import { buildAuthReturnUrl } from '@/lib/safeRedirect';
import type { ActiveRoom, AvatarIndex, JoinRejectionReason } from '@/lib/types';
import { JOIN_ERRORS } from './joinErrors';
import {
  RoomCodeInput,
  formatRoomCode,
  type RoomCodeInputHandle,
} from './RoomCodeInput';
import styles from './JoinRoomFlow.module.css';

export interface JoinErrorState {
  reason: JoinRejectionReason;
  message?: string;
}

interface JoinRoomFlowProps {
  initialCode: string;
  initialStep?: 'code' | 'name';
  initialError?: JoinErrorState | null;
  activeRooms: ActiveRoom[];
  suggestedName: string;
  isAuthenticated: boolean;
}

const MAX_DISPLAY_NAME_LENGTH = 80;

function syncUrlCode(roomCode: string | null) {
  if (typeof window === 'undefined') return;
  const target = roomCode ? `/sala?codigo=${roomCode}` : '/sala';
  if (window.location.pathname + window.location.search !== target) {
    window.history.replaceState(null, '', target);
  }
}

export function JoinRoomFlow({
  initialCode,
  initialStep = 'code',
  initialError = null,
  activeRooms,
  suggestedName,
  isAuthenticated,
}: JoinRoomFlowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<'code' | 'name'>(initialStep);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(suggestedName);
  const [avatarIndex, setAvatarIndex] = useState<AvatarIndex>(0);
  const [errorState, setErrorState] = useState<JoinErrorState | null>(initialError);

  const codeInputRef = useRef<RoomCodeInputHandle | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoCheckedRef = useRef<string | null>(initialError ? initialCode : null);

  const matchedActiveRoom = useMemo(
    () => (code.length === 6 ? activeRooms.find((room) => room.code === code) ?? null : null),
    [activeRooms, code],
  );

  // Foca o campo de nome ao entrar no passo 2.
  useEffect(() => {
    if (step === 'name') {
      nameInputRef.current?.focus();
    }
  }, [step]);

  function verifyCode(targetCode: string) {
    const clean = targetCode.replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6 || pending) return;

    lastAutoCheckedRef.current = clean;
    setErrorState(null);

    startTransition(async () => {
      const result = await checkRoomCodeAction(clean);
      if (result.ok) {
        setStep('name');
        setErrorState(null);
        syncUrlCode(clean);
      } else {
        setErrorState({ reason: result.reason, message: result.message });
        if (JOIN_ERRORS[result.reason].display === 'inline') {
          requestAnimationFrame(() => codeInputRef.current?.focusForEdit());
        }
      }
    });
  }

  function handleCodeChange(nextCode: string) {
    setCode(nextCode);
    if (nextCode !== lastAutoCheckedRef.current) {
      lastAutoCheckedRef.current = null;
    }
    if (errorState) {
      setErrorState(null);
    }
  }

  function handleCodeComplete(fullCode: string) {
    if (activeRooms.some((room) => room.code === fullCode)) return;
    if (lastAutoCheckedRef.current === fullCode) return;
    verifyCode(fullCode);
  }

  function goBackToCode() {
    setStep('code');
    setErrorState(null);
    lastAutoCheckedRef.current = code;
    syncUrlCode(null);
    requestAnimationFrame(() => codeInputRef.current?.focusForEdit());
  }

  function join() {
    const trimmedName = name.trim();
    if (!trimmedName || pending) return;

    setErrorState(null);
    startTransition(async () => {
      const result = await joinRoomAction(code, trimmedName, avatarIndex);
      if (result.ok) {
        recordLastActiveRoom({
          code,
          status: 'lobby',
          role: 'participant',
        });
        router.push(`/sala/${code}/lobby`);
      } else {
        setErrorState({ reason: result.reason, message: result.message });
        if (JOIN_ERRORS[result.reason].display === 'inline') {
          requestAnimationFrame(() => nameInputRef.current?.focus());
        }
      }
    });
  }

  const errorPresentation = errorState ? JOIN_ERRORS[errorState.reason] : null;
  const errorText = errorPresentation
    ? errorPresentation.message({
        code,
        name,
        serverMessage: errorState?.message,
      })
    : null;

  const inlineCodeError =
    step === 'code' && errorPresentation?.display === 'inline' ? errorText : null;
  const inlineNameError =
    step === 'name' && errorPresentation?.display === 'inline' ? errorText : null;
  const bannerError =
    errorPresentation?.display === 'banner' && errorText
      ? { ...errorPresentation, text: errorText }
      : null;

  const authLoginUrl = buildAuthReturnUrl(code);
  const authSignupUrl = buildAuthReturnUrl(code, 'criar');

  return (
    <>
      <nav className={styles.stepper} aria-label="Etapas para entrar na sala">
        <button
          type="button"
          className={cx(
            styles.stepItem,
            step === 'code' ? styles.stepActive : styles.stepDone,
          )}
          onClick={step === 'name' ? goBackToCode : undefined}
          disabled={step === 'code'}
          aria-current={step === 'code' ? 'step' : undefined}
        >
          <span className={styles.stepDot} aria-hidden="true">
            {step === 'name' ? <Icon.Check size={12} /> : '1'}
          </span>
          <span>Código</span>
        </button>

        <span
          className={cx(styles.stepConnector, step === 'name' && styles.stepConnectorDone)}
          aria-hidden="true"
        />

        <span
          className={cx(styles.stepItem, step === 'name' && styles.stepActive)}
          aria-current={step === 'name' ? 'step' : undefined}
        >
          <span className={styles.stepDot} aria-hidden="true">
            2
          </span>
          <span>Seu perfil</span>
        </span>
      </nav>

      {step === 'code' ? (
        <>
          <div className={styles.head}>
            <h1 className={styles.title}>Entrar na sala</h1>
            <p className={styles.lead}>Digite ou cole o código de 6 dígitos para continuar.</p>
          </div>

          <form
            className={styles.fields}
            onSubmit={(event) => {
              event.preventDefault();
              verifyCode(code);
            }}
          >
            <RoomCodeInput
              ref={codeInputRef}
              value={code}
              onChange={handleCodeChange}
              onComplete={handleCodeComplete}
              error={inlineCodeError}
              disabled={pending}
              autoFocus={!initialCode}
            />

            {matchedActiveRoom ? (
              <div className={styles.activeMatch} role="status">
                <div className={styles.activeMatchHead}>
                  <span className={styles.activeMatchTitle}>
                    {matchedActiveRoom.role === 'leader'
                      ? 'Você é o líder desta sala'
                      : 'Você já está nesta sala'}
                  </span>
                  <span className={styles.activeMatchStatus}>
                    {ROOM_STATUS_LABEL[matchedActiveRoom.status]}
                  </span>
                </div>
                <p className={styles.activeMatchDesc}>{describeActiveRoom(matchedActiveRoom)}</p>
                <div className={styles.activeMatchActions}>
                  <Link href={roomPath(matchedActiveRoom)} className={styles.fullWidthLink}>
                    <Button size="lg" block>
                      Voltar para a sala →
                    </Button>
                  </Link>
                  {matchedActiveRoom.role === 'participant' && (
                    <button
                      type="button"
                      className={styles.secondaryLink}
                      disabled={pending}
                      onClick={() => verifyCode(code)}
                    >
                      Entrar novamente com outro nome
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.actions}>
                <Button type="submit" size="lg" wide disabled={code.length !== 6 || pending}>
                  {pending ? 'Verificando…' : 'Continuar'}
                </Button>
              </div>
            )}
          </form>
        </>
      ) : (
        <>
          <div className={styles.roomBadgeRow}>
            <span className={styles.roomBadge}>Sala {formatRoomCode(code)}</span>
            <button type="button" className={styles.linkButton} onClick={goBackToCode}>
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
              ref={nameInputRef}
              label="Nome de usuário"
              placeholder="Como quer ser chamado?"
              autoComplete="nickname"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              value={name}
              error={inlineNameError}
              onChange={(event) => {
                setName(event.target.value);
                if (errorState) setErrorState(null);
              }}
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
                <Button variant="secondary" wide onClick={() => router.push(authLoginUrl)}>
                  Entrar com minha conta
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {bannerError && (
        <div className={styles.alertBanner} role="alert">
          <div className={styles.alertRow}>
            <span className={cx(styles.alertIcon, styles[bannerError.toneClass])}>
              {bannerError.icon}
            </span>
            <div className={styles.alertCopy}>
              <strong className={styles.alertTitle}>{bannerError.title}</strong>
              <p className={styles.alertMessage}>{bannerError.text}</p>
            </div>
          </div>

          {bannerError.primaryAction === 'login' && (
            <div className={styles.alertActions}>
              <Button size="sm" onClick={() => router.push(authLoginUrl)}>
                Fazer login e continuar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => router.push(authSignupUrl)}>
                Criar conta
              </Button>
            </div>
          )}

          {bannerError.primaryAction === 'retry' && (
            <div className={styles.alertActions}>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  if (step === 'code') verifyCode(code);
                  else join();
                }}
              >
                {pending ? 'Tentando…' : 'Tentar novamente'}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
