# Railway / GitHub Actions 연결 안내

이 폴더는 **앱 연결용 배포 설정**이다. 현재 `apps/web`에 로컬 프레임 검수용 화면이 있으며 [프로젝트 README](../../README.md)에 따라 실행할 수 있다. 운영용 API·Worker·Scheduler·인증·DB 연결은 아직 구현 전이므로 워크플로의 배포 단계는 기본 비활성이다. 설계는 [싱가포르·실시간 문의·승인 배포 구조](../../docs/04b-railway-scalable-architecture.md)를 따른다.

2026-09-13 갱신: 로컬 API 인증·저장과 예약/처리 모듈을 구현했으며 PGlite 환경에서는 한 프로세스에서 실행한다. 위 ‘운영용 미구현’은 독립 배포 서비스와 실제 외부 연동에 해당한다. 아래 이미지·실행 식별·readiness·본인 승인 계약을 충족하기 전에는 배포 플래그를 활성화하지 않는다. 사용자의 GitHub·Railway 계정은 아직 준비 전이다.

## 파일

| 파일 | 용도 |
|---|---|
| `.github/workflows/ci.yml` | staging/main PR·push 검사, staging 자동 배포, main 운영 승인 절차 연결 |
| `.github/workflows/deploy-railway.yml` | 브랜치별 배포, 동일 소스의 staging 확인, production 본인 승인 후 배포 |
| `infra/railway/{web,api,worker,scheduler}.json` | 서비스별 Dockerfile과 배포 준비 검사 |
| `infra/railway/services.json` | 배포 순서, 서비스 식별 변수, 고정 CLI 버전 |
| `scripts/check-infra.mjs` | 설정 일관성 및 앱 준비 검사 |
| `scripts/deploy-railway.mjs` | 선택 커밋의 추적 파일만 묶어 Railway에 배포 |
| `scripts/release-check.mjs` | 실제 실행 버전과 Worker/Scheduler 상태 확인 |
| `scripts/write-release.mjs` | 커밋·소스 내용·실행 번호로 배포 식별 파일 생성 |
| `scripts/check-production-approval.mjs` | 본인의 production 승인 기록 확인. 없거나 조회 실패면 배포 중단 |

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

`scripts/ci-app.sh`는 고정 의존성 설치, 타입·업무·권한·재시도·API 검사와 웹 빌드, 전용 PostgreSQL 동시 연결 검사를 실행한다. 테스트용 DB는 CI 안에서 분리해 띄우고 실제 고객 메일을 발송하지 않는다. 현재 로컬 검사 43개 통과와 별개로 PostgreSQL의 실제 실행 결과는 아직 대기 중이다. [새 CI 검사와 실행 조건](../../docs/06i-postgres-ci-preparation.md)

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

## 3. GitHub 설정

Repository Variables:

| 변수 | 값 |
|---|---|
| `CRM_APP_READY` | 앱 코드·테스트·컨테이너 계약을 갖춘 후 `true` |
| `CRM_DEPLOY_ENABLED` | Railway 환경·비밀값·주소 설정 후 `true` |
| `PRODUCTION_APPROVER` | 운영 배포를 승인할 본인의 정확한 GitHub 로그인 이름 |

GitHub에 `staging`, `production` Environment를 만들고 각각 설정한다.

| 종류 | 이름 | 내용 |
|---|---|---|
| Secret | `RAILWAY_TOKEN` | 해당 환경의 Railway Project Token |
| Secret | `OPS_READ_TOKEN` | 해당 환경 API의 배포 상태 조회 전용 토큰 |
| Variable | `CRM_BASE_URL` | 해당 환경 Web의 HTTPS 원점 주소. 경로·쿼리 없음 |
| Variable | `RAILWAY_ENVIRONMENT_ID` | Railway 환경 ID |
| Variable | `RAILWAY_WEB_SERVICE_ID` | Web 서비스 ID |
| Variable | `RAILWAY_API_SERVICE_ID` | API 서비스 ID |
| Variable | `RAILWAY_WORKER_SERVICE_ID` | Worker 서비스 ID |
| Variable | `RAILWAY_SCHEDULER_SERVICE_ID` | Scheduler 서비스 ID |

추가로 `staging-verification` Environment를 만든다. main 실행에서 검증 환경을 읽기만 하는 용도다. `CRM_BASE_URL`과 읽기 전용 `OPS_READ_TOKEN`만 staging의 값으로 등록하고 Railway 배포 토큰은 넣지 않는다.

| GitHub Environment | 허용 브랜치 | 승인 |
|---|---|---|
| staging | staging만 | 자동 |
| staging-verification | main만 | 자동, 검증 환경 읽기 전용 |
| production | main만 | 본인의 Required reviewer 승인 필수 |

production 설정은 다음과 같다.

1. Settings → Environments → production → Required reviewers에 본인 계정 하나만 추가한다. 여러 명을 추가하면 그중 한 명만 승인해도 통과할 수 있으므로 다른 사람을 함께 지정하지 않는다.
2. **Prevent self-review는 끈다.** 본인이 PR을 병합하거나 배포를 시작한 경우에도 직접 승인할 수 있어야 한다.
3. **Allow administrators to bypass configured protection rules는 끈다.**
4. Deployment branches and tags는 Selected branches and tags로 지정하고 `main` 브랜치만 허용한다.
5. Actions에 승인 대기가 나타나면 Review deployments → production → Approve and deploy를 누른다. PR 병합과 이 배포 승인은 별개다.

