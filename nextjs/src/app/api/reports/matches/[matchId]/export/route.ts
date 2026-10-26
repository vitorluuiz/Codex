import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/cookies';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await context.params;
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'pdf';

  if (format === 'pdf') {
    const redirectUrl = new URL(`/relatorios/${encodeURIComponent(matchId)}?export=pdf`, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  const base = process.env.API_BASE_URL;
  const serviceToken = process.env.API_SERVICE_TOKEN;

  if (!base) {
    return NextResponse.json({ code: 'API_NOT_CONFIGURED' }, { status: 503 });
  }

  const headers = new Headers();
  if (serviceToken) headers.set('x-service-token', serviceToken);

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (session) headers.set('authorization', `Bearer ${session}`);

  const upstream = await fetch(
    `${base}/matches/${encodeURIComponent(matchId)}/report/export?format=xlsx`,
    {
      method: 'GET',
      headers,
      cache: 'no-store',
    },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { code: 'EXPORT_FAILED', message: 'Falha ao exportar planilha do relatório.' },
      { status: upstream.status },
    );
  }

  const arrayBuffer = await upstream.arrayBuffer();
  const contentType =
    upstream.headers.get('content-type') ??
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const disposition =
    upstream.headers.get('content-disposition') ??
    `attachment; filename="relatorio-${matchId.slice(0, 8)}.xlsx"`;

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': disposition,
      'cache-control': 'no-store',
    },
  });
}
