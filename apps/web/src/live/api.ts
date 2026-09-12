export class RequestError extends Error {
  constructor(public status:number,message:string){super(message);}
}
export async function request(path:string,method='GET',body?:unknown,key?:string) {
  const res=await fetch(`/api/v1${path}`,{method,credentials:'same-origin',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  let result;try{result=await res.json();}catch{throw new RequestError(res.status,'서버에 연결할 수 없습니다. 실제 저장 검수 주소(4180)를 확인해 주세요.');}
  if(!res.ok)throw new RequestError(res.status,result.error?.message||'요청에 실패했습니다.');
  return result;
}
