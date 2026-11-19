import { NextResponse } from 'next/server';

import { ApiNotConfiguredError } from '@/lib/api/client';
import { getActiveRooms } from '@/lib/api/rooms';

/**
 * Ponte leve entre o browser e `GET /rooms/active` para que a `AppSidebar`
 * mantenha o submenu da última sala sempre sincronizado com as salas realmente
 * abertas da sessão (inclusive em telas que não buscam salas no SSR).
 */
export async function GET() {
  try {
    const rooms = await getActiveRooms();
    return NextResponse.json(
      { rooms, apiConfigured: true },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return NextResponse.json(
        { rooms: [], apiConfigured: false },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { rooms: [], apiConfigured: false },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
