# 프레임 02 — 전체 화면 목록

이 목록은 `apps/web/src/frame/screens.ts`의 검수 목록과 같은 항목입니다. 갱신: 2026-09-12.

각 항목을 PC·모바일에서 확인하며, 정상 흐름 외에도 확인 내용에 적힌 실패·빈 상태·권한·입력 오류를 점검합니다. 상세 확인창은 URL로 바로 열 수 있습니다. 앞선 시연으로 예시 업무를 이미 처리했다면 새로고침하거나 검수 도구의 기본 상황으로 복원합니다.

모든 항목은 **사용자 검수 대기**입니다. 제작자 동작 검사는 [검증 기록](05b-full-frame-review.md#제작자-검증--사용자-검수와-별도)에 별도로 기록합니다.

| ID | 구역 | 화면·확인창 | 경로 | 확인 내용 |
|---|---|---|---|---|
| inquiry | 접수·계정 | 신규 상담 접수 | `/inquiry` | 개인/기업 필수 입력, 오류 시 입력 유지, 제출 후 접수 확인과 CRM 반영 |
| login | 접수·계정 | 로그인 | `/login` | 역할 선택과 로그인 실패 안내, 업무 화면 진입 |
| invite | 접수·계정 | 초대 수락 | `/account/invite` | 초대 회사와 역할 확인, 만료된 초대 안내 |
| password | 접수·계정 | 비밀번호 재설정 | `/account/reset` | 이메일 형식 검사와 요청 접수 안내 |
| session | 접수·계정 | 인증 만료 | `/review/states/session` | 작성 내용 보존 안내, 재로그인 경로 |
| today | 업무·영업건 | 오늘 할 일 | `/today` | 지연/오늘/확인 필요 구역, 초기 요청 한 줄, 완료 업무 제거 |
| upcoming | 업무·영업건 | 예정 업무 | `/today?view=upcoming` | 오늘 업무와 분리, 담당자와 기한 확인 |
| review | 업무·영업건 | 확인 필요 | `/today?view=review` | 기한 미정, 다음 행동 없음, 직원 승인 제안 구분 |
| cases | 업무·영업건 | 전체 영업건·검색 | `/cases` | 단계별 카드와 검색, 검색 결과 없음, 직원별 접근 범위 |
| archive | 업무·영업건 | 완료·종료 영업건 | `/cases?view=archived` | 서비스 완료와 종료 분리, 기존 기록 보존 |
| detail | 업무·영업건 | 상세·업무와 다음 행동 | `/cases/c3` | 고객 정보, 원문, 다음 행동, 완료 기록과 취소 |
| notes | 업무·영업건 | 상세·상담 메모 | `/cases/c3?tab=notes` | 메모 작성과 작성자·시간 표시 |
| history | 업무·영업건 | 상세·변경 이력 | `/cases/c9?tab=history` | 자동 처리와 직원 수행 구분 |
| files | 업무·영업건 | 상세·자료 | `/cases/c3?tab=files` | 파일 선택, 크기 오류, 목록과 미리보기, 빈 자료 안내 |
| service | 업무·영업건 | 서비스 진행 | `/cases/c5` | 계약 이후 업무·담당자·다음 확인 날짜 |
| closed | 업무·영업건 | 종료 상세 | `/cases/c8` | 알림 중단 안내, 기록 조회와 변경 제한 |
| contact | 처리·확인창 | 첫 연락 결과 기록 | `/today?frameForm=record&id=t1` | 연결/부재 후 문자/전화 시도, 실제 시각, 메모 없이 완료 |
| complete | 처리·확인창 | 업무 완료 | `/today?frameForm=record&id=t2` | 선택 메모와 완료 후 목록 갱신 |
| due | 처리·확인창 | 기한 변경 | `/today?frameForm=due&id=t2` | 기한과 이유 필수, 원래 기한 보존 |
| date | 처리·확인창 | 미정 기한 설정 | `/today?frameForm=due&id=t7` | 날짜 미정 안내와 사람이 날짜 결정 |
| task | 처리·확인창 | 다음 행동 등록 | `/today?frameForm=add-task&id=c3` | 단계별 업무 종류 선택, 상세 내용 선택·기타는 필수, 날짜 미정으로도 등록 |
| note | 처리·확인창 | 메모 작성 | `/today?frameForm=note&id=c3` | 빈 메모 차단, 저장과 초안 보관 |
| note-edit | 처리·확인창 | 상담 메모 수정 | `/cases/c3/edit-record?kind=note` | 이전 메모와 변경 이유, AI는 자신의 정리 기록만 수정 |
| task-edit | 처리·확인창 | 업무 제목 수정 | `/cases/c3/edit-record?kind=task` | 미완료 업무만 수정, 변경 이유와 이력 보존 |
| customer | 처리·확인창 | 고객 정보 수정 | `/today?frameForm=customer&id=c3` | 필수값·이메일·수정 이유, 접수 원문 보존 |
| stage | 처리·확인창 | 단계·서비스 완료·종료 변경 | `/today?frameForm=stage&id=c3` | 마지막 단계 선택 시 남은 업무 영향과 확인 |
| exclude | 처리·확인창 | 업무 제외 | `/today?frameForm=exclude&id=t2` | 제외 이유 필수, 삭제와 구분 |
| reopen | 처리·확인창 | 완료 취소 | `/today?frameForm=reopen&id=t8` | 취소 이유 필수, 보낸 이메일은 취소되지 않음 |
| draft | 처리·확인창 | 후속 이메일 초안 | `/today?frameForm=email-draft&id=t3` | 수신자·제목·본문을 직원이 검토 |
| send | 처리·확인창 | 이메일 발송 검토 | `/today?frameForm=approve&id=p1` | 발송 확인, 다음 회신 확인 날짜 선택 |
| close | 처리·확인창 | 종료 제안 확인 | `/today?frameForm=approve&id=p2` | 승인 전 상태 유지, 남은 업무와 알림 중단 확인 |
| reassign | 처리·확인창 | 담당자 변경 확인 | `/today?frameForm=approve&id=p3` | 관리자만 승인, 미완료 업무 승계 |
| reject | 처리·확인창 | 제안 제외 | `/today?frameForm=reject&id=p1` | 이유 필수, 원래 업무 유지 |
| defer | 처리·확인창 | 제안 다음 확인 | `/today?frameForm=defer&id=p1` | 다음 확인 날짜와 이유 |
| activity | 알림·자동화 | AI 활동 목록 | `/activity` | 처리자와 영업건 연결, 상세 근거로 이동 |
| audit | 알림·자동화 | AI 변경 상세·되돌리기 | `/automation/audit` | 근거와 전후 비교, 이유 확인, 후속 수정 충돌 시 차단 |
| notifications | 알림·자동화 | 알림 이메일 미리보기 | `/notifications` | 15시/16시30분 대상 구분, 영업건으로 이동 |
| performance | 알림·자동화 | 첫 연락 성과 | `/performance` | 100% 목표와 실제 값 구분, 분모와 제외 항목 확인 |
| jobs | 알림·자동화 | 실행 내역·결과 확인 | `/automation/jobs` | 대기/실행/성공/실패/인증/속도 제한/결과 불명, 안전한 재시도 |
| settings | 관리자 | 운영 기준 | `/settings` | 첫 연락·알림·AI 권한 설명 |
| settings-edit | 관리자 | 운영 기준 변경 | `/admin/policy` | 담당자·휴일 설정, 변경 이유와 영향 확인 |
| users | 관리자 | 사용자·권한·초대 | `/admin/users` | 초대 입력, 역할 변경, 비활성 확인, AI 접근 금지 |
| integrations | 관리자 | 외부 연동·AI 연결 | `/admin/integrations` | 연동 상태, 인증 만료, API 변경, 비용 한도, 복구 경로 |
| loading | 공통 상태 | 불러오는 중 | `/review/states/loading` | 배치 유지, 중복 조작 방지, 로드 완료로 전환 |
| empty | 공통 상태 | 데이터 없음 | `/review/states/empty` | 최초 접수 안내와 복구 경로 |
| save | 공통 상태 | 저장 실패·초안 유지 | `/review/states/save` | 입력 유지, 재시도 및 성공 안내 |
| forbidden | 공통 상태 | 권한 없음 | `/review/states/forbidden` | 관리자 문의와 접근 가능한 화면 이동 |
| missing | 공통 상태 | 없는 화면 | `/review/states/missing` | 404 안내와 목록 복귀 |
| conflict | 공통 상태 | 다른 사용자 수정·중복 처리 | `/review/states/conflict` | 최신 데이터 확인, 덮어쓰기 방지 |
| validation | 공통 상태 | 잘못된 데이터 | `/review/states/validation` | 필드 옆 안내와 입력값 유지 |
| rate | 공통 상태 | 요청 제한 | `/review/states/rate` | 재시도 예정 표시와 연속 실행 방지 |
| offline | 공통 상태 | 연결 지연 | `/review/states/offline` | 마지막 확인 시각, 기존 업무 조회, 다시 연결 |

총 52개 검수 항목. 프레임 전체 검수 → 수정·재검수 → UI 의사결정 → 테마 선택.
