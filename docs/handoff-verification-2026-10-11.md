# 담당 AI 변경 시 MCP·스킬 승계 검증

기준: `main` **de7120d1a7cfaa6d2534fcd1e3d7e19bffae3ad2**, PR #147 병합 후.
작업 브랜치: `fix/client-handoff-verification`.

## 결과

설정에 이름만 있는 MCP와 `SKILL.md` 없는 스킬 폴더를 정상 승계로 표시하는 문제를
격리된 환경에서 재현했다. 기존 테스트 6개는 수정 전에도 모두 통과했다.
실제 운영 환경에서 잘못 인계된 업무가 있었는지는 이번 검증으로 확인하지 않았다.

임시 Work DB·Codex/Claude 설정·스킬 폴더와 loopback HTTP/MCP 서버를 사용했다.
별도 MCP 클라이언트가 initialize → tools/list → 무해한 fixture read 호출을 수행해
사용 가능 여부를 확인한 뒤, 실제 `clientHandoffCheck` 결과와 비교했다.
승계 검사 자체는 initialize와 tools/list만 수행하며 tools/call을 하지 않는 것도 검증했다.

| 격리 사례 | 실제 사용 가능 여부 | 수정 전 carried | 수정 후 carried / 화면 | 인계 지침 |
|---|---|---|---|---|
| 정상 MCP, 동일 연결 대상·필요 도구 | fixture read 성공 | true | true / 그대로 이어짐 | 해당 서버 지침 없음 |
| 설정에 이름만 있고 실행 명령·URL 없음 | 사용 불가 | true | false / 사용 가능 여부 미확인 | 연결·도구 재확인, 안 되면 대체 방법 |
| 연결 거부 | 사용 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| HTTP 404 | 사용 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| HTTP 401 | 현재 인증 없는 연결로 사용 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| HTTP 403 | 현재 연결로 사용 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| HTTP 200 HTML, MCP 아님 | 사용 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| MCP 초기 연결 시간 초과 | 제한 시간 내 확인 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| tools/list 오류 | 도구 확인 불가 | true | false / 사용 가능 여부 미확인 | 동일 |
| 빈 도구 목록 / 필요한 도구 없음 | 연결되지만 이전 도구 사용 불가 | true | false / 필요한 도구 없음 | 연결은 되지만 이전 도구가 목록에 없다고 안내 |
| 이름은 같고 대상 URL이 다른 정상 서버 | 새 서버 read 성공, 동일 서버인지는 미확인 | true | false / 사용 가능 여부 미확인 | 연결 대상 설정이 다르므로 같은 서버인지 재확인 |
| SKILL.md 없는 스킬 디렉터리 | 스킬 파일 읽기 불가 | true | false / 스킬 파일 미확인 | 읽을 수 있는 SKILL.md 미확인, 이전 파일 경로 안내 |

수정 후 추가 검증: tools/list 시간 초과, 두 번째 페이지의 도구, Windows 서버의 정상
승계, 실패한 로컬 설정이 같은 이름의 정상 Windows 서버를 가리는 경우, stdio 시작 실패,
설정 누락·disabled·지원하지 않는 SSE/인증 헤더, 검사 함수 예외, symlink·깨진 symlink·
`SKILL.md`라는 디렉터리. Codex→Claude와 Claude→Codex 정상 연결·스킬을 함께 확인했다.

Windows URL 탐색은 수정 전 GET 404 서버를 후보에 포함했고 GET 401·403은 제외했다.
단, 로컬 설정은 GET 확인도 없이 이름만으로 성공 처리하므로 로컬 401도 거짓 성공이었다.
수정 후 404는 Windows 후보에서 제외한다. 정상 POST 전용 MCP의 GET 405는 유지한다.
GET 200 HTML은 탐색 후보가 될 수 있지만 실제 MCP 검사에서 승계 성공으로 인정하지 않는다.

## 변경 사항

