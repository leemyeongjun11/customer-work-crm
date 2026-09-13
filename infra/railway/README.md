# Railway / GitHub Actions 연결 안내

이 폴더는 **Railway 시험·운영 환경의 배포 설정**이다. 현재 web·api·worker·scheduler를 별도 서비스로 실행하고 PostgreSQL을 공유하는 시험 환경을 연결했다. 사용 주소와 기능 범위는 [프로젝트 README](../../README.md), 배포 검수 기록은 [시험 실행 환경](../../docs/06l-staging-runtime.md)을 참고한다.

2026-09-13 갱신: 앱 준비·staging 자동 배포는 활성화됐고 실제 PostgreSQL·컨테이너·실행 상태 검사를 통과했다. production 배포는 비활성이며 실제 AI·외부 발송·전체 운영 검수는 남아 있다. 로컬 PGlite 검수에서는 API·worker·scheduler가 한 프로세스에서 실행된다. 아래 본인 수동 운영 배포와 검증 절차를 유지하며 시험 배포 성공만으로 운영 준비가 끝났다고 판단하지 않는다.

## 파일

| 파일 | 용도 |
|---|---|
| `.github/workflows/ci.yml` | staging/main PR·push 검사와 staging 자동 배포 |
| `.github/workflows/deploy-railway.yml` | CI 성공 후 staging만 배포하는 재사용 workflow |
| `.github/workflows/deploy-production.yml` | 본인 수동 실행·현재 main·동일 소스의 시험 배포 성공 확인 후 운영 배포 |
| `infra/railway/{web,api,worker,scheduler}.json` | 서비스별 Dockerfile과 배포 준비 검사 |
| `infra/railway/services.json` | 배포 순서, 서비스 식별 변수, 고정 CLI 버전 |
| `scripts/check-infra.mjs` | 설정 일관성 및 앱 준비 검사 |
| `scripts/deploy-railway.mjs` | 선택 커밋의 추적 파일만 묶어 Railway에 배포 |
| `scripts/release-check.mjs` | 실제 실행 버전과 Worker/Scheduler 상태 확인 |
| `scripts/write-release.mjs` | 커밋·소스 내용·실행 번호로 배포 식별 파일 생성 |
| `scripts/check-production-approval.mjs` | 본인 수동 실행과 현재 main 확인. 불일치·재실행·조회 실패 시 중단 |
| `scripts/check-staging-release.mjs` | 실제 시험 환경의 동일 소스와 성공한 CI·배포 기록 확인 |

## 1. 실제 앱이 제공해야 하는 계약

단일 GitHub 저장소에서 다음 경로를 사용한다. 앱 구조가 다르면 서비스 목록, Railway 설정, 워크플로의 Docker 빌드 경로를 함께 수정한다.

```text
apps/web/Dockerfile
apps/api/Dockerfile
apps/worker/Dockerfile
apps/scheduler/Dockerfile
scripts/ci-app.sh
```

- 모든 Dockerfile은 저장소 루트를 빌드 컨텍스트로 사용한다. 정확한 의존성 잠금 파일과 기반 이미지 digest를 관리한다.
- 최종 이미지에 루트의 `release.json`을 복사한다. 개발 실행에서는 별도 개발값을 사용할 수 있지만 배포에서는 파일 누락을 오류로 처리한다.
- Web/API는 Railway의 `PORT`에서 외부/내부 연결이 가능한 주소에 바인딩한다. Worker/Scheduler도 준비 상태용 HTTP 서버를 제공한다. 이 두 서비스에는 공개 도메인이 필요 없다.
- 모든 서비스의 `/health/ready`가 준비된 경우 다음 JSON을 반환한다. 내부 API는 `/health/ready`, CRM 공개 경로는 Web 프록시를 거친 `/api/health/ready`다.

```json
{"status":"ok","role":"api","revision":"40자리 커밋 SHA","sourceTree":"40자리 Git tree SHA","releaseId":"GitHubRunID-RunAttempt"}
```

