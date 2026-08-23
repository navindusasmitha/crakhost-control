import {redirect} from 'next/navigation';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import MailHostingCenter from '@/components/MailHostingCenter';

export default async function MailHostingPage(){
  const user=await getCurrentUser();
  if(!isAdmin(user))redirect('/dashboard');
  return <MailHostingCenter/>;
}
