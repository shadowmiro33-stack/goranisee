# 경쟁사 퍼널 비교 수집기

경쟁사 사이트의 마케팅 소구점·CTA·광고/추천 영역을 퍼널 단계별로 수집하고, 팀이 함께 보는 어드민에서 비교하는 도구입니다.

- `extension/` — 크롬 확장 프로그램 (수집 도구). 경쟁사 페이지에서 버튼 한 번으로 헤드라인·CTA·혜택 문구·팝업·추천/광고 섹션·스크린샷을 수집해 어드민으로 전송합니다.
- `public/`, `netlify/functions/`(Netlify) 및 `api/`(Vercel) — 어드민 (조회 화면). 비밀번호 로그인, 경쟁사 × 퍼널 단계 비교표, 수집 이력·변화 추적, CSV 내보내기, AI 분석용 프롬프트 생성.
- `collector/`, `.github/workflows/` — 자동 수집 (Playwright, GitHub Actions). URL 즉시 수집과 주간 수집.
- `schema.sql` — Supabase 테이블.

---

## 1. 서버(어드민) 올리기 — 처음 한 번, 약 10분

### 1-1. Supabase (무료 DB)
1. https://supabase.com 가입 → **New project** (리전은 Northeast Asia(Seoul) 권장, DB 비밀번호는 아무거나).
2. 왼쪽 **SQL Editor** → 이 저장소의 `schema.sql` 내용을 붙여넣고 **Run**.
3. **Project Settings → API** 에서 두 값을 복사해 둡니다.
   - `Project URL` → `SUPABASE_URL`
   - `service_role` 키 (secret) → `SUPABASE_SERVICE_KEY` ※ 절대 외부에 공개하지 마세요.

### 1-2. Netlify (또는 Vercel — 둘 다 됩니다)
**Netlify**: https://app.netlify.com → **Add new site → Import an existing project** → GitHub에서 `goranisee` 선택. 빌드 설정은 저장소의 `netlify.toml`이 알아서 잡으니 그대로 두고, **Site configuration → Environment variables** 에 세 개 추가:

**Vercel**: https://vercel.com → **Add New → Project** → `goranisee` 선택 → Framework Preset **Other** → **Environment Variables** 에 세 개 추가:

   | 이름 | 값 |
   |---|---|
   | `SUPABASE_URL` | 1-1에서 복사한 Project URL |
   | `SUPABASE_SERVICE_KEY` | 1-1에서 복사한 service_role 키 |
   | `ADMIN_PASSWORD` | 팀이 쓸 공용 비밀번호 (길고 어렵게) |

3. **Deploy**. 끝나면 `https://xxxx.netlify.app`(또는 `.vercel.app`) 주소가 나옵니다. 열어서 비밀번호로 로그인되면 완료.

> 환경변수를 배포 **이후**에 넣었다면 한 번 더 배포(**Trigger deploy / Redeploy**)해야 반영됩니다. 비밀번호를 바꿀 때도 마찬가지입니다. 모든 로그인 세션이 함께 무효화됩니다.

---

## 2-A. 수집 버튼(즐겨찾기) — 회사 PC에서 확장 설치가 막힐 때 (권장)

1. 어드민에 로그인 → **수집 버튼 만들기** 탭 → 비밀번호 입력 → **버튼 생성**
2. 크롬 **Ctrl+Shift+B**로 즐겨찾기 바 표시 → 파란 **📌 퍼널 수집** 버튼을 즐겨찾기 바로 드래그
3. 경쟁사 페이지에서 그 즐겨찾기 클릭 → 오른쪽 위 패널에서 경쟁사·단계 선택 → **이 페이지 캡처**

확장과 같은 항목을 수집하지만 스크린샷은 빠집니다.

## 2-B. 크롬 확장 설치 — 개발자 모드 확장이 허용된 PC

1. 이 저장소의 `extension` 폴더를 PC에 내려받습니다. (GitHub **Code → Download ZIP** 후 압축 해제 → `extension` 폴더)
2. 크롬 주소창에 `chrome://extensions` 입력 → 오른쪽 위 **개발자 모드** 켜기.
3. **압축해제된 확장 프로그램을 로드합니다** → `extension` 폴더 선택.
4. 툴바의 퍼즐 아이콘 → **퍼널 비교 수집기** 고정.
5. 아이콘 클릭 → **어드민 연결 설정** → 1-2의 주소(예: `https://xxxx.netlify.app`)와 비밀번호 입력 → **연결 테스트** → 저장.

