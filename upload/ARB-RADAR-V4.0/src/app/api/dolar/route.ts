import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export async function GET() {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares', {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`DolarAPI returned ${res.status}`);
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('DolarAPI returned empty or invalid data');
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: true, message: error instanceof Error ? error.message : 'Failed to fetch dollar rates' },
      { status: 502 }
    );
  }
}
