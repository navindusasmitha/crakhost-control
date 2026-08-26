import {db} from '@/lib/db';

export type ProvisioningReconcileResult={
  activated:number;
  staleFailed:number;
  cancelledPending:number;
  activatedOrders:string[];
  staleOrders:string[];
  cancelledOrders:string[];
};

export async function reconcileProvisioningOrders():Promise<ProvisioningReconcileResult>{
  const activated=await db.query(`
    update orders o
       set status='ACTIVE',
           failure_reason='',
           provisioned_at=coalesce(o.provisioned_at,now()),
           updated_at=now()
     where o.server_id is not null
       and o.status in ('PENDING','PAID','PROVISIONING','FAILED')
       and exists(select 1 from servers s where s.id=o.server_id)
    returning o.id
  `);

  const stale=await db.query(`
    update orders o
       set status='FAILED',
           failure_reason=case
             when coalesce(trim(o.failure_reason),'')='' then 'Provisioning timed out before a server was attached. Safe to retry from Admin Orders.'
             else o.failure_reason
           end,
           updated_at=now()
     where o.server_id is null
       and o.status='PROVISIONING'
       and o.updated_at<now()-interval '30 minutes'
    returning o.id
  `);

  const cancelled=await db.query(`
    update orders o
       set status='CANCELLED',
           failure_reason=case
             when coalesce(trim(o.failure_reason),'')='' then 'Checkout expired without a paid invoice.'
             else o.failure_reason
           end,
           updated_at=now()
     where o.server_id is null
       and o.status='PENDING'
       and o.updated_at<now()-interval '2 hours'
       and not exists(select 1 from invoices i where i.order_id=o.id and i.status='PAID')
    returning o.id
  `);

  return {
    activated:activated.rowCount||0,
    staleFailed:stale.rowCount||0,
    cancelledPending:cancelled.rowCount||0,
    activatedOrders:activated.rows.map((r:any)=>String(r.id)),
    staleOrders:stale.rows.map((r:any)=>String(r.id)),
    cancelledOrders:cancelled.rows.map((r:any)=>String(r.id))
  };
}
