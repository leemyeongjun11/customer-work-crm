import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ApiError,fields,requireValue,dayDeadline} from './rules.mjs';
import {validateInquiry,insertInquiry} from './intake.mjs';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);

export function readWebhookKeys(value) {
  if(!value)return [];
  try {
    const keys=JSON.parse(value);
    if(!Array.isArray(keys)||!keys.length||keys.length>20)throw new Error();
    const ids=new Set();
    for(const k of keys){
      if(!k||!identifier(k.id)||ids.has(k.id)||typeof k.secret!=='string'||Buffer.byteLength(k.secret)<32||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(k.tenantId)||typeof k.expiresAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(k.expiresAt)||!Number.isFinite(Date.parse(k.expiresAt)))throw new Error();
      ids.add(k.id);
    }
    return keys;
  }catch{throw new Error('Invalid CRM_EMERGENT_KEYS configuration. Check key IDs, tenant IDs, secret length and expiry dates.');}
}

export function ingestionService(db,{clock=()=>new Date(),keys=[]}={}) {
  function authenticate(headers,raw) {
    requireValue(keys.length,'외부 문의 연결이 아직 설정되지 않았습니다.',503);
    const key=keys.find(k=>k.id===headers['x-webhook-key-id']);
    const stamp=headers['x-webhook-timestamp'],signature=headers['x-webhook-signature'];
    const valid=key&&Date.parse(key.expiresAt)>clock().getTime()&&typeof stamp==='string'&&/^\d{10}$/.test(stamp)&&Math.abs(clock().getTime()-Number(stamp)*1000)<=300000&&typeof signature==='string'&&/^[0-9a-f]{64}$/.test(signature);
    requireValue(valid,'문의 수신 인증에 실패했습니다.',401);
    const expected=createHmac('sha256',key.secret).update(stamp+'.').update(raw).digest();
    requireValue(timingSafeEqual(expected,Buffer.from(signature,'hex')),'문의 수신 인증에 실패했습니다.',401);
    return key.tenantId;
  }
  async function importVerified(tenantId,event) {
      requireValue(typeof tenantId==='string'&&/^[0-9a-f-]{36}$/i.test(tenantId),'문의 연결의 회사 설정을 확인해 주세요.',503);
      requireValue(Buffer.byteLength(JSON.stringify(event)??'')<=16384,'입력 내용이 너무 큽니다.',413);
      fields(event,['schemaVersion','eventId','eventType','sourceInquiryId','sourceReceivedAt','payload']);
      requireValue(event.schemaVersion===1&&event.eventType==='inquiry.created','지원하지 않는 문의 이벤트 형식입니다.');
      requireValue(identifier(event.eventId)&&identifier(event.sourceInquiryId),'문의·이벤트 ID 형식을 확인해 주세요.');
      const at=event.sourceReceivedAt;
      requireValue(typeof at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(at)&&Number.isFinite(Date.parse(at)),'시간대가 포함된 원래 접수 시각이 필요합니다.');
      dayDeadline(at.slice(0,10));
      requireValue(Date.parse(at)<=clock().getTime(),'미래의 접수 시각은 사용할 수 없습니다.');
      fields(event.payload,['customerType','name','contactName','phone','email','companySize','requestMemo']);
      requireValue(['organization','person'].includes(event.payload.customerType),'문의 고객 유형을 확인해 주세요.');
      const p=event.payload,original=validateInquiry({customerType:p.customerType==='organization'?'company':'person',name:p.name,person:p.contactName,phone:p.phone,email:p.email,size:p.companySize,memo:p.requestMemo});
      const eventHash=hash(event),contentHash=hash({sourceReceivedAt:at,payload:p});
      return db.transaction(async tx=>{
        // One tenant lock serializes intake, settings and duplicate deliveries across API instances.
        const tenant=(await tx.query('SELECT * FROM crm_tenants WHERE id=$1 FOR UPDATE',[tenantId])).rows[0];
        requireValue(tenant,'문의 연결의 회사 설정을 확인해 주세요.',503);
        const prior=(await tx.query("SELECT * FROM crm_source_events WHERE tenant_id=$1 AND source='emergent' AND event_id=$2",[tenantId,event.eventId])).rows[0];
        if(prior)requireValue(prior.event_hash===eventHash,'동일 이벤트 ID의 내용이 달라 확인이 필요합니다.',409);
        const inquiry=(await tx.query("SELECT * FROM crm_source_inquiries WHERE tenant_id=$1 AND source='emergent' AND source_inquiry_id=$2",[tenantId,event.sourceInquiryId])).rows[0];
        if(inquiry)requireValue(inquiry.content_hash===contentHash,'동일 문의 ID의 원문이 달라 확인이 필요합니다. CRM 수정본은 유지됩니다.',409);
        const recordedAt=clock().toISOString();
        const response=inquiry?.response||await insertInquiry(tx,tenant,original,{receivedAt:new Date(at).toISOString(),recordedAt,source:'emergent',sourceInquiryId:event.sourceInquiryId});
        if(!inquiry)await tx.query("INSERT INTO crm_source_inquiries(tenant_id,source,source_inquiry_id,content_hash,raw_payload,source_received_at,ingested_at,case_id,response) VALUES($1,'emergent',$2,$3,$4,$5,$6,$7,$8)",[tenantId,event.sourceInquiryId,contentHash,JSON.stringify(p),at,recordedAt,response.receiptId,JSON.stringify(response)]);
        if(!prior)await tx.query("INSERT INTO crm_source_events(tenant_id,source,event_id,source_inquiry_id,event_hash,received_at) VALUES($1,'emergent',$2,$3,$4,$5)",[tenantId,event.eventId,event.sourceInquiryId,eventHash,recordedAt]);
        return {status:inquiry?200:201,data:{...response,duplicate:!!inquiry}};
      });
  }
  return {
    // Internal adapter entry only; never exposed as an unsigned HTTP route.
    importVerified,
    async receive(headers,raw){
      const tenantId=authenticate(headers,raw);
      let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw new ApiError(400,'JSON 내용을 확인해 주세요.');}
      return importVerified(tenantId,event);
    },
  };
}
