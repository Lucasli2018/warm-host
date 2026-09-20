// warm-host Task 7a 探针：寄养人搜索 + 详情 + 评价 API
// Node 22 原生 fetch，无需额外依赖
//
// 覆盖 13 项测试：
//   1. GET search 无参数 → 3 个（A/B/C active），按 avgRating DESC
//   2. from=10-01 & to=10-05 → 只 A（A 覆盖）
//   3. from=10-03 & to=10-06 → 空（A 只覆盖到 10-05）
//   4. from=10-10 & to=10-15 → 只 B
//   5. species / size / district 各 1 项
//   6. sort=price 升序
//   7. page=1&pageSize=12 → total=3
//   8. availableDays 对 A 在 10-01~10-05 = 5
//   9. GET /api/hosts/[id] 详情含 availability
//  10. GET /api/hosts/[id]/reviews 空列表 ratingDistribution 全 0
//  11. admin ban 用户 A 后 search 不再返回 A
//  12. 404：不存在 host id；非 active（pending）host id
//  13. 未 ban 的 pending 寄养人不出现（host_status 过滤）
//
// 数据布局（保证测试用例互不干扰）：
//   A  朝阳区  猫+狗  中型+小型  150元  有 10-01~10-05
//   B  海淀区  狗     大型+中型  100元  有 10-10~10-15
//   C  通州区  猫+兔  小型       200元  无 availability
//   D  西城区  狗     中型       130元  pending 不 verify

const BASE = 'http://127.0.0.1:8787';
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
  return { status: resp.status, data, text, headers: resp.headers };
}

// 生成 11 位手机号：1[3-9] + 9 位数字
function genPhone(prefix3) {
  const n = Date.now();
  const suffix9 = `${(n % 1000000000).toString().padStart(9, '0')}`;
  return `${prefix3}${suffix9.slice(-8)}`; // prefix3 + 8 位 = 11 位
}

