# 핵심 업무 API 계약 v1

2026-09-12. 상태: 인터뷰에서 결정한 업무 정책과 구현용 API 계약 정리. 실제 서버 구현·연결 검증 전.

## 1. 이번에 결정한 업무 정책

| 항목 | 기준 |
|---|---|
| AI의 관리 범위 | 해당 회사 전체 영업건. 담당자가 달라도 관리 가능 |
| AI가 직접 반영 | 영업 기록·상담 요약·다음 행동·업무 규칙에 맞는 기한 |
| 날짜 없는 후속 업무 | 업무를 등록하되 기한 확인 필요. 담당자가 기한 결정 |
| 영업건 종료 | AI는 제안, 권한 있는 직원 확인 후 종료 |
| 기존 담당자 변경 | AI는 제안, 담당자 변경 권한이 있는 직원 확인 후 변경 |
| 새 문의 담당자 | 기존 지정 전담 직원으로 자동 배정 |
| 고객 후속 발송 | 직원 승인 후 실행 |
| 사용자·권한·시스템 설정 | AI 변경 금지 |

아래 경로와 필드명은 위 정책을 구현하기 위한 기술 설계다. 현재 존재하는 Emergent API를 그대로 기록한 것은 아니다. 이 문서는 핵심 영업 API에 대해 이전 초기안의 권한·필드 설명보다 우선한다. 파일·인증 공급자·메일 제공자별 실제 연결 계약은 별도 보완 대상이다.

## 2. 공통 규칙

- 외부에서 호출하는 핵심 업무 경로는 `/api/v1` 아래에 둔다. Web 프록시가 첫 `/api`만 제거하므로 내부 API 경로는 `/v1/...`이다. 신규 문의 Webhook·SSE·운영 상태 경로는 기존 별도 연동 명세를 유지한다.
- 직원은 인증된 세션, AI는 별도 서비스 자격증명을 사용한다. 인증 서비스 제품·토큰 발급 방식은 미정이다. 기업·사용자·역할은 검증된 인증 정보로 결정한다. 본문의 `tenantId`, `actorRole`, `approvedBy`로 권한을 부여하지 않는다.
- 역할: 관리자, 일반 직원, `sales_agent`, 내부 자동 실행기. 관리자와 AI의 회사 자동 관리는 해당 회사 전체, 일반 직원은 자신의 담당 영업건을 대상으로 한다. AI가 직원 요청을 대행할 때는 그 직원 권한도 적용한다.
- 담당자 변경 권한은 초기 관리자에게만 부여하는 구현 기준이다. 향후 별도 위임 권한을 추가하더라도 AI에는 부여하지 않는다.
- 생성·변경·승인 요청에는 `Idempotency-Key`를 요구한다. 서버는 기업·호출자·작업·대상별로 키를 구분한다. 같은 키/내용의 재요청은 기존 결과, 같은 키/다른 내용은 409다.
- 기존 기록 변경에는 `expectedVersion`을 요구한다. 승인 대상에는 상담과 제안 버전을 모두 검사한다. 다른 변경이 있었다면 409로 돌려주고 다시 확인하게 한다.
- 정의되지 않은 필드와 허용되지 않은 보호 필드는 거부한다. `PATCH /cases/{id}`나 `PATCH /tasks/{id}`에 담당자·종료 상태를 섞어 보내 승인 절차를 우회할 수 없다.
- DB에는 업무 변경·감사 이력·후속 작업 요청을 함께 저장한다. 이메일 요청 202는 발송 완료를 뜻하지 않는다.
- API는 camelCase 필드를 사용한다. 기존 설계의 `due_at`, `deadline_status`는 각각 API의 `dueAt`, `deadlineStatus`에 대응하는 저장소 표기다.
- 날짜는 시간대가 포함된 문자열이다. 실제 연락 시각과 서버 입력 시각을 분리한다. 첫 연락 기한은 원래 접수 시각 및 기존 영업일 규칙으로 서버가 계산한다.

## 3. 최소 데이터

