// warm-host Task 7b 探针：寄养人列表页 + 详情页（纯前端）
// Node 22+ 原生 fetch，无需依赖
//
// 覆盖 7 项测试：
//   1. GET /hosts.html → 200，含筛选面板、品种 chips、日期 input、搜索按钮、卡片容器、空状态
//   2. GET /host-detail.html → 200，含头部卡、基本信息、可接单日期区、评分分布、评价列表、底部 CTA
//   3. GET /js/pages/hosts.js → 200，含 URL 参数解析、URL 同步、加载更多
//   4. GET /js/pages/host-detail.js → 200，含 id 参数解析、Promise.all、404 处理、CTA toast
//   5. style.css 含新增类名
//   6. 功能联调：注册寄养人 + admin verify → 通过 search 拿到 hostId → 页面 URL 可达
//   7. 所有 JS 文件 node --check 通过

const BASE = 'http://127.0.0.1:8787';
const REPO = __dirname + '/..';
let passCount = 0;
let failCount = 0;
let checks = 0;

function ok(name, cond) {
  checks++;
  if (cond) { passCount++; console.log(`  ✅ ${name}`); }
  else { failCount++; console.log(`  ❌ ${name}`); }
}

async function req(method, path, { body, headers = {}, isJson = true, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (isJson) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.body = body;
    }
  }
  const resp = await fetch(BASE + path, opts);
  if (raw) return resp;
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: resp.status, data, text, headers: resp.headers, url: resp.url };
}

function readFileSync(p) {
  return require('fs').readFileSync(p, 'utf8');
}

