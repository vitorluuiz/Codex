'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';

import { Button, Dialog, Tag, Toast, ToastViewport, type ToastTone } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { ImageSlot } from '@/components/media/ImageSlot';
import { AppSidebar } from '@/components/nav/AppSidebar';
import { AUDIENCE_LABEL } from '@/components/nav/audienceLabels';
import {
  KIND_META,
  KIND_ORDER,
  KIND_SHORT_LABEL,
  splitQuestion,
} from '@/components/set-editor/phaseKinds';
import { logoutAction } from '@/lib/actions/auth';
import {
  copyPhaseSetAction,
  deletePhaseSetAction,
  publishPhaseSetAction,
} from '@/lib/actions/phaseSets';
import { createRoomAction } from '@/lib/actions/profile';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import { setColor } from '@/lib/setColor';
import type { DraftPhase, PhaseKind, PhaseSetDetail, User } from '@/lib/types';
import styles from './PhaseSetView.module.css';

type PrototypeViewMode = 'owner-private' | 'owner-public' | 'visitor-public';

const PROTOTYPE_MODES: { id: PrototypeViewMode; label: string }[] = [
  { id: 'owner-private', label: 'Proprietário · Privado' },
  { id: 'owner-public', label: 'Proprietário · Público' },
  { id: 'visitor-public', label: 'Visitante da Comunidade · Público' },
];

interface ToastState {
  tone: ToastTone;
  title: string;
  message: string;
}

interface PhaseSetViewProps {
  set: PhaseSetDetail;
  user: User | null;
  sampleData?: boolean;
}

function initialViewMode(set: PhaseSetDetail): PrototypeViewMode {
  if (set.isOwner && set.visibility === 'private') return 'owner-private';
  if (set.isOwner && set.visibility === 'public') return 'owner-public';
  return 'visitor-public';
}

function resolveKindCounts(set: PhaseSetDetail): Partial<Record<PhaseKind, number>> {
  const hasCounts = Object.values(set.phaseKindCounts).some((count) => (count ?? 0) > 0);
  if (hasCounts) return set.phaseKindCounts;

  const computed: Partial<Record<PhaseKind, number>> = {};
  for (const phase of set.phases) {
    computed[phase.kind] = (computed[phase.kind] ?? 0) + 1;
  }
  return computed;
}