| 대상 | 필수 데이터와 기본값 |
|---|---|
| 상담 | `id`, `source`, `sourceInquiryId`(외부 접수), `sourceReceivedAt`, 원문, CRM 고객 수정본, `assigneeId`, `stage`, `version` |
| 고객 수정본 | 개인/기업 구분, 이름/업체명, 연락처, 이메일, 요청 메모. 기업이면 고객 담당자명. 회사 규모는 선택 |
| 업무 | `id`, `caseId`, `title`, `assigneeId`, `status`(incomplete/complete), `dueAt`, `deadlineStatus`, `version` |
| 기한 | `deadlineStatus=known`이면 `dueAt`과 `deadlineBasis` 필수. `needs_confirmation`이면 `dueAt=null` |
| 기한 근거 | `deadlineBasis`는 customer/staff/policy. 근거 기록 또는 적용한 정책 버전 연결. AI가 없는 날짜를 추정한 값은 기한으로 확정하지 않음 |
| 변경 제안 | `id`, `caseId`, `type`, `reason`, `evidenceRefs`, 대상 상담 버전, pending/approved/rejected 상태 |

AI의 새로운 할 일은 기본적으로 해당 영업건 담당자에게 배정한다. 다른 담당자를 지정하려면 담당자 변경 절차를 거친다. 일반 후속 업무의 첫 기한이 뒤늦게 확정되면 그 값을 최초 기한으로 기록하고 이후 변경 이력을 남긴다. 첫 연락의 원래 기한은 접수 때부터 존재하며 변경으로 지연 실적을 지우지 않는다.

## 4. 조회와 내부 업무 수정

| 요청 | 호출자 | 입력 | 결과 |
|---|---|---|---|
| `GET /workboard` | 직원·AI | `view=today/upcoming`, 선택 기준일 | 200: overdue/today/needsReview 구역별 업무, 건수. 완료 업무는 제외 |
| `GET /cases` | 직원·AI | 검색어·단계·cursor·limit | 200: 권한 범위 내 목록, nextCursor |
| `GET /cases/{id}` | 직원·AI | 상담 ID | 200: 고객 수정본·원문·현재 업무·연락·제안·이력 |
| `PATCH /cases/{id}` | 직원·AI | 허용된 고객 수정 필드, expectedVersion, 변경 사유 | 200: 새 수정본·version. 원문·담당자·단계·접수 시각은 이 경로에서 변경 불가 |
| `POST /cases/{id}/notes` | 직원·AI | `body`, AI이면 유효한 근거 연결 | 201: 메모·version. 직원 메모 새 버전은 AI 작업 등록 |
| `PATCH /notes/{id}` | 직원·AI | body·expectedVersion·변경 이유 | 200: 새 버전. 직원은 기존 권한, AI는 자신이 만든 정리 기록만 수정 |
| `POST /cases/{id}/tasks` | 직원·AI | title, dueAt, deadlineStatus, 날짜가 있으면 deadlineBasis·근거 | 201: 담당자 자동 연결, 미완료 업무 생성 |
| `PATCH /tasks/{id}` | 직원·AI | title/기한/다음 확인 날짜 중 허용 필드, expectedVersion·변경 이유 | 200: 새 업무·version·기한 이력. 담당자·완료·제외를 이 경로에서 변경 불가 |
| `POST /cases/{id}/contacts` | 직원·검증된 근거를 가진 AI | taskId, 연락 결과, 실제 시각, 선택 메모, expectedVersion | 201: 연락 이력과 갱신 업무. 통화 연결 또는 통화 부재 후 안내 문자 발송이 확인돼야 첫 연락 수행 완료 |
| `POST /tasks/{id}/complete` | 직원·검증된 근거를 가진 AI | 실제 수행 시각, expectedVersion, AI이면 실행 근거 참조 | 200: 완료·이력. 제안/초안만으로 완료 불가 |
| `POST /tasks/{id}/reopen` | 권한 있는 직원 | expectedVersion·취소 이유 | 200: 미완료 복원. 발송된 메일을 취소한 것으로 표시하지 않음 |
| `POST /tasks/{id}/exclude` | 권한 있는 직원 | expectedVersion·제외 이유 | 200: 관리 제외. 완료 실적에 포함하지 않음 |

