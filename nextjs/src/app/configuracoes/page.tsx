import { redirect } from 'next/navigation';

/**
 * Abre diretamente a primeira seção disponível de Configurações.
 */
export default function SettingsIndexPage() {
  redirect('/configuracoes/ia');
}
