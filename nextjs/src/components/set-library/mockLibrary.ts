import type {
  CommunityPhaseCatalog,
  CommunityPhaseSearchParams,
  CommunityPhaseSummary,
  DraftPhase,
  PhaseKind,
  PhaseSetDetail,
  PhaseSetDraft,
  PhaseSetLibrary,
  PhaseSetLibraryEntry,
  User,
} from '@/lib/types';

/**
 * Dados de exemplo da biblioteca — **temporários**.
 *
 * Existem para validar o layout de `/conjuntos` antes de `GET /phase-sets/owned` e `GET /phase-sets/community`
 * existir. A tela só cai aqui quando a API não está configurada, e quando cai
 * mostra uma tarja avisando que o conteúdo é fictício: o resto do projeto não
 * inventa dado (ver o cabeçalho de `src/lib/types.ts`), e esta é a exceção com
 * prazo de validade.
 *
 * Para remover: apague este arquivo, a pasta `public/mock/` e o `??` em
 * `src/app/conjuntos/page.tsx`, que volta a renderizar o `StateMessage`.
 *
 * O conjunto varia de propósito para exercitar os estados da tela: conjunto sem
 * capa, conjunto sem partidas (`accuracyRate: null`), títulos longos, um tipo de
 * fase só e mistura de tipos.
 */

export const MOCK_USER: User = {
  id: 'u_mock',
  name: 'Marina Duarte',
  email: 'marina.duarte@exemplo.com',
  avatarIndex: 3,
  plan: 'pro',
  audience: 'teacher',
};

