import {redirect} from 'next/navigation';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import MailCenter from '@/components/MailCenter';

export default async function MailPage(){
  const user=await getCurrentUser();
  if(!isAdmin(user))redirect('/dashboard');
  return <MailCenter/>;
}
