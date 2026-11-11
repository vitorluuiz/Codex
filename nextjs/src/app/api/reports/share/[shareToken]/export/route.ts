import { NextResponse, type NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shareToken: string }> },
) {
  const { shareToken } = await context.params;
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'pdf';

  if (format === 'pdf') {
    const redirectUrl = new URL(
      `/relatorios/${encodeURIComponent(shareToken)}?export=pdf`,
      request.url,
    );
    return NextResponse.redirect(redirectUrl);
  }

  const base = process.env.API_BASE_URL;
  const serviceToken = process.env.API_SERVICE_TOKEN;

  if (!base) {
    return NextResponse.json({ code: 'API_NOT_CONFIGURED' }, { status: 503 });
  }

  const headers = new Headers();
  if (serviceToken) headers.set('x-service-token', serviceToken);

  const upstream = await fetch(
    `${base}/reports/share/${encodeURIComponent(shareToken)}/export?format=xlsx`,
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
    upstream.headers.get('content-disposition') ?? 'attachment; filename="relatorio-partida.xlsx"';

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': disposition,
      'cache-control': 'no-store',
    },
  });
}