## 2-C. URL로 수집 — 어드민에서 주소만 넣기 (사내 IP 노출 없음)

어드민 **URL로 수집** 탭에 경쟁사 페이지 주소·경쟁사 이름·단계를 넣으면 이 저장소의 GitHub Actions(`collector/`)가 즉시 그 페이지를 열어 수집하고 1~2분 뒤 결과가 어드민에 도착합니다(archive.org의 Save Page Now와 같은 흐름). 도착하면 **화면 비교** 탭에서 바로 나란히 볼 수 있습니다.

설정 (Netlify 환경변수, 한 번만):

| 이름 | 값 |
|---|---|
| `GH_DISPATCH_TOKEN` | GitHub fine-grained PAT — 저장소 `goranisee`, 권한 **Contents: Read and write** |
| `GH_DISPATCH_REPO` | (선택) 기본 `shadowmiro33-stack/goranisee` |

이 저장소 Settings → Secrets and variables → Actions 에는 `FUNNEL_ADMIN_URL`(이 어드민 주소)와 `FUNNEL_ADMIN_PASSWORD`(`ADMIN_PASSWORD`와 같은 값)가 있어야 결과가 돌아옵니다.

## 2-D. 주간 자동 수집

`collector/funnel_targets.json`에 등록된 경쟁사·단계 URL을 매주 월요일 10:23 KST에 모바일·데스크톱 두 화면 폭으로 수집해 어드민에 보냅니다 (Actions → *Competitor Funnel Snapshot* 에서 수동 실행도 가능). 결과 원본은 `snapshots/`에 날짜별로 쌓입니다. 자세한 내용은 `collector/README.md`.

로그인이 필요한 단계(상담 신청·결제)는 자동 수집하지 않으므로 2-A/2-B로 직접 캡처합니다.

---

## 3. 사용법

1. 경쟁사 사이트를 평소처럼 엽니다.
2. 확장 아이콘 클릭 → 경쟁사 이름, 퍼널 단계(첫 화면 / 상품 목록 / 상품 상세 / 장바구니 / 결제 / 회원가입 / 이벤트), 화면(데스크톱·모바일) 선택 → **이 페이지 캡처**.
3. 같은 경쟁사의 다음 단계 페이지로 이동해 반복합니다. 경쟁사 3~4곳을 같은 단계로 모으면 비교가 됩니다.
4. **팀 어드민 열기** → 비교표에서 경쟁사별로 나란히 확인. 셀의 **상세 ›** 를 누르면 스크린샷과 전체 수집 내용이 보입니다.
5. **AI 분석용 프롬프트** 탭 → 복사 → Claude 등에 붙여 넣으면 소구점·퍼널 흐름·광고 노출 방식 비교 분석이 나옵니다.

팁
- **모바일 화면**: F12 → 기기 툴바(Ctrl+Shift+M)로 모바일 폭으로 바꾼 뒤 캡처하고, 화면을 "모바일"로 선택하세요.
- **팝업**: 첫 방문 팝업이 떠 있는 상태에서 캡처하면 팝업 내용도 같이 수집됩니다.
- **로그인 구간**(결제 등): 대리님 브라우저 세션 그대로이므로 로그인한 채로 캡처하면 됩니다. 단, 수집 데이터에 개인정보가 섞이지 않게 주문자 정보가 적힌 화면은 피하세요.
- 같은 경쟁사·같은 단계를 시간을 두고 다시 캡처하면 **수집 이력** 탭에서 소구점 변화를 추적할 수 있습니다.
- 전송이 실패하면(인터넷 끊김 등) 로컬에 보관했다가 다음 캡처 때 자동 재전송됩니다.

---

## 수집되는 항목

헤드라인(h1~h3), CTA 버튼(문구·위치·강조색·고정 여부), 혜택/소구 문구(할인·무료배송·쿠폰·후기·한정 등 키워드), 팝업/띠배너/플로팅, 추천·인기·광고 상품 섹션(제목·카드 수·위치·가격 예시), 노출 가격, 입력 폼(가입·구독), 내비게이션, 첫 화면 텍스트, 스크린샷(보이는 화면).

## 책임 있는 사용

공개된 웹페이지의 **보이는 내용**만 수집합니다. 로그인·DRM 우회, 대량 자동 크롤링은 하지 않으며, 수집한 로고·이미지·문구를 그대로 복제해 쓰지 마세요.
