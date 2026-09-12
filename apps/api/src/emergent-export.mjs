import {ApiError,requireValue,fields} from './rules.mjs';

export function readExportConnections(raw){
  if(!raw)return [];
  let items;try{items=JSON.parse(raw);}catch{throw new Error('CRM_EMERGENT_EXPORTS must be a JSON array.');}
  requireValue(Array.isArray(items)&&items.length<=10,'문의 조회 연결은 최대 10개까지 설정할 수 있습니다.');
  const seen=new Set();
  return items.map(item=>{
    fields(item,['tenantId','endpoint','token']);
    requireValue(typeof item.tenantId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.tenantId),'문의 조회 회사 ID를 확인해 주세요.');
    requireValue(!seen.has(item.tenantId.toLowerCase()),'회사의 문의 조회 연결이 중복되었습니다.');seen.add(item.tenantId.toLowerCase());
    let url;try{url=new URL(item.endpoint);}catch{throw new Error('Invalid Emergent export endpoint.');}
    requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash,'문의 조회 주소는 인증정보·쿼리 없는 HTTPS 주소여야 합니다.');
    requireValue(typeof item.token==='string'&&item.token.length>=16&&item.token.length<=4096&&!/[\s\x00-\x1f\x7f]/.test(item.token),'문의 조회 인증 토큰 형식을 확인해 주세요.');
    return {tenantId:item.tenantId.toLowerCase(),endpoint:url.href,token:item.token};
  });
}

export function exportPageFetcher(connections,{fetchImpl=fetch,clock=()=>new Date()}={}){
  if(!connections.length)return undefined;
  const map=new Map(connections.map(c=>[c.tenantId,c]));
  const fetchPage=async({tenantId,cursor,limit,signal})=>{
    const config=map.get(tenantId);requireValue(config,'이 회사의 문의 조회 연결이 설정되지 않았습니다.',503);
    const url=new URL(config.endpoint);url.searchParams.set('limit',String(Math.min(limit,100)));if(cursor!==null&&cursor!==undefined)url.searchParams.set('cursor',cursor);
    let response;
    try{response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json',Authorization:`Bearer ${config.token}`},redirect:'error',signal});}
    catch{throw new ApiError(503,'문의 조회 서버에 연결하지 못했습니다. 다음 실행에서 다시 확인합니다.');}
    if(!response.ok){
      const status=[401,403,429].includes(response.status)?response.status:503;
      const error=new ApiError(status,status===401||status===403?'문의 조회 인증 정보를 확인해 주세요.':status===429?'문의 조회 요청 제한으로 잠시 대기합니다.':'문의 조회 서버 응답을 확인해 주세요.');
      if(status===429){const value=response.headers.get('retry-after'),seconds=value&&/^\d+$/.test(value)?Number(value):value?Math.ceil((Date.parse(value)-clock().getTime())/1000):60;error.retryAfterSeconds=Number.isFinite(seconds)?Math.max(60,Math.min(seconds,86400)):60;}
      await response.body?.cancel();throw error;
    }
    if(response.headers.get('content-type')?.split(';')[0].trim()!=='application/json'){await response.body?.cancel();throw new ApiError(502,'문의 조회 응답은 JSON이어야 합니다.');}
    const reader=response.body?.getReader();requireValue(reader,'문의 조회 응답이 비어 있습니다.',502);
    const chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;requireValue(size<=1024*1024,'문의 조회 응답이 1 MiB 한도를 초과했습니다.',502);chunks.push(value);}}
    finally{await reader.cancel();reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(502,'문의 조회 JSON을 확인해 주세요.');}
  };
  fetchPage.tenantIds=[...map.keys()];return fetchPage;
}
