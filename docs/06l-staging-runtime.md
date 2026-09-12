# 클라우드 시험 실행 환경

웹, API, worker, scheduler를 별도 Node 24 컨테이너로 실행하고 PostgreSQL 17을 공유한다. 데이터베이스의 영구 볼륨은 시험 환경에만 만든다. GitHub PR에서 기존 기능과 PostgreSQL 검증, 네 컨테이너의 실제 기동·로그인·접수·연락 완료·API 재생성 후 데이터 및 세션 유지까지 검사한다.

웹만 HTTPS로 공개한다. API·DB는 Railway 사설망을 사용하며 웹이 내부 인증 헤더를 덮어쓴다. 클라우드 세션은 Secure / HttpOnly / SameSite=Strict / __Host- 쿠키를 사용한다. 변경 요청의 Origin 검사, DB 기반 요청 제한, SSE 세션 재검증을 적용한다. 초기 계정은 빈 DB에 한 번만 생성하고 재시작 시 비밀번호나 기록을 초기화하지 않는다.

각 서버는 배포 커밋·Git tree·Actions 실행 ID를 반환한다. API/worker/scheduler는 DB에 인스턴스별 준비 상태를 기록한다. 배포 검증은 모든 활성 인스턴스의 버전과 상태를 확인한다. 단순한 Docker 빌드 성공이나 HTTP 200만으로 배포 성공을 판정하지 않는다.

## 범위와 제한

- 시험 URL은 `https://web-staging-d005.up.railway.app/live`이며 실제 기동 완료 여부는 Actions 배포 결과와 실행 상태 검증으로 확인한다.
- 예시 데이터 검수용이다. 외부 이메일·AI·Emergent 공급자 자격 정보는 연결 전이다.
- 원격 백업 저장소와 운영 환경 복원 검수는 남아 있다. 클라우드 백업 API는 설정 없이 임시 파일에 저장하는 대신 연결 전 상태를 반환한다.
- 로컬 검수 DB는 업로드하지 않는다. 클라우드 초기 계정과 비밀값은 Git에서 제외된 `.local-data`에 보관하며 GitHub에는 암호화된 Secrets로 등록한다.
- 운영 배포 활성화는 별도 단계다. 사용자 계정에서 직접 실행하는 `운영 배포 실행` 절차를 유지한다.

## 배포 순서

기능 PR 검증 → 시험용 DB/환경 변수/토큰 설정 → staging 병합 → GitHub Actions 자동 배포 → 실행 상태 검증 → 사용자 화면 검수. `CRM_APP_READY`와 `CRM_STAGING_DEPLOY_ENABLED`는 시험 런타임 준비 후에만 활성화하며 `CRM_PRODUCTION_DEPLOY_ENABLED`는 운영 준비가 끝날 때까지 비활성화한다.