AI가 저장한 요약을 다시 직원 메모로 오인해 AI 분석을 무한 등록하지 않는다. 서버가 검증한 수행자·이벤트 출처를 사용해 동일 원문 버전당 분석 요청을 중복 제거한다. 직원 원문을 AI가 덮어쓰지 않고 별도 요약 기록을 생성하는 기준으로 구현한다.

날짜 미정 업무는 `needsReview`에 표시하며 overdue로 계산하지 않는다. 이미 고객과 약속했거나 직원이 확정한 날짜와 충돌하는 AI 변경은 적용하지 않고 검토 대상으로 남긴다. 조회 limit은 기본 50, 최대 100으로 제한하는 구현 제안이다.

## 5. 승인 대상 작업

| 요청 | 호출자 | 입력 | 결과 |
|---|---|---|---|
| `POST /cases/{id}/change-proposals` | 직원·AI | type(close/reassign), reason, evidenceRefs, caseVersion, 재배정이면 proposedAssigneeId | 201: pending 제안. 실제 상태·담당자·알림 변경 없음 |
| `GET /change-proposals/{id}/preview` | 제안 접근 권한이 있는 직원·AI | 제안 ID | 200: 변경 전후, 남은 업무, 알림 영향, 최신 caseVersion·proposalVersion |
| `POST /change-proposals/{id}/approve` | 종료는 해당 상담 처리 권한이 있는 직원, 재배정은 관리자 | expectedCaseVersion, expectedProposalVersion, 확인한 변경 내용 | 200: 승인과 실제 변경을 함께 저장. 이미 처리됐거나 버전이 다르면 충돌 |
| `POST /change-proposals/{id}/reject` | 해당 승인 권한이 있는 직원 | expectedProposalVersion·이유 | 200: rejected. 상담·업무는 유지 |
| `POST /cases/{id}/stage` | 직원·허용된 AI | 새 단계, expectedVersion, 단계 변경 근거 | 200: 허용된 비종료 단계 변경. AI가 closed/service_complete를 직접 보내면 승인 필요 오류 |
| `POST /cases/{id}/email-drafts` | 직원·AI | to, subject, body, 선택 attachmentIds·taskId | 201: 초안·version. 발송하지 않음 |
| `PATCH /email-drafts/{id}` | 직원·AI | 초안 허용 필드, expectedVersion | 200: 새 초안 버전. 기존 승인 내용이 바뀌면 재승인 필요 |
| `POST /email-drafts/{id}/send` | 해당 상담 접근 권한이 있는 직원 | 승인한 초안 버전 | 202: 고정된 승인 내용·jobId·queued. 실제 발송은 Worker가 수행 |

`change-proposals`는 종료·담당자 변경 전용이다. 이전 초기안의 일반 `proposals` 승인 API나 상담 PATCH로 이 권한 검사를 우회할 수 없다. 계약 후 서비스 완료도 기존의 남은 업무 확인 절차를 유지하며 실제 완료 단계 전환은 권한 있는 직원 확인을 요구한다.

승인 API는 사람의 인증 세션을 검사한다. AI가 `approved=true` 또는 임의 직원 ID를 보내도 사람 승인으로 인정하지 않는다. 승인 대기 동안 담당자·업무 상태·알림은 그대로 유지한다.

재배정 preview는 변경될 담당자와 관련 미완료 업무를 보여준다. 초기에는 영업건 한 명의 담당자를 기준으로 관리하므로 확인된 재배정은 해당 영업건의 미완료 업무 담당자도 함께 변경하는 구현 기준으로 둔다. 완료 이력의 실제 수행자는 바꾸지 않는다. 비활성 직원·다른 회사 직원은 대상이 될 수 없다. 새 문의의 정책 기반 최초 배정은 이 승인 API와 별도의 서버 내부 처리다.

