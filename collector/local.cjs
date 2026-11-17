#!/usr/bin/env node
// 내 컴퓨터(맥/윈도우)에서 한국 IP로 수집 — 어드민의 "URL로 수집"과 같은 결과를 내 PC의 네트워크(휴대폰 테더링 등)로 만듭니다.
// 사용: node collector/local.cjs            (대화형)
//       node collector/local.cjs --url https://... --competitor 차즘 [--crawl|--flow|--single] [--max-pages 30]
// 어드민 주소/비밀번호는 처음 한 번만 묻고 ~/.goranisee.json 에 저장합니다.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process'), readline = require('readline');
const ROOT = path.resolve(__dirname, '..');
const CFG = path.join(os.homedir(), '.goranisee.json');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, d) => new Promise((r) => rl.question(d ? `${q} [${d}] ` : `${q} `, (a) => r((a || d || '').trim())));

(async () => {
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch {}
  cfg.adminUrl = (process.env.FUNNEL_ADMIN_URL || cfg.adminUrl || await ask('어드민 주소', 'https://goranisee.cardt.workers.dev')).replace(/\/+$/, '');
  cfg.adminPw = process.env.FUNNEL_ADMIN_PASSWORD || cfg.adminPw || await ask('어드민 비밀번호');
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });

  // playwright 준비 (처음 한 번)
  let hasPw = false; try { require.resolve('playwright', { paths: [ROOT] }); hasPw = true; } catch {}
  if (!hasPw) { console.log('처음 실행: 브라우저 엔진 설치 중 (1~2분)…'); spawnSync('npm', ['i', '--no-save', '--no-package-lock', 'playwright@1.47.2'], { cwd: ROOT, stdio: 'inherit', shell: true }); spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: ROOT, stdio: 'inherit', shell: true }); }

  const once = async (url, competitor, mode, maxPages) => {
    const id = 'local-' + Date.now().toString(36);
    const a = ['collector/funnel_collector.cjs', '--url', url, '--competitor', competitor, '--device', '모바일', '--request-id', id];
    if (mode === 'crawl') a.push('--crawl', '--max-pages', String(maxPages || 30)); else if (mode === 'flow') a.push('--flow');
    console.log(`\n▶ ${competitor} · ${mode === 'crawl' ? '사이트 전체' : mode === 'flow' ? '신청까지 흐름' : '이 페이지만'} · ${url}`);
    const r = spawnSync(process.execPath, a, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, FUNNEL_ADMIN_URL: cfg.adminUrl, FUNNEL_ADMIN_PASSWORD: cfg.adminPw } });
    console.log(r.status === 0 ? `✔ 어드민에 올라갔습니다 → ${cfg.adminUrl} (수집 이력 탭)` : `✖ 실패 (코드 ${r.status}) — 위 로그를 확인하세요`);
  };

  if (arg('--url')) { await once(arg('--url'), arg('--competitor', '경쟁사'), args.includes('--flow') ? 'flow' : args.includes('--single') ? 'single' : 'crawl', arg('--max-pages')); rl.close(); return; }
  console.log('경쟁사 페이지를 내 컴퓨터 네트워크로 수집합니다. 빈 줄을 입력하면 종료.\n');
  for (;;) {
    const url = await ask('URL:'); if (!url) break;
    const competitor = await ask('경쟁사 이름:', cfg.lastCompetitor || '');
    const mode = await ask('방식 (1 사이트 전체 / 2 신청까지 흐름 / 3 이 페이지만):', '1');
    cfg.lastCompetitor = competitor; fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    await once(url, competitor, mode === '2' ? 'flow' : mode === '3' ? 'single' : 'crawl', mode === '1' ? await ask('최대 페이지 수:', '30') : null);
  }
  rl.close();
})();
