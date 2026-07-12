import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

export async function GET(req: NextRequest) {
  const analytics = req.nextUrl.searchParams.get('analytics');

  try {
    if (analytics === 'true') {
      // Fetch analytics for dashboard: tag counts by month/week
      // A tag is applied to a FEN. We join position_comments with position_moves and games
      // to see how many times that mistake was made in real games.
      
      const sql = `
        SELECT 
          json_each.value as tag,
          g.played_date,
          COUNT(pm.game_id) as occurrences
        FROM position_comments pc
        JOIN json_each(pc.tags)
        JOIN position_moves pm ON pm.fen_norm = pc.fen
        JOIN games g ON pm.game_id = g.id
        WHERE pc.tags IS NOT NULL AND pc.tags != '[]'
        GROUP BY tag, g.played_date
        ORDER BY g.played_date ASC
      `;
      const rs = await turso.execute(sql);
      
      // Group by tag and date
      const analyticsData = rs.rows.map(r => ({
        tag: String(r.tag),
        date: String(r.played_date),
        occurrences: Number(r.occurrences)
      }));

      return NextResponse.json({ analytics: analyticsData });
    }

    // Default: fetch distinct tags
    const sql = `
      SELECT DISTINCT json_each.value as tag 
      FROM position_comments, json_each(tags) 
      WHERE tags IS NOT NULL AND tags != '[]'
      ORDER BY tag ASC
    `;
    const rs = await turso.execute(sql);
    
    const tags = rs.rows.map(r => String(r.tag));
    return NextResponse.json({ tags });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
