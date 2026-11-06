# 경쟁사 퍼널 스냅샷 수집 (collector/)

경쟁사 공개 페이지를 퍼널 단계별로 열어 **화면 요소 JSON + 전체 스크린샷**을 날짜별로 쌓습니다.
GitHub Actions 러너에서 실행되므로 사내 IP가 경쟁사에 남지 않습니다.

```
collector/
  funnel_targets.json   수집 대상 (사이트 · 단계 · URL · 뷰포트)
  funnel_collector.cjs   Playwright 수집기
snapshots/
  index_latest.json     최근 실행 요약
  <site>/<stage>/<YYYY-MM-DD>.json|.jpg           모바일(390px, 2x) 추출 결과·전체 스크린샷
  <site>/<stage>/<YYYY-MM-DD>.desktop.json|.jpg   데스크톱(1280px) 동일
  <site>/<stage>/latest[.desktop].json|.jpg       최신본 복사
.github/workflows/funnel_snapshot.yml   매주 월요일 10:23 KST + 수동 실행
```

## goranisee 어드민 연동 (https://goranisee.netlify.app)

수집 결과는 크롬 확장 프로그램이 보내는 것과 같은 형식으로 어드민 `/api/captures`에 자동 전송됩니다.
어드민 비교표·수집 이력·AI 프롬프트에 "자동 수집" 메모가 달린 행으로 나타납니다.

설정 (GitHub → Settings → Secrets and variables → Actions):

| Secret | 값 |
|---|---|
| `FUNNEL_ADMIN_URL` | (선택) 기본값 `https://goranisee.netlify.app` — 다른 주소일 때만 |
| `FUNNEL_ADMIN_PASSWORD` | 어드민 `ADMIN_PASSWORD`와 같은 값 |

둘 중 하나라도 없으면 전송을 건너뛰고 저장소에만 쌓습니다. 단계 이름은 `funnel_targets.json`의 `stages[].adminStage`로 어드민 선택지에 맞춥니다
(첫 화면(랜딩) / 카테고리/상품 목록 / 상품 상세 / 장바구니 / 결제 / 회원가입/로그인 / 이벤트/기획전 / 기타).
어드민에 보내는 스크린샷은 확장과 같은 "보이는 화면"이고, 전체 페이지 스크린샷은 저장소에만 남습니다.
같은 날 다시 실행하면 같은 id(`auto-<site>-<stage>-<날짜>`)로 덮어씁니다.

## 어드민 "URL로 수집" (즉시 수집)

어드민에서 URL을 넣으면 `funnel_capture_request.yml`이 `repository_dispatch`(`funnel_capture`)로 실행되어 그 URL 하나를 바로 수집하고 어드민으로 보냅니다.
결과는 `snapshots/adhoc/<단계>/<날짜>_<요청id>_<사이트>.json|.jpg` 에 남습니다. 어드민 쪽 설정은 goranisee README 2-C 참고.

## 실행

- 자동: 매주 월요일. GitHub → Actions → *Competitor Funnel Snapshot* → **Run workflow** 로 수동 실행 (사이트·단계 지정 가능).
- 로컬:
  ```bash
  npm i -D playwright && npx playwright install chromium
  node collector/funnel_collector.cjs                 # 전체
  node collector/funnel_collector.cjs --site encar    # 사이트 하나
  node collector/funnel_collector.cjs --stage home    # 단계 하나
  ```
  로컬 실행은 내 PC IP로 접속합니다. 회사망에서는 Actions 실행을 권장합니다.

## 추출 JSON 구조 (한 페이지 = 한 파일)

| 필드 | 내용 |
|---|---|
| `hero[]` | 첫 화면(뷰포트 1.2배 이내)에서 가장 큰 텍스트 3개와 소구점 분류 |
| `ctas[]` | 버튼·링크 중 CTA로 판단한 것. `text`, `pos{x,y}`(페이지 대비 비율), `fixed`(고정 여부), `fullWidth`, `bg`, `fontSize`, `appeal[]` |
| `promo[]` | 추천·인기·함께 구매·배너 등 노출 영역. `label`(섹션 제목·명목), `pos`, `items`(카드 수), `kind`(reco/ad/banner) |
| `overlays[]` | 트리거별(`load+3s`, `scroll>30%` …) 팝업·플로팅·고정바. `kind`, `purpose`(app_install/coupon/first_purchase/contact/cta…), `position`, `viewportArea` |
| `appeals` | 본문에서 뽑은 긴급성·신뢰·가격/혜택 문구 |
| `style` | 디자인 근거: `brand[]`(채도 높은 주색과 면적 비중), `palette[]`, `fonts`(본문·제목 글꼴, 기준 크기, 굵은 글자 비중), `cta`(대표 CTA의 배경·글자색·명도 대비·높이·폭 비율·고정 여부, 고정/전폭/채도 CTA 수, 평균 높이, 사용 색), `fixedViewportShare`(첫 화면에서 고정 요소가 차지하는 면적 비율) |
| `screenshot` | 같은 폴더의 JPG 파일명 |

`pos.y`는 페이지 높이 대비 비율(0~1)이라 뷰어에서 스크린샷 위에 핀을 자동으로 찍는 데 씁니다.

## 화면 폭

`funnel_targets.json`의 `viewports`에 모바일(390)·데스크톱(1280)이 있어 한 번 실행에 두 폭을 모두 찍습니다. 어드민에는 각각 `모바일`·`데스크톱`으로 쌓여 "화면" 필터로 나눠 봅니다.
페이지에 `urlDesktop`이 있으면 데스크톱은 그 주소(예: `www.` 도메인)로 엽니다. 어드민 "URL로 수집"은 기본이 둘 다이며 하나만 고를 수 있습니다.

## 대상 추가

`funnel_targets.json`의 `sites[].pages[]`에 `{ "stage": "...", "url": "..." }` 를 추가합니다.
매물 상세처럼 URL이 매번 바뀌는 단계는 `{ "stage": "detail", "followFrom": "list", "linkSelector": "a[href*='detail']" }` 로 리스트 첫 링크를 따라갑니다.

## 원칙·한계

- 공개 페이지 GET만 합니다. 로그인, 폼 제출, 클릭 자동화는 하지 않습니다. 상담 신청·결제 단계는 뷰어에 **수동 업로드**로 보완합니다.
- 텍스트의 휴대폰 번호·차량 번호판은 마스킹해 저장합니다. 스크린샷은 원본이므로 외부 공유 전 확인이 필요합니다.
- 헤드리스 브라우저를 차단하는 사이트는 `error` 필드와 `.error.jpg`가 남습니다. 그 사이트는 수동 캡처로 전환합니다.
- CTA·추천·팝업 분류는 휴리스틱(문구·위치·고정 여부 기반)입니다. 사이트별로 틀리는 항목은 뷰어에서 핀을 수정하면 됩니다.
- 실행 주기는 주 1회가 기본입니다. 수집 빈도를 높일 때는 상대 사이트 약관을 먼저 확인하세요.
