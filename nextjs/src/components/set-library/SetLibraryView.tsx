'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button, Dialog, Tabs, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { ImageSlot } from '@/components/media/ImageSlot';
import { AppSidebar } from '@/components/nav/AppSidebar';
import { AUDIENCE_LABEL } from '@/components/nav/audienceLabels';
import { logoutAction } from '@/lib/actions/auth';
import {
  copyPhaseSetAction,
  deletePhaseSetAction,
  publishPhaseSetAction,
} from '@/lib/actions/phaseSets';
import { createRoomAction } from '@/lib/actions/profile';
import { cx } from '@/lib/cx';
import type { PhaseSetLibrary, User } from '@/lib/types';
import { FeaturedSetBanner } from './FeaturedSetBanner';
import { LibraryFilters } from './LibraryFilters';
import { SetCard } from './SetCard';
import {
  ALL_FOLDERS,
  INITIAL_FILTERS,
  filterSets,
  type LibraryFilterState,
  type LibraryScope,
} from './filters';
import styles from './SetLibraryView.module.css';

const TABS: { id: LibraryScope; label: string }[] = [
  { id: 'owned', label: 'Meus conjuntos' },
  { id: 'community', label: 'Comunidade' },
];

interface SetLibraryViewProps {
  user: User;
  library: PhaseSetLibrary;
}

export function SetLibraryView({ user, library }: SetLibraryViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // A lista vive no estado para que excluir um conjunto tire o card na hora; o
  // servidor confirma depois e revalida a rota. Quando chega uma biblioteca nova
  // do servidor (`router.refresh()`, nova navegação), ela substitui o estado —
  // senão o `useState` congelaria a primeira resposta.
  const [sets, setSets] = useState(library.sets);
  const [syncedSets, setSyncedSets] = useState(library.sets);
  if (library.sets !== syncedSets) {
    setSyncedSets(library.sets);
    setSets(library.sets);
  }
  const [filters, setFilters] = useState<LibraryFilterState>(INITIAL_FILTERS);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const visible = useMemo(() => filterSets(sets, filters), [sets, filters]);
  const owned = filters.scope === 'owned';
  const featured = sets.find((set) => set.source === 'owned') ?? null;
  
  function patchFilters(patch: Partial<LibraryFilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  // Trocar de aba zera o recorte: pasta e seleção são conceitos dos conjuntos
  // próprios e não significam nada na comunidade.
  function changeScope(scope: LibraryScope) {
    setFilters((current) => ({ ...current, scope, folder: ALL_FOLDERS }));
    setSelectMode(false);
    setSelected([]);
  }

  function startRoom(setId: string) {
    startTransition(async () => {
      router.push(`/sala/${await createRoomAction(setId)}/lobby`);
    });
  }

  function publishSet(setId: string) {
    startTransition(async () => {
      try {
        await publishPhaseSetAction(setId);
        // A comunidade guarda só a versão mais recente de cada conjunto; quem
        // decide o que sai e o que entra é o servidor, não uma inserção local.
        router.refresh();
        setToast('Conjunto publicado na comunidade.');
      } catch (err) {
        setToast(err instanceof Error ? err.message : 'Não foi possível publicar o conjunto.');
      }
    });
  }

  function copySet(setId: string) {
    startTransition(async () => {
      try {
        const copied = await copyPhaseSetAction(setId);
        router.push(`/conjunto/${copied.id}`);
      } catch (err) {
        setToast(err instanceof Error ? err.message : 'Não foi possível copiar o conjunto.');
      }
    });
  }

  function confirmDelete() {
    const ids = pendingDelete ?? [];
    setPendingDelete(null);
    setSets((current) => current.filter((set) => !ids.includes(set.id)));
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    const done = ids.length === 1 ? 'Conjunto excluído.' : `${ids.length} conjuntos excluídos.`;
    startTransition(async () => {
      await Promise.all(ids.map((id) => deletePhaseSetAction(id)));
      setToast(done);
    });
  }

  return (
    <div className={styles.layout}>
      <AppSidebar
        user={user}
        audienceLabel={AUDIENCE_LABEL[user.audience]}
        active="conjuntos"
        onSignOut={() => startTransition(() => void logoutAction())}
      />

      <main className={styles.content}>
        <div className={styles.hero}>
          {/* Sem capa o topo é só a cor da página — um contorno tracejado atrás
              do título seria ruído, não um espaço reservado útil. */}
          {library.coverUrl && (
            <>
              <ImageSlot
                className={styles.heroCover}
                placeholder="Capa da biblioteca"
                src={library.coverUrl}
                shape="rect"
                width={1240}
                height={320}
              />
              <div className={styles.heroVeil} />
            </>
          )}

          {/* <header className={styles.header}>
            <div>
              <h1 className={styles.title}>Conjuntos de desafios</h1>
            </div>
            <Button onClick={() => router.push('/conjunto/novo')}>Criar conjunto</Button>
          </header> */}

          {featured && (
            <FeaturedSetBanner set={featured} onStartRoom={() => startRoom(featured.id)} />
          )}

          <div className={styles.tabs}>
            <Tabs
              label="Origem dos conjuntos"
              tabs={TABS}
              active={filters.scope}
              onChange={changeScope}
            />
          </div>
        </div>

        <LibraryFilters
          filters={filters}
          onChange={patchFilters}
          subjects={library.subjects}
        />

        {owned && library.folders.length > 0 && (
          <div className={styles.folders}>
            <span className={styles.foldersLabel}>Pastas</span>
            {[ALL_FOLDERS, ...library.folders].map((folder) => (
              <button
                key={folder}
                type="button"
                className={cx(styles.folder, folder === filters.folder && styles.folderOn)}
                aria-pressed={folder === filters.folder}
                onClick={() => patchFilters({ folder })}
              >
                {folder}
              </button>
            ))}
          </div>
        )}

        <div className={styles.grid}>
          {visible.map((set) => (
            <SetCard
              key={set.id}
              set={set}
              onStartRoom={() => startRoom(set.id)}
              onPublish={set.source === 'owned' ? () => publishSet(set.id) : undefined}
              onCopy={set.source === 'community' ? () => copySet(set.id) : undefined}
              onDelete={() => setPendingDelete([set.id])}
            />
          ))}

          {owned && (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => router.push('/conjunto/novo')}
            >
              <Icon.Plus size={30} />
              Novo conjunto
            </button>
          )}
        </div>

        {visible.length === 0 && (
          <p className={styles.empty}>Nenhum conjunto encontrado com esses filtros.</p>
        )}
      </main>

      
      {pendingDelete && (
        <Dialog
          open
          title={pendingDelete.length === 1 ? 'Excluir conjunto' : 'Excluir conjuntos'}
          onClose={() => setPendingDelete(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setPendingDelete(null)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmDelete}>
                Excluir
              </Button>
            </>
          }
        >
          <p className={styles.dialogText}>
            {pendingDelete.length === 1
              ? 'O conjunto sai da sua biblioteca e não pode ser recuperado.'
              : `Os ${pendingDelete.length} conjuntos saem da sua biblioteca e não podem ser recuperados.`}{' '}
            As partidas já jogadas não mudam — a fila guarda uma cópia das fases.
          </p>
        </Dialog>
      )}

      {toast && (
        <ToastViewport>
          <Toast tone="success" title="Pronto" message={toast} onClose={() => setToast(null)} />
        </ToastViewport>
      )}
    </div>
  );
}
