// public/js/pages/index.js
// Task 15 — 首页交互：登录状态、数据看板、搜索栏跳转
// 依赖：/js/api.js

document.addEventListener('DOMContentLoaded', async () => {
  // ============ 登录状态：品牌栏右侧 ============
  const slot = document.getElementById('brand-auth-slot');
  const ctaNeed = document.getElementById('home-cta-need');

  async function renderAuth() {
    if (!slot) return;
    if (!ApiClient.isAuthed()) {
      slot.innerHTML = '<button type="button" id="btn-login" class="btn btn-secondary home-login-btn">登录</button>';
      slot.querySelector('#btn-login').addEventListener('click', () => {
        location.href = '/auth.html?next=' + encodeURIComponent(location.pathname);
      });
      // 未登录点"我要寄养" → auth.html
      if (ctaNeed) {
        ctaNeed.addEventListener('click', (e) => {
          e.preventDefault();
          location.href = '/auth.html?next=' + encodeURIComponent('/my.html?tab=needs');
        });
      }
    } else {
      // 有 token，调 /me 获取昵称
      try {
        const me = await ApiClient.get('/auth/me');
        const nickname = (me && me.nickname) || '我';
        const initial = (nickname || '?').slice(0, 1);
        slot.innerHTML =
          '<div class="home-avatar" title="' + escapeHtml(nickname) + '">' + escapeHtml(initial) + '</div>' +
          '<button type="button" id="btn-logout" class="btn btn-ghost home-logout-btn">退出</button>';
        slot.querySelector('#btn-logout').addEventListener('click', async () => {
          if (!confirm('确定退出登录？')) return;
          try { await ApiClient.post('/auth/logout', null); } catch {}
          ApiClient.setToken(null);
          location.reload();
        });
      } catch {
        // 请求失败时保持按钮降级为登录态
        slot.innerHTML = '<button type="button" id="btn-login" class="btn btn-secondary home-login-btn">登录</button>';
        slot.querySelector('#btn-login').addEventListener('click', () => {
          location.href = '/auth.html?next=' + encodeURIComponent(location.pathname);
        });
      }
    }
  }
  await renderAuth();

  // ============ 数据看板 ============
  async function loadStats() {
    // 元素 id → 后端 /api/stats 字段（today 在接口里叫 todayOrders，兼容两种）
    const map = {
      'stat-hosts':   ['hosts'],
      'stat-pets':    ['pets'],
      'stat-needs':   ['needs'],
      'stat-orders':  ['orders'],
      'stat-reviews': ['reviews'],
      'stat-today':   ['todayOrders', 'today'],
    };
    try {
      const data = await ApiClient.get('/stats');
      for (const [id, keys] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        let v;
        for (const k of keys) {
          if (data && Number.isFinite(data[k])) { v = data[k]; break; }
        }
        el.textContent = (Number.isFinite(v) && v >= 0) ? String(v) : '—';
      }
    } catch (err) {
      // 失败静默；元素保持 "—"
    }
  }
  await loadStats();

  // ============ 搜索栏 ============
  const fromEl = document.getElementById('search-from');
  const toEl   = document.getElementById('search-to');
  const areaEl = document.getElementById('search-area');
  const btnSearch = document.getElementById('btn-search');

  function ymd(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  const today = new Date();
  const plus7  = new Date(today); plus7.setDate(plus7.getDate() + 7);
  const plus11 = new Date(today); plus11.setDate(plus11.getDate() + 11);
  if (fromEl) fromEl.value = ymd(plus7);
  if (toEl)   toEl.value   = ymd(plus11);

  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      const from = fromEl && fromEl.value;
      const to   = toEl   && toEl.value;
      const area = (areaEl && areaEl.value || '').trim();
      if (!from || !to) {
        showToast('请选择日期区间', 'warning');
        return;
      }
      if (from >= to) {
        showToast('起始日期必须早于结束日期', 'warning');
        return;
      }
      const q = new URLSearchParams();
      q.set('from', from);
      q.set('to', to);
      if (area) q.set('district', area);
      location.href = '/hosts.html?' + q.toString();
    });
  }
});
