import { NextResponse } from 'next/server';

import { createRealtimeTicket } from '@/lib/api/realtime';
import { ApiError, ApiNotConfiguredError } from '@/lib/api/client';

/**
 * Ponte entre o browser e `POST /realtime-ticket` da API.
 *
 * O browser não fala com a API diretamente (é o que o `x-service-token`
 * garante), então o ticket precisa de uma rota deste lado. O cookie de sessão
 * chega aqui sozinho — `apiRequest` o repassa como `Authorization` —, então o
 * corpo é vazio: quem pede o ticket é sempre quem já está autenticado.
 *
 * O front só chama isto quando o socket falha por falta de cookie; num
 * navegador que manda o cookie no upgrade, esta rota nunca é tocada.
 */
export async function POST() {
  try {
    const ticket = await createRealtimeTicket();
    // `no-store` explícito: um ticket cacheado seria um ticket reusado, e ele é
    // de uso único por definição.
    return NextResponse.json(ticket, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return NextResponse.json({ code: 'API_NOT_CONFIGURED' }, { status: 503 });
    }
    if (error instanceof ApiError) {
      return NextResponse.json({ code: error.code ?? 'UNAUTHENTICATED' }, { status: error.status });
    }
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