- Web은 기본 화면 제공 가능 여부, API는 DB와 필요한 스키마, Worker/Scheduler는 DB 연결·자신의 실행 루프 준비 여부를 확인한다. AI/메일 업체 장애 때문에 모든 서비스가 재배포 불가가 되도록 readiness를 묶지 않는다.
- API/Worker/Scheduler는 DB에 `instance_id`, 역할, revision, sourceTree, releaseId, 준비 여부, UTC heartbeat 시각을 기록한다. 약 15초 간격으로 갱신하고 종료 때 비활성 표시한다. 프로세스 교체 중 구/신 인스턴스를 역할별 하나로 덮어쓰지 않는다.
- `/internal/ops/release`는 `OPS_READ_TOKEN`을 검증하고 모든 활성 인스턴스를 반환한다. 메모리 한 곳의 상태가 아니라 공유 저장소의 상태를 읽는다. 기업·고객 데이터는 포함하지 않는다.

```json
{
  "status":"ok",
  "components":[
    {"instanceId":"api-1","role":"api","revision":"40자리 커밋 SHA","sourceTree":"40자리 Git tree SHA","releaseId":"123-1","ready":true,"heartbeatAt":"2026-09-12T01:00:00Z"},
    {"instanceId":"worker-1","role":"worker","revision":"40자리 커밋 SHA","sourceTree":"40자리 Git tree SHA","releaseId":"123-1","ready":true,"heartbeatAt":"2026-09-12T01:00:00Z"},
    {"instanceId":"scheduler-1","role":"scheduler","revision":"40자리 커밋 SHA","sourceTree":"40자리 Git tree SHA","releaseId":"123-1","ready":true,"heartbeatAt":"2026-09-12T01:00:00Z"}
  ]
}
```

90초 이상 신호가 없는 인스턴스는 활성 목록에서 정리하되 장애 이력은 보관한다. 각 역할의 활성 인스턴스가 하나 이상이고 모두 같은 배포 버전이어야 CD 검사가 통과한다. 이 검사는 모든 설정된 복제 수나 모든 Web 복제본을 전수 확인하는 검사는 아니며, 실제 복제 수 점검·부하 검사는 별도 운영 검증이다.

