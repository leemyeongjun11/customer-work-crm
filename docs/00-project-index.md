# 프로젝트 문서 목차

정리일: 2026-09-12. 대상: 비개발자 학생이 가상의 서비스 기업 업무를 설계·구현하는 AI 리빙랩 프로젝트.

## 단계와 현재 위치

| 단계 | 산출물 | 상태 |
|---|---|---|
| 1. 문제 정의 | [사용자·병목·범위·자동화 경계·KPI](01-problem-definition.md) | 설계 기준 정리, 실제 기업 검증 전 |
| 2. 업무·데이터 분석 | [업무 흐름·데이터·상태](02-workflow-data-state.md) | 설계 기준 정리 |
| 3. UX/IA | [정보 구조·화면 목표·상태](03-ux-ia.md) | 기존 합의 정리 |
| 4. 구조·기능 명세 | 아래 4개 상세 문서 | 설계와 배포 골격 존재, 실제 외부 연결 전 |
| 5. UI 디자인 | [전체 프레임 02 및 검수 기록](05-ui-design-review.md) | 사용자 검수 완료 언급·6차 진행 동의, 현재 화면·기본 테마로 구축 |
| 6. 구축 및 검수 | [MVP·안정화·승인 배포·추가 구축](06-build-and-acceptance.md) | 6.1 MVP 구축 중, [여덟 번째 구현](06h-staff-account-status.md)까지 전달 |

5차 기술·테마 결정: [Tailwind CSS + shadcn/ui / 기본 테마 적용 기준](05a-ui-stack-theme.md).

6차 최신 전달: [직원 사용 상태 관리](06h-staff-account-status.md). 남은 범위: [첫 배포 작업 목록](06-first-release-checklist.md).

배포 검사 준비: [PostgreSQL 동시 연결 검사와 CI 구성](06i-postgres-ci-preparation.md). 전용 DB·GitHub 실행 대기이며 통과 결과는 아직 없다.

문의 연동 추가: [HTTPS 조회 어댑터와 60초 누락 확인](06j-emergent-export-polling.md). 로컬 전체 46개 검사 통과, 실제 Emergent 연결 전.

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

특히 초기의 “AI 제안은 모두 승인”이라는 해석은 현재 기준이 아닙니다. 영업 기록과 근거 있는 다음 행동은 직접 반영하고, 고객 후속 발송·영업건 종료·담당자 변경은 직원 확인 절차를 따릅니다.

현재 대화 기록에서 선택지만 남아 의미를 복원할 수 없는 A/B 답변은 새로운 결정을 만들어 채우지 않았습니다. 기존 상세 명세에 정리된 기준을 사용하고, 이번 구현 선택은 별도로 “검수 제안”이라고 표시합니다.

## 구현과 문서의 차이

문서에는 운영 시스템의 목표·계약까지 포함됩니다. 기존 프레임 외에 `apps/api`와 `/live` 화면에 로그인·권한·접수·업무·메모의 서버 저장을 구현했습니다. 실제 외부 연동·발송·AI·Railway 배포·성능 검증은 후속 대상입니다. 설계상 100% 목표나 5초 목표를 실측 성과로 표현하지 않습니다.
