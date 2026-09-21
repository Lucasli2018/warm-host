// warm-host 演示数据生成器（走真实 API，可指向本地或线上）
//
// 用法：
//   node tools/seed-demo.mjs                          # 默认 http://127.0.0.1:8787
//   node tools/seed-demo.mjs https://warm-host.pages.dev
//
// 生成内容：
//   · 5 位寄养人（4 位已审核可接单 + 1 位被举报确认进黑名单）
//   · 6 位宠物主人 + 7 只宠物档案
//   · 12 条寄养需求（8 条已完成订单、1 条进行中、3 条待接单）
//   · 8 条真实评价（含标签与文字，聚合出寄养人评分）
//   · 2 条举报（1 条已确认进公示、1 条待处理）
//
// 注意：线上注册限流为同 IP 15 分钟 20 次（内存实现）。本脚本注册 11 个账号，
//       请在限流窗口内一次跑完，勿短时间重复执行。
//
// 幂等性：**无**。脚本每次都会新建账号，请勿重复运行（账号已存在会报错退出）。

// 本机无 IPv6 出口 + *.pages.dev 有 AAAA 记录 → 不强制 IPv4 会 UND_ERR_CONNECT_TIMEOUT
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const B = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const PASSWORD = "demo123456";

// ============ 工具 ============
let reqCount = 0;
async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(B + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  reqCount++;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

let step = 0;
const log = (msg) => console.log(`\n[${String(++step).padStart(2, "0")}] ${msg}`);
const ok = (msg) => console.log(`     ✓ ${msg}`);

function must(r, what) {
  if (r.status < 200 || r.status >= 300) {
    console.error(`\n✗ ${what} 失败：HTTP ${r.status} ${JSON.stringify(r.data)}`);
    process.exit(1);
  }
  return r.data;
}

// 本地日期（取当天中午，避免 UTC 跨天）
function day(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const rndPhone = () => "13" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

// ============ 数据定义 ============
const HOSTS = [
  {
    key: "h1", nick: "林小满", district: "朝阳区", area: "望京 · 朝阳公园一带",
    species: ["猫", "狗"], sizes: ["小型", "中型"], rate: 12000,
    bio: "家里有独立猫房和落地窗，全职在家，一天至少陪玩三次。",
    exp: "养猫 8 年（两只英短），帮朋友照顾过金毛和小奶猫，会用喂药器。",
    services: ["有隔离空间", "24小时监控", "可上门接送"],
  },
  {
    key: "h2", nick: "陈屿", district: "海淀区", area: "中关村 · 五道口",
    species: ["狗"], sizes: ["中型", "大型"], rate: 15000,
    bio: "家里有大院子，每天早晚各遛一次，适合精力旺盛的狗子。",
    exp: "养边牧 6 年，做过宠物医院志愿者，懂基础急救。",
    services: ["可上门接送", "宠物医院合作", "24小时监控"],
  },
  {
    key: "h3", nick: "苏念", district: "西城区", area: "金融街 · 月坛",
    species: ["猫", "狗", "兔"], sizes: ["小型"], rate: 10000,
    bio: "公寓式寄养，安静少人，适合容易应激的小朋友。",
    exp: "养布偶 4 年，照顾过朋友的兔子和小型犬。",
    services: ["有隔离空间"],
  },
  {
    key: "h4", nick: "周予安", district: "东城区", area: "东直门 · 三里屯",
    species: ["猫", "兔"], sizes: ["小型"], rate: 9000,
    bio: "刚通过实名审核，家里有一只性格温和的橘猫，慢慢接单。",
    exp: "养宠 3 年，愿意从短途寄养开始积累口碑。",
    services: ["有隔离空间"],
  },
  {
    key: "h5", nick: "何未眠", district: "丰台区", area: "丽泽商务区一带",
    species: ["猫", "狗"], sizes: ["小型", "中型"], rate: 8000,
    bio: "家庭寄养，价格实惠。",
    exp: "有照顾宠物的经验。",
    services: [],
  },
];

const OWNERS = [
  { key: "o1", nick: "顾清和", pets: [{ key: "p1", name: "布丁", species: "猫", breed: "英短蓝猫", gender: "母", age: "2岁", weight: "4.2kg", personality: ["安静", "粘人"], habits: "每天早晚各喂一次，喜欢被梳毛。", health: "已绝育，疫苗齐全。", needs: "怕生，需要安静环境。" }] },
  { key: "o2", nick: "沈知微", pets: [{ key: "p2", name: "团子", species: "狗", breed: "柯基", gender: "公", age: "3岁", weight: "12kg", personality: ["活泼", "爱玩球"], habits: "每天早晚各遛一次，每次半小时。", health: "疫苗齐全，肠胃稍敏感。", needs: "只能吃自带的狗粮。" }] },
  { key: "o3", nick: "叶子墨", pets: [
    { key: "p3", name: "年糕", species: "猫", breed: "橘猫", gender: "公", age: "4岁", weight: "5.6kg", personality: ["贪吃", "亲人"], habits: "自由采食，喜欢晒太阳。", health: "需要控制体重。", needs: "不要喂零食。" },
    { key: "p4", name: "芝麻", species: "兔", breed: "垂耳兔", gender: "母", age: "1岁", weight: "1.8kg", personality: ["胆小"], habits: "苜蓿草 + 兔粮，每天换水。", health: "健康。", needs: "需要安静的笼位。" },
  ] },
  { key: "o4", nick: "温以宁", pets: [{ key: "p5", name: "小蓝", species: "猫", breed: "布偶", gender: "母", age: "1岁", weight: "3.8kg", personality: ["黏人", "怕生"], habits: "每天两次湿粮，注意梳毛。", health: "疫苗齐全。", needs: "容易应激，需要单独空间。" }] },
  { key: "o5", nick: "陆时言", pets: [{ key: "p6", name: "阿黄", species: "狗", breed: "金毛", gender: "公", age: "5岁", weight: "32kg", personality: ["温顺", "爱游泳"], habits: "每天遛两次，运动量较大。", health: "髋关节需注意，避免剧烈跳跃。", needs: "需要有一定活动空间。" }] },
  { key: "o6", nick: "白露", pets: [{ key: "p7", name: "雪球", species: "狗", breed: "萨摩耶", gender: "母", age: "2岁", weight: "20kg", personality: ["热情", "爱叫"], habits: "每天遛一小时，需要梳毛。", health: "健康。", issues: "" , needs: "掉毛多，希望每天梳一次。" }] },
];

// 需求 + 订单 + 评价
// 注：POST /api/needs 校验「startDate 不能早于今天」，所以演示订单的日期只能落在今天之后，
//     这里统一用「今天 ~ 今天+N」，状态机照常走完（completed），评价内容聚焦服务体验。
const ORDERS = [
  { host: "h1", owner: "o1", pet: "p1", from: 0, to: 2, price: 12000, rating: 5, tags: ["照顾周到", "会拍照"], content: "小满每天都会发布丁的照片和小视频，猫咪回来状态特别好，毛都顺了。下次还找她。" },
  { host: "h1", owner: "o2", pet: "p2", from: 0, to: 1, price: 12000, rating: 5, tags: ["沟通顺畅", "按时接送"], content: "临时出差急着找人，小满当天就答应了，接送都很准时，团子玩得很开心。" },
  { host: "h1", owner: "o3", pet: "p3", from: 0, to: 3, price: 12000, rating: 5, tags: ["照顾周到", "有爱心"], content: "年糕是只挑食的橘猫，小满连着几天换着花样哄它吃饭，很用心。" },
  { host: "h1", owner: "o4", pet: "p5", from: 0, to: 1, price: 12000, rating: 4, tags: ["环境整洁"], content: "环境很干净，小蓝回来后没有应激。唯一小遗憾是消息回复稍慢一点。" },
  { host: "h2", owner: "o5", pet: "p6", from: 0, to: 1, price: 15000, rating: 5, tags: ["经验丰富", "有急救知识"], content: "阿黄年纪大了腿脚不好，陈屿专门铺了防滑垫，还记录了每天的走路情况，很专业。" },
  { host: "h2", owner: "o2", pet: "p2", from: 0, to: 2, price: 15000, rating: 5, tags: ["按时接送", "照顾周到"], content: "团子第二次寄养了，陈屿说这次比上次放松很多，还教会了它接飞盘。" },
  { host: "h2", owner: "o6", pet: "p7", from: 0, to: 3, price: 15000, rating: 5, tags: ["有爱心", "沟通顺畅"], content: "雪球掉毛多，陈屿每天给梳一次毛，还发了梳毛视频，太贴心了。" },
  { host: "h3", owner: "o1", pet: "p1", from: 0, to: 1, price: 10000, rating: 5, tags: ["环境整洁", "照顾周到"], content: "苏念家很安静，布丁这个胆小鬼居然没有躲起来，说明环境真的让它安心。" },
];

// 进行中（已开始未完成）
const ONGOING = { host: "h3", owner: "o5", pet: "p6", from: 0, to: 2, price: 10000 };

// 待接单（保持 open，供搜索/邀请演示）
const OPEN_NEEDS = [
  { owner: "o1", pet: "p1", from: +7, to: +10, price: 12000, area: "朝阳区", desc: "出差一周，希望找有猫房、能每天发照片的寄养人。布丁怕生，需要安静环境。" },
  { owner: "o2", pet: "p2", from: +12, to: +15, price: 15000, area: "海淀区", desc: "公司团建四天，团子精力旺盛，希望每天能遛两次。" },
  { owner: "o4", pet: "p5", from: +20, to: +23, price: 10000, area: "西城区 / 朝阳区", desc: "第一次寄养，比较担心，希望寄养人有耐心、能随时沟通。" },
];

// 举报：1 条确认 + 封号（进入公开黑名单公示）、1 条待处理
// 注：GET /api/blacklist 的公示条件是「status='confirmed' **且** target 用户 banned=1」，
//     所以确认时必须带 banUser=true，否则只记录不公示。
const REPORTS = [
  { reporter: "o6", target: "h5", targetType: "host", category: "虚假资料", details: "页面写的可接单日期和实际不一致，沟通后临时说不能接，已经把行程打乱了。", handle: "confirm" },
  { reporter: "o4", target: "h4", targetType: "host", category: "失联/放鸽子", details: "约好周六上门看环境，等了一个多小时没见到人，消息也不回。", handle: "pending" },
];

// ============ 主流程 ============
console.log(`目标环境：${B}`);

log("admin 登录");
const adminLogin = must(await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } }), "admin 登录");
const ADMIN = adminLogin.token;
const adminId = adminLogin.user.id;
ok(`admin 已登录 (${adminId})`);

