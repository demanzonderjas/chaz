import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../../services/turso';

function normalizeFen(fen: string): string {
  const parts = fen.split(' ');
  return parts.slice(0, 4).join(' ');
}

export async function POST(req: NextRequest) {
  try {
    const { fens, depth, engine = 'sf18' } = (await req.json()) as {
      fens: string[];
      depth: number;
      engine?: string;
    };

    if (!fens || fens.length === 0) {
      return NextResponse.json({ results: {} });
    }

    const normalizedFens = Array.from(new Set(fens.map(normalizeFen)));
    const placeholders = normalizedFens.map(() => '?').join(',');

    // Query all matching cached rows for multipv = 1 or multipv = 4
    const sql = `
      SELECT fen_norm, multipv, limit_value, result_json 
      FROM analysis 
      WHERE engine = ? 
        AND limit_type = 'depth' 
        AND (multipv = 1 OR multipv = 4) 
        AND fen_norm IN (${placeholders})
    `;
    const rs = await turso.execute({ sql, args: [engine, ...normalizedFens] });

    // Group rows by fen_norm and multipv
    const rowsMap: Record<string, Record<number, any>> = {};
    rs.rows.forEach((row: any) => {
      const fenNorm = row.fen_norm as string;
      const multipv = Number(row.multipv);
      if (!rowsMap[fenNorm]) {
        rowsMap[fenNorm] = {};
      }
      // If there are multiple, keep the one with the highest depth (limit_value)
      const existing = rowsMap[fenNorm][multipv];
      if (!existing || Number(row.limit_value) > Number(existing.limit_value)) {
        rowsMap[fenNorm][multipv] = row;
      }
    });

    const results: Record<string, { cached: boolean; result: any }> = {};

    fens.forEach((fen) => {
      const norm = normalizeFen(fen);
      const group = rowsMap[norm] || {};
      const r1 = group[1];
      const r4 = group[4];

      let chosenRow = null;

      // Logic identical to GET:
      // 1. check r1 and if it has a pv array of length > 0
      let r1HasPv = false;
      let r1Parsed = null;
      if (r1) {
        try {
          r1Parsed = JSON.parse(r1.result_json as string);
          r1HasPv = !!(r1Parsed?.pv?.length);
        } catch {}
      }

      let r4HasPv = false;
      let r4Parsed = null;
      if (r4) {
        try {
          r4Parsed = JSON.parse(r4.result_json as string);
          r4HasPv = !!(r4Parsed?.pv?.length);
        } catch {}
      }

      if (r1 && r1HasPv && Number(r1.limit_value) >= depth) {
        chosenRow = r1;
      } else if (r4 && r4HasPv && Number(r4.limit_value) >= depth) {
        chosenRow = r4;
      } else if (r1 && Number(r1.limit_value) >= depth) {
        chosenRow = r1;
      }

      if (chosenRow) {
        try {
          results[fen] = {
            cached: true,
            result: JSON.parse(chosenRow.result_json as string),
          };
        } catch {
          results[fen] = { cached: false, result: null };
        }
      } else {
        results[fen] = { cached: false, result: null };
      }
    });

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