- `src/integrations/owner-mcp.ts`: 실제 적용되는 로컬 우선/Windows 추가 설정을 사용한다.
  현재 두 AI의 대상 설정을 비교하고, 새 AI의 연결로 MCP 초기화와 모든 tools/list 페이지를
  확인한다. 실행 이력에 나온 도구가 모두 있어야 `verified`다. 확인할 수 없는 설정·연결은
  `unverified`, 연결됐지만 필요한 도구가 없으면 `unavailable`로 반환한다.
  URL·명령·환경변수·오류 원문은 결과에 포함하지 않는다.
  기존 Aside 검사와 프로토콜 확인 코드를 공유하며, 전체 검사 시간 제한과 연결 정리를 둔다.
- `src/work/client-handoff.ts`: `verified`만 `carried=true`로 바꾼다. 검사 예외도 미확인으로
  처리한다. 스킬은 대상 AI의 설정 경로에서 읽을 수 있는 일반 파일 `SKILL.md`를 확인한다.
  기본 경로·플러그인 하위 경로·정상 파일 symlink를 유지한다.
- `src/observability/work-ui.ts`: 미확인·필요 도구 없음·스킬 파일 미확인을 구분한다.
  인계 지침은 확인 실패를 기능 부재로 단정하지 않고 재확인과 대체 방법을 안내한다.
- 기존 회귀 테스트의 정상 스킬 fixture에 실제 `SKILL.md`를 추가하고, 새 네이티브
  MCP/stdio 테스트 및 화면 표시 계약 테스트를 추가했다.

실제 화면 렌더링 함수에 검사 응답을 넣어 한국어·영어 목록과 인계 textarea를 검증했다.
브라우저 스크린샷·실제 사용자 화면 조작에 의한 수용 테스트는 아니다.

## 검증 명령과 범위

Node **22.22.0**, npm **11.11.0**. 잠금 파일의 의존성으로 빌드했다.

```sh
npm run build
node --test tests/runtime-client-handoff.test.mjs \
  tests/runtime-client-handoff-verification.test.mjs \
  tests/runtime-owner-mcp.test.mjs tests/runtime-work-client-run.test.mjs
npm run test:runtime
npm run ledger:verify
```

- 빌드 성공.
- 위 관련 테스트 **56/56 통과**, 실패·건너뜀 없음.
- 화면 문구·상태 회귀 테스트(`runtime-ui-copy-coverage`, `runtime-work-live-status-ui`)
  **19/19 통과**. 위 관련 검사와 합계 **75개 통과**.
- `ledger:verify`: **199개 요구사항 통과**.
- 공개 경계 검사: 895개 파일 검사, PASS.
- 전체 quick suite: **환경 차단으로 미완료**. `runtime-adaptive-pack` 브라우저 사례에서
  Playwright Chromium v1243 실행 파일 누락으로 실패했고, 실패 후 열린 fixture 때문에
  진행이 멈춰 중단했다. `playwright install chromium`은 배포 파일을 유효한 ZIP으로
  내려받지 못해 실패했다(`End of central directory record signature not found`).
  전체 통과로 보고하지 않으며, 해당 런타임과 브라우저가 준비된 CI에서 재실행이 필요하다.

## 남는 한계

- 현재 실행 이력에는 MCP 서버·도구 이름만 있다. 연결 대상 비교는 **현재 두 AI의 설정**을
  기준으로 하며, 과거 실행 시점의 실제 endpoint/account 동일성까지 증명하지 않는다.
  연결 대상 설정이 다르면 같은 이름과 같은 도구 목록만으로 승계를 인정하지 않는다.
- 인증 헤더·SSE·정확히 해석할 수 없는 설정은 정상 기능일 수도 있으나 미확인으로 남긴다.
  실제 클라이언트의 별도 인증 저장소를 읽거나 로그인하지 않는다.
- `verified`는 검사 시점의 설정·MCP 연결·도구 목록에 한정된다. 실제 업무 도구의 권한과
  호출 성공, 향후 연결 지속성까지 보장하지 않는다. 외부 효과가 있는 도구를 시험 호출하지 않는다.
- 스킬 판정은 읽을 수 있는 `SKILL.md`의 존재를 확인한다. 스킬 내용의 정확성이나 필요한
  외부 의존성이 모두 갖춰졌다는 수용 판정은 아니다.
- 사용자 설치·서비스·실제 업무 DB·예약 작업은 변경하지 않았다. 릴리스와 설치 반영은 별도다.