log("生成邀请码");
const codeRes = must(await api("POST", "/api/admin/invite-codes", { token: ADMIN, body: { count: 30 } }), "生成邀请码");
const codes = codeRes.codes || [];
if (codes.length < HOSTS.length + OWNERS.length) {
  console.error(`邀请码不足：${codes.length}`);
  process.exit(1);
}
ok(`获得 ${codes.length} 个邀请码`);

log("注册账号");
const hosts = {};
const owners = {};
let codeIdx = 0;

for (const h of HOSTS) {
  const phone = rndPhone();
  const r = must(await api("POST", "/api/auth/register", { body: { phone, password: PASSWORD, nickname: h.nick, inviteCode: codes[codeIdx++] } }), `注册 ${h.nick}`);
  hosts[h.key] = { ...h, token: r.token, id: r.user.id, phone };
  ok(`${h.nick}（寄养人 · ${h.district}）`);
}
for (const o of OWNERS) {
  const phone = rndPhone();
  const r = must(await api("POST", "/api/auth/register", { body: { phone, password: PASSWORD, nickname: o.nick, inviteCode: codes[codeIdx++] } }), `注册 ${o.nick}`);
  owners[o.key] = { ...o, token: r.token, id: r.user.id, phone, petIds: {} };
  ok(`${o.nick}（主人 · ${o.pets.length} 只宠物）`);
}

