# 클라우드 시험 실행 환경

웹, API, worker, scheduler를 별도 Node 24 컨테이너로 실행하고 PostgreSQL 17을 공유한다. 데이터베이스의 영구 볼륨은 시험 환경에만 만든다. GitHub PR에서 기존 기능과 PostgreSQL 검증, 네 컨테이너의 실제 기동·로그인·접수·연락 완료·API 재생성 후 데이터 및 세션 유지까지 검사한다.

웹만 HTTPS로 공개한다. API·DB는 Railway 사설망을 사용하며 웹이 내부 인증 헤더를 덮어쓴다. 클라우드 세션은 Secure / HttpOnly / SameSite=Strict / __Host- 쿠키를 사용한다. 변경 요청의 Origin 검사, DB 기반 요청 제한, SSE 세션 재검증을 적용한다. 초기 계정은 빈 DB에 한 번만 생성하고 재시작 시 비밀번호나 기록을 초기화하지 않는다.

각 서버는 배포 커밋·Git tree·Actions 실행 ID를 반환한다. API/worker/scheduler는 DB에 인스턴스별 준비 상태를 기록한다. 배포 검증은 모든 활성 인스턴스의 버전과 상태를 확인한다. 단순한 Docker 빌드 성공이나 HTTP 200만으로 배포 성공을 판정하지 않는다.

## 범위와 제한

2026-09-13 실행 결과: [GitHub 자동 배포](https://github.com/leemyeongjun11/customer-work-crm/actions/runs/34716286686) 3번째 시도가 성공했다. 배포 ID는 `34716286686-3`, 커밋은 `e12e6f6ad1d9258292eaf98a5c16b248c0ff9cdb`다. Railway 기본 Railpack 설정으로 처음 빌드가 실패하여 시험 서비스 각각에 검증한 Dockerfile 경로와 healthcheck/싱가포르 설정을 반영한 후 재실행했다. 새로운 환경을 만들 때도 동일 설정을 확인해야 한다. 공개 HTTPS에서 로그인·예시 접수·연락 완료 저장·재조회·SSE·로그아웃 무효화를 검증했고 로그인 화면 표시를 확인했다.

- 시험 URL은 `https://web-staging-d005.up.railway.app/live`이며 실제 기동 완료 여부는 Actions 배포 결과와 실행 상태 검증으로 확인한다.
- 예시 데이터 검수용이다. 외부 이메일·AI·Emergent 공급자 자격 정보는 연결 전이다.
- 원격 백업 저장소와 운영 환경 복원 검수는 남아 있다. 클라우드 백업 API는 설정 없이 임시 파일에 저장하는 대신 연결 전 상태를 반환한다.
- 로컬 검수 DB는 업로드하지 않는다. 클라우드 초기 계정과 비밀값은 Git에서 제외된 `.local-data`에 보관하며 GitHub에는 암호화된 Secrets로 등록한다.
- 운영 배포 활성화는 별도 단계다. 사용자 계정에서 직접 실행하는 `운영 배포 실행` 절차를 유지한다.

## 배포 순서

기능 PR 검증 → 시험용 DB/환경 변수/토큰 설정 → staging 병합 → GitHub Actions 자동 배포 → 실행 상태 검증 → 사용자 화면 검수. `CRM_APP_READY`와 `CRM_STAGING_DEPLOY_ENABLED`는 시험 런타임 준비 후에만 활성화하며 `CRM_PRODUCTION_DEPLOY_ENABLED`는 운영 준비가 끝날 때까지 비활성화한다.