export function PhaseSetView({ set, user, sampleData = false }: PhaseSetViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [viewMode, setViewMode] = useState<PrototypeViewMode>(() => initialViewMode(set));
  const [showAnswers, setShowAnswers] = useState<boolean>(() => set.isOwner);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [publishedMeta, setPublishedMeta] = useState<{ setId: string; version: number } | null>(
    set.publishedSetId
      ? { setId: set.publishedSetId, version: set.version ?? 1 }
      : null,
  );

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const effectiveIsOwner = viewMode !== 'visitor-public';
  const effectiveVisibility = viewMode === 'owner-private' ? 'private' : 'public';
  const editableSetId = set.sourcePrivateSetId ?? (set.isOwner ? set.id : null);
  const shareSetId = publishedMeta?.setId ?? set.id;
  const shareUrl = origin ? `${origin}/conjunto/${shareSetId}` : `/conjunto/${shareSetId}`;
  const kindCounts = useMemo(() => resolveKindCounts(set), [set]);
  const phaseTotal = set.phases.length > 0 ? set.phases.length : set.phaseCount;

  const byline = [
    set.authorName ? `Por ${set.authorName}` : null,
    set.updatedLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  function selectPrototypeMode(mode: PrototypeViewMode) {
    setViewMode(mode);
    setShowAnswers(mode !== 'visitor-public');
  }

  function handleStartSet() {
    if (sampleData) {
      setToast({
        tone: 'info',
        title: 'Protótipo (dados de exemplo)',
        message: `Iniciaria uma nova sala com "${set.title}" e abriria o lobby.`,
      });
      return;
    }

    if (!user) {
      router.push('/entrar');
      return;
    }

    startTransition(async () => {
      try {
        const code = await createRoomAction(set.id);
        router.push(`/sala/${code}/lobby`);
      } catch (err) {
        setToast({
          tone: 'danger',
          title: 'Não foi possível iniciar',
          message:
            err instanceof Error
              ? err.message
              : 'Erro ao criar a sala com este conjunto.',
        });
      }
    });
  }

  function handleEdit() {
    if (!editableSetId) {
      setToast({
        tone: 'info',
        title: 'Edição indisponível',
        message: 'Importe o conjunto para os seus conjuntos antes de editá-lo.',
      });
      return;
    }

    router.push(`/conjunto/${editableSetId}/editar`);
  }

  function handleImport() {
    if (sampleData) {
      setToast({
        tone: 'success',
        title: 'Protótipo (dados de exemplo)',
        message: `"${set.title}" foi importado para Meus conjuntos (cópia privada editável).`,
      });
      return;
    }

    if (!user) {
      router.push('/entrar');
      return;
    }

    startTransition(async () => {
      try {
        const copied = await copyPhaseSetAction(set.id);
        setToast({
          tone: 'success',
          title: 'Conjunto importado',
          message: 'Cópia privada criada em Meus conjuntos.',
        });
        if (copied.id) {
          router.push(`/conjunto/${copied.id}`);
        }
      } catch (err) {
        setToast({
          tone: 'danger',
          title: 'Erro ao importar',
          message:
            err instanceof Error ? err.message : 'Não foi possível importar este conjunto.',
        });
      }
    });
  }

  function handlePublish() {
    if (sampleData) {
      const nextVersion = (publishedMeta?.version ?? set.version ?? 0) + 1;
      setPublishedMeta({ setId: set.id, version: nextVersion });
      setViewMode('owner-public');
      setToast({
        tone: 'success',
        title: 'Protótipo (dados de exemplo)',
        message: `Conjunto publicado na comunidade (v${nextVersion}).`,
      });
      return;
    }

    if (!editableSetId) {
      setToast({
        tone: 'danger',
        title: 'Publicação indisponível',
        message: 'Somente o conjunto privado original pode ser publicado.',
      });
      return;
    }

    startTransition(async () => {
      try {
        const published = await publishPhaseSetAction(editableSetId);
        const nextVersion = (publishedMeta?.version ?? set.version ?? 0) + 1;
        setPublishedMeta({ setId: published.id, version: nextVersion });
        setViewMode('owner-public');
        // Descarta o cache do roteador para que /conjuntos busque a biblioteca
        // de novo (inclusive pelo botão voltar) já com a nova publicação.
        router.refresh();
        setToast({
          tone: 'success',
          title: 'Conjunto publicado',
          message: 'Versão pública disponível na comunidade.',
        });
      } catch (err) {
        setToast({
          tone: 'danger',
          title: 'Não foi possível publicar',
          message:
            err instanceof Error ? err.message : 'Verifique se todas as fases estão completas.',
        });
      }
    });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast({
        tone: 'success',
        title: 'Link copiado',
        message: 'O endereço deste conjunto foi copiado para a área de transferência.',
      });
    } catch {
      setToast({
        tone: 'info',
        title: 'Compartilhar',
        message: shareUrl,
      });
    }
  }

  function handleDelete() {
    if (sampleData) {
      setDeleteOpen(false);
      setToast({
        tone: 'success',
        title: 'Protótipo (dados de exemplo)',
        message: 'O conjunto seria excluído da sua biblioteca privada.',
      });
      router.push('/conjuntos');
      return;
    }

    if (!editableSetId) return;

    startTransition(async () => {
      try {
        await deletePhaseSetAction(editableSetId);
        setDeleteOpen(false);
        router.push('/conjuntos');
      } catch (err) {
        setDeleteOpen(false);
        setToast({
          tone: 'danger',
          title: 'Erro ao excluir',
          message:
            err instanceof Error ? err.message : 'Não foi possível excluir o conjunto.',
        });
      }
    });
  }

  return (
    <div className={styles.layout}>
      {sampleData && (
        <p className={styles.sampleNotice}>
          Protótipo com dados de exemplo — a API <code>GET /phase-sets/{set.id}</code> não
          respondeu. Use o seletor abaixo para alternar entre proprietário e visitante.
        </p>
      )}

      <AppSidebar
        user={user}
        audienceLabel={user ? AUDIENCE_LABEL[user.audience] : undefined}
        active="conjuntos"
        onSignOut={() => startTransition(() => void logoutAction())}
      />

      <main className={styles.main}>
        <div className={styles.container}>
          {/* Bloco 1: Navegação e seletor de estado do protótipo */}
          <div className={styles.topBar}>
            <div className={styles.topRow}>
              <Link href="/conjuntos" className={styles.backLink}>
                <Icon.ArrowLeft size={16} />
                Voltar para conjuntos
              </Link>
            </div>

            <div
              className={styles.protoBar}
              role="group"
              aria-label="Modo de visualização do protótipo"
            >
              <span className={styles.protoLabel}>Simular visão</span>
              <div className={styles.protoModes}>
                {PROTOTYPE_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={cx(
                      styles.protoButton,
                      viewMode === mode.id && styles.protoButtonActive,
                    )}
                    aria-pressed={viewMode === mode.id}
                    onClick={() => selectPrototypeMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bloco 2: Cabeçalho vertical e barra de ações */}
          <section className={styles.heroCard} aria-labelledby="set-view-title">
            <div className={styles.coverSlot}>
              {set.coverUrl ? (
                <ImageSlot
                  className={styles.coverImage}
                  placeholder={`Capa de ${set.title}`}
                  src={set.coverUrl}
                  shape="rect"
                  onDark
                  width={800}
                  height={150}
                />
              ) : (
                <div
                  className={styles.coverSolid}
                  style={cssVars({ '--set-color': setColor(set.id) })}
                />
              )}
            </div>

            <div className={styles.heroBody}>
              <div className={styles.badges}>
                {effectiveVisibility === 'private' ? (
                  <Tag tone="neutral" icon={<Icon.Lock size={12} />}>
                    Privado
                  </Tag>
                ) : (
                  <Tag tone="blue" icon={<Icon.Globe size={12} />}>
                    Público · Comunidade
                  </Tag>
                )}

                {effectiveIsOwner ? (
                  <Tag tone="green">Conjunto proprietário</Tag>
                ) : (
                  <Tag tone="amber">Visitante da comunidade</Tag>
                )}

                <Tag tone="neutral">{set.subject}</Tag>

                {effectiveIsOwner && set.folder && <Tag tone="neutral">{set.folder}</Tag>}

                {effectiveVisibility === 'public' && (publishedMeta?.version ?? set.version) != null && (
                  <Tag tone="neutral">v{publishedMeta?.version ?? set.version}</Tag>
                )}
              </div>

              <div className={styles.titleBlock}>
                <h1 className={styles.title} id="set-view-title">
                  {set.title}
                </h1>
                {byline && <p className={styles.byline}>{byline}</p>}
              </div>

              <div className={styles.actionsBar}>
                <Button
                  icon={<Icon.Power size={16} />}
                  onClick={handleStartSet}
                  disabled={isPending}
                >
                  Iniciar conjunto
                </Button>

                <div className={styles.secondaryActions}>
                  {effectiveIsOwner ? (
                    <>
                      {effectiveVisibility === "private" ? <><Button
                        variant="secondary"
                        icon={<Icon.Pencil size={16} />}
                        onClick={handleEdit}
                        disabled={isPending}
                      >
                        Editar conjunto
                      </Button><Button
                        variant="secondary"
                        icon={<Icon.Globe size={16} />}
                        onClick={() => setShareOpen(true)}
                        disabled={isPending}
                      >
                          Compartilhar
                        </Button> <Button
                          variant="danger"
                          icon={<Icon.Close size={16} />}
                          onClick={() => setDeleteOpen(true)}
                          disabled={isPending}
                        >
                          Excluir
                        </Button></> : <Button variant='secondary' onClick={() => router.replace(`/conjunto/${set.sourcePrivateSetId}`)}>Ir para o conjunto original</Button>
                      }
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        icon={<Icon.Download size={16} />}
                        onClick={handleImport}
                        disabled={isPending}
                      >
                        Importar conjunto
                      </Button>
                      <Button
                        variant="ghost"
                        icon={<Icon.Globe size={16} />}
                        onClick={() => void handleCopyLink()}
                        disabled={isPending}
                      >
                        Compartilhar link
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Bloco 3: Resumo vertical de métricas e composição */}
          <section className={styles.summaryCard} aria-label="Resumo do conjunto">
            <h2 className={styles.sectionHeading}>Resumo do conjunto</h2>

            <dl className={styles.metricsList}>
              <div className={styles.metricItem}>
                <dt className={styles.metricLabel}>Fases</dt>
                <dd className={styles.metricValue}>{phaseTotal}</dd>
              </div>
              <div className={styles.metricItem}>
                <dt className={styles.metricLabel}>Duração</dt>
                <dd className={styles.metricValue}>{set.durationLabel}</dd>
              </div>
              <div className={styles.metricItem}>
                <dt className={styles.metricLabel}>Acerto médio</dt>
                <dd className={styles.metricValue}>
                  {set.accuracyRate === null ? 'Sem partidas' : `${set.accuracyRate}%`}
                </dd>
              </div>
              <div className={styles.metricItem}>
                <dt className={styles.metricLabel}>Usos</dt>
                <dd className={styles.metricValue}>{set.useCount}</dd>
              </div>
            </dl>

            <div className={styles.kindsRow}>
              {KIND_ORDER.filter((kind) => (kindCounts[kind] ?? 0) > 0).map((kind) => (
                <span
                  key={kind}
                  className={styles.kindChip}
                  style={cssVars({ '--kind-color': KIND_META[kind].color })}
                >
                  <span className={styles.kindDot} />
                  {kindCounts[kind]} {KIND_SHORT_LABEL[kind]}
                </span>
              ))}
            </div>
          </section>

          {/* Bloco 4: Lista vertical de desafios */}
          <section className={styles.phasesSection} aria-label="Desafios do conjunto">
            <div className={styles.phasesHeader}>
              <div>
                <h2 className={styles.sectionHeading}>Fases do conjunto ({phaseTotal})</h2>
                <p className={styles.sectionHint}>
                  Exibição vertical dos desafios na ordem de execução da partida.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Icon.Eye size={15} />}
                onClick={() => setShowAnswers((prev) => !prev)}
              >
                {showAnswers ? 'Ocultar gabaritos' : 'Mostrar gabaritos'}
              </Button>
            </div>

            {set.phases.length === 0 ? (
              <div className={styles.emptyCard}>
                <p className={styles.emptyText}>
                  Este conjunto ainda não possui fases cadastradas.
                </p>
                {effectiveIsOwner && (
                  <Button size="sm" variant="secondary" onClick={handleEdit}>
                    Editar conjunto
                  </Button>
                )}
              </div>
            ) : (
              <ol className={styles.phaseList}>
                {set.phases.map((phase, index) => (
                  <PhaseRow
                    key={phase.id}
                    phase={phase}
                    position={index + 1}
                    showAnswers={showAnswers}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>

      {/* Modal de compartilhamento (proprietário) */}
      <Dialog
        open={shareOpen}
        title="Compartilhar conjunto"
        onClose={() => setShareOpen(false)}
        actions={
          <Button variant="secondary" onClick={() => setShareOpen(false)}>
            Fechar
          </Button>
        }
      >
        <div className={styles.dialogStack}>
          <div className={styles.dialogSection}>
            <span className={styles.subLabel}>Publicação na comunidade</span>
            <p className={styles.dialogText}>
              {publishedMeta || effectiveVisibility === 'public'
                ? 'Este conjunto já possui uma versão pública na comunidade. Você pode publicar uma nova versão após editar.'
                : 'Conjuntos privados ficam visíveis apenas para você. Publique na comunidade para que outros professores ou recrutadores visualizem e importem este conjunto.'}
            </p>
            <div>
              <Button
                size="sm"
                icon={<Icon.Globe size={15} />}
                onClick={handlePublish}
                disabled={isPending || !editableSetId}
              >
                {publishedMeta || effectiveVisibility === 'public'
                  ? 'Publicar nova versão'
                  : 'Publicar na comunidade'}
              </Button>
            </div>
            {publishedMeta && (
              <p className={styles.dialogText}>
                Versão publicada (v{publishedMeta.version}):{' '}
                <Link href={`/conjunto/${publishedMeta.setId}`}>
                  /conjunto/{publishedMeta.setId}
                </Link>
              </p>
            )}
          </div>

          <div className={styles.dialogSection}>
            <span className={styles.subLabel}>Link direto do conjunto</span>
            <div className={styles.shareLinkRow}>
              <input
                type="text"
                readOnly
                value={shareUrl}
                className={styles.shareInput}
                aria-label="Link direto do conjunto"
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<Icon.Copy size={14} />}
                onClick={() => void handleCopyLink()}
              >
                Copiar
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Modal de confirmação de exclusão */}
      <Dialog
        open={deleteOpen}
        title="Excluir conjunto"
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={isPending}>
              Excluir
            </Button>
          </>
        }
      >
        <p className={styles.dialogText}>
          O conjunto sai da sua biblioteca privada e não pode ser recuperado. Versões já
          publicadas na comunidade e partidas anteriores não são afetadas.
        </p>
      </Dialog>

      {toast && (
        <ToastViewport>
          <Toast
            tone={toast.tone}
            title={toast.title}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </ToastViewport>
      )}
    </div>
  );
}

interface PhaseRowProps {
  phase: DraftPhase;
  position: number;
  showAnswers: boolean;
}

function PhaseRow({ phase, position, showAnswers }: PhaseRowProps) {
  const kindMeta = KIND_META[phase.kind];

  return (
    <li className={styles.phaseCard}>
      <div className={styles.phaseTop}>
        <div className={styles.phaseIdentity}>
          <span className={styles.phaseNumber}>#{position}</span>
          <span
            className={styles.phaseKindTag}
            style={cssVars({ '--kind-color': kindMeta.color })}
          >
            {kindMeta.icon}
            {kindMeta.label}
          </span>
          <h3 className={styles.phaseTitle}>{phase.name}</h3>
          {phase.fromAI && (
            <Tag tone="blue" icon={<Icon.Sparkle size={12} />}>
              IA
            </Tag>
          )}
        </div>

        <div className={styles.phaseMeta}>
          <span className={styles.metaPill}>{phase.basePoints} pts</span>
          <span className={styles.metaPill}>{phase.timeSeconds}s</span>
          {phase.pointsMultiplier !== 1 && (
            <span className={styles.metaPill}>{phase.pointsMultiplier}x</span>
          )}
        </div>
      </div>

      {phase.kind === 'fill' ? (
        <p className={styles.question}>
          {splitQuestion(phase.question).map((part, idx) =>
            part.blankIndex !== null ? (
              <span
                key={idx}
                className={cx(
                  styles.blankChip,
                  showAnswers && phase.blanks[part.blankIndex] && styles.blankChipRevealed,
                )}
              >
                {showAnswers ? (phase.blanks[part.blankIndex] ?? '___') : '___'}
              </span>
            ) : (
              <Fragment key={idx}>{part.text}</Fragment>
            ),
          )}
        </p>
      ) : (
        <p className={styles.question}>{phase.question || 'Sem enunciado definido.'}</p>
      )}

      {phase.kind === 'quiz' && (
        <div className={styles.optionsList}>
          {phase.options.map((option, idx) => {
            const isCorrect = showAnswers && phase.correctIndexes.includes(idx);
            const letter = String.fromCharCode(65 + idx);
            return (
              <div
                key={idx}
                className={cx(styles.optionRow, isCorrect && styles.optionRowCorrect)}
              >
                <span className={cx(styles.optionBadge, isCorrect && styles.optionBadgeCorrect)}>
                  {isCorrect ? <Icon.Check size={12} /> : letter}
                </span>
                <span className={styles.optionText}>{option || `Alternativa ${letter}`}</span>
                {isCorrect && <Tag tone="green">Correta</Tag>}
              </div>
            );
          })}
        </div>
      )}

      {phase.kind === 'fill' && (
        <div className={styles.subSection}>
          <span className={styles.subLabel}>Banco de palavras</span>
          <div className={styles.wordBank}>
            {phase.words.map((word, idx) => {
              const isCorrect = showAnswers && phase.blanks.includes(word);
              return (
                <span
                  key={idx}
                  className={cx(styles.wordChip, isCorrect && styles.wordChipCorrect)}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {phase.kind === 'text' && (
        <div className={styles.subSection}>
          <span className={styles.subLabel}>Resposta esperada</span>
          {showAnswers ? (
            <div className={styles.answerBox}>
              {phase.expectedAnswer || 'Nenhuma resposta esperada cadastrada.'}
            </div>
          ) : (
            <p className={styles.hiddenHint}>Resposta dissertativa (gabarito oculto).</p>
          )}
        </div>
      )}

      {phase.kind === 'code' && (
        <div className={styles.dialogStack}>
          <div className={styles.subSection}>
            <span className={styles.subLabel}>Código inicial</span>
            <pre className={styles.codeBlock}>
              <code>{phase.starterCode}</code>
            </pre>
          </div>
          {showAnswers && phase.testCases && (
            <div className={styles.subSection}>
              <span className={styles.subLabel}>Casos de teste</span>
              <pre className={styles.codeBlock}>
                <code>{phase.testCases}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {phase.introTip && (
        <div className={styles.tipRow}>
          <Icon.Info size={14} />
          <span>Dica de pré-desafio: {phase.introTip}</span>
        </div>
      )}
    </li>
  );
}