async function main() {
  const runId = Date.now().toString(36).slice(-6);
  console.log(`\n=== Task 7a 探针 · runId=${runId} ===`);

  // ============ Setup: admin 登录 ============
  console.log('\n=== Setup: admin 登录 ===');
  const login = await req('POST', '/api/auth/login', {
    body: { phone: 'admin', password: 'admin123' },
  });
  ok('admin 登录 200', login.status === 200);
  ok('获得 admin token', !!login.data?.token);
  if (!login.data?.token) { console.error('无法登录 admin，终止'); process.exit(2); }
  const H_ADMIN = { Authorization: `Bearer ${login.data.token}` };
  const adminId = login.data.user.id;

  // ============ Setup: 探测 /admin/invite-codes ============
  console.log('\n=== Setup: 探测 /admin/invite-codes ===');
  const codesProbe = await req('GET', '/api/admin/invite-codes', { headers: H_ADMIN });
  ok('GET /admin/invite-codes 200', codesProbe.status === 200);
  ok('返回 total/used/available',
    typeof codesProbe.data?.total === 'number'
    && typeof codesProbe.data?.used === 'number'
    && typeof codesProbe.data?.available === 'number');

  // ============ Setup: 清理已有寄养人（ban active + reject pending），保证 total 断言可用 ============
  console.log('\n=== Setup: 清理已有寄养人 ===');
  const cleanupActive = await req('GET', '/api/admin/hosts?status=active', { headers: H_ADMIN });
  const cleanupPending = await req('GET', '/api/admin/hosts?status=pending', { headers: H_ADMIN });
  ok('能读到 active 列表', cleanupActive.status === 200 && Array.isArray(cleanupActive.data));
  ok('能读到 pending 列表', cleanupPending.status === 200 && Array.isArray(cleanupPending.data));
  const activeCount = (cleanupActive.data || []).length;
  const pendingCount = (cleanupPending.data || []).length;
  console.log(`  清理前 active=${activeCount}, pending=${pendingCount}`);
  let cleaned = 0;
  for (const row of (cleanupActive.data || [])) {
    if (row.id === adminId) continue; // 不 ban 自己
    const r = await req('POST', '/api/admin/users/ban', {
      body: { userId: row.id, banned: 1, reason: 'task7a cleanup' }, headers: H_ADMIN,
    });
    if (r.status === 200) cleaned++;
  }
  for (const row of (cleanupPending.data || [])) {
    const r = await req('POST', `/api/admin/hosts/${row.id}`, {
      body: { action: 'reject' }, headers: H_ADMIN,
    });
    if (r.status === 200) cleaned++;
  }
  // 清理完毕，处理 ${cleaned} 条
  console.log(`  清理完毕，处理 ${cleaned} 条`);

  // admin 账号在 DB 中 host_status=active 且 isHost=true（Task 2 已激活），
  // 不会被本次清理 ban，因此后续测试统一用非-admin 过滤集
  console.log('  注：admin 账号 host_status=active，测试断言需按 userId 排除');

  // ============ Setup: 定义 4 位寄养人（A/B/C/D） ============
  console.log('\n=== Setup: 定义 4 位寄养人 ===');
  const hosts = [
    { key: 'A', prefix: '139', nick: `寄养A_${runId}`,
      district: '朝阳区', species: ['猫', '狗'], sizes: ['中型', '小型'],
      rate: 15000, services: ['有隔离空间'], bio: '家有柯基 5 年养宠经验', exp: '养过 3 只柯基', address: '望京SOHO附近' },
    { key: 'B', prefix: '159', nick: `寄养B_${runId}`,
      district: '海淀区', species: ['狗'], sizes: ['大型', '中型'],
      rate: 10000, services: ['可上门接送'], bio: '专业养犬人 大狗专长', exp: '养过大金毛 4 年', address: '五道口' },
    { key: 'C', prefix: '188', nick: `寄养C_${runId}`,
      district: '通州区', species: ['猫', '兔'], sizes: ['小型'],
      rate: 20000, services: ['宠物医院合作'], bio: '家有小猫小兔', exp: '养过 6 只猫', address: '通州万达' },
    { key: 'D', prefix: '177', nick: `寄养D_${runId}`,
      district: '西城区', species: ['狗'], sizes: ['中型'],
      rate: 13000, services: ['24小时监控'], bio: '西城养犬', exp: '养过 2 只金毛', address: '金融街' },
  ];

  // ============ Setup: 生成 4 个新邀请码 + 生成 4 个唯一手机号 ============
  console.log('\n=== Setup: 生成 4 个新邀请码（保证唯一） ===');
  const gen4 = await req('POST', '/api/admin/invite-codes', {
    body: { count: 4 }, headers: H_ADMIN,
  });
  ok('生成 4 码 200', gen4.status === 200);
  ok('返回 4 个码', (gen4.data?.codes || []).length === 4);
  const freshCodes = gen4.data?.codes || [];

  // 生成 4 个唯一手机号：1[3-9] + 8 位 = 11 位
  // 1 位开头 + 1 位 3-9 + 8 位 = 11 位
  const base = Date.now();
  hosts.forEach((h, i) => {
    const prefix = ['137', '138', '139', '135'][i]; // 3 位 1[3-9]xx
    const seed = String((base + i * 7919) % 100000000).padStart(8, '0').slice(-8);
    h.phone = prefix + seed; // 3 + 8 = 11 位
  });
  for (const h of hosts) {
    ok(`${h.key} 手机号 ${h.phone} 长度=11`, h.phone.length === 11);
    ok(`${h.key} 手机号符合 1[3-9]\\d{9}`, /^1[3-9]\d{9}$/.test(h.phone));
  }

  // ============ Setup: 注册 A/B/C/D ============
  console.log('\n=== Setup: 注册 4 位寄养人 ===');
  for (const h of hosts) {
    const code = freshCodes[hosts.indexOf(h)];
    const reg = await req('POST', '/api/auth/register', {
      body: { phone: h.phone, password: 'test123', nickname: h.nick, inviteCode: code },
    });
    ok(`${h.key} 注册 200`, reg.status === 200);
    ok(`${h.key} 获得 token`, !!reg.data?.token);
    if (reg.data?.token) {
      h.token = reg.data.token;
      h.headers = { Authorization: `Bearer ${reg.data.token}` };
      h.userId = reg.data.user.id;
    } else {
      console.error(`  注册 ${h.key} 失败:`, reg.status, reg.text);
    }
  }

  // ============ Setup: A/B/C/D 各自 apply ============
  console.log('\n=== Setup: 4 位提交申请 ===');
  for (const h of hosts) {
    const apply = await req('POST', '/api/hosts/apply', {
      body: {
        bio: h.bio,
        capacity_count: 2,
        capacity_species: h.species,
        capacity_size: h.sizes,
        capacity_gender: ['公', '母'],
        address_fuzzy: h.address,
        district: h.district,
        experience: h.exp,
        special_services: h.services,
        daily_rate_cents: h.rate,
      },
      headers: h.headers,
    });
    ok(`${h.key} apply 200`, apply.status === 200);
    ok(`${h.key} apply hostStatus=pending`, apply.data?.hostStatus === 'pending');
  }

  // ============ Setup: admin verify A/B/C（D 保持 pending） ============
  console.log('\n=== Setup: admin verify A/B/C（D 保留 pending） ===');
  const hostsActive = await req('GET', '/api/admin/hosts?status=active', { headers: H_ADMIN });
  ok('GET /admin/hosts?status=active 200', hostsActive.status === 200);
  const hostsPending = await req('GET', '/api/admin/hosts?status=pending', { headers: H_ADMIN });
  ok('GET /admin/hosts?status=pending 200', hostsPending.status === 200);
  ok('pending 列表包含 D', hostsPending.data?.some(h => h.id === hosts[3].userId));

  for (const h of hosts.slice(0, 3)) {
    const v = await req('POST', `/api/admin/hosts/${h.userId}`, {
      body: { action: 'verify' }, headers: H_ADMIN,
    });
    ok(`${h.key} verify 200`, v.status === 200);
    ok(`${h.key} verify status=active`, v.data?.status === 'active');
  }

  // ============ Setup: 拿 host_id (host_profiles.id) ============
  console.log('\n=== Setup: 获取 host_id (host_profiles.id) ===');
  const hostsAfterActive = await req('GET', '/api/admin/hosts?status=active', { headers: H_ADMIN });
  ok('GET /admin/hosts?status=active 200 (verify 后)', hostsAfterActive.status === 200);
  for (const h of hosts.slice(0, 3)) {
    const found = hostsAfterActive.data?.find(x => x.id === h.userId);
    if (found) {
      h.hostId = found.hostProfile?.id;
      ok(`${h.key} 拿到 hostId=${h.hostId?.slice(0, 8)}...`, !!h.hostId);
    } else {
      ok(`${h.key} 在 active 列表未找到（异常）`, false);
    }
  }
  // D 的 hostId（用于 pending 404 测试）
  const hostsDpending = await req('GET', '/api/admin/hosts?status=pending', { headers: H_ADMIN });
  const dFound = hostsDpending.data?.find(x => x.id === hosts[3].userId);
  if (dFound) {
    hosts[3].hostId = dFound.hostProfile?.id;
    ok(`D 拿到 hostId=${hosts[3].hostId?.slice(0, 8)}...`, !!hosts[3].hostId);
  }

  const [A, B, C, D] = hosts;

  // ============ Setup: 设置 A/B 的 availability ============
  console.log('\n=== Setup: 设置 A/B 的 availability ===');
  const availA = await req('PUT', '/api/hosts/me/availability', {
    body: [{ start_date: '2026-10-01', end_date: '2026-10-05', note: '国庆前可接' }],
    headers: A.headers,
  });
  ok('A PUT availability 200', availA.status === 200);
  ok('A availability count=1', availA.data?.count === 1);

  const availB = await req('PUT', '/api/hosts/me/availability', {
    body: [{ start_date: '2026-10-10', end_date: '2026-10-15', note: '双 11 前后' }],
    headers: B.headers,
  });
  ok('B PUT availability 200', availB.status === 200);
  ok('B availability count=1', availB.data?.count === 1);

  // C/D 不设 availability（C active 但无 availability；D pending）

  // ============ 1. GET search 无参数 → 3 个 ============
  console.log('\n=== 1. GET search 无参数 → 3 个 active（排除 admin） ===');
  const s1 = await req('GET', '/api/hosts/search');
  ok('status=200', s1.status === 200);
  ok('返回 total/page/pageSize/hosts', typeof s1.data?.total === 'number'
    && typeof s1.data?.page === 'number'
    && typeof s1.data?.pageSize === 'number'
    && Array.isArray(s1.data?.hosts));
  // 排除 admin（admin 账号在 DB 中 host_status=active，属于「非测试寄养人」）
  const nonAdmin = (r) => (r.data?.hosts || []).filter(h => h.userId !== adminId);
  ok('非 admin hosts 长度=3', nonAdmin(s1).length === 3);
  ok('total = 非 admin 数 + 1（admin 占 1 席）', s1.data?.total === nonAdmin(s1).length + 1);
  ok('page=1', s1.data?.page === 1);
  ok('pageSize=12', s1.data?.pageSize === 12);
  const ids1 = new Set(nonAdmin(s1).map(h => h.hostId));
  ok('含 A.hostId', ids1.has(A.hostId));
  ok('含 B.hostId', ids1.has(B.hostId));
  ok('含 C.hostId', ids1.has(C.hostId));
  ok('不含 D.hostId (pending)', !ids1.has(D.hostId));
  // camelCase 字段
  if (s1.data?.hosts?.[0]) {
    const h0 = s1.data.hosts[0];
    ok('含 userId', typeof h0.userId === 'string');
    ok('含 hostId', typeof h0.hostId === 'string');
    ok('含 nickname', typeof h0.nickname === 'string');
    ok('含 capacitySpecies 数组', Array.isArray(h0.capacitySpecies));
    ok('含 capacitySize 数组', Array.isArray(h0.capacitySize));
    ok('含 capacityGender 数组', Array.isArray(h0.capacityGender));
    ok('含 specialServices 数组', Array.isArray(h0.specialServices));
    ok('含 dailyRateCents 数字', typeof h0.dailyRateCents === 'number');
    ok('含 avgRating 数字', typeof h0.avgRating === 'number');
    ok('含 totalReviews 数字', typeof h0.totalReviews === 'number');
    ok('含 availableDays 数字', typeof h0.availableDays === 'number');
    ok('availableDays=0（无 from/to）', h0.availableDays === 0);
  }

  // ============ 2. from=10-01 & to=10-05 → 只 A ============
  console.log('\n=== 2. from=2026-10-01 & to=2026-10-05 → 只 A ===');
  const s2 = await req('GET', '/api/hosts/search?from=2026-10-01&to=2026-10-05');
  ok('status=200', s2.status === 200);
  ok('total=1', s2.data?.total === 1);
  ok('hosts 长度=1', (s2.data?.hosts || []).length === 1);
  ok('只含 A.hostId', s2.data?.hosts?.[0]?.hostId === A.hostId);
  ok('不含 B.hostId', !(s2.data?.hosts || []).some(h => h.hostId === B.hostId));
  ok('不含 C.hostId（无 availability）', !(s2.data?.hosts || []).some(h => h.hostId === C.hostId));

  // ============ 3. from=10-03 & to=10-06 → 空（A 只覆盖到 10-05） ============
  console.log('\n=== 3. from=2026-10-03 & to=2026-10-06 → 空 ===');
  const s3 = await req('GET', '/api/hosts/search?from=2026-10-03&to=2026-10-06');
  ok('status=200', s3.status === 200);
  ok('total=0', s3.data?.total === 0);
  ok('hosts 为空数组', Array.isArray(s3.data?.hosts) && s3.data.hosts.length === 0);

  // ============ 4. from=10-10 & to=10-15 → 只 B ============
  console.log('\n=== 4. from=2026-10-10 & to=2026-10-15 → 只 B ===');
  const s4 = await req('GET', '/api/hosts/search?from=2026-10-10&to=2026-10-15');
  ok('status=200', s4.status === 200);
  ok('total=1', s4.data?.total === 1);
  ok('只含 B.hostId', s4.data?.hosts?.[0]?.hostId === B.hostId);

  // ============ 5. species / size / district 各 1 项 ============
  console.log('\n=== 5. species / size / district 筛选 ===');
  const s5a = await req('GET', '/api/hosts/search?species=' + encodeURIComponent('狗'));
  ok('species=狗 200', s5a.status === 200);
  const s5aHosts = nonAdmin(s5a);
  ok('species=狗 包含 A 和 B，不含 C',
    s5aHosts.some(h => h.hostId === A.hostId)
    && s5aHosts.some(h => h.hostId === B.hostId)
    && !s5aHosts.some(h => h.hostId === C.hostId));

  const s5b = await req('GET', '/api/hosts/search?size=' + encodeURIComponent('小型'));
  ok('size=小型 200', s5b.status === 200);
  const s5bHosts = nonAdmin(s5b);
  ok('size=小型 包含 A 和 C，不含 B',
    s5bHosts.some(h => h.hostId === A.hostId)
    && s5bHosts.some(h => h.hostId === C.hostId)
    && !s5bHosts.some(h => h.hostId === B.hostId));

  const s5c = await req('GET', '/api/hosts/search?district=' + encodeURIComponent('海淀区'));
  ok('district=海淀区 200', s5c.status === 200);
  ok('district=海淀区 total=1（仅 B）', s5c.data?.total === 1);
  ok('district=海淀区 只含 B', s5c.data?.hosts?.[0]?.hostId === B.hostId);

  // ============ 6. sort=price 升序 ============
  console.log('\n=== 6. sort=price 升序 ===');
  const s6 = await req('GET', '/api/hosts/search?sort=price');
  ok('status=200', s6.status === 200);
  const s6Hosts = nonAdmin(s6);
  ok('非 admin hosts 长度=3', s6Hosts.length === 3);
  const rates = s6Hosts.map(h => h.dailyRateCents);
  ok(`升序排序: [${rates.join(', ')}] 应为 [10000, 15000, 20000]`,
    rates[0] === 10000 && rates[1] === 15000 && rates[2] === 20000);
  ok('首位是 B (10000)', s6Hosts[0]?.hostId === B.hostId);
  ok('末位是 C (20000)', s6Hosts[2]?.hostId === C.hostId);

  // ============ 7. page=1&pageSize=12 → total=3（非 admin） ============
  console.log('\n=== 7. page=1&pageSize=12 ===');
  const s7 = await req('GET', '/api/hosts/search?page=1&pageSize=12');
  ok('status=200', s7.status === 200);
  ok('非 admin hosts 长度=3', nonAdmin(s7).length === 3);
  ok('page=1', s7.data?.page === 1);
  ok('pageSize=12', s7.data?.pageSize === 12);

  // ============ 8. availableDays 对 A 在 10-01~10-05 = 5 ============
  console.log('\n=== 8. availableDays 对 A = 5 ===');
  const s8 = await req('GET', '/api/hosts/search?from=2026-10-01&to=2026-10-05');
  ok('status=200', s8.status === 200);
  const hA = (s8.data?.hosts || []).find(h => h.hostId === A.hostId);
  ok('A 在结果中', !!hA);
  ok('A.availableDays=5', hA?.availableDays === 5);
  // 顺带检查 partial overlap（比如 10-03 ~ 10-04 应等于 2）
  const s8b = await req('GET', '/api/hosts/search?from=2026-10-03&to=2026-10-04');
  ok('partial: 10-03~10-04 total=1', s8b.data?.total === 1);
  const hA_partial = (s8b.data?.hosts || []).find(h => h.hostId === A.hostId);
  ok('A.availableDays=2（partial overlap）', hA_partial?.availableDays === 2);

  // ============ 9. GET /api/hosts/[id] 详情含 availability ============
  console.log('\n=== 9. GET /api/hosts/[A.id] 详情 ===');
  const d9 = await req('GET', `/api/hosts/${A.hostId}`);
  ok('status=200', d9.status === 200);
  ok('返回 host 对象', !!d9.data?.host);
  ok('返回 availability 数组', Array.isArray(d9.data?.availability));
  if (d9.data?.host) {
    const h = d9.data.host;
    ok('host.hostId 正确', h.hostId === A.hostId);
    ok('host.userId 正确', h.userId === A.userId);
    ok('host.nickname 正确', h.nickname === A.nick);
    ok('host.district=朝阳区', h.district === '朝阳区');
    ok('host.capacitySpecies 含 猫 狗',
      Array.isArray(h.capacitySpecies) && h.capacitySpecies.includes('猫') && h.capacitySpecies.includes('狗'));
    ok('host.dailyRateCents=15000', h.dailyRateCents === 15000);
    ok('host.isVerified=true（verify 后）', h.isVerified === true);
  }
  ok('availability 长度=1', (d9.data?.availability || []).length === 1);
  if (d9.data?.availability?.[0]) {
    ok('availability[0].startDate=2026-10-01', d9.data.availability[0].startDate === '2026-10-01');
    ok('availability[0].endDate=2026-10-05', d9.data.availability[0].endDate === '2026-10-05');
    ok('availability[0].note 存在', typeof d9.data.availability[0].note === 'string');
  }

  // ============ 10. GET /api/hosts/[id]/reviews 空列表 ============
  console.log('\n=== 10. GET /api/hosts/[A.id]/reviews 空列表 ===');
  const r10 = await req('GET', `/api/hosts/${A.hostId}/reviews`);
  ok('status=200', r10.status === 200);
  ok('reviews 为空数组', Array.isArray(r10.data?.reviews) && r10.data.reviews.length === 0);
  ok('total=0', r10.data?.total === 0);
  ok('avgRating=0', r10.data?.avgRating === 0);
  ok('ratingDistribution 含 5 个键',
    r10.data?.ratingDistribution
    && ['1', '2', '3', '4', '5'].every(k => r10.data.ratingDistribution[k] === 0));

  // ============ 11. admin ban 用户 A 后 search 不再返回 A ============
  console.log('\n=== 11. admin ban 用户 A 后 search 不再返回 A ===');
  const banA = await req('POST', '/api/admin/users/ban', {
    body: { userId: A.userId, banned: 1, reason: 'Task 7a 测试' },
    headers: H_ADMIN,
  });
  ok('ban A 200', banA.status === 200);
  ok('ban success=true', banA.data?.success === true);

  const s11a = await req('GET', '/api/hosts/search');
  const s11aHosts = nonAdmin(s11a);
  ok('ban 后 非 admin hosts 长度=2', s11aHosts.length === 2);
  ok('ban 后不含 A', !s11aHosts.some(h => h.hostId === A.hostId));
  ok('ban 后仍含 B', s11aHosts.some(h => h.hostId === B.hostId));
  ok('ban 后仍含 C', s11aHosts.some(h => h.hostId === C.hostId));

  const s11b = await req('GET', `/api/hosts/search?from=2026-10-01&to=2026-10-05`);
  ok('ban 后 A 的 availability 区间也匹配不到 A', s11b.data?.total === 0);

  const d11 = await req('GET', `/api/hosts/${A.hostId}`);
  ok('ban 后 GET /api/hosts/[A.id] 返回 404', d11.status === 404);

  const r11 = await req('GET', `/api/hosts/${A.hostId}/reviews`);
  ok('ban 后 /reviews 返回 404', r11.status === 404);

  // 恢复 A 的 ban（方便后续测试，也验证 unban 幂等）
  const unbanA = await req('POST', '/api/admin/users/ban', {
    body: { userId: A.userId, banned: 0 },
    headers: H_ADMIN,
  });
  ok('unban A 200', unbanA.status === 200);

  // ============ 12. 404: 不存在 host id / 非 active（pending）host id ============
  console.log('\n=== 12. 404 场景 ===');
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const d12a = await req('GET', `/api/hosts/${fakeId}`);
  ok('不存在的 host_id → 404', d12a.status === 404);

  const d12b = await req('GET', `/api/hosts/${D.hostId}`);
  ok(`D 的 pending host_id → 404（实际 ${d12b.status}）`, d12b.status === 404);

  const r12 = await req('GET', `/api/hosts/${D.hostId}/reviews`);
  ok('D 的 pending /reviews → 404', r12.status === 404);

  // ============ 13. 未 ban 的 pending 寄养人不出现 ============
  console.log('\n=== 13. D 的 pending 状态过滤（未 ban） ===');
  const s13 = await req('GET', '/api/hosts/search');
  ok('status=200', s13.status === 200);
  ok('D 不在 search 结果', !(s13.data?.hosts || []).some(h => h.hostId === D.hostId));
  ok('非 admin hosts 长度=3（A 恢复 + B + C）', nonAdmin(s13).length === 3);

  // 验证 D 依然是 pending（未被 ban，仅状态不对）
  const hostsPendingFinal = await req('GET', '/api/admin/hosts?status=pending', { headers: H_ADMIN });
  ok('D 仍在 pending 列表', hostsPendingFinal.data?.some(h => h.id === D.userId));

  // ============ 汇总 ============
  console.log('\n================================================');
  console.log(`总计: ✅ ${passCount} 通过, ❌ ${failCount} 失败 (共 ${checks} 项断言, 覆盖 13 项测试)`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
