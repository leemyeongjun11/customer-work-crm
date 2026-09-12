from pathlib import Path
import re

source = Path('apps/web/src/frame/screens.ts').read_text(encoding='utf-8')
rows = []
for line in source.splitlines():
    match = re.search(r"screen\('([^']+)', '([^']+)', '([^']+)', (.*), '([^']+)'\),", line)
    if not match:
        continue
    ident, group, title, route, check = match.groups()
    form = re.fullmatch(r"form\('([^']+)', '([^']+)'\)", route)
    url = f'/today?frameForm={form[1]}&id={form[2]}' if form else route.strip("'")
    rows.append(f'| {ident} | {group} | {title} | `{url}` | {check} |')
header = '''# 프레임 02 — 전체 화면 목록

이 목록은 `apps/web/src/frame/screens.ts`의 검수 목록과 같은 항목입니다. 갱신: 2026-09-12.

각 항목을 PC·모바일에서 확인하며, 정상 흐름 외에도 확인 내용에 적힌 실패·빈 상태·권한·입력 오류를 점검합니다. 상세 확인창은 URL로 바로 열 수 있습니다. 앞선 시연으로 예시 업무를 이미 처리했다면 새로고침하거나 검수 도구의 기본 상황으로 복원합니다.

모든 항목은 **사용자 검수 대기**입니다. 제작자 동작 검사는 [검증 기록](05b-full-frame-review.md#제작자-검증--사용자-검수와-별도)에 별도로 기록합니다.

| ID | 구역 | 화면·확인창 | 경로 | 확인 내용 |
|---|---|---|---|---|
'''
Path('docs/05c-screen-inventory.md').write_text(header + '\n'.join(rows) + f'\n\n총 {len(rows)}개 검수 항목. 프레임 전체 검수 → 수정·재검수 → UI 의사결정 → 테마 선택.\n', encoding='utf-8')
print(f'{len(rows)} screen entries documented')