log("寄养人：提交申请 → 审核通过 → 平台担保");
for (const h of Object.values(hosts)) {
  must(await api("POST", "/api/hosts/apply", {
    token: h.token,
    body: {
      bio: h.bio, capacity_count: 3,
      capacity_species: h.species, capacity_size: h.sizes, capacity_gender: ["公", "母", "未知"],
      address_fuzzy: h.area, district: h.district, experience: h.exp,
      special_services: h.services, daily_rate_cents: h.rate,
    },
  }), `${h.nick} 申请`);
  must(await api("POST", `/api/admin/hosts/${h.id}`, { token: ADMIN, body: { action: "verify" } }), `${h.nick} 审核`);
  must(await api("POST", `/api/admin/hosts/${h.id}/sponsor`, { token: ADMIN, body: { sponsorUserId: adminId } }), `${h.nick} 担保`);
  const me = must(await api("GET", "/api/hosts/me", { token: h.token }), `${h.nick} 档案`);
  h.profileId = me.profile.id;
  if (!me.profile.is_sponsored) { console.error(`✗ ${h.nick} 未获得担保`); process.exit(1); }
  ok(`${h.nick} 已通过审核并完成担保`);
}

log("寄养人：设置可接单日期");
for (const h of Object.values(hosts)) {
  must(await api("PUT", "/api/hosts/me/availability", {
    token: h.token,
    body: [
      { start_date: day(-60), end_date: day(-30), note: "已排满的历史档期" },
      { start_date: day(-29), end_date: day(45), note: "可接单" },
      { start_date: day(46), end_date: day(120), note: "可预约" },
    ],
  }), `${h.nick} 可接单日期`);
}
ok("5 位寄养人的档期已设置（过去 60 天 ~ 未来 120 天）");

