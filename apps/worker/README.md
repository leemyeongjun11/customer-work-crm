# CRM Worker — 로컬 검수 알림 처리

`src/run.mjs`는 DB의 알림 대기를 처리하고 검수 수신함에 저장한다. 실제 외부 이메일은 보내지 않는다. 현재는 로컬 API가 같은 프로세스에서 실행한다. [구현·검증·제약](../../docs/06c-notification-automation.md). PostgreSQL 다중 프로세스·실제 제공자·AI·배포용 독립 실행은 후속 작업이다.