종료는 남은 미완료 기록을 보존하면서 향후 업무 알림을 중단한다. 이미 발송 중인 외부 요청까지 취소됐다고 표시하지 않는다. 이메일 발송 승인도 실행 직전 종료·중복·승인 버전을 다시 확인하고, 실제 성공이 확인돼야 연결된 발송 업무를 완료한다.

## 6. 시스템 영역과 외부 API

- `/admin/users`, `/admin/settings`, 역할·권한·연동 비밀값·운영 예산 변경은 관리자용이며 AI 자격증명은 거부한다.
- `/jobs/{id}` 조회는 연결 업무의 권한을 따른다. 자동 재시도는 기존 정책으로 실행기가 수행한다. 최종 실패의 수동 해결·수동 재실행은 직원용 경로다.
- Emergent 문의 수집은 [실시간 문의 계약](04c-emergent-realtime-ingestion.md)을 따른다. 직원/AI 업무 토큰을 외부 Webhook 인증 대신 쓰지 않는다.
- AI 도구는 위 API의 허용된 일부 기능에만 연결한다. 범용 URL 호출·임의 SQL·관리자 토큰을 제공하지 않는다.
- 파일 API의 허용 형식·용량, AI 모델 API와 도구 공급자별 인증·호출 제한, 직원 로그인 제품은 아직 선정 전이다. 해당 연결은 실제 API 확인 후 별도 명세를 완성한다.

## 7. 응답과 오류

성공 응답은 `{ "data": ..., "requestId": "..." }`, 오류는 `{ "error": { "code": "...", "message": "...", "fields": [] }, "requestId": "..." }` 형식이다.

| HTTP | 코드 | 동작 |
|---|---|---|
| 401 | UNAUTHENTICATED | 로그인/서비스 인증 확인. 재인증이 미승인 외부 작업의 자동 승인이 되지 않음 |
| 403 | FORBIDDEN | 회사·역할·작업 권한 위반 차단 |
| 403 | HUMAN_APPROVAL_REQUIRED | AI의 종료·담당자 변경·후속 발송 직접 실행 차단, 제안/초안 경로 안내 |
| 404 | NOT_FOUND | 없거나 접근할 수 없는 기록. 다른 회사 정보 유출 방지 |
| 409 | VERSION_CONFLICT | 최신 내용 재조회 후 재판단 |
| 409 | IDEMPOTENCY_CONFLICT | 같은 키의 다른 요청 거부 |
| 422 | VALIDATION_ERROR | 필수값·날짜 조합·허용되지 않은 필드 오류 |
| 422 | EVIDENCE_REQUIRED | 실제 수행 근거 없는 완료·상태 변경 거부 |
| 429 | RATE_LIMITED | 서버가 안내한 재시도 시각까지 대기 |
| 503 | TEMPORARY_FAILURE | 저장 결과·중복 키 확인 후 제한된 재시도 |

예시: AI가 기한 없는 후속 업무 생성 시 요청 body:

```json
{
  "title": "견적서 준비 후 전달",
  "dueAt": null,
  "deadlineStatus": "needs_confirmation",
  "evidenceRefs": ["접근_가능한_상담메모_ID"]
}
```

서버는 접근 가능한 상담 ID와 인증된 AI 실행 맥락을 검증하고 현재 상담 담당자를 연결한다. 임의 고객 ID·기한·승인자를 모델이 출력했다고 그대로 저장하지 않는다.

## 8. 구현 후 확인할 사항

전체 영업건 접근과 타 기업 접근 차단, 직원 대행 권한 제한, 날짜 미정 업무 표시, 실제 근거 없는 완료 차단, 종료/재배정 제안만으로 원본이 변경되지 않는지, 승인자 권한·대상 버전 검증, 일반 PATCH를 통한 승인 우회 차단, 중복 승인·동시 수정, CRM 수정본의 원문 재수신 후 보존을 검증한다.

현재 완료된 것은 핵심 업무 API의 권한·처리 계약 정리다. 서버 구현이나 실제 인증·외부 API 연결을 테스트했다고 의미하지 않는다. 파일·인증·외부 도구의 공급자별 세부값까지 포함한 전체 API 명세 확정과 구분한다.
