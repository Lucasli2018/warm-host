// tests/probe-task15.js
// Task 15 — 首页 index.html + 全局底部 Tab 导航 + /api/stats 探针
//
// 运行：node tests/probe-task15.js
// 前提：wrangler pages dev 已在 http://localhost:8787 运行

const BASE = 'http://localhost:8787';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    console.log('  ✗', name, detail ? `— ${detail}` : '');
    failures.push(name + (detail ? `: ${detail}` : ''));
  }
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
}

async function fetchText(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

(async () => {
  console.log('\n=== Task 15 · probe ===\n');

  // ---- 1. GET / and GET /index.html both 200 ----
  console.log('[1] GET / and /index.html');
  {
    const r1 = await fetchText(BASE + '/');
    assert('GET / returns 200', r1.status === 200, `status=${r1.status}`);
    const r2 = await fetchText(BASE + '/index.html');
    assert('GET /index.html returns 200', r2.status === 200, `status=${r2.status}`);
  }

  // ---- 2. index.html content checks ----
  console.log('[2] index.html content');
  const idxRes = await fetchText(BASE + '/');
  const idxHtml = idxRes.text;
  assert('contains brand name 暖木家', idxHtml.includes('暖木家'));
  assert('contains hero title 给毛孩子', idxHtml.includes('给毛孩子'));
  assert('contains hero title 找一个温暖的家', idxHtml.includes('找一个温暖的家'));
  assert('contains CTA 找寄养人', idxHtml.includes('找寄养人'));
  assert('contains CTA 我要寄养', idxHtml.includes('我要寄养'));
  assert('contains 3 value cards (实名审核/真实评价/首单担保)',
    idxHtml.includes('实名审核') && idxHtml.includes('真实评价') && idxHtml.includes('首单担保'));
  assert('contains 2 date inputs (search-from / search-to)',
    idxHtml.includes('id="search-from"') && idxHtml.includes('id="search-to"') &&
    (idxHtml.match(/type="date"/g) || []).length >= 2);
  assert('contains 4 trust items (实名审核/首单担保/真实评价/黑名单公示)',
    idxHtml.includes('黑名单公示'));
  assert('contains app.js script tag', idxHtml.includes('/js/app.js'));
  assert('contains index.js script tag', idxHtml.includes('/js/pages/index.js'));

  // ---- 3. GET /api/stats ----
  console.log('[3] GET /api/stats');
  {
    const r = await fetchJson(BASE + '/api/stats');
    assert('GET /api/stats returns 200', r.status === 200, `status=${r.status}`);
    const b = r.body || {};
    const keys = ['hosts', 'pets', 'needs', 'orders', 'reviews', 'todayOrders'];
    let allNum = true, detail = '';
    for (const k of keys) {
      const v = b[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        allNum = false;
        detail += ` ${k}=${v}`;
      }
    }
    assert('stats returns 6 numeric fields >= 0', allNum, `body=${JSON.stringify(b)}${detail}`);
  }

  // ---- 4. static assets under wrangler ----
  console.log('[4] static assets');
  {
    const r1 = await fetchText(BASE + '/js/app.js');
    assert('GET /js/app.js returns 200', r1.status === 200, `status=${r1.status}`);
    const r2 = await fetchText(BASE + '/css/style.css');
    assert('GET /css/style.css returns 200', r2.status === 200, `status=${r2.status}`);
  }

  // ---- 5. app.js referenced in all pages ----
  console.log('[5] app.js referenced in pages');
  {
    const pages = ['hosts.html', 'my.html', 'host-detail.html', 'admin.html', 'auth.html'];
    for (const p of pages) {
      const r = await fetchText(BASE + '/' + p);
      assert(`${p} references /js/app.js`, r.text.includes('/js/app.js'), `status=${r.status}`);
    }
  }

  // ---- 6. app.js content checks ----
  console.log('[6] app.js content');
  {
    const r = await fetchText(BASE + '/js/app.js');
    const js = r.text;
    assert('contains 5 tab definitions (home/hosts/pets/needs/profile)',
      js.includes("'home'") && js.includes("'hosts'") &&
      js.includes("'pets'") && js.includes("'needs'") && js.includes("'profile'"));
    assert('contains mobile check (window.innerWidth)', js.includes('window.innerWidth'));
    assert('contains tabchange event dispatch', js.includes("CustomEvent('tabchange'") || js.includes('CustomEvent("tabchange"'));
    assert('contains active highlight logic (classList.toggle active)',
      js.includes('classList.toggle') && js.includes('active'));
    assert('contains bottom-tab-bar class', js.includes('bottom-tab-bar'));
  }

  // ---- 7. my.js contains tabchange listener ----
  console.log('[7] my.js tabchange listener');
  {
    const r = await fetchText(BASE + '/js/pages/my.js');
    const js = r.text;
    assert('my.js contains tabchange listener',
      js.includes("addEventListener('tabchange'") || js.includes('addEventListener("tabchange"'));
  }

  // ---- 8. style.css contains all new class names ----
  console.log('[8] style.css contains new classes');
  {
    const r = await fetchText(BASE + '/css/style.css');
    const css = r.text;
    const classes = [
      '.home-hero', '.home-cta', '.home-value-cards', '.home-value-card',
      '.home-stats', '.home-stat-item', '.home-stat-num', '.home-stat-label',
      '.home-search', '.home-steps', '.home-step',
      '.home-trust', '.home-trust-item', '.home-footer',
      '.bottom-tab-bar', '.bottom-tab', '.bottom-tab.active',
      '.bottom-tab-icon', '.bottom-tab-label',
    ];
    for (const cls of classes) {
      assert(`style.css contains ${cls}`, css.includes(cls));
    }
  }

  // ---- 9. node --check all changed JS ----
  console.log('[9] node --check all changed JS');
  {
    const files = [
      'functions/api/stats/index.js',
      'public/js/app.js',
      'public/js/pages/index.js',
      'public/js/pages/my.js',
      'public/js/api.js',
      'public/js/notifications.js',
    ];
    for (const f of files) {
      const full = path.join('F:\\LLM\\warm-host', f.replace(/\//g, '\\'));
      const exists = fs.existsSync(full);
      assert(`${f} exists`, exists);
      if (!exists) continue;
      // Use child_process to run node --check
      const { execSync } = require('child_process');
      try {
        execSync(`node --check "${full}"`, { stdio: 'pipe' });
        assert(`${f} node --check passes`, true);
      } catch (err) {
        assert(`${f} node --check passes`, false, err.stderr?.toString() || err.message);
      }
    }
  }

  // ---- summary ----
  console.log('\n=== Summary ===');
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  -', f);
    process.exit(1);
  } else {
    console.log('\nAll checks passed ✅');
    process.exit(0);
  }
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
