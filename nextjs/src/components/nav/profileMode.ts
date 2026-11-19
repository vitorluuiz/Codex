/** As duas faces do perfil — cada uma com seu próprio menu. */
export type ProfileMode = 'leader' | 'participant';

export const PROFILE_MODE_COOKIE = 'codex_profile_mode';
const PROFILE_MODE_STORAGE_KEY = 'codex:profile-mode';
const PROFILE_MODE_CHANGE_EVENT = 'codex:profile-mode-change';

/** Interpreta query string, cookie ou storage para o modo de perfil. */
export function parseProfileMode(value?: string | null): ProfileMode | null {
  if (value === 'participant' || value === 'participante') return 'participant';
  if (value === 'leader' || value === 'lider') return 'leader';
  return null;
}

/** Rota da tela de perfil correspondente ao modo escolhido. */
export function getProfileHref(mode: ProfileMode): string {
  return mode === 'participant' ? '/perfil?modo=participante' : '/perfil?modo=lider';
}

export function readStoredProfileMode(): ProfileMode {
  if (typeof window === 'undefined') return 'leader';
  try {
    const raw = window.localStorage.getItem(PROFILE_MODE_STORAGE_KEY);
    return parseProfileMode(raw) ?? 'leader';
  } catch {
    return 'leader';
  }
}

export function writeStoredProfileMode(mode: ProfileMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROFILE_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage indisponível (ex.: modo privado restritivo)
  }
  try {
    document.cookie = `${PROFILE_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookie indisponível
  }
  window.dispatchEvent(new Event(PROFILE_MODE_CHANGE_EVENT));
}

export function clearStoredProfileMode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PROFILE_MODE_STORAGE_KEY);
  } catch {
    // localStorage indisponível
  }
  try {
    document.cookie = `${PROFILE_MODE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // cookie indisponível
  }
  window.dispatchEvent(new Event(PROFILE_MODE_CHANGE_EVENT));
}

export function subscribeProfileMode(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PROFILE_MODE_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener(PROFILE_MODE_CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(PROFILE_MODE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', handleStorage);
  };
}
