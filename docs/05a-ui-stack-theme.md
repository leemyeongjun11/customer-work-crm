# 프런트엔드 기술과 프레임 테마

결정일: 2026-09-12. 사용자 요청: Tailwind CSS와 shadcn을 사용하고 프레임 목업 단계에서는 shadcn 기본 테마를 적용한다.

## 적용 기준

| 항목 | 적용 |
|---|---|
| 앱 기반 | React + TypeScript + Vite 유지 |
| 스타일링 | Tailwind CSS v4, `@tailwindcss/vite` 플러그인 |
| UI 컴포넌트 | shadcn/ui 공식 레지스트리의 소스 컴포넌트 |
| 컴포넌트 스타일 | New York / Radix 기반 |
| 프레임 테마 | Neutral 라이트. 기본 배경·글자·버튼·테두리·입력·포커스 토큰 사용 |
| 주요 컨트롤 | Button, Card, Badge, Input, Textarea, NativeSelect, Dialog |
| 최종 브랜드 테마 | 이번 요청으로 최종 테마까지 확정한 것은 아님 |

“기본 테마”는 별도 브랜드 색상 없이 사용하는 공식 Neutral 테마로 구체화했습니다. CLI의 레거시 `default` 스타일 이름과 구분하며, 실제 컴포넌트 생성 설정은 `new-york`입니다. 새로운 CLI의 전체 앱 생성 프리셋을 덮어 적용하지 않고 기존 프로젝트에 공식 컴포넌트를 추가했습니다.

## 파일과 확장 방법

- `apps/web/components.json`: 스타일·Neutral 기본색·alias·CSS 경로 설정
- `apps/web/src/components/ui/`: 공식 레지스트리에서 가져온 UI 소스
- `apps/web/src/theme.css`: shadcn 기본 테마 토큰과 Tailwind 연결
- `apps/web/src/layout.css`: 화면 배치·반응형 규칙. Tailwind `@apply`와 의미 기반 색상 토큰 사용
- `apps/web/src/lib/utils.ts`: 클래스 병합 유틸리티
- `apps/web/vite.config.ts`, `tsconfig.json`: Tailwind 플러그인과 `@/` alias

기존 `styles.css`의 개별 색상·컨트롤 스타일은 제거했습니다. 새로운 색상은 개별 화면에 하드코딩하지 않고 테마 토큰으로 관리합니다. 기본 컴포넌트의 형태는 유지하고 앱에 필요한 배치와 크기만 조정합니다. 업무 목록의 선택 상태·기한 지연은 기본 muted/destructive 토큰으로 표시합니다.

추가 컴포넌트가 필요하면 프로젝트 루트에서 아래 명령의 이름을 바꿔 사용합니다.

```powershell
pnpm dlx shadcn@latest add 컴포넌트이름 --cwd apps/web
```

검수 화면은 <http://127.0.0.1:5173/today>입니다. 실제 발송·DB·AI 연결 범위에는 변화가 없습니다.

## 검증과 출처

타입 검사·업무 및 배포 규칙 테스트 18개·Tailwind/Vite 빌드 통과. 브라우저에서 Dialog 열기, NativeSelect 선택, 메모 없는 연락 완료 후 목록 갱신을 확인했습니다. UI 교체를 위해 업무 규칙 코드와 외부 배포 승인을 변경하지 않았습니다.

설치와 테마 기준은 [shadcn Vite 설치](https://ui.shadcn.com/docs/installation/vite), [공식 테마 문서](https://ui.shadcn.com/docs/theming), [공식 CLI](https://ui.shadcn.com/docs/cli)를 참고했습니다. 설치된 정확한 패키지 버전은 `apps/web/package.json`과 `pnpm-lock.yaml`에 기록됩니다.
