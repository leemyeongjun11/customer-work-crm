# 프로젝트 문서 목차

정리일: 2026-09-13. 대상: 비개발자 학생이 가상의 서비스 기업 업무를 설계·구현하는 AI 리빙랩 프로젝트.

처음 사용하는 경우 [README의 사용 주소와 업무 흐름](../README.md)을 먼저 읽는다. 현재 `staging`에 실제 저장 CRM과 자동 배포를 연결했으며, 실제 AI·외부 발송·정식 운영 배포는 연결 전이다.

## 단계와 현재 위치

| 단계 | 산출물 | 상태 |
|---|---|---|
| 1. 문제 정의 | [사용자·병목·범위·자동화 경계·KPI](01-problem-definition.md) | 설계 기준 정리, 실제 기업 검증 전 |
| 2. 업무·데이터 분석 | [업무 흐름·데이터·상태](02-workflow-data-state.md) | 설계 기준 정리 |
| 3. UX/IA | [정보 구조·화면 목표·상태](03-ux-ia.md) | 기존 합의 정리 |
| 4. 구조·기능 명세 | 아래 4개 상세 문서 | 목표 설계와 실제 구현 범위를 구분하여 참고 |
| 5. UI 디자인 | [전체 프레임 02 및 검수 기록](05-ui-design-review.md) | 사용자 검수 완료 언급·6차 진행 동의, 현재 화면·기본 테마로 구축 |
| 6. 구축 및 검수 | [MVP·안정화·승인 배포·추가 구축](06-build-and-acceptance.md) | 핵심 CRM·다음 진행 안내·요청 연결과 시험 자동 배포 구현, 전체 운영 검수는 남음 |

5차 기술·테마 결정: [Tailwind CSS + shadcn/ui / 기본 테마 적용 기준](05a-ui-stack-theme.md).

최신 기능: [완료 후 다음 진행 안내와 같은 요청 연결](06n-follow-up-and-linked-requests.md). 현재 직원이 상황과 동일 요청 여부를 확인·승인하는 규칙 기반 기능이다.

AI 체험: [상담 후 업무 정리 시연](06m-ai-workflow-demo.md). 준비된 예시로 동작하며 실제 고객 DB에 저장하지 않는다.

시험 배포: [클라우드 실행 환경](06l-staging-runtime.md), [본인이 실행하는 운영 배포 절차](06k-owner-triggered-deployment.md). 실제 PostgreSQL 검사와 네 컨테이너 검사, GitHub Actions의 staging 자동 배포가 통과했다. [PostgreSQL CI 준비 기록](06i-postgres-ci-preparation.md)은 초기 준비 당시 문서다.

계정 관리: [직원 사용 중지·재개와 인계 확인](06h-staff-account-status.md). 문의 연동: [HTTPS 조회 어댑터와 60초 누락 확인](06j-emergent-export-polling.md)은 구현했지만 실제 Emergent 연결은 남아 있다.

남은 범위: [배포·운영 작업 목록](06-first-release-checklist.md). 시험 배포 완료가 전체 MVP와 운영 검수 완료를 의미하지는 않는다.

6차 현재 위치: [전체 진행 현황](06-progress.md), [누락 감지·알림 예약·검수 수신함](06c-notification-automation.md).

5차 전체 검수: [검수 방법·모바일 접속·단계 완료 조건](05b-full-frame-review.md), [52개 화면 목록](05c-screen-inventory.md).

4차 상세 문서:

- [시스템·API·배치·I/F·안정성 종합](04-system-api-batch-interface-spec.md)
- [Railway 확장 구조와 CI/CD](04b-railway-scalable-architecture.md)
- [Emergent 신규 문의 연동](04c-emergent-realtime-ingestion.md)
- [최신 핵심 API와 AI 권한](04d-core-api-contract.md)
- [Railway 실제 연결 준비](../infra/railway/README.md)

## 해석 우선순위

최신 사용자 지시 → [통합 결정 기록](decision-log.md)에서 확인한 최신 합의 → `04d` 핵심 API → `04c` 신규 문의 연동 / `04b` 구조 → `04` 초기 종합 명세 순으로 확인합니다. 같은 항목의 과거 표현이 다르면 최신 결정으로 적용하고 문서의 변경 기록을 남깁니다.

과거 `04b`·`04d`의 AI 직접 반영 정책은 실제 에이전트 연결을 목표로 한 설계입니다. 이후 사용자는 AI 구축을 보류하고 사용 흐름을 먼저 체험하기로 했습니다. **현재 구현**인 [AI 시연](06m-ai-workflow-demo.md)과 [다음 진행·요청 연결](06n-follow-up-and-linked-requests.md)은 직원이 내용을 확인하고 승인하는 방식이며 실제 AI를 호출하지 않습니다. 실제 에이전트의 자동 반영 권한은 연결 단계에서 최신 사용자 결정과 함께 재확인해야 합니다.

과거 문서의 “검수 제안”은 당시 검토하던 선택을 뜻합니다. 현재 승인·구현된 내용은 해당 기능의 최신 구현 문서와 검수 기록을 확인합니다.

## 구현과 문서의 차이

문서에는 운영 시스템의 목표·계약과 과거 검수 기록까지 포함됩니다. `/live`는 실제 인증·DB를 사용하는 CRM이며 Railway 시험 환경에서 사용할 수 있습니다. `/live/ai-demo`와 기존 `/review` 프레임은 별도의 가상 데이터 체험입니다. 실제 외부 연동·발송·AI·정식 운영 배포·성능 검증은 후속 대상입니다. 설계상 100% 목표나 5초 목표를 실측 성과로 표현하지 않습니다.