`scripts/ci-app.sh`는 고정 의존성 설치, 타입·업무·권한·재시도·API 검사와 웹 빌드, 전용 PostgreSQL 동시 연결 검사를 실행한다. 테스트용 DB는 CI 안에서 분리해 띄우고 실제 고객 메일을 발송하지 않는다. 2026-09-13 [첫 GitHub CI](https://github.com/leemyeongjun11/customer-work-crm/actions/runs/34712562594)에서 기존 46개 검사·타입 검사·웹 빌드 및 별도 PostgreSQL 17 동시 연결 검사가 성공했다. 컨테이너 빌드와 배포 job은 비활성 상태로 건너뛰었다. [CI 검사와 실행 조건](../../docs/06i-postgres-ci-preparation.md)

## 2. Railway 준비

1. Railway 프로젝트에 staging과 production 환경을 분리한다. 운영 서비스·PostgreSQL은 싱가포르 `asia-southeast1-eqsg3a`에 생성한다. 제공 네 JSON은 staging도 싱가포르로 설정한다. DB·파일·외부 인증정보는 환경별로 분리한다.
2. `web`, `api`, `worker`, `scheduler` Empty Service를 만든다. PostgreSQL과 파일 저장소를 연결한다.
3. 네 서비스의 Root Directory와 Custom Config Path를 따로 지정하지 않고 저장소 루트 기본값을 사용한다. 배포 스크립트가 서비스별 설정을 업로드 사본의 `railway.json`으로 넣는다.
4. Dockerfile의 기본 시작 명령을 사용한다. Scheduler도 **상시 서비스**이며 Railway Cron Schedule을 설정하지 않는다. 자동 작업을 실행하는 Worker/Scheduler에 유휴 절전 설정을 적용하지 않는다.
5. GitHub 연결을 통한 별도 자동 배포는 끈다. Actions가 배포를 담당한다.
6. Web에 공개 도메인을 연결한다. API는 내부 주소로 연결하고 DB/Worker/Scheduler를 외부에 직접 노출하지 않는다.
7. 각 환경의 Project Token을 만들어 해당 GitHub Environment의 `RAILWAY_TOKEN`에 저장한다. 환경 및 서비스 ID를 아래 변수에 등록한다.

제공 JSON은 싱가포르의 각 서비스 1개로 지정한다. 복제 수를 늘릴 때 JSON을 수정해 배포에 반영한다. 자원 상한·백업·DB 지역은 Railway 환경에서 실제로 설정해야 한다. 파일 추가만으로 계정 자원이나 DB가 생성되지는 않는다. 볼륨이 있는 기존 DB의 지역 이동은 별도 작업이다.

설정의 `restartPolicyMaxRetries: 5`는 프로세스가 비정상 종료됐을 때 Railway가 다시 시작하는 횟수다. 고객 메일·AI 등 개별 업무의 ‘최초 포함 총 3회’와 다르며, 업무 횟수는 DB에 보존해 프로세스 재시작으로 초기화하지 않는다.

서버 런타임 변수 예시(값은 실제 구현 때 확정):

| 서비스 | 변수 |
|---|---|
| Web | `API_INTERNAL_URL`, `PUBLIC_APP_URL`, 인증에 필요한 서버 설정 |
| API | `DATABASE_URL`, `OPS_READ_TOKEN`, 직원 인증 설정, 허용 출처, 파일 저장 설정, Emergent Webhook 서명 키 |
| Worker | `DATABASE_URL`, `EMERGENT_API_BASE_URL`, Emergent 자격증명, AI·메일 자격증명, 작업별 동시 실행 상한 |
| Scheduler | `DATABASE_URL`, `TZ=Asia/Seoul`, 공휴일 달력 설정 |

MongoDB 연결 문자열은 기본 연결 구성에 넣지 않는다. Emergent 인증 방식과 변수 이름은 실제 API 계약에 맞춘다. 일반 직원·고객에게 내부 서비스 비밀값을 전달하지 않는다.

## 3. GitHub 설정 — 본인 수동 운영 배포

2026-09-13 사용자 결정: 비공개 저장소를 유지하고, 기본 Environment Required reviewers 대신 본인이 GitHub Actions의 **운영 배포 실행**을 직접 시작한다. 이 결정이 이전 Environment 승인 대기 설계를 대체한다.

GitHub 저장소의 Settings → Secrets and variables → Actions에서 등록한다. 환경별 Environment 기능에 의존하지 않고 Repository Variables/Secrets를 구분된 이름으로 사용한다.

| 종류 | 이름 | 값 또는 용도 |
|---|---|---|
| Variable | CRM_APP_READY | 운영 런타임·이미지·인증·DB를 검수한 뒤 true |
| Variable | CRM_STAGING_DEPLOY_ENABLED | 시험 배포 연결이 완료된 뒤 true |
| Variable | CRM_PRODUCTION_DEPLOY_ENABLED | 시험 배포·사용자 검수가 완료된 뒤 true |
| Variable | PRODUCTION_APPROVER | leemyeongjun11 |
| Variable | STAGING_CRM_BASE_URL | 시험 Web의 HTTPS 원점 주소 |
| Variable | PRODUCTION_CRM_BASE_URL | 운영 Web의 HTTPS 원점 주소 |
| Secret | STAGING_RAILWAY_TOKEN | staging 전용 Railway Project Token |
| Secret | PRODUCTION_RAILWAY_TOKEN | production 전용 Railway Project Token |
| Secret | STAGING_OPS_READ_TOKEN | 시험 API의 실행 상태 조회 토큰 |
| Secret | PRODUCTION_OPS_READ_TOKEN | 운영 API의 실행 상태 조회 토큰 |

서비스·환경 ID는 targets.json에서 읽고 UUID 형식과 대상 브랜치를 확인한다. 비밀값은 이 파일에 넣지 않는다. 이전 CRM_DEPLOY_ENABLED는 새 워크플로에서 사용하지 않으며 false를 유지한다. Railway 런타임의 메일·AI·DB 자격증명은 Railway에 저장한다.

## 4. 실행 흐름과 한계

1. 작업 브랜치 → PR → staging: 앱/인프라/PostgreSQL 검사. 준비 플래그가 켜진 경우 네 컨테이너 빌드 후 staging 배포.
2. staging → PR → main: 자동 검사만 실행한다. main push로 운영 배포가 시작되지 않는다.
3. 본인이 GitHub Actions → **운영 배포 실행** → **Run workflow**에서 main을 선택하고 시험 환경 확인 체크박스를 체크해 실행한다.
4. 실행 기록 API로 요청자와 재실행 요청자가 본인 User인지, 전용 workflow_dispatch인지, 현재 main 커밋인지 확인한다. Re-run은 거부하며 실패 후에도 새 실행을 명시적으로 시작해야 한다.
5. 선택한 커밋의 앱/DB 검사와 컨테이너 빌드를 다시 수행한다. 실제 staging이 동일 Git tree를 실행하고 있고, 해당 staging CI와 배포 job의 readiness 검사가 성공했는지 조회한다. 단순 CI 성공에서 배포 job을 건너뛴 결과는 인정하지 않는다.
6. Railway 호출 직전 본인과 main 커밋을 재확인한다. API → Worker → Scheduler → Web 배포 후 실제 실행 버전과 heartbeat를 확인한다.

운영 workflow는 push·PR·workflow_call 트리거가 없다. 기존 deploy-railway.yml은 staging 전용이며 CI에서 staging 비밀값만 전달한다. 서비스 설정이나 자격증명이 없거나 조회에 실패하면 배포 전에 중단한다. 동시 운영 배포는 직렬화하되 GitHub concurrency는 모든 대기를 보존하는 큐가 아니다.

CLI 빌드 성공만으로 배포 완료로 보지 않는다. 일부 서비스 배포 후 실패할 수 있으므로 수동 복구 시 호환되는 이전 버전과 DB 상태를 함께 확인한다. 자동 전체 롤백은 구현하지 않았다. staging에서 업무 시나리오와 모바일 검수도 따로 수행해야 한다.

이 방식은 GitHub의 기본 환경 승인과 다르다. GitHub는 UI의 버튼과 같은 계정의 CLI/API 수동 요청을 구별해 증명하지 않으므로 계정·토큰 관리가 필요하다. 에이전트는 운영 workflow를 사용자 대신 호출하지 않는다. 저장소 쓰기/관리 권한이 있는 사람은 workflow나 Repository Secrets 사용 방식을 바꿀 수 있다. 현재 요금제의 비공개 저장소에서는 브랜치 보호도 강제할 수 없으므로, 본인만 쓰기/관리 권한을 보유하는 운영 전제를 유지한다. CI의 main PR 출처 검사는 플랫폼 수준의 직접 push 차단을 대체하지 않는다.

참고: [GitHub 수동 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [GitHub 환경 기능 제한](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
## 5. 로컬 확인

실제 계정 연결(2026-09-13): CLI 로그인과 `balanced-balance` 프로젝트의 staging 연결을 완료했다. 두 환경의 네 서비스가 싱가포르·복제본 1개로 설정됐음을 CLI에서 확인했다. `targets.json`에는 환경·서비스 식별자만 보관한다. 아래 명령으로 현재 원격 설정을 읽기 전용으로 재확인한다. 서비스 생성·배포·비밀값 출력은 하지 않는다.

```powershell
.\scripts\check-railway-state.ps1
```

로컬 CLI는 `.local-data/railway-tools/node_modules/.bin/railway.cmd`이며 Git에 포함하지 않는다. 다른 컴퓨터에서는 CLI 설치·로그인·기존 프로젝트 연결이 필요하다. 기존 파일 검사나 이 조회가 통과해도 앱 배포가 완료된 것은 아니다.

프로젝트 폴더의 터미널에서 실행한다. 이 명령은 배포하지 않는다.

```powershell
node scripts/check-infra.mjs
node --test scripts/release-check.test.mjs
node --test scripts/check-production-approval.test.mjs
```

`node scripts/check-infra.mjs --require-app`는 운영용 Dockerfile이 아직 없어 실패한다. 로컬 앱과 CI 검사 스크립트는 존재하지만 독립 운영 런타임과 이미지는 남아 있다. 설정 검사 통과를 앱 구축·배포 완료로 해석하지 않는다.

참고: [Railway 설정 파일](https://docs.railway.com/config-as-code/reference), [CLI 배포](https://docs.railway.com/cli/deploying), [배포 준비 검사](https://docs.railway.com/deployments/healthchecks).
