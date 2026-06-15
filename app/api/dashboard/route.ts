import { NextResponse } from 'next/server';
import { getDashboardData } from '../../services/dashboardService';

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
