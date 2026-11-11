import { NextResponse, type NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ accessToken: string }> },
) {
  const { accessToken } = await context.params;
  const redirectUrl = new URL(
    `/relatorios/individual/${encodeURIComponent(accessToken)}?export=pdf`,
    request.url,
  );
  return NextResponse.redirect(redirectUrl);
}
