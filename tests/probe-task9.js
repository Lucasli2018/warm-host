// warm-host Task 9 探针：寄养需求（needs）CRUD + 我的需求列表
// Node 18+ 原生 fetch，无需额外依赖
//
// 覆盖 12 项测试：
//   1. POST 创建需求 → status=open
//   2. GET /needs/my → 1 条
//   3. GET /needs（公开）→ 包含该需求，含宠物信息
//   4. GET /needs/[id] 公开读
//   5. PUT 更新期望日费 → 生效
//   6. PUT 改日期 → 校验生效
//   7. DELETE → status=cancelled
//   8. 越权：未登录 POST → 401；他人 PUT → 403；他人 DELETE → 403
//   9. 校验：缺 petId 400；startDate>=endDate 400；过去日期 400；非法日期格式 400；petId 不存在或非本人 403/404
//  10. 已取消需求不出现在 GET /needs 公开列表
//  11. 需求状态标签 CSS/HTML 存在性检查
//  12. GET /needs 分页 total 正确

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

// 生成唯一 11 位手机号：1[3-9] + 8 位
function genPhone(prefix3, seed) {
  const s = String(seed % 100000000).padStart(8, '0').slice(-8);
  return prefix3 + s;
}

async function main() {
  const runId = Date.now().toString(36).slice(-6);
  console.log(`\n=== Task 9 探针 · runId=${runId} ===`);

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

  // ============ Setup: 生成 2 个邀请码 ============
  console.log('\n=== Setup: 生成 2 个邀请码 ===');
  const gen2 = await req('POST', '/api/admin/invite-codes', {
    body: { count: 2 }, headers: H_ADMIN,
  });
  ok('生成 2 码 200', gen2.status === 200);
  ok('返回 2 个码', (gen2.data?.codes || []).length === 2);
  const [codeA, codeB] = gen2.data?.codes || [];

  // ============ Setup: 注册用户 A（owner）============
  console.log('\n=== Setup: 注册用户 A（owner） ===');
  const phoneA = genPhone('137', Date.now());
  ok('A 手机号长度=11', phoneA.length === 11);
  ok('A 手机号符合 1[3-9]\\d{9}', /^1[3-9]\d{9}$/.test(phoneA));
  const regA = await req('POST', '/api/auth/register', {
    body: { phone: phoneA, password: 'test123', nickname: `Owner_${runId}`, inviteCode: codeA },
  });
  ok('A 注册 200', regA.status === 200);
  ok('A 获得 token', !!regA.data?.token);
  if (!regA.data?.token) { console.error('A 注册失败:', regA.text); process.exit(2); }
  const H_A = { Authorization: `Bearer ${regA.data.token}` };
  const userIdA = regA.data.user.id;
  ok('A 是普通用户（role=user）', regA.data.user.role === 'user');

  // ============ Setup: 注册用户 B（他人，测试越权）============
  console.log('\n=== Setup: 注册用户 B（他人） ===');
  const phoneB = genPhone('138', Date.now() + 7919);
  ok('B 手机号长度=11', phoneB.length === 11);
  const regB = await req('POST', '/api/auth/register', {
    body: { phone: phoneB, password: 'test123', nickname: `Other_${runId}`, inviteCode: codeB },
  });
  ok('B 注册 200', regB.status === 200);
  const H_B = { Authorization: `Bearer ${regB.data.token}` };

  // ============ Setup: A 创建 1 只宠物 ============
  console.log('\n=== Setup: A 创建 1 只宠物 ===');
  const petRes = await req('POST', '/api/pets', {
    body: {
      name: `豆豆_${runId}`,
      species: '狗',
      breed: '柯基',
      gender: '公',
      age: '2岁',
      weight: '12kg',
      personality: ['友善', '粘人'],
      health_notes: '已绝育，已疫苗',
      daily_habits: '每日散步 2 次',
      special_needs: '不能接触猫',
    },
    headers: H_A,
  });
  ok('A 创建宠物 200', petRes.status === 200);
  ok('宠物 id 存在', !!petRes.data?.id);
  const petId = petRes.data?.id;
  if (!petId) { console.error('宠物创建失败:', petRes.text); process.exit(2); }

  // ============ Setup: A 拿一个自己的宠物作为 A 的 pet，B 拿一个不属于自己的 pet（A 的宠物即可）============
  // 用 A 的宠物做所有测试（B 是"他人"）
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const plusDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const startDate = plusDays(3);
  const endDate = plusDays(7);

  // ============ 1. POST 创建需求 → status=open ============
  console.log('\n=== 1. POST 创建需求 → status=open ===');
  const create = await req('POST', '/api/needs', {
    body: {
      petId,
      startDate,
      endDate,
      expectedArea: '朝阳区',
      expectedPriceCents: 15000, // 150 元
      description: '希望有院子的大房子，可上门接送',
    },
    headers: H_A,
  });
  ok('POST 创建 200', create.status === 200);
  ok('返回 id', !!create.data?.id);
  ok('status=open', create.data?.status === 'open');
  ok('owner_id 为 A', create.data?.owner_id === userIdA);
  ok('pet_id 为宠物 id', create.data?.pet_id === petId);
  ok('start_date 正确', create.data?.start_date === startDate);
  ok('end_date 正确', create.data?.end_date === endDate);
  ok('expected_area=朝阳区', create.data?.expected_area === '朝阳区');
  ok('expected_price_cents=15000', create.data?.expected_price_cents === 15000);
  ok('description 正确', create.data?.description?.includes('希望有院子'));
  ok('pet 信息存在', !!create.data?.pet);
  ok('pet.name=豆豆_xxx', create.data?.pet?.name === `豆豆_${runId}`);
  ok('pet.species=狗', create.data?.pet?.species === '狗');
  ok('pet.breed=柯基', create.data?.pet?.breed === '柯基');
  ok('pet.gender=公', create.data?.pet?.gender === '公');
  ok('pet.age=2岁', create.data?.pet?.age === '2岁');
  ok('owner.nickname 存在', typeof create.data?.owner?.nickname === 'string');
  ok('owner.nickname 匹配 A', create.data?.owner?.nickname === `Owner_${runId}`);
  const needId = create.data?.id;
  if (!needId) { console.error('需求创建失败'); process.exit(2); }

  // ============ 2. GET /needs/my → 1 条 ============
  console.log('\n=== 2. GET /needs/my → 1 条 ===');
  const myNeeds = await req('GET', '/api/needs/my', { headers: H_A });
  ok('GET /needs/my 200', myNeeds.status === 200);
  ok('返回数组', Array.isArray(myNeeds.data));
  ok('长度=1', myNeeds.data?.length === 1);
  ok('第一条 id 匹配', myNeeds.data?.[0]?.id === needId);
  ok('含 pet 信息', !!myNeeds.data?.[0]?.pet?.name);
  ok('含 hostId 字段（可为 null）', 'hostId' in (myNeeds.data?.[0] || {}));
  ok('hostId 为 null（未匹配）', myNeeds.data?.[0]?.hostId === null);

  // ============ 3. GET /needs（公开）→ 包含该需求 ============
  console.log('\n=== 3. GET /needs（公开）===');
  const pubList = await req('GET', '/api/needs');
  ok('GET /needs 200', pubList.status === 200);
  ok('返回 needs 数组', Array.isArray(pubList.data?.needs));
  ok('返回 total 数字', typeof pubList.data?.total === 'number');
  ok('返回 page=1', pubList.data?.page === 1);
  ok('返回 pageSize=12', pubList.data?.pageSize === 12);
  ok('公开列表含本需求', pubList.data?.needs?.some(n => n.id === needId));
  const myPubNeed = pubList.data?.needs?.find(n => n.id === needId);
  ok('公开需求含 pet 信息', !!myPubNeed?.pet?.name);
  ok('公开需求 pet.species=狗', myPubNeed?.pet?.species === '狗');
  ok('公开需求含 owner 昵称', !!myPubNeed?.owner?.nickname);
  ok('公开需求 status=open', myPubNeed?.status === 'open');

  // ============ 4. GET /needs/[id] 公开读 ============
  console.log('\n=== 4. GET /needs/[id] 公开读 ===');
  const detail = await req('GET', `/api/needs/${needId}`);
  ok('GET /needs/[id] 200', detail.status === 200);
  ok('id 匹配', detail.data?.id === needId);
  ok('含 pet 信息', !!detail.data?.pet?.name);
  ok('含 owner 昵称', !!detail.data?.owner?.nickname);
  ok('status=open', detail.data?.status === 'open');
  // 不存在 id
  const detail404 = await req('GET', '/api/needs/00000000-0000-0000-0000-000000000000');
  ok('不存在 id → 404', detail404.status === 404);

  // ============ 5. PUT 更新期望日费 → 生效 ============
  console.log('\n=== 5. PUT 更新期望日费 ===');
  const upd1 = await req('PUT', `/api/needs/${needId}`, {
    body: { expectedPriceCents: 20000 },
    headers: H_A,
  });
  ok('PUT 更新日费 200', upd1.status === 200);
  ok('expected_price_cents=20000', upd1.data?.expected_price_cents === 20000);
  ok('其他字段不变（startDate）', upd1.data?.start_date === startDate);
  ok('其他字段不变（expectedArea）', upd1.data?.expected_area === '朝阳区');

  // ============ 6. PUT 改日期 → 校验生效 ============
  console.log('\n=== 6. PUT 改日期 ===');
  const newStart = plusDays(10);
  const newEnd = plusDays(14);
  const upd2 = await req('PUT', `/api/needs/${needId}`, {
    body: { startDate: newStart, endDate: newEnd, expectedArea: '海淀区' },
    headers: H_A,
  });
  ok('PUT 改日期 200', upd2.status === 200);
  ok('start_date 更新', upd2.data?.start_date === newStart);
  ok('end_date 更新', upd2.data?.end_date === newEnd);
  ok('expected_area 更新', upd2.data?.expected_area === '海淀区');
  ok('expected_price_cents 保持 20000', upd2.data?.expected_price_cents === 20000);

  // ============ 7. DELETE → status=cancelled ============
  console.log('\n=== 7. DELETE → status=cancelled ===');
  const del = await req('DELETE', `/api/needs/${needId}`, { headers: H_A });
  ok('DELETE 200', del.status === 200);
  ok('success=true', del.data?.success === true);
  ok('status=cancelled', del.data?.status === 'cancelled');
  // 验证 DB 中状态已改
  const afterDel = await req('GET', `/api/needs/${needId}`);
  ok('DELETE 后 GET status=cancelled', afterDel.data?.status === 'cancelled');

  // 幂等：再次 DELETE 也应返回 cancelled
  const del2 = await req('DELETE', `/api/needs/${needId}`, { headers: H_A });
  ok('再次 DELETE 幂等 200', del2.status === 200);
  ok('再次 DELETE status=cancelled', del2.data?.status === 'cancelled');

  // ============ 8. 越权测试 ============
  console.log('\n=== 8. 越权测试 ===');
  // 未登录 POST → 401
  const unauthPost = await req('POST', '/api/needs', {
    body: { petId, startDate, endDate },
  });
  ok('未登录 POST → 401', unauthPost.status === 401);

  // 创建一个新需求供 B 尝试 PUT/DELETE
  const createForAuth = await req('POST', '/api/needs', {
    body: { petId, startDate: plusDays(5), endDate: plusDays(9), expectedArea: '西城区' },
    headers: H_A,
  });
  ok('为越权测试创建需求 200', createForAuth.status === 200);
  const needId2 = createForAuth.data?.id;

  // B PUT 我的需求 → 403
  const bPut = await req('PUT', `/api/needs/${needId2}`, {
    body: { expectedPriceCents: 99999 },
    headers: H_B,
  });
  ok('他人 PUT 我的需求 → 403', bPut.status === 403);

  // B DELETE 我的需求 → 403
  const bDel = await req('DELETE', `/api/needs/${needId2}`, { headers: H_B });
  ok('他人 DELETE 我的需求 → 403', bDel.status === 403);

  // A 取消（清理）
  await req('DELETE', `/api/needs/${needId2}`, { headers: H_A });

  // ============ 9. 校验测试 ============
  console.log('\n=== 9. 校验测试 ===');
  // 9a. 缺 petId
  const v1 = await req('POST', '/api/needs', {
    body: { startDate, endDate }, headers: H_A,
  });
  ok('缺 petId → 400', v1.status === 400);

  // 9b. startDate >= endDate
  const v2 = await req('POST', '/api/needs', {
    body: { petId, startDate: plusDays(10), endDate: plusDays(5) }, headers: H_A,
  });
  ok('startDate>=endDate → 400', v2.status === 400);

  const v2b = await req('POST', '/api/needs', {
    body: { petId, startDate: plusDays(10), endDate: plusDays(10) }, headers: H_A,
  });
  ok('startDate==endDate → 400', v2b.status === 400);

  // 9c. 过去日期
  const v3 = await req('POST', '/api/needs', {
    body: { petId, startDate: '2000-01-01', endDate: '2000-02-01' }, headers: H_A,
  });
  ok('过去日期 → 400', v3.status === 400);

  // 9d. 非法日期格式
  const v4a = await req('POST', '/api/needs', {
    body: { petId, startDate: '2026/01/01', endDate: '2026-02-01' }, headers: H_A,
  });
  ok('非法日期格式（/）→ 400', v4a.status === 400);
  const v4b = await req('POST', '/api/needs', {
    body: { petId, startDate: 'not-a-date', endDate: plusDays(5) }, headers: H_A,
  });
  ok('非法日期格式（文本）→ 400', v4b.status === 400);
  const v4c = await req('POST', '/api/needs', {
    body: { petId, startDate: '2026-13-40', endDate: '2026-02-01' }, headers: H_A,
  });
  ok('非法日期格式（月份越界）→ 400', v4c.status === 400);

  // 9e. petId 不存在 → 404
  const v5 = await req('POST', '/api/needs', {
    body: { petId: '00000000-0000-0000-0000-000000000000', startDate, endDate }, headers: H_A,
  });
  ok('petId 不存在 → 404', v5.status === 404);

  // 9f. petId 非本人 → 403
  // 先让 B 创建一个需求供 A 尝试 PUT（但 A 需要 B 的宠物；B 还没有宠物）
  // 简化：用 A 的宠物，让 B 尝试创建（B 无宠物，创建会 403）
  const v6 = await req('POST', '/api/needs', {
    body: { petId, startDate, endDate }, headers: H_B,
  });
  ok('B 为 A 的宠物创建需求 → 403', v6.status === 403);

  // 9g. expectedPriceCents 非整数
  const v7 = await req('POST', '/api/needs', {
    body: { petId, startDate, endDate, expectedPriceCents: -1 }, headers: H_A,
  });
  ok('expectedPriceCents 负数 → 400', v7.status === 400);

  const v7b = await req('POST', '/api/needs', {
    body: { petId, startDate, endDate, expectedPriceCents: 10.5 }, headers: H_A,
  });
  ok('expectedPriceCents 非整数 → 400', v7b.status === 400);

  // ============ 10. 已取消需求不出现在公开列表 ============
  console.log('\n=== 10. 已取消需求不出现在公开列表 ===');
  // needId 已 DELETE（status=cancelled）
  const pubAfterCancel = await req('GET', '/api/needs');
  ok('cancelled 需求不在公开列表',
    !pubAfterCancel.data?.needs?.some(n => n.id === needId));

  // ============ 11. 需求状态标签 CSS/HTML 存在性检查 ============
  console.log('\n=== 11. 需求状态标签 CSS/HTML 存在性 ===');
  // 拉 my.html
  const myHtmlRes = await fetch(`${BASE}/my.html`);
  const myHtml = await myHtmlRes.text();
  ok('my.html 含 needs-list', myHtml.includes('id="needs-list"'));
  ok('my.html 含 btn-add-need', myHtml.includes('id="btn-add-need"'));
  ok('my.html 含 need-modal', myHtml.includes('id="need-modal"'));
  ok('my.html 含 need-form', myHtml.includes('id="need-form"'));
  ok('my.html 含 need-submit', myHtml.includes('id="need-submit"'));
  ok('my.html 含 petId select', myHtml.includes('name="petId"'));
  ok('my.html 含 startDate', myHtml.includes('name="startDate"'));
  ok('my.html 含 endDate', myHtml.includes('name="endDate"'));
  ok('my.html 含 expectedArea', myHtml.includes('name="expectedArea"'));
  ok('my.html 含 expectedPrice', myHtml.includes('name="expectedPrice"'));
  ok('my.html 含 description', myHtml.includes('name="description"'));

  // 拉 style.css
  const cssRes = await fetch(`${BASE}/css/style.css`);
  const css = await cssRes.text();
  ok('style.css 含 .need-card', css.includes('.need-card'));
  ok('style.css 含 .badge-need-amber', css.includes('.badge-need-amber'));
  ok('style.css 含 .badge-need-blue', css.includes('.badge-need-blue'));
  ok('style.css 含 .badge-need-green', css.includes('.badge-need-green'));
  ok('style.css 含 .badge-need-gray', css.includes('.badge-need-gray'));
  ok('style.css 含 .need-pet-cover', css.includes('.need-pet-cover'));
  ok('style.css 含 .need-card-actions', css.includes('.need-card-actions'));

  // 拉 my.js
  const jsRes = await fetch(`${BASE}/js/pages/my.js`);
  const js = await jsRes.text();
  ok('my.js 含 NEED_STATUS', js.includes('NEED_STATUS'));
  ok('my.js 含 招募中', js.includes('招募中'));
  ok('my.js 含 已接单', js.includes('已接单'));
  ok('my.js 含 已成交', js.includes('已成交'));
  ok('my.js 含 已取消', js.includes('已取消'));
  ok('my.js 含 openNeedModal', js.includes('openNeedModal'));
  ok('my.js 含 loadNeeds', js.includes('loadNeeds'));
  ok('my.js 含 /needs/my', js.includes('/needs/my'));

  // ============ 12. GET /needs 分页 total 正确 ============
  console.log('\n=== 12. GET /needs 分页 ===');
  // 创建 2 条新需求（open）
  const extraNeeds = [];
  for (let i = 0; i < 2; i++) {
    const r = await req('POST', '/api/needs', {
      body: {
        petId,
        startDate: plusDays(20 + i * 2),
        endDate: plusDays(24 + i * 2),
        expectedArea: `区域_${i}`,
      },
      headers: H_A,
    });
    if (r.data?.id) extraNeeds.push(r.data.id);
  }
  ok('额外创建 2 条需求成功', extraNeeds.length === 2);

  const pub12 = await req('GET', '/api/needs');
  ok('默认 pageSize=12', pub12.data?.pageSize === 12);
  ok('total >= 2（2 新需求均为 open）', pub12.data?.total >= 2);
  ok('total 精确 = needs 长度 + 已被分页隐藏的（此处 pageSize=12 应全部返回）',
    pub12.data?.needs?.length === pub12.data?.total);

  // 验证 total 计算正确：拉全部后统计 open 且非 ban
  const page1 = await req('GET', '/api/needs?page=1&pageSize=5');
  ok('page=1&pageSize=5 → total 与默认一致', page1.data?.total === pub12.data?.total);
  ok('page=1&pageSize=5 → needs 长度<=5', (page1.data?.needs || []).length <= 5);
  ok('page=1&pageSize=5 → page=1', page1.data?.page === 1);
  ok('page=1&pageSize=5 → pageSize=5', page1.data?.pageSize === 5);

  // 越界 pageSize 应被截断到 50
  const bigPage = await req('GET', '/api/needs?pageSize=1000');
  ok('pageSize=1000 被截断为 50', bigPage.data?.pageSize === 50);

  // 分页翻页
  const pubPage1 = await req('GET', '/api/needs?page=1&pageSize=2');
  const pubPage2 = await req('GET', '/api/needs?page=2&pageSize=2');
  ok('page=1 pageSize=2 → needs 长度<=2', (pubPage1.data?.needs || []).length <= 2);
  ok('page=1 和 page=2 数据不重复',
    !pubPage1.data?.needs?.some(n => pubPage2.data?.needs?.some(m => m.id === n.id)));

  // 清理：取消 2 条额外需求
  for (const id of extraNeeds) {
    await req('DELETE', `/api/needs/${id}`, { headers: H_A });
  }

  // ============ 汇总 ============
  console.log('\n================================================');
  console.log(`总计: ✅ ${passCount} 通过, ❌ ${failCount} 失败 (共 ${checks} 项断言, 覆盖 12 项测试)`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
