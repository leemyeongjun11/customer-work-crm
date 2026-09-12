# CRM API — 첫 로컬 저장 구현

로그인·회사/담당자 권한·상담 접수·업무·메모·변경 이력과 중복 방지를 구현했다. 실행과 검수 계약은 [첫 실제 저장 안내](../../docs/06a-first-working-slice.md)를 따른다.

운영 목표 계약은 `docs/04d-core-api-contract.md`다. 현재 서버는 로컬 검수용으로 127.0.0.1에만 바인딩하며 `NODE_ENV=production`을 허용하지 않는다. PGlite 파일 저장과 실제 PostgreSQL 어댑터를 분리했으며, 외부 DB·인증 공급자·웹훅·메일·AI·운영 배포는 아직 검증하지 않았다.
