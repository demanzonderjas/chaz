import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

export async function GET(req: NextRequest) {
  try {
    const sql = `
      SELECT o.id, o.name, g.user_color, COUNT(*) as game_count
      FROM games g
      JOIN openings o ON g.opening_id = o.id
      GROUP BY o.id, o.name, g.user_color
      ORDER BY o.name ASC, g.user_color ASC
    `;
    const rs = await turso.execute(sql);
    const openings = rs.rows.map(r => ({
      id: Number(r.id),
      name: String(r.name),
      color: String(r.user_color),
      game_count: Number(r.game_count)
    }));
    return NextResponse.json({ openings });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
