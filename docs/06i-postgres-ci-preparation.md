# PostgreSQL 자동 검사 준비

2026-09-13. 코드와 CI 실행 구성을 준비했으며 **실제 PostgreSQL 검사는 아직 실행 전**이다. 6.1 MVP 구축과 6.3 배포 준비 작업이며 배포 완료가 아니다.

## 추가한 항목

- `pnpm test:postgres`: 서로 다른 PostgreSQL 연결에서 동일 문의 수신, 같은 버전의 동시 변경 충돌, 알림 처리 잠금과 중복 저장, PostgreSQL 백업을 PGlite에 복원하는 계약 검사.
- CI의 `postgres` job: PR·push에서 전용 PostgreSQL 17 서비스 컨테이너로 검사한다. `application`은 이 검사와 기존 UI/인프라 검사가 모두 통과해야 진행한다.
- `scripts/ci-app.sh`: 잠금 파일 설치, 실제 `pnpm check`, PostgreSQL 검사를 수행한다. 자동 성공이나 DB 검사 생략을 허용하지 않는다. 배포 전 validate에도 전용 테스트 DB를 제공한다.

서비스 컨테이너의 준비 검사와 runner의 loopback 포트 연결은 [GitHub 공식 PostgreSQL 서비스 컨테이너 안내](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)를 따른다. 테스트 서비스의 비밀번호는 매번 폐기되는 CI DB 전용이며 운영 비밀값을 사용하지 않는다. 테스트 이미지 태그는 `postgres:17`이며 운영 이미지의 버전·digest 확정은 별도이다.

## 데이터 보호와 실행 조건

`CRM_TEST_DATABASE_URL`은 별도의 CI 서버의 `127.0.0.1` 호스트와 `crm_ci` DB만 허용한다. 설정이 없거나 다른 DB이면 검사 전에 중단한다. 그 서버에서 무작위 이름 `crm_ci_<32자리 UUID>`의 새로운 DB를 만든 뒤에만 스키마와 검수 데이터를 넣는다. 종료 때 자신이 생성한 DB만 삭제하며 기존 `crm_ci`나 CRM 운영 DB의 테이블은 삭제하지 않는다. 테스트용 계정에는 해당 임시 DB 생성 권한이 필요하다.

로컬에 별도 PostgreSQL 또는 Docker가 준비되면 전용 테스트 서버를 띄워 이 변수를 설정하고 `pnpm test:postgres`를 실행한다. 운영 연결 문자열을 사용하지 않는다. 현재 컴퓨터에서는 Docker 명령과 테스트 DB 설정을 확인하지 못했으므로 서버 검사를 성공했다고 기록하지 않는다. GitHub 저장소도 아직 연결되지 않아 원격 실행 결과가 없다.

현재 확인한 것: JS 문법 검사, 기존 인프라 설정 검사, Bash 문법 검사, 두 워크플로 YAML 파싱과 PostgreSQL job 의존성, DB 설정이 없을 때 실패하는 방어 동작. 테스트 DB 미설정으로 나온 실패 1건은 CRM 기능 실패가 아니라 필수 DB 검사를 실행할 수 없다는 신호다. 로컬 전체 검사 통과 결과와 별도로 관리한다.

## 배포 전에 남은 조건

운영 Web/API/Worker/Scheduler 이미지와 독립 런타임·공유 DB 실행 상태, 운영 인증·실제 발송 연결, PostgreSQL 실제 테스트 성공, staging 종단 간 검수가 필요하다. `CRM_APP_READY`와 `CRM_DEPLOY_ENABLED`는 계속 비활성이다. production은 기존의 본인 GitHub 승인 검사를 통과해야 하며 이 작업은 그 승인 절차를 변경하지 않는다.
