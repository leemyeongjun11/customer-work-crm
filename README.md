# 고객 업무 관리 CRM

서비스 기업의 신규 상담부터 계약·서비스 제공까지, 담당자별 다음 행동과 기한을 관리하는 AI 리빙랩 프로젝트입니다. 현재 단계는 **6차 구축 및 검수 — 6.1 MVP 구축 중**입니다. [6차 구축·검수 계획](docs/06-build-and-acceptance.md)

**실제 저장 검수:** <http://127.0.0.1:4180/live>. 로그인·권한·상담 접수·담당자/기한 배정·결과 기록·다음 행동과 메모를 서버에 저장합니다. [첫 구현 실행·검수 안내](docs/06a-first-working-slice.md)

추가 구현: 고객 정보 수정, 영업 단계 변경, 담당자 변경·종료 전 영향 확인과 확정. [두 번째 구현 검수 안내](docs/06b-case-management-review.md)

알림 구현: 다음 행동 누락 감지, 영업일 알림 예약·처리, [검수용 수신함](http://127.0.0.1:4180/live/notifications). 실제 이메일은 보내지 않습니다. [알림 구현·검수](docs/06c-notification-automation.md)

운영 기능: 관리자 기본 담당자·회사 휴일 설정, [첫 연락 성과](http://127.0.0.1:4180/live/metrics)와 집계 근거. [운영 기준·성과 검수](docs/06d-operations-and-metrics.md)

외부 문의: 서명 수신·중복 방지·원문 보존·실시간 갱신·누락 복구 처리 엔진 구현. 실제 Emergent 연결은 아직 비활성입니다. [실시간·복구 검수](docs/06f-realtime-and-recovery.md)

백업 구현: 관리자 [운영 기준](http://127.0.0.1:4180/live/settings)에서 회사별 암호화 백업 생성과 별도 DB 복원 검증. [백업·복원 안내](docs/06g-backup-and-restore.md) · [6차 전체 진행 현황](docs/06-progress.md)

최신 구현: [직원 계정](http://127.0.0.1:4180/live/accounts)에서 등록된 직원의 사용 중지·재개, 인계 전 확인과 변경 이력을 제공합니다. [계정 관리 안내](docs/06h-staff-account-status.md)

배포 준비: [PostgreSQL 전용 검사와 CI 구성](docs/06i-postgres-ci-preparation.md)을 추가했습니다. 실제 PostgreSQL 검사는 전용 DB·GitHub 실행 대기이며 로컬 43개 검사 통과와 별도로 관리합니다.

문의 연동 추가: [회사별 조회와 60초 누락 확인](docs/06j-emergent-export-polling.md)을 구현했습니다. 이후 전체 로컬 검사는 46개 통과했습니다. 실제 Emergent 주소·인증 정보가 없어 외부 조회는 비활성입니다.

**기존 프레임 검수:** <http://127.0.0.1:4173/review>. 사용자가 검수 완료 후 6차 진행을 요청했으며, 현재 수정된 화면과 shadcn 기본 테마를 초기 구축 기준으로 사용합니다. 브라우저에 기록된 52개 PC/모바일 검수 선택값은 그대로 유지합니다. [전체 화면 검수와 모바일 접속 안내](docs/05b-full-frame-review.md)

프런트엔드는 **React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui**를 사용합니다. 프레임에서는 Neutral 기본 테마(라이트)와 New York 컴포넌트 스타일을 적용합니다. [UI 기술·테마 기준](docs/05a-ui-stack-theme.md)에 설정을 기록했습니다.

## 바로 실행하기

Node.js 24와 pnpm 11.19.0을 사용하는 프로젝트입니다. 프로젝트 폴더의 **터미널**에서 실행합니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

브라우저에서 <http://127.0.0.1:5173>을 엽니다. 개발 서버는 이 컴퓨터에서만 접근하도록 설정했습니다. 종료는 실행한 터미널에서 `Ctrl+C`입니다.

```powershell
pnpm check
```

위 명령은 타입 검사, 업무 규칙·배포 승인 검사·API 통합 테스트, 웹 빌드를 실행합니다. `pnpm build` 결과는 `apps/web/dist`에 생성됩니다.

실제 저장 버전은 웹 빌드 후 `pnpm live:setup`으로 로컬 계정을 만들고 `pnpm live`로 실행합니다. 계정 정보는 `.local-data/access.txt`에 저장되며, 이후 실행은 `pnpm live`만 사용합니다. DB는 `.local-data/postgres`에 보존됩니다. setup은 서버 실행 전에 한 번 수행합니다.

Windows에서 검수 서버를 숨김 백그라운드로 실행하려면 PowerShell에서 `./scripts/start-live.ps1`을 실행합니다. 이미 실행 중이면 중복 시작하지 않으며, 실행 기록은 `.local-data/live-server.out.log`와 `.local-data/live-server.err.log`에 남습니다. 컴퓨터 재시작 후에는 다시 실행해야 합니다. 운영 배포나 자동 부팅 서비스는 아닙니다.

빌드한 목업을 PC에서 확인할 때는 `pnpm --filter @crm/web preview`를 실행하고 <http://127.0.0.1:4173/review>를 엽니다.

같은 Wi-Fi에 연결한 휴대폰에서 확인할 때는 다음 명령을 사용합니다.

```powershell
pnpm build
pnpm --filter @crm/web preview:mobile
```

출력된 Wi-Fi `Network` 주소의 `/review`를 엽니다. 현재 주소는 <http://172.30.1.69:4174/review>이며 네트워크 변경 시 달라질 수 있습니다. PC와 서버가 켜져 있어야 합니다. 인터넷 공개 배포가 아닙니다.

## 기존 프레임에서 확인할 수 있는 것

- 오늘 할 일: 기한 초과 / 오늘 업무 / 확인 필요, 별도의 예정 업무 보기
- 첫 연락 결과 기록, 업무 완료·취소, 기한 변경과 사유 기록
- 단계별 영업건 목록, 고객 상세, 상담 메모와 변경 이력
- 이메일 초안 검토, 종료·담당자 변경 영향 확인
- 검수 도구: 신규 문의 도착, 빈 화면, 저장 실패, 발송 실패, 연결 지연, 역할별 화면
- 접수·로그인·초대·재설정, 자료 선택/미리보기, 메모·업무 제목 수정
- 알림 본문, 첫 연락 성과, AI 변경 근거·되돌리기, 실행 결과와 복구
- 사용자·운영 기준·외부 연동 관리, 공통 오류 상태와 모바일 전체 메뉴
- 52개 항목의 검수 진행률·수정 의견·JSON 내보내기·단계 완료 조건

**위 목록은 기존 프레임의 가상 데이터 시연입니다.** 프레임 기준 시각은 2026-09-14 월요일 15:00 KST로 고정했습니다. 프레임 업무 데이터는 새로고침하면 초기화됩니다. 별도 `/live` 구현은 실제 DB·인증을 사용하며 현재 시각과 저장 데이터를 표시합니다. 실제 이메일·AI·Emergent는 두 화면 모두 연결 전입니다. 예시 데이터로 검수합니다.

## 프로젝트 구성

```text
apps/web/          React + Tailwind CSS + shadcn/ui 화면과 검수 도구
apps/api/          로컬 인증·권한·접수·업무·메모 API 및 저장/권한 테스트
apps/worker/       로컬 검수 알림 처리 실행 모듈 (API와 같은 프로세스)
apps/scheduler/    영업일 알림 예약 실행 모듈 (API와 같은 프로세스)
packages/domain/  검수용 업무 규칙·가상 데이터·테스트
docs/             단계별 결정사항·API·검수 기록
infra/railway/    Railway 서비스 설정과 배포 연결 안내
scripts/          인프라·승인·릴리스 검사 도구
.github/workflows/ CI 및 승인 후 배포 흐름
```

기존 프레임의 상태 모델과 실제 API는 구분합니다. `/live`에서는 서버 인증·트랜잭션·중복 방지·권한 검사를 수행합니다. 기존 4차 전체 계약과 외부 연동, 운영 배포는 후속 구현 대상입니다.

## 문서와 다음 작업

[전체 문서 목차](docs/00-project-index.md) → [통합 결정 기록](docs/decision-log.md) → [이번 검수 안내](docs/05-ui-design-review.md)

사용자 요청에 따라 6차 **MVP 구축 → 검수·안정화 → 배포(CI/CD) → 추가 구축**으로 진행합니다. 현재 화면과 기본 테마를 구축 기준으로 삼고 피드백을 계속 반영합니다. 여덟 번째 구현 단위까지 전달했으며 전체 MVP·운영 검수 완료는 아닙니다. Railway 배포는 아직 연결되지 않았습니다. 운영 배포는 GitHub에서 본인이 승인한 이후에만 가능하도록 한 기존 원칙을 유지합니다.
