# 6차 진행 현황

갱신: 2026-09-13. **6.3 시험 환경 자동 배포와 공개 주소 기능 검수가 완료**됐다. 6.1의 실제 외부 연동과 6.2의 전체 운영 검수는 아직 남아 있으며, 단계 전체가 완료됐다는 의미는 아니다.

남은 작업은 [첫 배포까지의 여섯 묶음](06-first-release-checklist.md)으로 고정해서 관리한다.

| 순서 | 현재 위치와 남은 일 |
|---|---|
| 6.1 MVP 범위 구축 | 핵심 CRM 저장·권한·변경 확인·누락 감지·로컬 알림·운영 기준·첫 연락 성과 구현. 실제 이메일·Emergent·AI 제공자 연결, 추가 운영 기능은 미완료 |
| 6.2 검수 및 안정화 | 구현 단위마다 자동/화면 검수 진행. 로컬 백업·별도 DB 복원 검사 완료. 외부 연동 포함 전체 시나리오·부하·운영 PostgreSQL 백업/복구·동시 접속 검수는 남음 |
| 6.3 배포(CI/CD) | 시험용 PostgreSQL 영구 볼륨·HTTPS 주소·초기 계정·GitHub Secrets 연결 완료. 웹/API/worker/scheduler의 컨테이너 검수 통과. staging 자동 배포·공개 주소의 로그인/접수/연락 저장/SSE/로그아웃 검수 완료. 운영 준비와 본인 승인 후 production 배포는 남음 |
| 6.4 추가 구축 | 첫 MVP 전체 검수·배포 후 진행 |

## 구현·검수된 단위

- [첫 구현](06a-first-working-slice.md): 로그인, 관리자/직원 권한, 접수와 담당자/기한, 업무·연락·메모·이력 저장.
- [두 번째 구현](06b-case-management-review.md): 고객 수정본/원문, 단계 변경, 관리자 재배정, 종료 전 영향 확인과 승인.
- [세 번째 구현](06c-notification-automation.md): 다음 행동 누락, 접수 알림 등록, 영업일 예약, 재검증·중복/실패 처리, 검수용 수신함.
- [네 번째 구현](06d-operations-and-metrics.md): 관리자 기본 담당자·휴일 설정과 변경 이력, 원래 기한 기준 첫 연락 성과와 집계 근거. 자동 검사 30개 통과.
- [다섯 번째 구현](06e-external-inquiry-ingestion.md): 외부 문의 서명 수신, 회사별 중복 방지·원문 보존·원래 접수 시각 적용·원자적 저장. 전체 자동 검사 33개 통과. 실제 Emergent 연결·즉시 화면 갱신·누락 보충은 남음.
- [여섯 번째 구현](06f-realtime-and-recovery.md): 영속 변경 기록·SSE·재접속·입력 유지·장애 시 조회 전환, 누락 복구 처리 엔진·커서·오류 목록·관리자 연결 상태 화면. 자동 검사 38개 통과. 다섯 번째 전달에서 남았던 화면 갱신과 복구 내부 처리를 구현했으며 실제 외부 조회·60초 예약 연결은 남음.

- [일곱 번째 구현](06g-backup-and-restore.md): 관리자 회사별 암호화 백업 생성·중복 방지·새 DB 실제 복원 검사·세션 제외·대기 알림 보류 구현. 전체 자동 검사 **41개**, 타입 검사와 웹 빌드 통과. 운영 PostgreSQL과 원격 저장소의 재해 복구는 남음.

- [여덟 번째 구현](06h-staff-account-status.md): 관리자 직원 목록·인계 전 확인·사용 중지/재개·세션 폐기·변경 이력 구현. 전체 로컬 자동 검사 **43개**와 웹 빌드 통과. 임시 회사로 UI 중지/재개 검수 및 이전 실제 백업의 새 구조 복원 확인. 신규 초대·메일 인증·관리자 계정 흐름은 연결 전이다.

배포 검사 준비: PostgreSQL 전용 동시 접속 테스트와 GitHub 서비스 컨테이너 검사 job, 실제 `scripts/ci-app.sh`를 추가했다. 두 워크플로 YAML과 job 의존성·JS/Bash 문법·인프라 설정을 검증했다. 로컬 Docker·전용 PostgreSQL·원격 GitHub 실행이 없어 해당 DB 검사는 실행 대기다. 설정 미지정 시 실패하도록 확인했으며 로컬 성공 건수에 포함하지 않는다. [준비 상태와 실행 조건](06i-postgres-ci-preparation.md)

- [문의 조회 연결 추가](06j-emergent-export-polling.md): 회사별 HTTPS/Bearer 조회·크기/시간 제한·오류 처리, 60초 주기 실행·겹침 방지·종료 대기 구현. 전체 로컬 검사 **46개**, 타입 검사·웹 빌드 통과. 실제 Emergent 주소·토큰이 없어 외부 조회는 비활성이다.

## 연결 대기

