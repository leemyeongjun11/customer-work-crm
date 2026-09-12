# CRM Scheduler — 로컬 영업일 예약

`src/run.mjs`는 영업일 15:00/16:30 알림을 중복 없이 DB에 등록한다. 현재 로컬 API가 주기 실행하며, 17시 이후 보충은 생략 기록을 남긴다. 실제 휴일 달력과 독립 운영 서비스는 후속 작업이다. [구현·검증·제약](../../docs/06c-notification-automation.md).

`src/recovery-polling.mjs`는 설정된 회사의 문의 누락 확인을 별도 60초 루프로 실행한다. 같은 프로세스의 겹침과 종료를 관리하고 DB의 기존 임대·커서·요청 제한을 따른다. 실제 연결 정보가 없으면 실행하지 않는다. [조회 계약과 설정](../../docs/06j-emergent-export-polling.md).
