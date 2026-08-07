import styles from './LeftRoomNotice.module.css';

/**
 * Por que a pessoa foi parar na tela de entrar sem ter pedido.
 *
 * Existe porque a saída de quem é expulso é um redirecionamento, não um diálogo:
 * o socket já foi fechado pelo servidor (§10 do contrato de WS) e a tela de trás
 * ficaria congelada. Sem esta faixa, o efeito para quem está olhando seria um
 * teletransporte sem explicação.
 *
 * O texto serve aos dois caminhos que chegam com `?saida=removido` — o líder
 * removeu, ou a sala deixou de existir para aquela sessão — porque para quem lê
 * são a mesma coisa: você não está mais lá, e voltar exige o código de novo.
 */
export function LeftRoomNotice({ reason }: { reason: string | undefined }) {
  if (reason !== 'removido') return null;

  return (
    <div className={styles.notice} role="status">
      <span className={styles.title}>Você não está mais na sala</span>
      <span className={styles.body}>
        O líder removeu você. Peça o código de novo para voltar a entrar.
      </span>
    </div>
  );
}
