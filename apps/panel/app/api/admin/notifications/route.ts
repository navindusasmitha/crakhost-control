import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import {audit} from '@/lib/audit';
import {getNotificationSettings,normalizeNotificationSettings} from '@/lib/alert-evaluator';

export const dynamic='force-dynamic';
export const runtime='nodejs';
function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===req.headers.get('host')}catch{return false}}
export async function GET(){const user=await getCurrentUser();if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});return NextResponse.json({settings:await getNotificationSettings()},{headers:{'cache-control':'no-store'}})}
export async function PATCH(req:Request){
  const user=await getCurrentUser();if(!isAdmin(user))return NextResponse.json({error:'Admin required'},{status:403});if(!sameOrigin(req))return NextResponse.json({error:'Cross-origin notification change blocked.'},{status:403});if(req.headers.get('x-crakhost-action')!=='notification-settings')return NextResponse.json({error:'Missing notification settings confirmation.'},{status:400});
  const body=await req.json().catch(()=>({}));const value=normalizeNotificationSettings(body);
  await db.query(`insert into system_settings(key,value,updated_by,updated_at) values('notification_settings',$1,$2,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[JSON.stringify(value),user.id]);await audit(user.id,'notifications.settings.update','system','notification_settings',{emailEnabled:value.emailEnabled,recipientCount:value.recipients.length,criticalOnly:value.criticalOnly});return NextResponse.json({ok:true,settings:value},{headers:{'cache-control':'no-store'}})
}
