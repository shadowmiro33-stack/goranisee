# ego lite (vendored copy)

- 출처: https://github.com/citrolabs/ego-lite  (MIT License, Copyright (c) 2026 CitroLabs)
- 가져온 시점: 2026-11-10, upstream 커밋 `bacaece` (2026-11-04, v2.2.0-beta.5)
- 용도: 보관용. 나중에 "로그인 상태의 로컬 브라우저로 경쟁사 페이지를 자동 수집"할 때 쓸 후보.
  - 에이전트용 스킬: `skills/ego-browser/SKILL.md` (Claude Code에 설치하면 `ego-browser` CLI로 브라우저 조작)
  - 설치 안내: `skills/ego-browser/references/install.md` (macOS/Windows 설치 파일은 README의 다운로드 링크)
- 주의: 사용자 PC에서 돌면 그 PC의 IP가 상대 사이트에 남습니다. 회사망이 아닌 PC(핫스팟) 또는 한국 VPS에서 쓰는 것을 전제로 함.
- 이 폴더는 빌드·배포에 포함되지 않습니다 (netlify.toml ignore 규칙 참고).
