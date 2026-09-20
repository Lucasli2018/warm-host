// warm-host Task 5 探针：寄养人档案 + 可接单日期
// Node 脚本，避免 PowerShell 中文编码问题
//
// 测试覆盖：
//   1. admin 登录
//   2. 重置 admin 为未申请状态
//   3. GET /hosts/me 验证空态
//   4. POST /hosts/apply → pending
//   5. GET /hosts/me 验证 profile + pending
//   6. PUT availability (pending) → 403
//   7. debug 端点设 active → PUT availability 成功
//   8. POST /hosts/me 更新档案
//   9. GET /hosts/me 验证 availability 列表
//  10. 越权：未登录 apply → 401
//  11. 校验：capacity_count=0 → 400；start_date>end_date → 400
//  12. my.html 关键元素检查

const BASE = 'http://127.0.0.1:8787';
let passCount = 0;
let failCount = 0;

function ok(name) { passCount++; console.log(`  ✅ ${name}`); }
function fail(name, detail) { failCount++; console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`); }

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

async function main() {
  console.log('=== 1. 登录 admin ===');
  const login = await req('POST', '/api/auth/login', { body: { phone: 'admin', password: 'admin123' } });
  if (login.status !== 200 || !login.data?.token) {
    fail('admin 登录', `status=${login.status} body=${login.text}`);
    return;
  }
  const H = { 'Authorization': `Bearer ${login.data.token}` };
  const adminId = login.data.user.id;
  ok(`获得 token (user.id=${adminId.slice(0, 8)}...)`);

  // ============ 2. 重置 admin 为未申请状态 ============
  console.log('\n=== 2. 重置 admin 为未申请状态 ===');
  const reset = await req('POST', '/api/admin/_debug-set-host-status', { body: { hostStatus: 'none' }, headers: H });
  ok(`debug 重置 status=${reset.status}`, reset.status === 200);
  ok(`isHost=0`, reset.data?.isHost === 0);
  ok(`hostStatus=pending`, reset.data?.hostStatus === 'pending');

  // ============ 3. GET /hosts/me 空态 ============
  console.log('\n=== 3. GET /hosts/me 空态 ===');
  const r3 = await req('GET', '/api/hosts/me', { headers: H });
  ok(`status=${r3.status}`, r3.status === 200);
  ok(`profile=null`, r3.data?.profile === null);
  ok(`availability=[]`, Array.isArray(r3.data?.availability) && r3.data.availability.length === 0);
  ok(`user.host_status=pending`, r3.data?.user?.host_status === 'pending');

  // ============ 4. POST /hosts/apply → pending ============
  console.log('\n=== 4. POST /hosts/apply 提交申请 ===');
  const applyPayload = {
    bio: '家有柯基和英短，5 年养宠经验',
    capacity_count: 2,
    capacity_species: ['猫', '狗'],
    capacity_size: ['小型', '中型'],
    capacity_gender: ['公', '母'],
    address_fuzzy: '朝阳区望京某小区',
    district: '朝阳区',
    experience: '养过 3 只柯基，英短 5 年',
    special_services: ['有隔离空间', '24小时监控'],
    daily_rate_cents: 10000,
  };
  const r4 = await req('POST', '/api/hosts/apply', { body: applyPayload, headers: H });
  ok(`status=${r4.status}`, r4.status === 200);
  ok(`success=true`, r4.data?.success === true);
  ok(`hostStatus=pending`, r4.data?.hostStatus === 'pending');

  // ============ 5. GET /hosts/me 验证 profile + pending ============
  console.log('\n=== 5. GET /hosts/me 验证 profile ===');
  const r5 = await req('GET', '/api/hosts/me', { headers: H });
  ok(`status=${r5.status}`, r5.status === 200);
  ok(`profile 非空`, r5.data?.profile !== null);
  ok(`profile.id 存在`, typeof r5.data?.profile?.id === 'string');
  ok(`profile.bio 正确`, r5.data?.profile?.bio === applyPayload.bio);
  ok(`profile.capacity_count=2`, r5.data?.profile?.capacity_count === 2);
  ok(`profile.capacity_species 含猫狗`, Array.isArray(r5.data?.profile?.capacity_species)
    && r5.data.profile.capacity_species.includes('猫') && r5.data.profile.capacity_species.includes('狗'));
  ok(`profile.special_services 含隔离空间`, Array.isArray(r5.data?.profile?.special_services)
    && r5.data.profile.special_services.includes('有隔离空间'));
  ok(`profile.daily_rate_cents=10000`, r5.data?.profile?.daily_rate_cents === 10000);
  ok(`user.host_status=pending`, r5.data?.user?.host_status === 'pending');
  ok(`user.is_sponsored=false`, r5.data?.user?.is_sponsored === false);
  ok(`user.is_verified=false`, r5.data?.user?.is_verified === false);

  const profileId = r5.data?.profile?.id;

  // ============ 6. PUT availability (pending) → 403 ============
  console.log('\n=== 6. PUT availability pending 状态应 403 ===');
  const r6 = await req('PUT', '/api/hosts/me/availability', {
    body: [{ start_date: '2026-10-01', end_date: '2026-10-05', note: '国庆' }],
    headers: H,
  });
  ok(`status=${r6.status}`, r6.status === 403);
  ok(`错误信息含"审核通过"`, (r6.data?.error || '').includes('审核通过'));

  // ============ 7. debug 端点设 active → PUT availability 成功 ============
  console.log('\n=== 7. 设为 active 后 PUT availability ===');
  const toActive = await req('POST', '/api/admin/_debug-set-host-status', { body: { hostStatus: 'active' }, headers: H });
  ok(`debug 设 active status=${toActive.status}`, toActive.status === 200);
  ok(`isHost=1`, toActive.data?.isHost === 1);

  const availPayload = [
    { start_date: '2026-10-01', end_date: '2026-10-05', note: '国庆' },
    { start_date: '2026-10-20', end_date: '2026-10-25', note: '' },
  ];
  const r7 = await req('PUT', '/api/hosts/me/availability', { body: availPayload, headers: H });
  ok(`status=${r7.status}`, r7.status === 200);
  ok(`success=true`, r7.data?.success === true);
  ok(`count=2`, r7.data?.count === 2);

  // ============ 8. POST /hosts/me 更新档案 ============
  console.log('\n=== 8. POST /hosts/me 更新档案 ===');
  const updatePayload = { ...applyPayload, bio: '更新后的介绍', daily_rate_cents: 12000, special_services: ['可上门接送'] };
  const r8 = await req('POST', '/api/hosts/me', { body: updatePayload, headers: H });
  ok(`status=${r8.status}`, r8.status === 200);
  ok(`success=true`, r8.data?.success === true);

  // ============ 9. GET /hosts/me 验证更新 + availability 列表 ============
  console.log('\n=== 9. GET /hosts/me 验证更新 ===');
  const r9 = await req('GET', '/api/hosts/me', { headers: H });
  ok(`status=${r9.status}`, r9.status === 200);
  ok(`profile.bio 已更新`, r9.data?.profile?.bio === '更新后的介绍');
  ok(`profile.daily_rate_cents=12000`, r9.data?.profile?.daily_rate_cents === 12000);
  ok(`profile.special_services 更新`, Array.isArray(r9.data?.profile?.special_services)
    && r9.data.profile.special_services.length === 1
    && r9.data.profile.special_services[0] === '可上门接送');
  ok(`availability 长度=2`, Array.isArray(r9.data?.availability) && r9.data.availability.length === 2);
  ok(`availability[0].start_date=2026-10-01`, r9.data?.availability?.[0]?.start_date === '2026-10-01');
  ok(`availability[0].note=国庆`, r9.data?.availability?.[0]?.note === '国庆');
  ok(`availability[1].end_date=2026-10-25`, r9.data?.availability?.[1]?.end_date === '2026-10-25');
  ok(`availability[0].active=true`, r9.data?.availability?.[0]?.active === true);

  // ============ 10. 越权：未登录 apply → 401 ============
  console.log('\n=== 10. 越权测试：未登录 ===');
  const r10a = await req('POST', '/api/hosts/apply', { body: applyPayload });
  ok(`未登录 apply 返回 401`, r10a.status === 401);
  const r10b = await req('GET', '/api/hosts/me');
  ok(`未登录 GET /hosts/me 返回 401`, r10b.status === 401);
  const r10c = await req('PUT', '/api/hosts/me/availability', { body: availPayload });
  ok(`未登录 PUT availability 返回 401`, r10c.status === 401);
  const r10d = await req('POST', '/api/hosts/me', { body: applyPayload });
  ok(`未登录 POST /hosts/me 返回 401`, r10d.status === 401);

  // ============ 11. 校验测试 ============
  console.log('\n=== 11. 校验测试 ===');
  // capacity_count=0
  const r11a = await req('POST', '/api/hosts/me', { body: { ...applyPayload, capacity_count: 0 }, headers: H });
  ok(`capacity_count=0 返回 400`, r11a.status === 400);
  ok(`错误信息含"1-10"`, (r11a.data?.error || '').includes('1-10'));
  // capacity_count=11
  const r11b = await req('POST', '/api/hosts/me', { body: { ...applyPayload, capacity_count: 11 }, headers: H });
  ok(`capacity_count=11 返回 400`, r11b.status === 400);
  // 缺 species
  const r11c = await req('POST', '/api/hosts/me', { body: { ...applyPayload, capacity_species: [] }, headers: H });
  ok(`缺 species 返回 400`, r11c.status === 400);
  // 缺 district
  const r11d = await req('POST', '/api/hosts/me', { body: { ...applyPayload, district: '' }, headers: H });
  ok(`缺 district 返回 400`, r11d.status === 400);
  // 非法 species 值
  const r11e = await req('POST', '/api/hosts/me', { body: { ...applyPayload, capacity_species: ['鸡'] }, headers: H });
  ok(`非法 species 返回 400`, r11e.status === 400);
  // 非法 service 值应被过滤（不报错，但 services 为空）
  const r11f = await req('POST', '/api/hosts/me', { body: { ...applyPayload, special_services: ['非法服务'] }, headers: H });
  ok(`非法 service 被过滤（不报错）`, r11f.status === 200);

  // start_date > end_date
  const r11g = await req('PUT', '/api/hosts/me/availability', {
    body: [{ start_date: '2026-10-10', end_date: '2026-10-05' }],
    headers: H,
  });
  ok(`start>end 返回 400`, r11g.status === 400);
  ok(`错误信息含"早于或等于"`, (r11g.data?.error || '').includes('早于或等于'));

  // 非法日期格式
  const r11h = await req('PUT', '/api/hosts/me/availability', {
    body: [{ start_date: '2026/10/10', end_date: '2026-10-20' }],
    headers: H,
  });
  ok(`非法日期格式返回 400`, r11h.status === 400);

  // 超过未来 1 年
  const r11i = await req('PUT', '/api/hosts/me/availability', {
    body: [{ start_date: '2099-01-01', end_date: '2099-01-10' }],
    headers: H,
  });
  ok(`超过未来 1 年返回 400`, r11i.status === 400);

  // 请求体不是数组
  const r11j = await req('PUT', '/api/hosts/me/availability', { body: { x: 1 }, headers: H });
  ok(`非数组请求体返回 400`, r11j.status === 400);

  // 重复申请
  const r11k = await req('POST', '/api/hosts/apply', { body: applyPayload, headers: H });
  ok(`已 active 重复申请返回 400`, r11k.status === 400);

  // ============ 12. 空数组 PUT（允许保存 0 条） ============
  console.log('\n=== 12. 边界测试 ===');
  const r12 = await req('PUT', '/api/hosts/me/availability', { body: [], headers: H });
  ok(`空数组 PUT 返回 200`, r12.status === 200);
  ok(`count=0`, r12.data?.count === 0);
  const r12check = await req('GET', '/api/hosts/me', { headers: H });
  ok(`保存后 availability=[]`, Array.isArray(r12check.data?.availability) && r12check.data.availability.length === 0);

  // ============ 13. 前端页面关键元素检查 ============
  console.log('\n=== 13. my.html 关键元素 ===');
  const my = await req('GET', '/my.html');
  ok(`my.html 200`, my.status === 200);
  ok(`包含 tab-host`, my.text.includes('tab-host'));
  ok(`包含 host-banner`, my.text.includes('host-banner'));
  ok(`包含 host-form`, my.text.includes('host-form'));
  ok(`包含 host-availability`, my.text.includes('host-availability'));
  ok(`包含 capacity-species-chips`, my.text.includes('capacity-species-chips'));
  ok(`包含 capacity-size-chips`, my.text.includes('capacity-size-chips'));
  ok(`包含 capacity-gender-chips`, my.text.includes('capacity-gender-chips'));
  ok(`包含 special-services-chips`, my.text.includes('special-services-chips'));
  ok(`包含 cal-grid`, my.text.includes('cal-grid'));
  ok(`包含 host-availability-save`, my.text.includes('host-availability-save'));
  ok(`包含 host-sponsor-hint`, my.text.includes('host-sponsor-hint'));

  const js = await req('GET', '/js/pages/my.js');
  ok(`my.js 200`, js.status === 200);
  ok(`包含 HOST_SPECIES`, js.text.includes('HOST_SPECIES'));
  ok(`包含 loadHost`, js.text.includes('loadHost'));
  ok(`包含 renderCalendar`, js.text.includes('renderCalendar'));
  ok(`包含 onCalDateClick`, js.text.includes('onCalDateClick'));
  ok(`包含 initCalendar`, js.text.includes('initCalendar'));
  ok(`包含 renderAvailabilityRanges`, js.text.includes('renderAvailabilityRanges'));

  const css = await req('GET', '/css/style.css');
  ok(`style.css 200`, css.status === 200);
  ok(`包含 .host-banner`, css.text.includes('.host-banner'));
  ok(`包含 .cal-grid`, css.text.includes('.cal-grid'));
  ok(`包含 .cal-cell-range`, css.text.includes('.cal-cell-range'));
  ok(`包含 .cal-cell-anchor`, css.text.includes('.cal-cell-anchor'));
  ok(`包含 .cal-range-item`, css.text.includes('.cal-range-item'));

  // ============ 汇总 ============
  console.log('\n================================================');
  console.log(`总计: ✅ ${passCount} 通过, ❌ ${failCount} 失败`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
