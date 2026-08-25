import {createHash,timingSafeEqual} from 'node:crypto';

function md5(v:string){return createHash('md5').update(v,'utf8').digest('hex').toUpperCase()}

export function payhereConfig(){
  const merchantId=String(process.env.PAYHERE_MERCHANT_ID||'').trim();
  const merchantSecret=String(process.env.PAYHERE_MERCHANT_SECRET||'').trim();
  if(!merchantId||!merchantSecret)throw new Error('PayHere is not configured');
  const sandbox=String(process.env.PAYHERE_SANDBOX||'true').toLowerCase()!=='false';
  return {merchantId,merchantSecret,sandbox,checkoutUrl:sandbox?'https://sandbox.payhere.lk/pay/checkout':'https://www.payhere.lk/pay/checkout'};
}

export function money(v:number|string){const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error('Invalid payment amount');return n.toFixed(2)}

export function checkoutHash(merchantId:string,orderId:string,amount:number|string,currency:string,merchantSecret:string){
  return md5(`${merchantId}${orderId}${money(amount)}${currency.toUpperCase()}${md5(merchantSecret)}`);
}

export function notificationHash(merchantId:string,orderId:string,amount:string,currency:string,statusCode:string,merchantSecret:string){
  return md5(`${merchantId}${orderId}${amount}${currency.toUpperCase()}${statusCode}${md5(merchantSecret)}`);
}

export function safeSignatureEqual(a:string,b:string){
  const x=Buffer.from(String(a||'').toUpperCase(),'utf8'),y=Buffer.from(String(b||'').toUpperCase(),'utf8');
  return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);
}