승인 후 job 안에서도 GitHub Actions 승인 이력 API로 이번 workflow run의 승인자가 `PRODUCTION_APPROVER`인지 확인한다. 이 조회는 `GITHUB_TOKEN`의 `actions: read`를 사용하고 승인 자체를 자동으로 수행하지 않는다. 환경 설정이 빠져 job이 즉시 시작돼도 실제 승인 기록이 없으면 Railway 호출 전에 실패한다. 승인 기록을 조회할 수 없어도 진행하지 않는다. [GitHub 승인 이력 API](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run)

브랜치는 `작업 브랜치 → PR → staging → PR → main`으로 운영한다. main을 기본 브랜치로 두고 staging/main에 PR 필수, CI 필수, 강제 push·삭제·직접 push 제한 규칙을 적용한다. main 대상 PR은 동일 저장소의 staging에서 온 경우만 CI를 통과한다. 혼자 작업한다면 PR 작성자 본인이 자신의 PR 리뷰 승인을 할 수 없다는 점을 고려해, PR 존재·CI 필수 규칙과 별도 운영 배포 본인 승인을 사용한다. 실제 계정/저장소 연결 전에는 이러한 원격 규칙이 설정된 상태가 아니다.

API, AI, 메일, DB의 런타임 비밀값은 Railway에 저장한다. PR 테스트에는 운영 비밀값을 제공하지 않는다. Railway GitHub 자동 배포와 우회 배포 경로도 사용하지 않는다. 저장소 관리자 자체가 워크플로·환경 규칙을 변경하는 권한까지 로컬 설정 파일로 없애는 것은 아니므로 해당 관리 권한은 본인이 보유한다.


GitHub의 Required reviewers 지원은 저장소 공개 여부·요금제에 따라 다르다. 공식 문서 기준 Free/Pro/Team의 Required reviewers는 공개 저장소에서 제공된다. 비공개 저장소에서 지원되지 않으면 **이번 요구를 충족할 수 있는 요금제·승인 구성이 확인될 때까지 운영 배포를 활성화하지 않는다.** 저장소를 임의로 공개하거나 수동 실행 버튼으로 승인 절차를 대체하지 않는다. [GitHub 환경 제한](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## 4. 배포 순서와 실패 처리

- PR → staging: 인프라 검사 → 앱 테스트 → 네 컨테이너 빌드. 병합 후 staging에 자동 배포.
- PR staging → main: CI 검증 후 병합. 앱 검사 → staging과 전체 소스 내용 일치 확인 → **본인 승인 대기** → production 배포 → 실제 실행 상태 확인.
- 커밋 SHA는 PR 병합 시 바뀔 수 있으므로 전체 파일 내용을 나타내는 Git tree SHA를 비교한다. 소스가 다르면 배포를 막고 staging에서 다시 검증한다. 환경 변수/DB 데이터까지 같다고 판정하는 검사는 아니다.
- 수동 새 배포 실행도 staging은 staging 브랜치, production은 main 브랜치에서만 가능하다. production은 언제나 별도 본인 승인을 받아야 한다.
- 승인 이력이 run attempt를 구분하지 않으므로 production의 Re-run은 거부한다. 실패 후 main에서 새 workflow_dispatch 실행을 생성하고 다시 승인한다.
- 환경별 동시 배포는 직렬화하고 실행 중인 배포를 새 push 때문에 중단하지 않는다.
- API → Worker → Scheduler → Web 순서로 업로드한다. CLI `--ci`의 성공은 빌드 단계 성공이므로 후속 실행 검사가 필수다. 서비스 간 구/신 버전 공존을 허용하는 호환 설계가 필요하다.
- 배포 오류나 시간 초과 시 자동 반복 배포하지 않는다. Railway에서 이미 적용된 서비스와 실패한 서비스를 확인한다. DB 마이그레이션·여러 서비스의 일괄 자동 롤백은 이 워크플로에 구현돼 있지 않다.
- 기존 버전 복구는 호환되는 이미지/배포를 서비스별로 선택해 시행하고, 실행기와 예약 실행 상태를 확인한다. 이후 실패 원인을 수정해 정상 파이프라인으로 재배포한다.

상태 점검은 실제 사용 흐름 전체의 테스트가 아니다. staging에서 접수·배정·연락 기록·예정 알림·승인 메일의 종단 간 검증도 해야 한다. 현재 워크플로에는 실제 앱 테스트 진입점만 있으며 이 업무 검증 자체는 앱 구현 시 추가해야 한다.

## 5. 로컬 확인

프로젝트 폴더의 터미널에서 실행한다. 이 명령은 배포하지 않는다.

```powershell
node scripts/check-infra.mjs
node --test scripts/release-check.test.mjs
node --test scripts/check-production-approval.test.mjs
```

`node scripts/check-infra.mjs --require-app`는 운영용 Dockerfile이 아직 없어 실패한다. 로컬 앱과 CI 검사 스크립트는 존재하지만 독립 운영 런타임과 이미지는 남아 있다. 설정 검사 통과를 앱 구축·배포 완료로 해석하지 않는다.

참고: [Railway 설정 파일](https://docs.railway.com/config-as-code/reference), [CLI 배포](https://docs.railway.com/cli/deploying), [배포 준비 검사](https://docs.railway.com/deployments/healthchecks).
