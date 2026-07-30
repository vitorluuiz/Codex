import Link from 'next/link';

import { StateMessage } from '@/components/feedback/StateMessage';

export default function NotFound() {
  return (
    <StateMessage variant="centered" title="Página não encontrada">
      O endereço que você abriu não existe ou a sala foi encerrada.{' '}
      <Link href="/">Voltar para a página inicial</Link>.
    </StateMessage>
  );
}
