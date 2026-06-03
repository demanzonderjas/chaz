import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

function normalizeFen(fen: string): string {
  const parts = fen.split(' ');
  return parts.slice(0, 4).join(' ');
}

async function getCachedRow(engine: string, fen: string, multipv: number) {
  const sql = 'SELECT limit_value, result_json FROM analysis WHERE engine = ? AND fen_norm = ? AND limit_type = \'depth\' AND multipv = ? ORDER BY limit_value DESC LIMIT 1';
  const rs = await turso.execute({ sql, args: [engine, normalizeFen(fen), multipv] });
  return rs.rows[0];
}

function buildGetResult(row: any, depth: number) {
  const ok = !!(row && Number(row.limit_value) >= depth);
  return { cached: ok, result: ok ? JSON.parse(row.result_json as string) : null };
}

async function saveCacheRow(eng: string, fen: string, depth: number, json: string) {
  const norm = normalizeFen(fen);
  const deleteSql = 'DELETE FROM analysis WHERE engine = ? AND fen_norm = ? AND limit_type = \'depth\' AND multipv = 1';
  const insertSql = 'INSERT INTO analysis (engine, fen_norm, limit_type, limit_value, multipv, result_json) VALUES (?, ?, \'depth\', ?, 1, ?)';
  await turso.batch([
    { sql: deleteSql, args: [eng, norm] },
    { sql: insertSql, args: [eng, norm, depth, json] }
  ], 'write');
}

function errorResponse(err: any) {
  return NextResponse.json({ error: String(err) }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const fen = req.nextUrl.searchParams.get('fen');
  const depth = parseInt(req.nextUrl.searchParams.get('depth') || '0');
  const eng = req.nextUrl.searchParams.get('engine') || 'sf18';
  if (!fen) return NextResponse.json({ cached: false });
  const row = await getCachedRow(eng, fen, 1).catch(() => null);
  return NextResponse.json(buildGetResult(row, depth));
}

export async function POST(req: NextRequest) {
  const { fen, depth, result, engine = 'sf18' } = await req.json();
  const row = await getCachedRow(engine, fen, 1).catch(() => null);
  if (row && Number(row.limit_value) >= depth) return NextResponse.json({ success: true });
  return saveCacheRow(engine, fen, depth, JSON.stringify(result))
    .then(() => NextResponse.json({ success: true }))
    .catch((err) => errorResponse(err));
}