log("主人：创建宠物档案");
for (const o of Object.values(owners)) {
  for (const p of o.pets) {
    const r = must(await api("POST", "/api/pets", {
      token: o.token,
      body: {
        name: p.name, species: p.species, breed: p.breed, gender: p.gender,
        age: p.age, weight: p.weight, personality: p.personality,
        health_notes: p.health, daily_habits: p.habits, special_needs: p.needs,
      },
    }), `宠物 ${p.name}`);
    o.petIds[p.key] = r.id;
  }
}
ok(`已创建 ${Object.values(owners).reduce((s, o) => s + o.pets.length, 0)} 只宠物`);

async function createNeed(o, pet, from, to, price, desc, area) {
  const r = must(await api("POST", "/api/needs", {
    token: o.token,
    body: {
      petId: o.petIds[pet], startDate: day(from), endDate: day(to),
      expectedArea: area || "", description: desc, expectedPriceCents: price,
    },
  }), "发布需求");
  return r.id;
}

log("生成历史订单（接单 → 确认 → 开始 → 完成 → 评价）");
let orderSeq = 0;
for (const od of ORDERS) {
  const h = hosts[od.host];
  const o = owners[od.owner];
  const desc = `${o.nick} 的 ${OWNERS.find((x) => x.key === od.owner).pets.find((x) => x.key === od.pet)?.name || "宠物"} 需要寄养 ${Math.abs(od.to - od.from) + 1} 天。`;
  const needId = await createNeed(o, od.pet, od.from, od.to, od.price, desc);

  const booked = must(await api("POST", `/api/hosts/${h.profileId}/book`, { token: h.token, body: { needId } }), "接单");
  const orderId = booked.id;
  must(await api("POST", `/api/orders/${orderId}/status`, { token: o.token, body: { action: "accept" } }), "主人确认");
  must(await api("POST", `/api/orders/${orderId}/status`, { token: h.token, body: { action: "start" } }), "开始寄养");
  must(await api("POST", `/api/orders/${orderId}/status`, { token: h.token, body: { action: "complete" } }), "完成寄养");
  must(await api("POST", `/api/orders/${orderId}/review`, {
    token: o.token,
    body: { rating: od.rating, content: od.content, tags: od.tags },
  }), "评价");

  orderSeq++;
  ok(`订单 ${orderSeq}：${h.nick} ← ${o.nick}（${od.rating} 星）`);
}

