// ════════════════════════════════════════════════════════════════════════
// V3.4.3-PRO — /api/iol-status
// Quick IOL availability check — used by frontend LED indicator
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getIOLToken, isIOLAvailable } from '@/lib/iol-bridge';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hasCredentials = !!(process.env.IOL_USERNAME && process.env.IOL_PASSWORD);

  if (!hasCredentials) {
    return NextResponse.json({
      status: 'not_configured',
      credentials: false,
      online: false,
    });
  }

  // Try to get a token — this bootstraps the connection if it's the first call
  const token = await getIOLToken();
  const available = isIOLAvailable();

  return NextResponse.json({
    status: token ? 'online' : 'auth_failed',
    credentials: true,
    online: available && !!token,
  });
}
