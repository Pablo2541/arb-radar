import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DOLAR_API_URL = 'https://dolarapi.com/v1/dolares';
const CACHE_TTL = 300_000;
let cachedData: unknown = null;
let cachedAt = 0;

export async function GET() {
  const now = Date.now();
  if (cachedData && (now - cachedAt) < CACHE_TTL) {
    return NextResponse.json(cachedData);
  }
  try {
    const res = await fetch(DOLAR_API_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    cachedData = data;
    cachedAt = now;
    return NextResponse.json(data);
  } catch {
    if (cachedData) return NextResponse.json(cachedData);
    return NextResponse.json({ error: true, message: 'Failed to fetch dollar rates' }, { status: 502 });
  }
}