log("生成进行中订单");
{
  const h = hosts[ONGOING.host];
  const o = owners[ONGOING.owner];
  const needId = await createNeed(o, ONGOING.pet, ONGOING.from, ONGOING.to, ONGOING.price, "短期寄养三天，正在服务中。");
  const booked = must(await api("POST", `/api/hosts/${h.profileId}/book`, { token: h.token, body: { needId } }), "接单");
  must(await api("POST", `/api/orders/${booked.id}/status`, { token: o.token, body: { action: "accept" } }), "主人确认");
  must(await api("POST", `/api/orders/${booked.id}/status`, { token: h.token, body: { action: "start" } }), "开始寄养");
  ok(`进行中：${h.nick} 正在照顾 ${o.nick} 的宠物`);
}

log("生成待接单需求（open）");
for (const n of OPEN_NEEDS) {
  const o = owners[n.owner];
  await createNeed(o, n.pet, n.from, n.to, n.price, n.desc, n.area);
  ok(`${o.nick} 的需求（${day(n.from)} ~ ${day(n.to)}）`);
}

log("生成主人邀请（产生寄养人通知）");
{
  const o = owners.o1;
  const h = hosts.h1;
  const openRes = must(await api("GET", "/api/needs/my", { token: o.token }), "我的需求");
  const list = Array.isArray(openRes) ? openRes : (openRes.needs || []);
  const target = list.find((x) => x.status === "open");
  if (target) {
    const r = await api("POST", `/api/hosts/${h.profileId}/invite`, { token: o.token, body: { needId: target.id } });
    if (r.status === 200) ok(`已邀请 ${h.nick} 接单（寄养人侧产生一条通知）`);
    else ok(`邀请返回 ${r.status}（已有订单时属正常）`);
  }
}

log("生成举报与黑名单处理");
const reportIds = [];
for (const rep of REPORTS) {
  const r = must(await api("POST", "/api/blacklist", {
    token: owners[rep.reporter].token,
    body: { targetUserId: hosts[rep.target].id, targetType: rep.targetType, category: rep.category, details: rep.details },
  }), "提交举报");
  reportIds.push({ id: r.id, handle: rep.handle, target: rep.target });
  ok(`${owners[rep.reporter].nick} 举报 ${hosts[rep.target].nick}（${rep.category}）`);
}
for (const r of reportIds.filter((x) => x.handle === "confirm")) {
  must(await api("POST", `/api/admin/blacklist/${r.id}`, { token: ADMIN, body: { action: "confirm", banUser: true } }), "处理举报");
  ok(`已确认举报并封号 → ${hosts[r.target].nick} 进入黑名单公示`);
}

// ============ 汇总 ============
const stats = must(await api("GET", "/api/stats"), "stats");
const search = must(await api("GET", "/api/hosts/search"), "search");
const pubBl = must(await api("GET", "/api/blacklist"), "blacklist");

console.log("\n================ 造数据完成 ================");
console.log(`请求数        : ${reqCount}`);
console.log(`/api/stats    : ${JSON.stringify(stats)}`);
console.log(`可搜索寄养人  : ${search.total} 位（黑名单已过滤）`);
console.log(`黑名单公示    : ${(pubBl.items || []).length} 条`);
if (!(pubBl.items || []).length) console.log("  ⚠️ 公示为 0：公开列表要求 confirmed + 已封号，检查举报处理结果");
console.log("\n演示账号（密码统一 " + PASSWORD + "）：");
for (const h of Object.values(hosts)) console.log(`  寄养人  ${h.nick.padEnd(4)} ${h.phone}`);
for (const o of Object.values(owners)) console.log(`  主人    ${o.nick.padEnd(4)} ${o.phone}`);
console.log(`\n线上地址：${B}`);