async function main() {
  const runId = Date.now().toString(36).slice(-6);
  console.log(`\n=== Task 7b 探针 · runId=${runId} ===`);

  // ============ 1. GET /hosts.html ============
  console.log('\n=== 1. hosts.html 静态页面 ===');
  const r1 = await req('GET', '/hosts.html');
  ok('status=200', r1.status === 200);
  const h1 = r1.text || '';
  ok('含筛选面板 .filter-panel', h1.includes('filter-panel'));
  ok('含品种 chips #f-species-chips', h1.includes('f-species-chips') && h1.includes('data-value="猫"') && h1.includes('data-value="狗"'));
  ok('含日期 input type=date', h1.includes('type="date"'));
  ok('含搜索按钮 #btn-search', h1.includes('btn-search'));
  ok('含卡片容器 #host-list', h1.includes('host-list'));
  ok('含空状态 #empty-state', h1.includes('empty-state'));
  ok('含 header 标题"找寄养人"', h1.includes('找寄养人'));
  ok('含 header 返回链接 /index.html', h1.includes('/index.html'));
  ok('引用 /js/pages/hosts.js', h1.includes('/js/pages/hosts.js'));

  // ============ 2. GET /host-detail.html ============
  console.log('\n=== 2. host-detail.html 静态页面 ===');
  const r2 = await req('GET', '/host-detail.html');
  ok('status=200', r2.status === 200);
  const h2 = r2.text || '';
  ok('含头部卡 #detail-header', h2.includes('detail-header'));
  ok('含基本信息卡 info-card', h2.includes('info-card'));
  ok('含可接单日期 #detail-availability', h2.includes('detail-availability'));
  ok('含评分分布 .rating-summary + .rating-bar', h2.includes('rating-summary') && h2.includes('rating-bar'));
  ok('含评价列表 #reviews-list', h2.includes('reviews-list'));
  ok('含底部悬浮 CTA #cta-wrap + #btn-cta', h2.includes('cta-wrap') && h2.includes('btn-cta'));
  ok('CTA 默认 disabled', h2.includes('disabled'));
  ok('含 loading-state + not-found-state', h2.includes('loading-state') && h2.includes('not-found-state'));
  ok('引用 /js/pages/host-detail.js', h2.includes('/js/pages/host-detail.js'));
  ok('含 header 返回链接 /hosts.html', h2.includes('/hosts.html'));

  // ============ 3. GET /js/pages/hosts.js ============
  console.log('\n=== 3. hosts.js 前端逻辑 ===');
  const r3 = await req('GET', '/js/pages/hosts.js');
  ok('status=200', r3.status === 200);
  const js3 = r3.text || '';
  ok('含 URLSearchParams（URL 参数解析）', js3.includes('URLSearchParams'));
  ok('含 history.replaceState（URL 同步）', js3.includes('history.replaceState'));
  ok('含 loadMore / 加载更多', js3.includes('loadMore') || js3.includes('load-more') || js3.includes('load(true)'));
  ok('含 from/to 参数', js3.includes("state.from") && js3.includes("state.to"));
  ok('含 district/species/size/sort 状态', js3.includes('district') && js3.includes('species') && js3.includes('size') && js3.includes('sort'));
  ok('含 renderCard 卡片渲染', js3.includes('renderCard'));
  ok('含 renderStars 星级渲染', js3.includes('renderStars'));
  ok('含 formatPrice 价格格式化', js3.includes('formatPrice'));

  // ============ 4. GET /js/pages/host-detail.js ============
  console.log('\n=== 4. host-detail.js 前端逻辑 ===');
  const r4 = await req('GET', '/js/pages/host-detail.js');
  ok('status=200', r4.status === 200);
  const js4 = r4.text || '';
  ok('含 id 参数解析 (p.get(\'id\'))', js4.includes("p.get('id')"));
  ok('含 Promise.all 并行加载', js4.includes('Promise.all'));
  ok('含 404 处理 showNotFound', js4.includes('showNotFound'));
  ok('含 CTA 邀请接单逻辑（/invite + 需求选择器）', js4.includes('/invite') && js4.includes('showNeedPicker'));
  ok('含 availability 可接单日期渲染', js4.includes('availability') && js4.includes('startDate'));
  ok('含 ratingDistribution 分布条形图', js4.includes('ratingDistribution') || js4.includes('rating-bar'));
  ok('含 reviews 加载更多 loadMoreReviews', js4.includes('loadMoreReviews'));

  // ============ 5. style.css 新增类名 ============
  console.log('\n=== 5. style.css 新增类名 ===');
  const r5 = await req('GET', '/css/style.css');
  ok('status=200', r5.status === 200);
  const css = r5.text || '';
  const newClasses = [
    '.filter-panel', '.host-card', '.badge-verified', '.badge-sponsored',
    '.badge-availability', '.rating-bar', '.detail-header', '.cta-fixed',
    '.empty-state', '.skeleton', '.host-avatar', '.availability-item',
    '.review-card', '.rating-summary', '.rating-avg-num', '.info-card',
  ];
  for (const cls of newClasses) {
    ok(`含类名 ${cls}`, css.includes(cls));
  }

  // ============ 6. 功能联调：admin 注册 + apply + verify → search → 页面 ============
  console.log('\n=== 6. 功能联调：真实寄养人 → 页面 ===');
  // admin 登录
  const login = await req('POST', '/api/auth/login', {
    body: { phone: 'admin', password: 'admin123' },
  });
  ok('admin 登录 200', login.status === 200);
  ok('获得 admin token', !!login.data?.token);
  if (!login.data?.token) { console.error('admin 登录失败，终止 6 项测试'); }
  const H_ADMIN = { Authorization: `Bearer ${login.data.token}` };

  // 生成 1 个新邀请码
  const gen = await req('POST', '/api/admin/invite-codes', {
    body: { count: 1 }, headers: H_ADMIN,
  });
  ok('生成邀请码 200', gen.status === 200);
  const code = gen.data?.codes?.[0];
  ok('获得邀请码', !!code);

  // 生成唯一手机号
  const base = Date.now();
  const phone = '139' + String(base % 100000000).padStart(8, '0').slice(-8); // 3 + 8 = 11
  ok(`测试手机号长度=11 (实际=${phone.length})`, phone.length === 11);

  // 注册
  const reg = await req('POST', '/api/auth/register', {
    body: { phone, password: 'test123', nickname: `寄养7B_${runId}`, inviteCode: code },
  });
  ok('注册 200', reg.status === 200);
  ok('获得 token', !!reg.data?.token);
  if (reg.data?.token) {
    const H = { Authorization: `Bearer ${reg.data.token}` };
    const userId = reg.data.user.id;

    // apply
    const apply = await req('POST', '/api/hosts/apply', {
      body: {
        bio: '7B 测试寄养人 · 家有柯基，5 年养宠经验',
        capacity_count: 2,
        capacity_species: ['猫', '狗'],
        capacity_size: ['中型', '小型'],
        capacity_gender: ['公', '母'],
        address_fuzzy: '望京SOHO附近',
        district: '朝阳区',
        experience: '养过 3 只柯基，英短 5 年',
        special_services: ['有隔离空间', '可上门接送'],
        daily_rate_cents: 15000,
      },
      headers: H,
    });
    ok('apply 200', apply.status === 200);
    ok('apply hostStatus=pending', apply.data?.hostStatus === 'pending');

    // admin verify
    const v = await req('POST', `/api/admin/hosts/${userId}`, {
      body: { action: 'verify' }, headers: H_ADMIN,
    });
    ok('admin verify 200', v.status === 200);
    ok('verify status=active', v.data?.status === 'active');

    // 拿到 hostId
    const active = await req('GET', '/api/admin/hosts?status=active', { headers: H_ADMIN });
    const found = (active.data || []).find(x => x.id === userId);
    ok('找到 verify 后的寄养人', !!found);
    const hostId = found?.hostProfile?.id;
    ok('拿到 hostId', !!hostId);

    if (hostId) {
      // 设置 availability
      const avail = await req('PUT', '/api/hosts/me/availability', {
        body: [{ start_date: '2026-10-01', end_date: '2026-10-10', note: '国庆可接' }],
        headers: H,
      });
      ok('设置 availability 200', avail.status === 200);

      // 通过 search 拿到（带日期区间，才能算 availableDays）
      const s = await req('GET', `/api/hosts/search?district=${encodeURIComponent('朝阳区')}&from=2026-10-01&to=2026-10-05`);
      ok('search 200', s.status === 200);
      const foundInSearch = (s.data?.hosts || []).find(h => h.hostId === hostId);
      ok('search 返回该寄养人', !!foundInSearch);
      if (foundInSearch) {
        ok(`search 返回 availableDays>0 (实际=${foundInSearch.availableDays})`, foundInSearch.availableDays > 0);
      }

      // 详情页可达
      const d = await req('GET', `/api/hosts/${hostId}`);
      ok('详情 GET 200', d.status === 200);
      ok('详情返回 host 对象', !!d.data?.host);
      ok('详情含 availability', Array.isArray(d.data?.availability) && d.data.availability.length > 0);

      // 前端页面带 ?id=<hostId> 访问（只验证 HTML 可达，前端 JS 会在浏览器里跑 API）
      const page = await req('GET', `/host-detail.html?id=${hostId}`);
      ok('详情页 HTML 可达 200', page.status === 200);
      ok('详情页 HTML 含 CTA + disabled', (page.text || '').includes('btn-cta') && (page.text || '').includes('disabled'));

      // 列表页带筛选参数可达
      const list = await req('GET', `/hosts.html?district=${encodeURIComponent('朝阳区')}&species=${encodeURIComponent('猫')}`);
      ok('列表页 HTML 可达 200', list.status === 200);
    }

    // 清理：ban 测试用户，避免污染后续测试
    const ban = await req('POST', '/api/admin/users/ban', {
      body: { userId, banned: 1, reason: 'Task 7b cleanup' }, headers: H_ADMIN,
    });
    ok('cleanup ban 200', ban.status === 200);
  } else {
    console.log('  (跳过后续步骤：注册未成功)');
  }

  // ============ 7. node --check 所有 JS 文件 ============
  console.log('\n=== 7. node --check 语法检查 ===');
  const { execFileSync } = require('child_process');
  const jsFiles = [
    'public/js/pages/hosts.js',
    'public/js/pages/host-detail.js',
  ];
  for (const rel of jsFiles) {
    const fullPath = REPO + '/' + rel;
    try {
      execFileSync('node', ['--check', fullPath], { stdio: 'pipe' });
      ok(`node --check ${rel} 通过`, true);
    } catch (e) {
      ok(`node --check ${rel} 通过`, false);
      console.log('  stderr:', e.stderr?.toString() || e.message);
    }
  }
  // 顺带检查已有 JS 都还 OK
  const existingJs = [
    'public/js/api.js',
    'public/js/pages/my.js',
    'public/js/pages/admin.js',
    'public/js/pages/auth.js',
  ];
  for (const rel of existingJs) {
    const fullPath = REPO + '/' + rel;
    try {
      execFileSync('node', ['--check', fullPath], { stdio: 'pipe' });
      ok(`node --check ${rel} 通过`, true);
    } catch (e) {
      ok(`node --check ${rel} 通过`, false);
    }
  }

  // ============ 汇总 ============
  console.log('\n================================================');
  console.log(`总计: ✅ ${passCount} 通过, ❌ ${failCount} 失败 (共 ${checks} 项断言, 覆盖 7 项测试)`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