최신 시험 배포 갱신: [클라우드 런타임](06l-staging-runtime.md)을 PR #3으로 staging에 반영했다. 로컬 검사 52개·타입·웹 빌드 및 GitHub의 실제 PostgreSQL 검사, 네 컨테이너 기동·로그인·접수·연락 완료·API 재생성 후 데이터 유지 검사가 통과했다. 시험 DB는 싱가포르 1개 인스턴스와 500MB 영구 볼륨으로 실행 중이다. 사용자가 배포 토큰과 상태 조회 토큰의 GitHub 암호화 저장을 각각 허용했으며 두 Secrets와 시험 배포 변수를 등록했다. [자동 배포 실행](https://github.com/leemyeongjun11/customer-work-crm/actions/runs/34716286686)은 3번째 시도에서 성공했다. 미배정 작업 재시도 후 Railway 기본 빌드 설정 문제를 확인해 시험 서비스에 Dockerfile·상태 확인 설정을 반영했다. 배포 커밋은 e12e6f6ad1d9258292eaf98a5c16b248c0ff9cdb이며 공개 HTTPS에서 Secure 로그인, 예시 접수, 연락 완료 저장, 재조회, SSE 연결, 로그아웃 후 세션 무효화를 확인했다. 웹·API·worker·scheduler 및 DB가 실행 중이다. 운영 배포는 비활성 상태다. 아래의 미연결·빈 서비스 표현은 이전 작업 당시의 기록이다.

GitHub 준비 갱신: 비공개 저장소 `leemyeongjun11/customer-work-crm`의 main/staging에 초기 커밋 `e9a9e0a6ee4d68344dd1085d8d2978a37311ea18` 업로드와 원격 워크플로 등록을 확인했다. 2026-09-13 staging에서 [첫 CI 실행](https://github.com/leemyeongjun11/customer-work-crm/actions/runs/34712562594)을 요청했다. 배포 활성화 변수는 설정되지 않았다.

첫 CI 최종 결과: `infrastructure`·`ui`·`postgres`가 모두 성공했다. 기존 46개 검사·타입 검사·웹 빌드에 더해 PostgreSQL 17의 별도 연결을 통한 중복 수신·동시 수정·Worker 경합·복원 호환 검사도 실제 실행을 통과했다. 위 PostgreSQL 실행 대기 기록은 준비 당시의 이력이며 이 실행으로 갱신한다. `application` 컨테이너 빌드·`staging` 배포·`production` 배포는 비활성 조건으로 건너뛰었다. 따라서 첫 CI 성공은 운영 이미지나 실제 배포 검증을 뜻하지 않는다.

Railway CLI 5.54.0을 `.local-data/railway-tools`에 설치하고 브라우저 로그인 승인 후 기존 `balanced-balance` 프로젝트의 staging에 연결했다. CLI로 staging/production 각각 web·api·worker·scheduler가 모두 싱가포르·복제본 1개임을 확인했다. 이전 SFO 대기 변경 확인도 이 조회로 해소했다. 식별자만 `infra/railway/targets.json`에 기록하고 로그인 비밀값은 기록하지 않는다. `scripts/check-railway-state.ps1`로 반복 확인할 수 있다. 서비스에 앱 코드가 배포된 상태는 아니다. Railway PostgreSQL·발신 메일·실제 외부 연동은 아직 미연결이다.

GitHub 승인 제약과 변경: 원격 Environments는 0개이며 rulesets 조회가 요금제 제한으로 거부됐다. 이후 사용자가 **비공개 유지·본인 수동 운영 배포 실행**으로 변경하는 데 동의했다. [변경 명세](06k-owner-triggered-deployment.md)에 따라 전용 workflow와 본인·커밋·시험 배포 성공 검사를 구현했다. 기존 자동 운영 배포와 Environment 의존성을 제거했다. 로컬 전체 검사 50개·타입 검사·웹 빌드 및 actionlint 1.7.12 검사가 통과했다. 실제 운영 배포는 실행하지 않았다. 저장소 공개 전환이나 유료 업그레이드도 하지 않았다.

실제 연결 순서: GitHub 계정·저장소 준비 → Railway 계정과 staging/production 구성 → 발신 주소·메일 서비스 결정과 검수 수신함 연결 → Emergent API 연결 → AI 제공자·실행 범위와 비용 결정. 실제 비밀값은 Git에 저장하지 않는다. 원래의 GitHub 본인 승인 후 운영 배포 원칙을 유지한다.

AI는 전체 제품 요구사항에 남아 있다. 첫 배포의 구체 범위는 제공자 연결과 사용자 검수에 맞춰 확정하며, 임의로 구현 완료 또는 영구 제외로 표시하지 않는다.

## 진행 표현

‘이번 기능 검수 통과’는 해당 구현 단위만 뜻한다. ‘6.2 완료’는 합의한 MVP 전체의 외부 연동·안정성·사용자 검수까지 마친 경우에만 사용한다. ‘배포 완료’는 실제 배포 주소와 실행 상태를 확인한 뒤에만 사용한다.