export const MOCK_LIBRARY: PhaseSetLibrary = {
  coverUrl: '/mock/library-cover.svg',
  subjects: ['Matemática', 'Programação', 'Estatística'],
  folders: ['Matemática 2º ano', 'Programação', 'Provas'],
  sets: [
    {
      id: 's7',
      title: 'Revisão para o simulado',
      phaseCount: 14,
      source: 'owned',
      updatedLabel: 'editado ontem',
      authorName: null,
      phaseKindCounts: { quiz: 9, fill: 3, text: 2 },
      accuracyRate: 71,
      durationLabel: '1h 10',
      subject: 'Matemática',
      folder: 'Provas',
      useCount: 3,
      coverUrl: '/mock/cover-5.svg',
    },
    {
      id: 's1',
      title: 'Frações & Funções Básicas',
      phaseCount: 8,
      source: 'owned',
      updatedLabel: 'editado há 2 dias',
      authorName: null,
      phaseKindCounts: { quiz: 5, fill: 3 },
      accuracyRate: 78,
      durationLabel: '32 min',
      subject: 'Matemática',
      folder: 'Matemática 2º ano',
      useCount: 12,
      coverUrl: '/mock/cover-1.svg',
    },
    {
      id: 's4',
      title: 'Estruturas de Dados',
      phaseCount: 10,
      source: 'owned',
      updatedLabel: 'editado há 4 dias',
      authorName: null,
      phaseKindCounts: { code: 7, text: 3 },
      accuracyRate: 69,
      durationLabel: '55 min',
      subject: 'Programação',
      folder: 'Programação',
      useCount: 15,
      coverUrl: '/mock/cover-3.svg',
    },
    {
      id: 's2',
      title: 'Lógica de Programação I',
      phaseCount: 12,
      source: 'owned',
      updatedLabel: 'editado há 1 semana',
      authorName: null,
      phaseKindCounts: { code: 8, quiz: 4 },
      accuracyRate: 84,
      durationLabel: '48 min',
      subject: 'Programação',
      folder: 'Programação',
      useCount: 21,
      coverUrl: '/mock/cover-2.svg',
    },
    {
      // Sem capa e sem partidas: é o card que mostra o contorno tracejado e o
      // "sem partidas" no lugar da porcentagem.
      id: 's5',
      title: 'Álgebra Linear Aplicada a Sistemas Dinâmicos',
      phaseCount: 9,
      source: 'owned',
      updatedLabel: 'editado há 2 semanas',
      authorName: null,
      phaseKindCounts: { quiz: 6, fill: 3 },
      accuracyRate: null,
      durationLabel: '40 min',
      subject: 'Matemática',
      folder: 'Provas',
      useCount: 0,
      coverUrl: null,
    },
    {
      id: 's3',
      title: 'Geometria Básica',
      phaseCount: 6,
      source: 'owned',
      updatedLabel: 'editado há 3 semanas',
      authorName: null,
      phaseKindCounts: { quiz: 4, text: 2 },
      accuracyRate: 61,
      durationLabel: '25 min',
      subject: 'Matemática',
      folder: 'Matemática 2º ano',
      useCount: 7,
      coverUrl: '/mock/cover-4.svg',
    },
    {
      id: 's6',
      title: 'Probabilidade & Estatística',
      phaseCount: 7,
      source: 'owned',
      updatedLabel: 'editado há 1 mês',
      authorName: null,
      phaseKindCounts: { quiz: 5, text: 2 },
      accuracyRate: 66,
      durationLabel: '30 min',
      subject: 'Estatística',
      folder: 'Provas',
      useCount: 9,
      coverUrl: '/mock/cover-6.svg',
    },
    {
      id: 'p1',
      title: 'Big-O sem sofrimento',
      phaseCount: 10,
      source: 'community',
      updatedLabel: '1.840 usos',
      authorName: 'Comunidade Codex',
      phaseKindCounts: { code: 6, quiz: 4 },
      accuracyRate: 64,
      durationLabel: '45 min',
      subject: 'Programação',
      folder: null,
      useCount: 1840,
      coverUrl: '/mock/cover-5.svg',
    },
    {
      id: 'p2',
      title: 'Porcentagem no dia a dia',
      phaseCount: 8,
      source: 'community',
      updatedLabel: '3.210 usos',
      authorName: 'Ana Petrov',
      phaseKindCounts: { quiz: 6, fill: 2 },
      accuracyRate: 88,
      durationLabel: '28 min',
      subject: 'Matemática',
      folder: null,
      useCount: 3210,
      coverUrl: '/mock/cover-3.svg',
    },
    {
      id: 'p3',
      title: 'SQL para iniciantes',
      phaseCount: 12,
      source: 'community',
      updatedLabel: '2.405 usos',
      authorName: 'Comunidade Codex',
      phaseKindCounts: { code: 8, fill: 4 },
      accuracyRate: 70,
      durationLabel: '1h',
      subject: 'Programação',
      folder: null,
      useCount: 2405,
      coverUrl: '/mock/cover-6.svg',
    },
    {
      id: 'p4',
      title: 'Recursão na prática',
      phaseCount: 11,
      source: 'community',
      updatedLabel: '980 usos',
      authorName: 'Prof. Caio Ramos',
      phaseKindCounts: { code: 9, quiz: 2 },
      accuracyRate: 58,
      durationLabel: '50 min',
      subject: 'Programação',
      folder: null,
      useCount: 980,
      coverUrl: '/mock/cover-2.svg',
    },
    {
      id: 'p5',
      title: 'Equações do 2º grau',
      phaseCount: 9,
      source: 'community',
      updatedLabel: '1.120 usos',
      authorName: 'Prof. Helena Braz',
      phaseKindCounts: { quiz: 7, fill: 2 },
      accuracyRate: 80,
      durationLabel: '35 min',
      subject: 'Matemática',
      folder: null,
      useCount: 1120,
      coverUrl: '/mock/cover-1.svg',
    },
  ],
};

