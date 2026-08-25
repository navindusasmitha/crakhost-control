import {redirect} from 'next/navigation';
import {getCurrentUser,isAdmin} from '@/lib/auth';
import AdminCommerceCenter from '@/components/AdminCommerceCenter';

export default async function AdminCommerce(){const user=await getCurrentUser();if(!user)redirect('/login?next=/admin/commerce');if(!isAdmin(user))redirect('/dashboard');return <AdminCommerceCenter/>}
