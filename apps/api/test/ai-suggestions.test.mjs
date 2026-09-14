import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAiSuggestions} from '../src/ai-suggestions.mjs';
import {ApiError} from '../src/rules.mjs';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {createService} from '../src/service.mjs';
import {makeServer} from '../src/server.mjs';

const clock=()=>new Date('2026-09-14T08:00:00.000Z');
const env={CRM_AI_ENABLED:'true',GROQ_API_KEY:'synthetic-test-key-never-sent'};
const user={tenantId:randomUUID(),id:randomUUID(),role:'staff'};
const caseId=randomUUID();
const dateQuote='2026년 9월 18일에 견적을 보내 주세요.';
const proposal=(overrides={})=>({
  summary:'고객이 견적 전달을 요청했습니다.',situation:'waiting',stage:'제안·협의',
  createTask:true,taskType:'quote',description:'점검 견적 전달',date:'2026-09-18',
  dateEvidence:dateQuote,evidence:[dateQuote],questions:[],...overrides,
});
const detailFixture=()=>({
  salesCase:{id:caseId,version:2,stage:'상담 진행',followUp:{cause:'consultation',title:'첫 연락'},requestMemo:dateQuote},
  tasks:[],notes:[],activities:[],
});
const responseFor=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof raw==='string'?raw:JSON.stringify(raw)}}]}),{
  status:200,headers:{'Content-Type':'application/json'},
});
const statusIs=status=>error=>error instanceof ApiError&&error.status===status;

function stubAi({detail=detailFixture(),fetchImpl=async()=>responseFor(proposal()),...options}={}) {
  return createAiSuggestions({service:{detail:async()=>structuredClone(detail)},clock,env,fetchImpl,...options});
}

test('AI 연결을 명시적으로 켜고 키를 설정하기 전에는 외부 호출을 하지 않는다',async()=>{
  let calls=0;
  for(const configuration of [{},{CRM_AI_ENABLED:'true'},{CRM_AI_ENABLED:'false',GROQ_API_KEY:'test'},
    {CRM_AI_ENABLED:'TRUE',GROQ_API_KEY:'test'},{CRM_AI_ENABLED:'true',GROQ_API_KEY:'   '}]) {
    const ai=stubAi({env:configuration,fetchImpl:async()=>{calls++;throw new Error('must not call provider');}});
    assert.equal(ai.status().enabled,false);
    await assert.rejects(ai.suggest(user,caseId,{expectedVersion:2}),statusIs(503));
  }
  assert.equal(calls,0);
  assert.equal(stubAi().status().enabled,true);
});

test('불완전하거나 잘못된 제안과 사용 한도 오류는 저장 가능한 제안으로 반환하지 않는다',async t=>{
  const failures=[
    {name:'모델 본문이 JSON이 아님',response:()=>responseFor('```json\n{}\n```'),status:502},
    {name:'정의되지 않은 고객 상황',response:()=>responseFor(proposal({situation:'certainly-signed'})),status:502},
    {name:'정의되지 않은 업무',response:()=>responseFor(proposal({taskType:'send-money'})),status:502},
    {name:'상담에 없는 근거',response:()=>responseFor(proposal({evidence:['고객이 계약에 동의했다.']})),status:502},
    {name:'제공자 사용 한도',response:()=>new Response('rate limited',{status:429}),status:429},
  ];
  for(const failure of failures)await t.test(failure.name,async()=>{
    let calls=0;
    const ai=stubAi({fetchImpl:async()=>{calls++;return calls===1?failure.response():responseFor(proposal());}});
    await assert.rejects(ai.suggest(user,caseId,{expectedVersion:2}),statusIs(failure.status));
    // A failed attempt must release the pending request guard so the employee can retry.
    assert.equal((await ai.suggest(user,caseId,{expectedVersion:2})).suggestion.taskType,'quote');
    assert.equal(calls,2);
  });
});

