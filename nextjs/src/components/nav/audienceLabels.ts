import type { Audience } from '@/lib/types';

/**
 * Como a pessoa é chamada na barra lateral e no cabeçalho do perfil.
 *
 * Mora fora das duas telas porque as duas mostram a barra: a mesma conta não
 * pode ser "Professor(a)" numa e outra coisa na outra.
 */
export const AUDIENCE_LABEL: Record<Audience, string> = {
  teacher: 'Professor(a)',
  recruiter: 'Líder de recrutamento',
};
