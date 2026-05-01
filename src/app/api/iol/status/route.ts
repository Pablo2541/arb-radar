// ════════════════════════════════════════════════════════════════════════
// V3.2 — IOL Level 2 Status Check Endpoint
//
// Checks whether IOL (InvertirOnline) credentials are configured
// and whether the IOL API is reachable. Used by the frontend to
// display the IOL L2 indicator in the header.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const username = process.env.IOL_USERNAME;
    const password = process.env.IOL_PASSWORD;

    const credentialsConfigured = !!(username && password && username.trim() !== '' && password.trim() !== '');

    if (!credentialsConfigured) {
      return NextResponse.json({
        ok: true,
        online: false,
        reason: 'IOL credentials not configured (IOL_USERNAME / IOL_PASSWORD)',
        credentialsConfigured: false,
      });
    }

    // Attempt authentication to verify IOL is reachable
    try {
      const params = new URLSearchParams({
        username: username!,
        password: password!,
        grant_type: 'password',
      });

      const res = await fetch('https://api.invertironline.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json() as { access_token: string; expires_in: number };
        return NextResponse.json({
          ok: true,
          online: true,
          tokenExpiry: data.expires_in,
          credentialsConfigured: true,
        });
      } else {
        const errText = await res.text().catch(() => '');
        return NextResponse.json({
          ok: true,
          online: false,
          reason: `Auth failed: ${res.status} — ${errText.slice(0, 100)}`,
          credentialsConfigured: true,
        });
      }
    } catch {
      return NextResponse.json({
        ok: true,
        online: false,
        reason: 'IOL API connection error',
        credentialsConfigured: true,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Failed to check IOL status' },
      { status: 500 }
    );
  }
}
