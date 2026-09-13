# 본인이 실행하는 운영 배포

결정일: 2026-09-13. 사용자는 비공개 저장소를 유지하고 GitHub의 수동 운영 배포 실행 방식을 승인했다.

## 사용자가 할 일

시험 환경에서 로그인·접수·담당자·기한·업무 처리 흐름을 확인한다. 검수가 끝나고 운영 준비가 완료됐다는 안내를 받은 다음 GitHub 저장소 → Actions → **운영 배포 실행** → **Run workflow**를 연다. 브랜치는 main으로 두고 시험 환경 확인 항목을 체크해 실행한다.

프로그램은 사용자 계정 leemyeongjun11의 수동 실행인지 확인하고, 선택된 main 코드의 검사·빌드·시험 배포 성공을 확인한 뒤 운영 환경을 배포한다. 실패한 실행의 Re-run은 사용하지 않고 새 Run workflow로 다시 요청한다.

## 이번 구현

- main의 자동 운영 배포 경로 제거, 전용 수동 workflow 추가.
- 본인 요청·별도 확인·main·실행 ID·커밋·최초 시도 검증. 배포 직전 재확인.
- 시험 환경이 동일 소스를 실행하는지와 해당 CI/배포 job의 성공을 확인.
- 현재 비공개 저장소에서 쓸 수 있는 Repository Variables/Secrets 방식으로 변경하고 staging/production 이름 분리.
- Railway 환경·서비스 ID 기록과 PowerShell 읽기 전용 확인 스크립트 추가.

## 준비 상태

2026-09-13 갱신: [Railway 시험 환경](06l-staging-runtime.md)의 web·api·worker·scheduler와 PostgreSQL을 실행하고 공개 HTTPS 주소를 연결했다. 앱 준비·시험 배포 플래그와 GitHub 자동 배포가 활성화됐으며 시험 환경의 실제 접수·저장·실행 상태를 검증했다. 운영 배포 플래그는 비활성이다. 운영 서비스·계정·PostgreSQL·도메인·실제 연동·전체 운영 검수는 별도로 준비해야 한다.

현재 workflow의 배포 성공을 흉내 내기 위해 준비 플래그를 켜거나 production을 실행하지 않는다. 실제 사용자 계정의 운영 실행 검수는 준비가 끝난 후 본인이 시작한다.

구체 변수와 운영 한계는 [Railway 연결 안내](../infra/railway/README.md)를 따른다.