function buildMockPhase(entry: PhaseSetLibraryEntry, kind: PhaseKind, index: number): DraftPhase {
  const id = `${entry.id}_phase_${index + 1}`;
  const isCodeSubject = entry.subject === 'Programação';
  const order = index + 1;

  switch (kind) {
    case 'quiz':
      return {
        id,
        kind: 'quiz',
        name: `Questão ${order} · ${entry.subject}`,
        basePoints: 100,
        pointsMultiplier: 1,
        timeSeconds: 45,
        fromAI: false,
        question: isCodeSubject
          ? `(${entry.title}) Qual afirmação descreve corretamente o comportamento analisado no passo ${order}?`
          : `(${entry.title}) Qual alternativa resolve corretamente o exercício ${order} de ${entry.subject}?`,
        options: isCodeSubject
          ? [
              'Executa em tempo linear O(n) com memória constante',
              'Depende de recursão infinita sem caso base',
              'Altera a ordem original sem percorrer os itens',
              'Ignora entradas vazias e retorna undefined',
            ]
          : [
              'A relação proporcional mantém o mesmo quociente',
              'A soma dos termos altera a razão original',
              'O denominador deve ser sempre menor que o numerador',
              'Nenhuma das alternativas anteriores',
            ],
        correctIndexes: [0],
        introTip: index === 0 ? `Leia o enunciado de "${entry.title}" com atenção antes de responder.` : undefined,
      };
    case 'fill':
      return {
        id,
        kind: 'fill',
        name: `Completar ${order} · ${entry.subject}`,
        basePoints: 100,
        pointsMultiplier: 1,
        timeSeconds: 60,
        fromAI: false,
        question: isCodeSubject
          ? 'Para evitar estouro de pilha em uma função recursiva, definimos um ___ antes da chamada ___.'
          : 'Uma expressão equivalente preserva a ___ quando aplicamos o mesmo ___ em ambos os termos.',
        words: isCodeSubject
          ? ['caso base', 'recursiva', 'laço infinito', 'ponteiro nulo']
          : ['proporção', 'fator', 'subtração', 'expoente'],
        blanks: isCodeSubject ? ['caso base', 'recursiva'] : ['proporção', 'fator'],
      };
    case 'text':
      return {
        id,
        kind: 'text',
        name: `Dissertativa ${order} · ${entry.subject}`,
        basePoints: 120,
        pointsMultiplier: 1.25,
        timeSeconds: 120,
        fromAI: false,
        question: `Explique, com suas palavras, o raciocínio principal aplicado na etapa ${order} de "${entry.title}".`,
        expectedAnswer:
          'Espera-se que o participante identifique os dados iniciais, justifique a estratégia escolhida e apresente a conclusão de forma clara.',
      };
    case 'code':
      return {
        id,
        kind: 'code',
        name: `Código ${order} · ${entry.title}`,
        basePoints: 150,
        pointsMultiplier: 1.5,
        timeSeconds: 300,
        fromAI: false,
        question: `Implemente a função \`solucao\` para resolver o desafio ${order} de "${entry.title}".`,
        starterCode: 'function solucao(entrada) {\n  // Escreva sua solução aqui\n  return entrada;\n}\n',
        testCases: 'Entrada: [2, 4, 6]\nSaída: 12\n\nEntrada: [1, 3]\nSaída: 4',
      };
  }
}

function buildMockPhasesForEntry(entry: PhaseSetLibraryEntry): DraftPhase[] {
  const kinds: PhaseKind[] = ['quiz', 'code', 'text', 'fill'];
  const phases: DraftPhase[] = [];

  for (const kind of kinds) {
    const count = entry.phaseKindCounts[kind] ?? 0;
    for (let i = 0; i < count; i += 1) {
      phases.push(buildMockPhase(entry, kind, phases.length));
    }
  }

  return phases;
}

