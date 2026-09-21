// warm-host · 需求广场（Task 18）
//
// 数据源：GET /api/needs（公开，status='open'，返回 {needs, total, page, pageSize}）
//
// 交互：
//   - 未登录 → 「登录后接单」→ /auth.html?next=/needs.html
//   - 已登录非寄养人（未申请或未审核通过）→ 「成为寄养人后接单」→ /my.html?tab=host
//   - 已登录 active 寄养人 → 「接单」→ 二次确认 → POST /api/hosts/<profileId>/book {needId}
//   - 自己的需求 → 灰色标签「这是我发布的需求」（owner_id === user.id）
//   - URL ?need=<id> → scrollIntoView + 高亮边框（用于通知跳转）
//
// 依赖：/js/api.js, /js/notifications.js, /js/app.js

(function () {
  'use strict';

  const SPECIES_ICON = { '猫': '🐱', '狗': '🐶', '兔': '🐰', '其他': '🐾' };
  const PAGE_SIZE = 12;

  const state = {
    page: 1,
    total: 0,
    pageSize: PAGE_SIZE,
    loading: false,
    needs: [],           // 累积列表
    me: null,            // GET /api/auth/me 的 user 对象
    profileId: '',       // GET /api/hosts/me 的 profile.id
    highlightId: '',     // URL ?need=<id>
  };

  // ---------- DOM ----------
  const elList = document.getElementById('needs-list');
  const elLoading = document.getElementById('loading-state');
  const elEmpty = document.getElementById('empty-state');
  const elCount = document.getElementById('result-count');
  const elLoadMoreWrap = document.getElementById('load-more-wrap');
  const elLoadMore = document.getElementById('btn-load-more');
  const elModal = document.getElementById('book-confirm-modal');
  const elModalText = document.getElementById('book-confirm-text');
  const elModalConfirm = document.getElementById('btn-book-confirm');

  // ---------- 工具 ----------
  function relativeTime(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' 分钟前';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时前';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + ' 天前';
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function mmdd(s) {
    if (!s || typeof s !== 'string') return '';
    // 'YYYY-MM-DD' → 'MM-DD'
    if (s.length === 10 && s[4] === '-' && s[7] === '-') return s.slice(5) + ' ~ ' + s.slice(8, 10);
    return s;
  }

  function daysBetween(start, end) {
    if (!start || !end) return 0;
    const [y1, m1, d1] = start.split('-').map(Number);
    const [y2, m2, d2] = end.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
  }

  // 兼容数组 / {needs,total,page,pageSize} 两种返回
  function normalizeResponse(data) {
    if (!data) return { needs: [], total: 0 };
    if (Array.isArray(data)) return { needs: data, total: data.length };
    return { needs: data.needs || [], total: data.total || 0 };
  }

  // ---------- 卡片渲染 ----------
  function renderCard(need) {
    var pet = need.pet || {};
    var speciesIcon = SPECIES_ICON[pet.species] || '🐾';
    var petName = pet.name || '宠物';
    var metaParts = [];
    if (pet.breed) metaParts.push(pet.breed);
    if (pet.gender) metaParts.push(pet.gender);
    if (pet.age) metaParts.push(pet.age);
    var metaText = metaParts.join(' · ') || '未填写品种 / 性别 / 年龄';

    var area = need.expected_area || '';
    var price = need.expected_price_cents;
    var duration = daysBetween(need.start_date, need.end_date);
    var desc = need.description || '';
    var descHtml = desc
      ? `<div class="need-desc-preview">${escapeHtml(desc.length > 60 ? desc.slice(0, 60) + '…' : desc)}</div>`
      : '';
    var timeHtml = `<div class="need-time-hint">${escapeHtml(relativeTime(need.created_at))} 发布</div>`;

    // 判断"是我的需求"
    var isMine = !!(state.me && state.me.id && need.owner_id === state.me.id);
    // 判断按钮状态
    var actionHtml = '';
    if (isMine) {
      actionHtml = `<div class="need-card-actions">
        <span class="need-own-tag">这是我发布的需求</span>
      </div>`;
    } else if (!ApiClient.isAuthed()) {
      actionHtml = `<div class="need-card-actions">
        <a class="btn btn-secondary" href="/auth.html?next=${encodeURIComponent('/needs.html')}">登录后接单</a>
      </div>`;
    } else if (!state.profileId) {
      actionHtml = `<div class="need-card-actions">
        <a class="btn btn-secondary" href="/my.html?tab=host">成为寄养人后接单</a>
      </div>`;
    } else {
      actionHtml = `<div class="need-card-actions">
        <button type="button" class="btn btn-primary" data-need-id="${need.id}" data-action="book">接单</button>
      </div>`;
    }

    var cover = pet.cover_key
      ? `<img class="need-pet-cover" src="/api/pets/${encodeURIComponent(need.pet_id || pet.id || '')}/photo" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    var coverFallback = `<div class="need-pet-cover need-pet-cover-placeholder">${speciesIcon}</div>`;

    return `
      <div class="need-card card need-square-card" data-need-id="${need.id}">
        <div class="need-card-head">
          <div class="need-pet-avatar-wrap">
            ${cover}
            ${coverFallback}
          </div>
          <div class="need-card-title">
            <div class="need-pet-name">${escapeHtml(petName)} <span class="need-pet-species">${speciesIcon}</span></div>
            <div class="need-pet-meta">${escapeHtml(metaText)}</div>
          </div>
          <div class="need-card-status">
            <span class="badge-need-amber">待接单</span>
          </div>
        </div>
        <div class="need-card-body">
          <div class="need-row"><span class="need-label">📅 日期</span><span class="need-value">${escapeHtml(mmdd(need.start_date))}（${duration} 天）</span></div>
          ${area ? `<div class="need-row"><span class="need-label">📍 区域</span><span class="need-value">${escapeHtml(area)}</span></div>` : ''}
          <div class="need-row"><span class="need-label">💰 参考价</span><span class="need-value">${price !== null && price !== undefined ? '¥' + formatPrice(price) + '/天' : '面议'}</span></div>
          ${descHtml}
        </div>
        ${actionHtml}
        ${timeHtml}
      </div>
    `;
  }

  // ---------- 渲染结果 ----------
  function renderResult() {
    elLoading.style.display = 'none';

    if (state.needs.length === 0) {
      elEmpty.style.display = '';
      elCount.style.display = 'none';
      elLoadMoreWrap.style.display = 'none';
      return;
    }

    elEmpty.style.display = 'none';
    elCount.textContent = `共 ${state.total} 条待接单需求`;
    elCount.style.display = '';

    elList.innerHTML = state.needs.map(renderCard).join('');

    // 加载更多
    if (state.needs.length < state.total) {
      elLoadMoreWrap.style.display = '';
      elLoadMore.textContent = state.loading ? '加载中…' : '加载更多';
      elLoadMore.disabled = state.loading;
    } else {
      elLoadMoreWrap.style.display = 'none';
    }

    // 高亮目标卡片
    if (state.highlightId) {
      var target = elList.querySelector(`[data-need-id="${CSS.escape(state.highlightId)}"]`);
      if (target) {
        target.classList.add('need-card-highlight');
        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      }
    }
  }

  // ---------- 加载 ----------
  async function load(reset) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.page = 1;
      state.needs = [];
    }

    elLoading.style.display = state.needs.length === 0 ? '' : 'none';
    elEmpty.style.display = 'none';
    elCount.style.display = 'none';
    elLoadMoreWrap.style.display = 'none';

    try {
      var p = new URLSearchParams();
      p.set('page', String(state.page));
      p.set('pageSize', String(state.pageSize));
      var data = await ApiClient.get('/needs?' + p.toString());
      var norm = normalizeResponse(data);
      state.total = norm.total || 0;
      if (data && typeof data.pageSize === 'number') state.pageSize = data.pageSize;
      state.needs = state.needs.concat(norm.needs);
    } catch (err) {
      showToast(err.message || '加载失败', 'error');
    } finally {
      state.loading = false;
      renderResult();
    }
  }

  // ---------- 接单流程 ----------
  let pendingBook = null;

  function openBookConfirm(need) {
    pendingBook = need;
    elModalText.textContent = `确认接「${(need.pet && need.pet.name) || '宠物'}」的寄养需求？日期 ${need.start_date} 至 ${need.end_date}。`;
    elModal.classList.add('show');
  }

  function closeBookConfirm() {
    elModal.classList.remove('show');
    pendingBook = null;
  }

  async function confirmBook() {
    if (!pendingBook) return;
    var need = pendingBook;
    elModalConfirm.disabled = true;
    try {
      var res = await ApiClient.post(`/hosts/${encodeURIComponent(state.profileId)}/book`, { needId: need.id });
      closeBookConfirm();
      showToast('接单成功，等待主人确认', 'success');
      // 卡片变灰
      var card = elList.querySelector(`[data-need-id="${CSS.escape(need.id)}"]`);
      if (card) {
        card.classList.add('need-card-done');
        var actions = card.querySelector('.need-card-actions');
        if (actions) actions.innerHTML = '<span class="need-done-tag">✅ 已接单</span>';
      }
    } catch (err) {
      var msg = (err && err.message) || '接单失败';
      // 401 由 api.js 处理；其它错误直接 toast
      showToast(msg, 'error');
    } finally {
      elModalConfirm.disabled = false;
    }
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    elLoadMore.addEventListener('click', function () {
      if (state.loading) return;
      if (state.needs.length >= state.total) return;
      state.page += 1;
      load(false);
    });

    // 卡片内按钮：接单
    elList.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action="book"]') : null;
      if (!btn) return;
      var card = btn.closest('[data-need-id]');
      if (!card) return;
      var needId = card.getAttribute('data-need-id');
      var need = state.needs.find(function (n) { return n.id === needId; });
      if (!need) return;
      openBookConfirm(need);
    });

    // 弹窗关闭
    elModal.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', closeBookConfirm);
    });
    elModal.querySelector('.modal-mask').addEventListener('click', closeBookConfirm);
    elModalConfirm.addEventListener('click', confirmBook);
  }

  // ---------- 用户态解析 ----------
  async function resolveUserState() {
    state.me = null;
    state.profileId = '';
    if (!ApiClient.isAuthed()) return;

    try {
      var data = await ApiClient.get('/auth/me');
      state.me = data.user || data || null;
      if (state.me && state.me.isHost && state.me.hostStatus === 'active') {
        try {
          var h = await ApiClient.get('/hosts/me');
          var p = h.profile || h.hostProfile || {};
          state.profileId = p.id || '';
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* 401 由 api.js 处理 */ }
  }

  // ---------- 初始化 ----------
  async function init() {
    var p = new URLSearchParams(location.search);
    state.highlightId = (p.get('need') || '').trim();

    bindEvents();
    await resolveUserState();
    await load(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