test('날짜는 실제 상담의 일치하는 달력 날짜로 뒷받침될 때만 남긴다',async t=>{
  const cases=[
    {name:'정확한 날짜와 근거',overrides:{},expected:'2026-09-18'},
    {name:'날짜 근거 없음',overrides:{dateEvidence:null},expected:null},
    {name:'원문에 없는 날짜 근거',overrides:{dateEvidence:'2026년 9월 18일 방문하기로 했습니다.'},expected:null},
    {name:'근거와 다른 날짜',overrides:{date:'2026-09-19'},expected:null},
    {name:'근거의 명시 연도와 다른 올해 날짜',overrides:{dateEvidence:'2027년 9월 18일에 전달해 주세요.'},extraNote:'2027년 9월 18일에 전달해 주세요.',expected:null},
    {name:'내일이라는 상대 날짜',overrides:{date:'2026-09-15',dateEvidence:'내일 연락해 주세요.'},extraNote:'내일 연락해 주세요.',expected:null},
  ];
  for(const item of cases)await t.test(item.name,async()=>{
    const detail=detailFixture();if(item.extraNote)detail.notes.push({body:item.extraNote});
    const ai=stubAi({detail,fetchImpl:async()=>responseFor(proposal(item.overrides))});
    const {suggestion}=await ai.suggest(user,caseId,{expectedVersion:2});
    assert.equal(suggestion.date,item.expected);
    if(item.expected===null){assert.equal(suggestion.dateEvidence,null);assert.ok(suggestion.questions.length>0);}
  });
});

test('AI 응답을 기다리는 동안 바뀐 버전과 접근 권한을 다시 확인한다',async t=>{
  await t.test('변경된 상담 버전',async()=>{
    const detail=detailFixture();let reads=0;
    const ai=stubAi({service:{detail:async()=>{reads++;return structuredClone(detail);}},fetchImpl:async()=>{
      detail.salesCase.version++;
      return responseFor(proposal());
    }});
    await assert.rejects(ai.suggest(user,caseId,{expectedVersion:2}),statusIs(409));
    assert.equal(reads,2);
  });
  await t.test('조회 권한이 사라짐',async()=>{
    let allowed=true;
    const ai=stubAi({service:{detail:async()=>{
      if(!allowed)throw new ApiError(404,'접근 권한이 없습니다.');
      return detailFixture();
    }},fetchImpl:async()=>{allowed=false;return responseFor(proposal());}});
    await assert.rejects(ai.suggest(user,caseId,{expectedVersion:2}),statusIs(404));
  });
});

test('같은 직원과 상담의 중복 요청은 제공자에 동시에 보내지 않는다',async()=>{
  let entered,release,calls=0;
  const providerEntered=new Promise(resolve=>{entered=resolve;});
  const providerRelease=new Promise(resolve=>{release=resolve;});
  const ai=stubAi({fetchImpl:async()=>{calls++;entered();await providerRelease;return responseFor(proposal());}});
  const first=ai.suggest(user,caseId,{expectedVersion:2});
  await providerEntered;
  try {
    await assert.rejects(ai.suggest(user,caseId,{expectedVersion:2}),statusIs(429));
    assert.equal(calls,1);
  } finally {release();}
  assert.equal((await first).suggestion.taskType,'quote');
  await ai.suggest(user,caseId,{expectedVersion:2});
  assert.equal(calls,2);
});

