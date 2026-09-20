// warm-host Task 6 探针：Admin 审核寄养人 + 用户 Ban + 邀请码管理
// Node 脚本，避免 PowerShell 中文编码问题
//
// 测试覆盖（12 项）：
//   1. admin 登录
//   2. GET /admin/hosts?status=pending（能看到测试寄养人）
//   3. POST verify → host_status=active + 通知生成
//   4. POST suspend → activate 恢复
//   5. POST reject
//   6. GET /admin/users + 搜索
//   7. Ban 用户 → 该用户旧 token 失效（401）
//   8. Ban admin → 400
//   9. GET /admin/invite-codes 统计
//  10. POST 生成 5 个码
//  11. 非 admin 访问 → 403
//  12. debug 端点已删除（GET 返回 404）
//
// 说明：通知生成依赖 notifications 表（Task 14 完成后可读），
//       本测试通过「API 返回成功 + host_status 正确变更」间接验证。

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

function ts() {
  return Date.now().toString(36).slice(-6);
}

async function main() {
  const runId = ts();
  // 11 位手机号：1[3-9] + 9 位数字
  const tail8 = String(Date.now()).slice(-8);
  const hostPhone = `139${tail8}`;   // 139 + 8 位 = 11 位
  const viewerPhone = `159${tail8}`; // 159 + 8 位 = 11 位

  // ============ Setup: admin 登录 ============
  console.log('=== Setup: admin 登录 ===');
  const login = await req('POST', '/api/auth/login', {
    body: { phone: 'admin', password: 'admin123' },
  });
  ok('admin 登录 200', login.status === 200);
  ok('获得 token', !!login.data?.token);
  if (!login.data?.token) { console.error('无法登录 admin，终止'); return; }
  const H_ADMIN = { Authorization: `Bearer ${login.data.token}` };
  const adminId = login.data.user.id;
  const adminRole = login.data.user.role;
  ok(`admin.role=admin`, adminRole === 'admin');
  ok(`admin.id 存在`, typeof adminId === 'string' && adminId.length > 0);

  // ============ Setup: 拿邀请码 ============
  console.log('\n=== Setup: 获取可用邀请码 ===');
  const codesSetup = await req('GET', '/api/admin/invite-codes', { headers: H_ADMIN });
  ok('GET /admin/invite-codes 200', codesSetup.status === 200);
  ok('返回 total/used/available', typeof codesSetup.data?.total === 'number'
    && typeof codesSetup.data?.used === 'number'
    && typeof codesSetup.data?.available === 'number');
  ok('返回 recent 数组', Array.isArray(codesSetup.data?.recent));
  const initialAvailable = codesSetup.data?.available ?? 0;
  ok(`初始可用邀请码 ${initialAvailable} >= 2`, initialAvailable >= 2);
  const codeA = codesSetup.data?.recent?.[0]?.code;
  const codeB = codesSetup.data?.recent?.[1]?.code;
  ok(`拿到 codeA=${codeA}`, !!codeA);
  ok(`拿到 codeB=${codeB}`, !!codeB);
  if (!codeA || !codeB) { console.error('邀请码不足，终止'); return; }

  // ============ Setup: 注册寄养人候选 A + 申请 ============
  console.log('\n=== Setup: 注册寄养人候选 A + 申请 ===');
  const regA = await req('POST', '/api/auth/register', {
    body: { phone: hostPhone, password: 'test123', nickname: `寄养人${runId}`, inviteCode: codeA },
  });
  ok(`注册 A 200`, regA.status === 200);
  ok(`A 获得 token`, !!regA.data?.token);
  if (!regA.data?.token) { console.error('A 注册失败，终止'); return; }
  const H_A = { Authorization: `Bearer ${regA.data.token}` };
  const idA = regA.data.user.id;

  const applyPayload = {
    bio: '家有柯基，5 年养宠经验',
    capacity_count: 2,
    capacity_species: ['猫', '狗'],
    capacity_size: ['小型', '中型'],
    capacity_gender: ['公', '母'],
    address_fuzzy: '朝阳区望京',
    district: '朝阳区',
    experience: '养过 3 只柯基',
    special_services: ['有隔离空间'],
    daily_rate_cents: 10000,
  };
  const apply = await req('POST', '/api/hosts/apply', { body: applyPayload, headers: H_A });
  ok('A 申请寄养人 200', apply.status === 200);
  ok('A hostStatus=pending', apply.data?.hostStatus === 'pending');

  // ============ Setup: 注册旁观者 B（非 admin，用于 403 测试） ============
  console.log('\n=== Setup: 注册旁观者 B ===');
  const regB = await req('POST', '/api/auth/register', {
    body: { phone: viewerPhone, password: 'test123', nickname: `旁观者${runId}`, inviteCode: codeB },
  });
  ok('注册 B 200', regB.status === 200);
  const H_B = { Authorization: `Bearer ${regB.data.token}` };
  const idB = regB.data.user.id;
  ok(`B 非 admin`, regB.data?.user?.role !== 'admin');

  // ============ 1. admin 登录（已验证） ============
  console.log('\n=== 1. admin 登录 ===');
  ok('admin token 可用', true);

  // ============ 2. GET /admin/hosts?status=pending ============
  console.log('\n=== 2. GET /admin/hosts?status=pending ===');
  const hostsPending = await req('GET', '/api/admin/hosts?status=pending', { headers: H_ADMIN });
  ok('status=200', hostsPending.status === 200);
  ok('返回数组', Array.isArray(hostsPending.data));
  const hostA_inList = hostsPending.data?.find(h => h.id === idA);
  ok(`列表含 A (id=${idA.slice(0,8)}...)`, !!hostA_inList);
  if (hostA_inList) {
    ok('A 包含 phone', hostA_inList.phone === hostPhone);
    ok('A 包含 hostProfile', !!hostA_inList.hostProfile);
    ok('A hostProfile.bio 正确', hostA_inList.hostProfile?.bio === applyPayload.bio);
    ok('A hostProfile.capacity_species 含猫狗',
      Array.isArray(hostA_inList.hostProfile?.capacity_species)
      && hostA_inList.hostProfile.capacity_species.includes('猫')
      && hostA_inList.hostProfile.capacity_species.includes('狗'));
    ok('A 包含 appliedAt', typeof hostA_inList.appliedAt === 'string');
    ok('A hostStatus=pending', hostA_inList.hostStatus === 'pending');
    ok('A hasIdCard=false', hostA_inList.hasIdCard === false);
    ok('A 未泄漏图片内容', !hostA_inList.idCardImage);
  }
  // 不存在的 status 校验
  const hostsBadStatus = await req('GET', '/api/admin/hosts?status=xxx', { headers: H_ADMIN });
  ok('非法 status 返回 400', hostsBadStatus.status === 400);

  // ============ 3. POST verify ============
  console.log('\n=== 3. POST verify → active + 通知 ===');
  const verify = await req('POST', `/api/admin/hosts/${idA}`, {
    body: { action: 'verify' }, headers: H_ADMIN,
  });
  ok('verify 200', verify.status === 200);
  ok('success=true', verify.data?.success === true);
  ok('status=active', verify.data?.status === 'active');
  ok('userId 正确', verify.data?.userId === idA);

  // 验证 A 的 host_status 已变 active
  const meA_after = await req('GET', '/api/hosts/me', { headers: H_A });
  ok('A /hosts/me 200', meA_after.status === 200);
  ok('A host_status=active', meA_after.data?.user?.host_status === 'active');
  ok('A profile.is_verified=true', !!meA_after.data?.profile?.is_verified);

  // 非法 action
  const badAction = await req('POST', `/api/admin/hosts/${idA}`, {
    body: { action: 'delete' }, headers: H_ADMIN,
  });
  ok('非法 action 400', badAction.status === 400);
  ok('错误信息含 verify/reject/suspend/activate',
    (badAction.data?.error || '').includes('verify') && (badAction.data?.error || '').includes('reject'));

  // ============ 4. POST suspend → activate ============
  console.log('\n=== 4. POST suspend → activate ===');
  const suspend = await req('POST', `/api/admin/hosts/${idA}`, {
    body: { action: 'suspend' }, headers: H_ADMIN,
  });
  ok('suspend 200', suspend.status === 200);
  ok('status=suspended', suspend.data?.status === 'suspended');

  const meA_susp = await req('GET', '/api/hosts/me', { headers: H_A });
  ok('A host_status=suspended', meA_susp.data?.user?.host_status === 'suspended');

  // activate 从 active 状态（当前 suspended 后再 activate）
  const activate = await req('POST', `/api/admin/hosts/${idA}`, {
    body: { action: 'activate' }, headers: H_ADMIN,
  });
  ok('activate 200', activate.status === 200);
  ok('status=active', activate.data?.status === 'active');

  const meA_act = await req('GET', '/api/hosts/me', { headers: H_A });
  ok('A host_status=active（恢复）', meA_act.data?.user?.host_status === 'active');

  // activate 从非 suspended 状态应 400
  const activateBad = await req('POST', `/api/admin/hosts/${idA}`, {
    body: { action: 'activate' }, headers: H_ADMIN,
  });
  ok('activate 从 active 返回 400', activateBad.status === 400);

  // ============ 5. POST reject ============
  console.log('\n=== 5. POST reject ===');
  const reject = await req('POST', `/api/admin/hosts/${idA}`, {
    body: { action: 'reject' }, headers: H_ADMIN,
  });
  ok('reject 200', reject.status === 200);
  ok('status=rejected', reject.data?.status === 'rejected');

  const meA_rej = await req('GET', '/api/hosts/me', { headers: H_A });
  ok('A host_status=rejected', meA_rej.data?.user?.host_status === 'rejected');

  // 404: 无档案的用户
  const rejectNoProfile = await req('POST', `/api/admin/hosts/${idB}`, {
    body: { action: 'reject' }, headers: H_ADMIN,
  });
  ok('B 无档案返回 404', rejectNoProfile.status === 404);

  // 404: 不存在的用户
  const rejectMissing = await req('POST', `/api/admin/hosts/${crypto.randomUUID?.() || 'nonexistent'}`, {
    body: { action: 'reject' }, headers: H_ADMIN,
  });
  ok('不存在用户返回 404', rejectMissing.status === 404);

  // ============ 6. GET /admin/users + 搜索 ============
  console.log('\n=== 6. GET /admin/users + 搜索 ===');
  const usersAll = await req('GET', '/api/admin/users?page=1', { headers: H_ADMIN });
  ok('users 200', usersAll.status === 200);
  ok('返回 total/page/pageSize/totalPages/users',
    typeof usersAll.data?.total === 'number'
    && typeof usersAll.data?.page === 'number'
    && typeof usersAll.data?.pageSize === 'number'
    && typeof usersAll.data?.totalPages === 'number'
    && Array.isArray(usersAll.data?.users));
  ok('total >= 3 (admin + A + B)', (usersAll.data?.total || 0) >= 3);
  ok('page=1', usersAll.data?.page === 1);
  ok('users 非空', (usersAll.data?.users || []).length > 0);

  const adminInUsers = usersAll.data?.users?.find(u => u.id === adminId);
  ok('列表含 admin', !!adminInUsers);
  if (adminInUsers) {
    ok('admin.role=admin', adminInUsers.role === 'admin');
    ok('admin.banned=false', adminInUsers.banned === false);
    ok('admin 有 orderCount 字段', typeof adminInUsers.orderCount === 'number');
    ok('admin 有 petCount 字段', typeof adminInUsers.petCount === 'number');
    ok('admin 有 createdAt', typeof adminInUsers.createdAt === 'string');
    ok('admin 有 hostStatus', typeof adminInUsers.hostStatus === 'string');
  }

  // 搜索
  const usersSearch = await req('GET', `/api/admin/users?q=${encodeURIComponent('寄养人')}`, { headers: H_ADMIN });
  ok('搜索 200', usersSearch.status === 200);
  ok('搜索返回 users 数组', Array.isArray(usersSearch.data?.users));
  const aInSearch = usersSearch.data?.users?.find(u => u.id === idA);
  ok('搜索命中 A', !!aInSearch);

  // 搜索不存在的
  const usersNoMatch = await req('GET', `/api/admin/users?q=${encodeURIComponent('zzz_not_exist_')}`, { headers: H_ADMIN });
  ok('搜索无匹配 200', usersNoMatch.status === 200);
  ok('搜索无匹配 total=0', (usersNoMatch.data?.total || 0) === 0);

  // ============ 7. Ban 用户 → 旧 token 失效 ============
  console.log('\n=== 7. Ban 用户 A → 旧 token 401 ===');
  const banA = await req('POST', '/api/admin/users/ban', {
    body: { userId: idA, banned: 1, reason: '测试禁用' }, headers: H_ADMIN,
  });
  ok('ban A 200', banA.status === 200);
  ok('success=true', banA.data?.success === true);
  ok('banned=1', banA.data?.banned === 1);
  ok('changed=true', banA.data?.changed === true);

  // A 的旧 token 应失效（401）
  const meA_banned = await req('GET', '/api/hosts/me', { headers: H_A });
  ok('A 旧 token 返回 401', meA_banned.status === 401);

  // 尝试 ban 已 banned 用户（幂等）
  const banAAgain = await req('POST', '/api/admin/users/ban', {
    body: { userId: idA, banned: 1 }, headers: H_ADMIN,
  });
  ok('重复 ban 200', banAAgain.status === 200);
  ok('changed=false（幂等）', banAAgain.data?.changed === false);

  // unban
  const unbanA = await req('POST', '/api/admin/users/ban', {
    body: { userId: idA, banned: 0 }, headers: H_ADMIN,
  });
  ok('unban A 200', unbanA.status === 200);
  ok('banned=0', unbanA.data?.banned === 0);
  ok('changed=true', unbanA.data?.changed === true);

  // 无效 userId
  const banMissing = await req('POST', '/api/admin/users/ban', {
    body: { userId: 'nonexistent', banned: 1 }, headers: H_ADMIN,
  });
  ok('ban 不存在用户 404', banMissing.status === 404);

  // 缺字段
  const banNoUserId = await req('POST', '/api/admin/users/ban', {
    body: { banned: 1 }, headers: H_ADMIN,
  });
  ok('缺 userId 400', banNoUserId.status === 400);

  // 非法 banned 值
  const banBadVal = await req('POST', '/api/admin/users/ban', {
    body: { userId: idB, banned: 2 }, headers: H_ADMIN,
  });
  ok('banned=2 返回 400', banBadVal.status === 400);

  // ============ 8. Ban admin → 400 ============
  console.log('\n=== 8. Ban admin → 400 ===');
  const banAdmin = await req('POST', '/api/admin/users/ban', {
    body: { userId: adminId, banned: 1, reason: '尝试禁自己' }, headers: H_ADMIN,
  });
  ok('ban admin 400', banAdmin.status === 400);
  ok('错误信息含 admin', (banAdmin.data?.error || '').includes('admin'));

  // 非 admin 访问 ban
  const banByB = await req('POST', '/api/admin/users/ban', {
    body: { userId: idA, banned: 1 }, headers: H_B,
  });
  ok('B 调 ban 403', banByB.status === 403);

  // ============ 9. GET /admin/invite-codes ============
  console.log('\n=== 9. GET /admin/invite-codes 统计 ===');
  const codes9 = await req('GET', '/api/admin/invite-codes', { headers: H_ADMIN });
  ok('200', codes9.status === 200);
  ok('total >= 10', (codes9.data?.total || 0) >= 10);
  ok('used >= 2 (A+B)', (codes9.data?.used || 0) >= 2);
  ok('available = total - used', (codes9.data?.available || 0) === (codes9.data?.total || 0) - (codes9.data?.used || 0));
  ok('recent 数组', Array.isArray(codes9.data?.recent));
  ok('recent[0] 含 code+createdAt', codes9.data?.recent?.[0]?.code && typeof codes9.data?.recent?.[0]?.createdAt === 'string');

  // ============ 10. POST 生成 5 个码 ============
  console.log('\n=== 10. POST 生成 5 个码 ===');
  const gen5 = await req('POST', '/api/admin/invite-codes', {
    body: { count: 5 }, headers: H_ADMIN,
  });
  ok('生成 5 码 200', gen5.status === 200);
  ok('success=true', gen5.data?.success === true);
  ok('generated=5', gen5.data?.generated === 5);
  ok('codes 数组长度 5', Array.isArray(gen5.data?.codes) && gen5.data.codes.length === 5);
  const codeSet = new Set(gen5.data?.codes || []);
  ok('5 个码唯一', codeSet.size === 5);
  ok('码格式 6 位大写', (gen5.data?.codes?.[0] || '').match(/^[A-Z2-9]{6}$/));

  // 边界校验
  const genBad1 = await req('POST', '/api/admin/invite-codes', { body: { count: 0 }, headers: H_ADMIN });
  ok('count=0 返回 400', genBad1.status === 400);
  const genBad2 = await req('POST', '/api/admin/invite-codes', { body: { count: 101 }, headers: H_ADMIN });
  ok('count=101 返回 400', genBad2.status === 400);
  const genBad3 = await req('POST', '/api/admin/invite-codes', { body: { count: 'abc' }, headers: H_ADMIN });
  ok('count=abc 返回 400', genBad3.status === 400);

  // 验证可用码增加了 5
  const codesAfter = await req('GET', '/api/admin/invite-codes', { headers: H_ADMIN });
  ok('total 增加 5', (codesAfter.data?.total || 0) === (codes9.data?.total || 0) + 5);
  ok('available 增加 5', (codesAfter.data?.available || 0) === (codes9.data?.available || 0) + 5);

  // ============ 11. 非 admin 访问 → 403 ============
  console.log('\n=== 11. 非 admin 访问 → 403 ===');
  const hostsByB = await req('GET', '/api/admin/hosts', { headers: H_B });
  ok('B GET /admin/hosts 403', hostsByB.status === 403);
  const usersByB = await req('GET', '/api/admin/users', { headers: H_B });
  ok('B GET /admin/users 403', usersByB.status === 403);
  const codesByB = await req('GET', '/api/admin/invite-codes', { headers: H_B });
  ok('B GET /admin/invite-codes 403', codesByB.status === 403);
  const hostsByBPost = await req('POST', `/api/admin/hosts/${idB}`, {
    body: { action: 'verify' }, headers: H_B,
  });
  ok('B POST /admin/hosts/[id] 403', hostsByBPost.status === 403);
  const genByB = await req('POST', '/api/admin/invite-codes', { body: { count: 1 }, headers: H_B });
  ok('B POST /admin/invite-codes 403', genByB.status === 403);

  // 未登录访问
  const hostsNoAuth = await req('GET', '/api/admin/hosts');
  ok('未登录 GET /admin/hosts 401', hostsNoAuth.status === 401);

  // ============ 12. debug 端点已删除 ============
  console.log('\n=== 12. debug 端点已删除 ===');
  const debugGet = await req('GET', '/api/admin/_debug-set-host-status', { headers: H_ADMIN });
  ok('GET /admin/_debug-set-host-status 返回 404', debugGet.status === 404);
  const debugPost = await req('POST', '/api/admin/_debug-set-host-status', {
    body: { hostStatus: 'active' }, headers: H_ADMIN,
  });
  ok('POST /admin/_debug-set-host-status 非 2xx（已删除）',
    debugPost.status >= 400);

  // ============ 前端页面元素检查 ============
  console.log('\n=== 附加：前端页面检查 ===');
  const adminHtml = await req('GET', '/admin.html');
  ok('admin.html 200', adminHtml.status === 200);
  ok('含 admin-tabs', adminHtml.text.includes('admin-tabs'));
  ok('含 admin-tab-hosts', adminHtml.text.includes('admin-tab-hosts'));
  ok('含 admin-tab-users', adminHtml.text.includes('admin-tab-users'));
  ok('含 admin-tab-codes', adminHtml.text.includes('admin-tab-codes'));
  ok('含 admin-filter-chip', adminHtml.text.includes('admin-filter-chip'));
  ok('含 hosts-list', adminHtml.text.includes('hosts-list'));
  ok('含 users-list', adminHtml.text.includes('users-list'));
  ok('含 codes-stats', adminHtml.text.includes('codes-stats'));
  ok('含 btn-generate-codes', adminHtml.text.includes('btn-generate-codes'));
  ok('含 admin-denied', adminHtml.text.includes('admin-denied'));
  ok('引用 style-admin.css', adminHtml.text.includes('style-admin.css'));

  const adminJs = await req('GET', '/js/pages/admin.js');
  ok('admin.js 200', adminJs.status === 200);
  ok('含 HOST_STATUS_LABELS', adminJs.text.includes('HOST_STATUS_LABELS'));
  ok('含 loadHosts', adminJs.text.includes('loadHosts'));
  ok('含 renderHostCard', adminJs.text.includes('renderHostCard'));
  ok('含 loadUsers', adminJs.text.includes('loadUsers'));
  ok('含 renderUserTable', adminJs.text.includes('renderUserTable'));
  ok('含 loadCodes', adminJs.text.includes('loadCodes'));
  ok('含 bindHostActions', adminJs.text.includes('bindHostActions'));
  ok('含 bindUserActions', adminJs.text.includes('bindUserActions'));

  const adminCss = await req('GET', '/css/style-admin.css');
  ok('style-admin.css 200', adminCss.status === 200);
  ok('含 .admin-tabs', adminCss.text.includes('.admin-tabs'));
  ok('含 .admin-host-card', adminCss.text.includes('.admin-host-card'));
  ok('含 .admin-table', adminCss.text.includes('.admin-table'));
  ok('含 .admin-stat-card', adminCss.text.includes('.admin-stat-card'));
  ok('含 .admin-code-item', adminCss.text.includes('.admin-code-item'));

  // ============ 汇总 ============
  console.log('\n================================================');
  console.log(`总计: ✅ ${passCount} 通过, ❌ ${failCount} 失败 (共 ${checks} 项)`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
