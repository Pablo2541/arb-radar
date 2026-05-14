// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — /api/iol-status
// Full IOL diagnostic — shows EXACTLY why IOL is online or offline
// Includes credential presence, circuit breaker state, and last error
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getIOLToken, isIOLAvailable, getIOLDiagnostic, resetIOLState } from '@/lib/iol-bridge';

export const dynamic = 'force-dynamic';

export async function GET() {
  const diagnostic = getIOLDiagnostic();

  // If credentials exist but we haven't tried yet, attempt auth now
  if (diagnostic.credentials_configured && !diagnostic.token_cached && !diagnostic.circuit_breaker.locked) {
    const token = await getIOLToken();
    diagnostic.iol_available = isIOLAvailable();
    diagnostic.token_cached = !!token;
    // Refresh diagnostic after auth attempt
    const updatedDiag = getIOLDiagnostic();
    Object.assign(diagnostic, updatedDiag);
  }

  let status: string;
  if (!diagnostic.credentials_configured) {
    status = 'not_configured';
  } else if (diagnostic.iol_available) {
    status = 'online';
  } else if (diagnostic.circuit_breaker.locked) {
    status = 'circuit_breaker_locked';
  } else if (diagnostic.circuit_breaker.backoff_until) {
    status = 'circuit_breaker_backoff';
  } else {
    status = 'auth_failed';
  }

  // Legacy compatibility fields for frontend
  const token_status = !diagnostic.credentials_configured
    ? 'not_configured'
    : diagnostic.iol_available
      ? 'valid'
      : 'invalid';

  return NextResponse.json({
    status,
    token_status,
    credentials: diagnostic.credentials_configured,
    online: diagnostic.iol_available,
    iol_available: diagnostic.iol_available,
    diagnostic,
    circuitBreaker: diagnostic.circuit_breaker,
  });
}

// ── POST: Reset IOL circuit breaker ──────────────────────────────────
// Call this after fixing credentials in .env to immediately retry
export async function POST() {
  resetIOLState();
  return NextResponse.json({
    ok: true,
    message: 'IOL circuit breaker reset — will retry auth on next check',
  });
}