test('AI HTTP 경로는 로그인과 요청 출처를 검사하고 제안 요청만 제한한다',async t=>{
  const db=await openDatabase({url:'',directory:''});
  const password='AI-http-test-only';
  const org=await provision(db,{password});
  const service=createService(db,clock,{aiEnv:env}),staff={tenantId:org.tenantId,id:org.staffId,role:'staff'};
  const intake=await service.intake('local-review',{customerType:'company',name:'API 예시',person:'예시 담당자',phone:'010-1111-2222',email:'example@example.com',memo:dateQuote},randomUUID());
  await service.addNote(staff,intake.receiptId,{body:dateQuote,expectedVersion:1},randomUUID());
  let calls=0;
  const server=makeServer(db,{clock,ai:{env,fetchImpl:async()=>{calls++;return responseFor(proposal());}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeStreams();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));await db.close();});
  async function call(path,{method='GET',body,cookie,source=origin}={}) {
    const response=await fetch(`${origin}/api/v1${path}`,{method,headers:{Origin:source,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const path=`/cases/${intake.receiptId}/ai-suggestion`,body={expectedVersion:2};
  assert.equal((await call('/ai/status')).status,401);
  assert.equal((await call(path,{method:'POST',body})).status,401);
  const login=await call('/auth/login',{method:'POST',body:{email:'staff@crm.local',password}});
  assert.equal(login.status,200);const cookie=login.cookie;
  assert.deepEqual((await call('/ai/status',{cookie})).data,{enabled:true,provider:'groq',model:'qwen/qwen3.6-27b'});
  assert.equal((await call(path,{method:'POST',body,cookie,source:'https://untrusted.example'})).status,403);
  assert.equal(calls,0);
  const result=await call(path,{method:'POST',body,cookie});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.suggestion.taskType,'quote');
  assert.equal((await call(path,{method:'POST',body,cookie})).status,200);
  assert.equal((await call(path,{method:'POST',body,cookie})).status,429);
  assert.equal(calls,2,'local throttle prevents an additional provider call');
  assert.equal((await call('/ai/status',{cookie})).status,200,'manual UI status still works after AI throttle');
});

test('실제 DB에서 제안은 읽기만 수행하고 직원 승인 뒤에만 업무와 검증된 AI 출처를 저장한다',async t=>{
  const db=await openDatabase({url:'',directory:''});t.after(()=>db.close());
  const org=await provision(db,{password:'AI-local-test-only-password'});
  const staff={tenantId:org.tenantId,id:org.staffId,role:'staff'};
  const service=createService(db,clock,{aiEnv:env});
  const inquiry={customerType:'company',name:'구조화된 업체명',person:'구조화된 담당자명',phone:'010-1234-5678',email:'structured-contact@example.com',memo:dateQuote};
  const {receiptId:id}=await service.intake('local-review',inquiry,randomUUID());
  let detail=await service.detail(staff,id);
  await service.updateTask(staff,id,detail.tasks[0].id,'contact',{
    outcome:'connected',actualAt:clock().toISOString(),expectedVersion:detail.tasks[0].version,
    memo:`${dateQuote} 참고 연락처: memo-contact@example.com, 010-9876-5432`,
  },randomUUID());
  detail=await service.detail(staff,id);
  const body={expectedVersion:detail.salesCase.version};
  let calls=0,providerContext;
  const ai=createAiSuggestions({service,clock,env,fetchImpl:async(url,request)=>{
    calls++;
    assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
    providerContext=JSON.parse(JSON.parse(request.body).messages.find(m=>m.role==='user').content);
    const payload=request.body;
    for(const secret of [inquiry.name,inquiry.person,inquiry.phone,inquiry.email,org.tenantId,org.staffId,id,
      'memo-contact@example.com','010-9876-5432',env.GROQ_API_KEY])assert.ok(!payload.includes(secret),`provider payload contains ${secret}`);
    return responseFor(proposal());
  }});

  async function storedState() {
    const result={};
    // Include mutation side effects that do not appear in the case detail response.
    for(const table of ['crm_cases','crm_tasks','crm_notes','crm_contacts','crm_audit','crm_idempotency','crm_notification_jobs','crm_changes']) {
      result[table]=(await db.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`)).rows;
    }
    return result;
  }
  const before=await storedState();
  for(const inaccessible of [{...staff,id:randomUUID()},{...staff,tenantId:randomUUID()}]) {
    await assert.rejects(ai.suggest(inaccessible,id,body),statusIs(404));
  }
  assert.equal(calls,0,'access checks must finish before contacting the provider');

  const result=await ai.suggest(staff,id,body);
  assert.equal(calls,1);
  assert.equal(result.caseVersion,body.expectedVersion);
  assert.equal(result.suggestion.date,'2026-09-18');
  assert.equal(result.aiSource.model,result.model);
  assert.equal(result.aiSource.generatedAt,clock().toISOString());
  assert.equal(typeof result.aiSource.proof,'string');
  assert.match(providerContext.recentNotes[0].text,/\[이메일 제외\]/);
  assert.match(providerContext.recentNotes[0].text,/\[전화번호 제외\]/);
  assert.deepEqual(await storedState(),before,'requesting a proposal must leave all business records untouched');

  const plan={...body,stage:result.suggestion.stage,situation:'견적 전달 요청',createTask:true,
    taskType:result.suggestion.taskType,description:result.suggestion.description,date:result.suggestion.date,
    confirmed:true,aiSource:result.aiSource};
  await assert.rejects(service.followUp(staff,id,{...plan,confirmed:false},randomUUID()),statusIs(422));
  const missingConfirmation={...plan};delete missingConfirmation.confirmed;
  await assert.rejects(service.followUp(staff,id,missingConfirmation,randomUUID()),statusIs(422));
  for(const forgedSource of [
    {model:result.model,generatedAt:result.generatedAt},
    {...result.aiSource,proof:'a'.repeat(43)},
    {...result.aiSource,generatedAt:'2026-09-14T07:59:00.000Z'},
  ])await assert.rejects(service.followUp(staff,id,{...plan,aiSource:forgedSource},randomUUID()),statusIs(409));
  assert.deepEqual(await storedState(),before,'missing confirmation and forged provenance must not save records');

  const approvalKey=randomUUID();
  const saved=await service.followUp(staff,id,plan,approvalKey);
  assert.deepEqual(await service.followUp(staff,id,plan,approvalKey),saved);
  const afterRotation=createService(db,()=>new Date('2026-09-16T08:00:00Z'),{aiEnv:{...env,GROQ_API_KEY:'rotated-test-key'}});
  assert.deepEqual(await afterRotation.followUp(staff,id,plan,approvalKey),saved,'successful retries survive proof expiry and key rotation');
  const after=await service.detail(staff,id);
  assert.equal(after.salesCase.version,body.expectedVersion+1);
  assert.equal(after.salesCase.followUp,null);
  assert.equal(after.tasks.length,detail.tasks.length+1);
  assert.equal(after.tasks.find(task=>task.id===saved.taskId).description,plan.description);
  const approvalEvents=after.activities.filter(event=>event.action==='다음 진행 승인');
  assert.equal(approvalEvents.length,1);
  assert.equal(approvalEvents[0].payload.source,'ai-reviewed');
  assert.deepEqual(approvalEvents[0].payload.aiSource,{provider:'groq',model:result.model,generatedAt:result.generatedAt});
  assert.ok(!JSON.stringify(approvalEvents[0]).includes(result.aiSource.proof),'audit keeps provenance without the reusable proof');

  // Existing manual review remains usable without inventing AI provenance.
  await service.addNote(staff,id,{body:'기존 견적 업무를 계속 진행합니다.',expectedVersion:after.salesCase.version},randomUUID());
  const manualVersion=(await service.detail(staff,id)).salesCase.version;
  await service.followUp(staff,id,{expectedVersion:manualVersion,stage:'제안·협의',situation:'기존 업무 유지',createTask:false,confirmed:true},randomUUID());
  const manualEvent=(await service.detail(staff,id)).activities.find(event=>event.action==='다음 진행 승인'&&event.payload.source==='rules-reviewed');
  assert.ok(manualEvent);
  assert.equal(manualEvent.payload.aiSource,undefined);
});
