import type { ReactNode } from 'react';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';

interface RoomLayoutProps {
  params: Promise<{ code: string }>;
  children: ReactNode;
}

/**
 * Layout persistente da sala.
 *
 * Mantém o WebSocket de tempo real aberto de forma ininterrupta durante
 * toda a permanência na sala, evitando desconexão e reconexão entre
 * as telas de Lobby, Partida e Pódio.
 */
export default async function RoomLayout({ params, children }: RoomLayoutProps) {
  const { code } = await params;
  return <RealtimeProvider roomCode={code}>{children}</RealtimeProvider>;
}
