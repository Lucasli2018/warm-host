// warm-host · 寄养人列表页
// 读取 URL 参数 from/to/district/species/size/sort，支持搜索、加载更多、URL 同步。
// 数据源：GET /api/hosts/search

(function () {
  'use strict';

  const SPECIES_ICON = { '猫': '🐱', '狗': '🐶', '兔': '🐰', '其他': '🐾' };
  const PAGE_SIZE = 12;

  // 状态
  const state = {
    from: '',
    to: '',
    district: '',
    species: '',
    size: '',
    sort: 'rating',
    page: 1,
    total: 0,
    pageSize: PAGE_SIZE,
    loading: false,
  };

  // ---------- URL 参数解析 ----------
  function parseQuery() {
    const p = new URLSearchParams(location.search);
    const get = (k) => (p.get(k) || '').trim();
    state.from = get('from');
    state.to = get('to');
    state.district = get('district');
    state.species = get('species');
    state.size = get('size');
    const s = get('sort');
    state.sort = ['rating', 'price', 'reviews'].includes(s) ? s : 'rating';
    const pg = parseInt(p.get('page') || '1', 10);
    state.page = Number.isFinite(pg) && pg >= 1 ? pg : 1;
  }

  // ---------- URL 同步 ----------
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.district) p.set('district', state.district);
    if (state.species) p.set('species', state.species);
    if (state.size) p.set('size', state.size);
    if (state.sort && state.sort !== 'rating') p.set('sort', state.sort);
    if (state.page > 1) p.set('page', String(state.page));
    const qs = p.toString();
    const url = location.pathname + (qs ? '?' + qs : '');
    try { history.replaceState(null, '', url); } catch { /* ignore */ }
  }

  // ---------- DOM ----------
  const elList = document.getElementById('host-list');
  const elCount = document.getElementById('result-count');
  const elLoading = document.getElementById('loading-state');
  const elEmpty = document.getElementById('empty-state');
  const elLoadMoreWrap = document.getElementById('load-more-wrap');
  const elLoadMore = document.getElementById('btn-load-more');
  const elBtnSearch = document.getElementById('btn-search');
  const elBtnClear = document.getElementById('btn-clear-filter');
  const elFilterToggle = document.getElementById('filter-toggle');
  const elFilterBody = document.getElementById('filter-body');

  const elFrom = document.getElementById('f-from');
  const elTo = document.getElementById('f-to');
  const elDistrict = document.getElementById('f-district');
  const elSpeciesChips = document.getElementById('f-species-chips');
  const elSizeChips = document.getElementById('f-size-chips');
  const elSortChips = document.getElementById('f-sort-chips');

  // ---------- 渲染表单态到 DOM ----------
  function applyStateToForm() {
    elFrom.value = state.from;
    elTo.value = state.to;
    elDistrict.value = state.district;
    // 单选 chips：把当前选中项加上 chip-primary，其他去掉
    const setChip = (container, key) => {
      const cur = state[key];
      container.querySelectorAll('.chip-cursor').forEach(c => {
        const v = c.dataset.value;
        if (v === cur) c.classList.add('chip-primary');
        else c.classList.remove('chip-primary');
      });
    };
    setChip(elSpeciesChips, 'species');
    setChip(elSizeChips, 'size');
    setChip(elSortChips, 'sort');
  }

  // ---------- 卡片渲染 ----------
  function escapeId(s) { return String(s || ''); }

  function speciesLabel(species) {
    if (!Array.isArray(species) || species.length === 0) return '';
    // 取第一个（列表页显示为主品种）
    const s = species[0];
    return (SPECIES_ICON[s] || '🐾') + ' ' + s;
  }

  function renderCard(host) {
    const avatar = host.avatarKey
      ? `<img class="host-avatar" src="/api/users/${escapeId(host.userId)}/photo" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const avatarFallback = `<div class="host-avatar host-avatar-fallback" style="${host.avatarKey ? 'display:none' : ''}">🏠</div>`;

    const badges = [];
    if (host.isVerified) badges.push('<span class="badge-verified" title="已通过身份审核">✓ 认证</span>');
    if (host.isSponsored) badges.push('<span class="badge-sponsored" title="平台担保">✓ 已担保</span>');

    const stars = renderStars(host.avgRating || 0);
    const ratingText = (host.avgRating || 0).toFixed(1);
    const reviews = host.totalReviews || 0;

    // 属性 chips
    const chips = [];
    const sp = speciesLabel(host.capacitySpecies);
    if (sp) chips.push(`<span class="chip chip-primary">${sp}</span>`);
    chips.push(`<span class="chip">最多 ${host.capacityCount || 1} 只</span>`);
    if (Array.isArray(host.capacitySize) && host.capacitySize.length > 0) {
      const sz = host.capacitySize.map(escapeHtml).join(' / ');
      chips.push(`<span class="chip">${escapeHtml(sz)}</span>`);
    }

    // 区域
    const region = [host.district, host.addressFuzzy].filter(Boolean).map(escapeHtml).join(' · ');
    const regionHtml = region ? `<div class="host-region">📍 ${region}</div>` : '';

    // 日费
    const price = formatPrice(host.dailyRateCents);
    const priceHtml = `<span class="host-price">参考日费 <strong>¥${price}</strong> <small>/天</small></span>`;

    // 可接天数（仅当搜索带 from/to 时展示）
    let availHtml = '';
    if (state.from && state.to && host.availableDays > 0) {
      availHtml = `<span class="badge-availability">${host.availableDays} 天可接</span>`;
    }

    return `
      <a class="host-card" href="/host-detail.html?id=${encodeURIComponent(host.hostId)}">
        <div class="host-card-avatar-wrap">
          ${avatar}
          ${avatarFallback}
        </div>
        <div class="host-card-body">
          <div class="host-card-title-row">
            <span class="host-card-name">${escapeHtml(host.nickname || '寄养人')}</span>
            <div class="host-card-badges">${badges.join('')}</div>
          </div>
          <div class="host-card-rating">
            <span class="host-card-stars">${stars}</span>
            <span class="host-card-rating-num">${ratingText}</span>
            <span class="host-card-reviews">· ${reviews} 条评价</span>
          </div>
          <div class="host-card-chips">${chips.join('')}</div>
          ${regionHtml}
          <div class="host-card-footer">
            ${priceHtml}
            ${availHtml}
          </div>
        </div>
        <div class="host-card-arrow">›</div>
      </a>
    `;
  }

  // ---------- 渲染结果 ----------
  function renderResult() {
    // 隐藏所有状态
    elLoading.style.display = 'none';
    elEmpty.style.display = 'none';
    elLoadMoreWrap.style.display = 'none';

    if (elList._cachedHtml === undefined) elList._cachedHtml = '';
    elList.innerHTML = elList._cachedHtml;

    if (state.total === 0) {
      elEmpty.style.display = '';
      elCount.style.display = 'none';
      return;
    }

    elCount.textContent = `共 ${state.total} 位寄养人`;
    elCount.style.display = '';

    // 加载更多按钮：还有下一页时显示
    if (elList.children.length < state.total) {
      elLoadMoreWrap.style.display = '';
      elLoadMore.textContent = state.loading ? '加载中…' : '加载更多';
      elLoadMore.disabled = state.loading;
    }
  }

  // ---------- 加载数据 ----------
  async function load(reset = false) {
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.page = 1;
      elList.innerHTML = '';
      elList._cachedHtml = '';
    }
    renderResult(); // 显示 loading

    // 显示 loading
    elLoading.style.display = '';
    elList.innerHTML = '';
    elList._cachedHtml = '';
    elCount.style.display = 'none';
    elEmpty.style.display = 'none';
    elLoadMoreWrap.style.display = 'none';

    const p = new URLSearchParams();
    if (state.from && state.to) {
      p.set('from', state.from);
      p.set('to', state.to);
    }
    if (state.district) p.set('district', state.district);
    if (state.species) p.set('species', state.species);
    if (state.size) p.set('size', state.size);
    if (state.sort) p.set('sort', state.sort);
    p.set('page', String(state.page));
    p.set('pageSize', String(state.pageSize));

    try {
      const data = await ApiClient.get('/hosts/search?' + p.toString());
      state.total = data.total || 0;
      state.pageSize = data.pageSize || PAGE_SIZE;
      const hosts = data.hosts || [];
      const html = hosts.map(renderCard).join('');
      elList.innerHTML = (elList._cachedHtml || '') + html;
      elList._cachedHtml = elList.innerHTML;
    } catch (err) {
      showToast(err.message || '加载失败', 'error');
    } finally {
      state.loading = false;
      renderResult();
      syncUrl();
    }
  }

  // ---------- 筛选态变更 ----------
  function readFormToState() {
    state.from = elFrom.value.trim();
    state.to = elTo.value.trim();
    state.district = elDistrict.value.trim();
    state.species = elSpeciesChips.querySelector('.chip-primary')?.dataset.value || '';
    state.size = elSizeChips.querySelector('.chip-primary')?.dataset.value || '';
    state.sort = elSortChips.querySelector('.chip-primary')?.dataset.value || 'rating';
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    // 展开/折叠
    elFilterToggle.addEventListener('click', () => {
      const hidden = elFilterBody.style.display === 'none';
      elFilterBody.style.display = hidden ? '' : 'none';
      elFilterToggle.textContent = hidden ? '收起 ▴' : '展开 ▾';
    });

    // 单选 chips
    const bindSingleSelect = (container, key) => {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-cursor');
        if (!btn) return;
        const v = btn.dataset.value;
        // 已选中 → 取消选中
        if (state[key] === v) {
          btn.classList.remove('chip-primary');
          state[key] = '';
        } else {
          container.querySelectorAll('.chip-cursor').forEach(c => c.classList.remove('chip-primary'));
          btn.classList.add('chip-primary');
          state[key] = v;
        }
        syncUrl();
      });
    };
    bindSingleSelect(elSpeciesChips, 'species');
    bindSingleSelect(elSizeChips, 'size');
    bindSingleSelect(elSortChips, 'sort');

    // 搜索
    elBtnSearch.addEventListener('click', () => {
      readFormToState();
      syncUrl();
      load(true);
    });

    // 清空
    elBtnClear.addEventListener('click', () => {
      state.from = '';
      state.to = '';
      state.district = '';
      state.species = '';
      state.size = '';
      state.sort = 'rating';
      applyStateToForm();
      syncUrl();
      load(true);
    });

    // 加载更多
    elLoadMore.addEventListener('click', () => {
      if (state.loading) return;
      if (elList.children.length >= state.total) return;
      state.page += 1;
      load(false);
    });

    // Enter 键在输入框内触发搜索
    elFrom.addEventListener('keydown', (e) => { if (e.key === 'Enter') elBtnSearch.click(); });
    elTo.addEventListener('keydown', (e) => { if (e.key === 'Enter') elBtnSearch.click(); });
    elDistrict.addEventListener('keydown', (e) => { if (e.key === 'Enter') elBtnSearch.click(); });
  }

  // ---------- 初始化 ----------
  function init() {
    parseQuery();
    applyStateToForm();
    bindEvents();
    load(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
