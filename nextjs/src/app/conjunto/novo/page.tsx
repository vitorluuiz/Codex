import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SetEditor } from '@/components/set-editor/SetEditor';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Novo conjunto' };

/**
 * Conjunto novo não precisa de ida ao servidor: o rascunho nasce vazio no
 * cliente e só existe no banco quando a pessoa clica em salvar.
 */
export default async function NewPhaseSetPage() {
  const session = await getSession();
  if (!session.user) redirect('/entrar');

  return <SetEditor initialDraft={{ id: null, title: '', phases: [] }} />;
}