export function getMockPhaseSetDetail(setId: string): PhaseSetDetail | null {
  const entry = MOCK_LIBRARY.sets.find((item) => item.id === setId);
  if (!entry) return null;

  const isOwned = entry.source === 'owned';
  return {
    ...entry,
    visibility: isOwned ? 'private' : 'public',
    isOwner: isOwned,
    authorId: isOwned ? MOCK_USER.id : `author_${entry.id}`,
    authorName: isOwned ? MOCK_USER.name : entry.authorName,
    publishedSetId: isOwned ? null : entry.id,
    sourcePrivateSetId: isOwned ? entry.id : null,
    version: isOwned ? null : 1,
    phases: buildMockPhasesForEntry(entry),
  };
}

export function getMockPhaseSetDraft(setId: string): PhaseSetDraft | null {
  const entry = MOCK_LIBRARY.sets.find((item) => item.id === setId);
  if (!entry || entry.source !== 'owned') return null;

  return {
    id: entry.id,
    title: entry.title,
    subject: entry.subject,
    folder: entry.folder,
    coverUrl: entry.coverUrl,
    phases: buildMockPhasesForEntry(entry),
  };
}

interface MockCommunityPhaseRecord {
  summary: CommunityPhaseSummary;
  draft: DraftPhase;
}

function buildMockCommunityPhases(): MockCommunityPhaseRecord[] {
  const records: MockCommunityPhaseRecord[] = [];
  const communityEntries = MOCK_LIBRARY.sets.filter((item) => item.source === 'community');

  communityEntries.forEach((entry, entryIndex) => {
    const phases = buildMockPhasesForEntry(entry);
    phases.slice(0, 4).forEach((phase, phaseIndex) => {
      const id = `cp_${entry.id}_${phaseIndex + 1}`;
      const draft: DraftPhase = {
        ...phase,
        id,
        originCommunityPhaseId: id,
      };
      records.push({
        summary: {
          id,
          name: `${phase.name} (${entry.title})`,
          questionPreview: phase.question,
          kind: phase.kind,
          subject: entry.subject,
          difficulty: phaseIndex % 3 === 0 ? 'easy' : phaseIndex % 3 === 1 ? 'medium' : 'hard',
          authorId: `author_${entry.id}`,
          authorName: entry.authorName ?? 'Comunidade Codex',
          basePoints: phase.basePoints,
          pointsMultiplier: phase.pointsMultiplier,
          timeSeconds: phase.timeSeconds,
          useCount: Math.max(12, Math.round(entry.useCount / (phaseIndex + 2))),
          accuracyRate: entry.accuracyRate,
          publishedAt: new Date(Date.now() - (entryIndex * 4 + phaseIndex + 1) * 86_400_000).toISOString(),
        },
        draft,
      });
    });
  });

  return records;
}

export function searchMockCommunityPhases(
  params: CommunityPhaseSearchParams = {},
): CommunityPhaseCatalog {
  const all = buildMockCommunityPhases();
  const subjects = Array.from(new Set([...MOCK_LIBRARY.subjects, ...all.map((r) => r.summary.subject)])).sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  );

  const q = params.q?.trim().toLowerCase() ?? '';
  const subject = params.subject?.trim() ?? '';
  const kind = params.kind;
  const sort = params.sort ?? 'recent';
  const limit = params.limit ?? 30;
  const offset = params.cursor ?? 0;

  let filtered = all.map((r) => r.summary).filter((item) => {
    if (subject && item.subject !== subject) return false;
    if (kind && item.kind !== kind) return false;
    if (
      q &&
      !item.name.toLowerCase().includes(q) &&
      !item.questionPreview.toLowerCase().includes(q) &&
      !item.subject.toLowerCase().includes(q) &&
      !item.authorName.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });

  if (sort === 'popular') {
    filtered = [...filtered].sort((a, b) => b.useCount - a.useCount);
  } else {
    filtered = [...filtered].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit < filtered.length ? offset + limit : null;

  return {
    items: page,
    nextOffset,
    subjects,
  };
}

export function getMockCommunityPhaseDraft(phaseId: string): DraftPhase | null {
  const record = buildMockCommunityPhases().find((item) => item.summary.id === phaseId);
  return record?.draft ?? null;
}
