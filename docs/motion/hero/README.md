# README 모션그래픽

[`docs/images/hero.gif`](../../images/hero.gif)(한국어)와 [`docs/images/en/hero.gif`](../../images/en/hero.gif)(영어)의 원본입니다.
고화질 MP4는 같은 폴더의 `hero.mp4`입니다. 1080×1350, 39초 루프이고 5개 샷으로 되어 있습니다.

| # | 샷 | 보여주는 것 |
|---|---|---|
| 1 | 흩어짐 | Codex·Claude Code·Hermes 창에서 업무가 각자 돌고, Hermes 업무 하나가 조용히 멈춘다 |
| 2 | 연결 | `agent-office connect` 뒤 여섯 업무가 보드 열로 모이고, 멈춘 업무는 확인 필요로 간다 |
| 3 | 멈춤 대응 | 메신저 알림 → 카드 상세(상태·원인·다음) → 로그인 후 같은 세션에서 이어서 → 종료 |
| 4 | 새 업무 | 한 줄 요청, Claude Code와 추론 강도 선택 → Claude Code 창에서 실행 → 결과가 보드로 |
| 5 | 한 화면 | 결과가 이 앱·Telegram·Slack으로 전달되고, 앱 3개·업무 7개가 한 화면에 |

업무 이름과 숫자는 예시입니다. 실제 사용자 업무는 쓰지 않습니다. 화면 문구는 v0.4.0 관제센터의 열 이름과 버튼을 따릅니다.

## 다시 만들기

[Storyboarding 스킬](https://github.com/deepdivekr/Storyboarding-skill)의 kit으로 그립니다.
`build.py`는 스킬의 검사와 player를 그대로 쓰고, 한글 글리프용으로 저장소의 Pretendard(`assets/fonts`) 부분 집합을 추가합니다.

```bash
pip install playwright fonttools brotli   # ffmpeg도 필요합니다
python build.py storyboard.ko.json -o out/hero-ko.html --skill ~/.claude/skills/storyboarding
python ~/.claude/skills/storyboarding/scripts/render.py out/hero-ko.html --keyframes out/frames-ko
python ~/.claude/skills/storyboarding/scripts/render.py out/hero-ko.html --mp4 out/hero-ko.mp4 --gif out/hero-ko.gif --gif-width 640 --gif-fps 12
```

영어판은 `storyboard.en.json`으로 같은 명령을 돌립니다. 문구·업무·타이밍은 JSON에서, 그리는 코드는 `scene.js`에서 고칩니다.
