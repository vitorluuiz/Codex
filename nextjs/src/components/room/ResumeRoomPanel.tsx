import Link from 'next/link';

import { roomPath } from '@/lib/roomPath';
import type { ActiveRoom } from '@/lib/types';
import { ROOM_STATUS_LABEL, describeActiveRoom } from './activeRoomLabels';
import styles from './ResumeRoomPanel.module.css';

interface ResumeRoomPanelProps {
  rooms: ActiveRoom[];
}

/**
 * O bloco de "Voltar para a sala" no topo da tela de entrar.
 *
 * Fechar a aba não tira ninguém da sala — nem o líder nem o participante —, mas
 * o único caminho de volta era digitar o código de novo, que o líder nunca
 * decorou (a sala nasce com um código gerado) e o convidado já esqueceu. Este
 * painel é esse caminho.
 *
 * Fica **acima** do formulário em vez de substituí-lo: `/sala` continua sendo a
 * tela de entrar, e quem tem uma sala aberta pode legitimamente querer entrar em
 * outra. É um Server Component — só links, nenhum estado.
 */
export function ResumeRoomPanel({ rooms }: ResumeRoomPanelProps) {
  if (rooms.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Salas em que você já está">
      <h2 className={styles.title}>
        {rooms.length === 1 ? 'Você já está numa sala' : 'Você já está em algumas salas'}
      </h2>

      <ul className={styles.list}>
        {rooms.map((room) => (
          <li key={room.code}>
            <Link href={roomPath(room)} className={styles.card}>
              <div className={styles.head}>
                <span className={styles.code}>Sala {room.code}</span>
                <span className={styles.status}>{ROOM_STATUS_LABEL[room.status]}</span>
              </div>
              <span className={styles.description}>{describeActiveRoom(room)}</span>
              <span className={styles.action}>Voltar para a sala →</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className={styles.divider}>
        <span className={styles.dividerLine} />
        <span className={styles.dividerLabel}>ou entre em outra</span>
        <span className={styles.dividerLine} />
      </div>
    </section>
  );
}
