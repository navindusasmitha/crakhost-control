import {NextResponse} from 'next/server';import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){const {rows}=await db.query(`select slug,name,description,memory_mb,cpu_limit,disk_mb,price_monthly,currency,template_slug,featured from plans where enabled=true order by sort_order,price_monthly`);return NextResponse.json({plans:rows})}
