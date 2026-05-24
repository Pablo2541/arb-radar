import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const filePath = join(process.cwd(), 'arb-radar-v3.1.0.zip');
    const fileBuffer = readFileSync(filePath);
    const stats = statSync(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="arb-radar-v3.1.0.zip"',
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'File not found', details: error instanceof Error ? error.message : String(error) },
      { status: 404 }
    );
  }
}
