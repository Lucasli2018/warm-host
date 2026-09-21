// warm-host · 寄养人详情页
// 读取 URL id 参数，并行加载 detail + reviews，展示档案、可接单日期、评价，CTA 占位。

(function () {
  'use strict';

  const SPECIES_ICON = { '猫': '🐱', '狗': '🐶', '兔': '🐰', '其他': '🐾' };
  const REVIEWS_PAGE_SIZE = 10;

  const state = {
    hostId: '',
    reviewsPage: 1,
    reviewsTotal: 0,
    reviewsLoading: false,
    reviewsLoaded: 0,
  };

  // ---------- 404 处理 ----------
  function showNotFound() {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('detail-content').style.display = 'none';
    document.getElementById('not-found-state').style.display = '';
    document.getElementById('cta-wrap').style.display = 'none';
  }

  // ---------- 显示详情 ----------
  function showDetail(host, availability, reviewsData) {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('not-found-state').style.display = 'none';
    document.getElementById('detail-content').style.display = '';

    // 标题
    document.getElementById('detail-name').textContent = host.nickname || '寄养人';

    // 头像
    const avatar = document.getElementById('detail-avatar');
    const avatarFallback = document.getElementById('detail-avatar-fallback');
    if (host.avatarKey) {
      avatar.src = `/api/users/${encodeURIComponent(host.userId)}/photo`;
      avatar.style.display = '';
      avatarFallback.style.display = 'none';
      avatar.onerror = function () {
        avatar.style.display = 'none';
        avatarFallback.style.display = 'flex';
      };
    } else {
      avatar.style.display = 'none';
      avatarFallback.style.display = 'flex';
    }

    // 徽章
    const badges = [];
    if (host.isVerified) badges.push('<span class="badge-verified" title="已通过身份审核">✓ 认证</span>');
    if (host.isSponsored) badges.push('<span class="badge-sponsored" title="平台担保">✓ 已担保</span>');
    document.getElementById('detail-badges').innerHTML = badges.join('');

    // 星级 + 评分
    document.getElementById('detail-stars').textContent = renderStars(host.avgRating || 0);
    document.getElementById('detail-rating-num').textContent = (host.avgRating || 0).toFixed(1);
    document.getElementById('detail-reviews').textContent = `· ${host.totalReviews || 0} 条评价`;

    // 基本信息
    const region = [host.district, host.addressFuzzy].filter(Boolean).join(' · ') || '-';
    document.getElementById('detail-region').textContent = region;
    document.getElementById('detail-price').innerHTML = `¥<strong>${formatPrice(host.dailyRateCents)}</strong><small> /天</small>`;
    document.getElementById('detail-capacity').textContent = `最多 ${host.capacityCount || 1} 只`;
    document.getElementById('detail-species').textContent =
      (host.capacitySpecies || []).map(s => (SPECIES_ICON[s] || '🐾') + s).join(' / ') || '-';
    document.getElementById('detail-size').textContent =
      (host.capacitySize || []).map(escapeHtml).join(' / ') || '-';
    document.getElementById('detail-gender').textContent =
      (host.capacityGender || []).map(escapeHtml).join(' / ') || '-';

    // 自我介绍
    document.getElementById('detail-bio').textContent = host.bio || '暂无自我介绍';
    document.getElementById('detail-experience').textContent = host.experience || '暂无养宠经历';

    // 特殊服务
    const services = host.specialServices || [];
    const servicesWrap = document.getElementById('detail-services-wrap');
    const servicesBox = document.getElementById('detail-services');
    if (services.length > 0) {
      servicesWrap.style.display = '';
      servicesBox.innerHTML = services.map(s => `<span class="chip chip-trust">${escapeHtml(s)}</span>`).join('');
    } else {
      servicesWrap.style.display = 'none';
      servicesBox.innerHTML = '';
    }

    // 可接单日期
    renderAvailability(availability || []);

    // 评价
    renderReviews(reviewsData);

    // CTA
    document.getElementById('cta-wrap').style.display = '';
  }

  // ---------- 可接单日期 ----------
  function renderAvailability(list) {
    const box = document.getElementById('detail-availability');
    if (!list || list.length === 0) {
      box.innerHTML = `<div class="availability-empty">暂未设置可接单日期</div>`;
      return;
    }
    // 按 startDate 升序
    const sorted = [...list].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    box.innerHTML = sorted.map(item => {
      const s = item.startDate || '';
      const e = item.endDate || '';
      const note = item.note ? escapeHtml(item.note) : '';
      // 计算天数（含首尾）
      let days = 0;
      if (s && e) {
        const sUTC = Date.UTC(s.slice(0, 4), s.slice(5, 7) - 1, s.slice(8, 10));
        const eUTC = Date.UTC(e.slice(0, 4), e.slice(5, 7) - 1, e.slice(8, 10));
        if (eUTC >= sUTC) days = Math.floor((eUTC - sUTC) / 86400000) + 1;
      }
      return `
        <div class="availability-item">
          <span class="availability-idx">📅</span>
          <div class="availability-body">
            <div class="availability-date">${escapeHtml(s)} 至 ${escapeHtml(e)}</div>
            <div class="availability-meta">${days} 天${note ? ' · ' + note : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ---------- 评价 ----------
  function renderReviews(data) {
    const reviews = data.reviews || [];
    state.reviewsTotal = data.total || 0;
    state.reviewsLoaded = reviews.length;
    state.reviewsPage = 1;

    // 平均评分
    const avg = data.avgRating || 0;
    document.getElementById('reviews-avg').textContent = avg.toFixed(1);
    document.getElementById('reviews-avg-stars').textContent = renderStars(avg);
    document.getElementById('reviews-count').textContent = `${state.reviewsTotal} 条评价`;

    // 分布条形图
    const dist = data.ratingDistribution || {};
    const distTotal = (dist['5'] || 0) + (dist['4'] || 0) + (dist['3'] || 0) + (dist['2'] || 0) + (dist['1'] || 0);
    for (let r = 5; r >= 1; r--) {
      const count = dist[String(r)] || 0;
      const pct = distTotal > 0 ? Math.round((count / distTotal) * 100) : 0;
      const bar = document.querySelector(`.rating-bar[data-rating="${r}"]`);
      if (bar) bar.style.width = pct + '%';
      const cnt = document.querySelector(`.rating-bar-count[data-count="${r}"]`);
      if (cnt) cnt.textContent = String(count);
    }

    renderReviewsList(reviews);
  }

  function renderReviewsList(reviews) {
    const box = document.getElementById('reviews-list');
    const empty = document.getElementById('reviews-empty');
    const wrap = document.getElementById('reviews-load-more-wrap');

    if (state.reviewsTotal === 0) {
      box.innerHTML = '';
      empty.style.display = '';
      wrap.style.display = 'none';
      return;
    }
    empty.style.display = 'none';

    if (!reviews || reviews.length === 0) {
      box.innerHTML = `<div class="reviews-list-empty">还没有评价</div>`;
      wrap.style.display = 'none';
      return;
    }

    const html = reviews.map(renderReviewCard).join('');
    // 追加（首次为空，后续为追加）
    if (state.reviewsPage === 1) box.innerHTML = html;
    else box.innerHTML += html;

    // 加载更多
    wrap.style.display = box.children.length < state.reviewsTotal ? '' : 'none';
    document.getElementById('btn-reviews-more').disabled = state.reviewsLoading;
  }

  function renderReviewCard(review) {
    const reviewer = review.reviewer || {};
    const rating = review.rating || 0;
    const stars = renderStars(rating);
    const time = formatDateShort(review.createdAt);
    const tags = Array.isArray(review.tags) ? review.tags.slice(0, 5) : [];
    const tagHtml = tags.map(t => `<span class="chip chip-primary">${escapeHtml(t)}</span>`).join('');

    let photoHtml = '';
    if (reviewer.avatarKey) {
      photoHtml = `<img class="review-avatar" src="/api/users/${encodeURIComponent(reviewer.id)}/photo" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`;
    }
    const fallback = `<div class="review-avatar review-avatar-fallback" style="${reviewer.avatarKey ? 'display:none' : ''}">${escapeHtml((reviewer.nickname || '评')[0])}</div>`;

    return `
      <div class="review-card">
        <div class="review-header">
          <div class="review-avatar-wrap">
            ${photoHtml}
            ${fallback}
          </div>
          <div class="review-meta">
            <div class="review-nickname">${escapeHtml(reviewer.nickname || '匿名用户')}</div>
            <div class="review-time">${time}</div>
          </div>
          <div class="review-rating">${stars}</div>
        </div>
        <div class="review-content">${escapeHtml(review.content || '')}</div>
        ${tagHtml ? `<div class="review-tags">${tagHtml}</div>` : ''}
      </div>
    `;
  }

  function formatDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ---------- 加载更多评价 ----------
  async function loadMoreReviews() {
    if (state.reviewsLoading || !state.hostId) return;
    if (state.reviewsLoaded >= state.reviewsTotal) return;
    state.reviewsLoading = true;
    const btn = document.getElementById('btn-reviews-more');
    if (btn) btn.disabled = true;
    state.reviewsPage += 1;
    try {
      const data = await ApiClient.get(`/hosts/${encodeURIComponent(state.hostId)}/reviews?page=${state.reviewsPage}&pageSize=${REVIEWS_PAGE_SIZE}`);
      renderReviewsList(data.reviews || []);
    } catch (err) {
      showToast(err.message || '加载失败', 'error');
      state.reviewsPage -= 1;
    } finally {
      state.reviewsLoading = false;
      const wrap = document.getElementById('reviews-load-more-wrap');
      wrap.style.display = state.reviewsLoaded < state.reviewsTotal ? '' : 'none';
      if (btn) btn.disabled = false;
    }
  }

  // ---------- 初始化 ----------
  async function init() {
    const p = new URLSearchParams(location.search);
    state.hostId = (p.get('id') || '').trim();
    if (!state.hostId) {
      showToast('缺少寄养人 id', 'error');
      setTimeout(() => { location.href = '/hosts.html'; }, 600);
      return;
    }

    document.getElementById('btn-reviews-more').addEventListener('click', loadMoreReviews);

    // 并行加载详情 + 评价
    let detailRes;
    try {
      const [detRes, reviewsRes] = await Promise.all([
        ApiClient.get(`/hosts/${encodeURIComponent(state.hostId)}`),
        ApiClient.get(`/hosts/${encodeURIComponent(state.hostId)}/reviews?page=1&pageSize=${REVIEWS_PAGE_SIZE}`),
      ]);
      detailRes = detRes;
      if (!detailRes || !detailRes.host) throw new Error('not found');
      showDetail(detailRes.host, detailRes.availability || [], reviewsRes || {});
    } catch (err) {
      if (err && err.message === 'not found') {
        showNotFound();
      } else {
        showToast(err.message || '加载失败', 'error');
        showNotFound();
      }
    }

    // CTA 逻辑：根据登录态 / 是否自己的主页 / 是否有 open 需求 分支
    wireCta(detailRes && detailRes.host);
  }

  // ---------- CTA：主人邀请寄养人接单 ----------
  async function wireCta(host) {
    const btn = document.getElementById('btn-cta');
    if (!btn) return;

    // 按钮文案保持「寄养 TA」
    btn.textContent = '寄养 TA';
    btn.disabled = false;

    btn.addEventListener('click', async function () {
      // 1. 未登录 → 跳登录
      if (!ApiClient.isAuthed()) {
        location.href = '/auth.html?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }

      // 2. 判断是否自己的主页
      let me = null;
      try {
        const r = await ApiClient.get('/auth/me');
        me = r.user || r || null;
      } catch (_) { /* 401 由 api.js 处理 */ }
      if (!me || !me.id) return;

      if (host && host.userId === me.id) {
        btn.disabled = true;
        btn.textContent = '这是您的主页';
        showToast('这是您自己的主页', 'info');
        return;
      }

      // 3. 查我的 open 需求
      let myNeeds = [];
      try {
        const r = await ApiClient.get('/needs/my');
        myNeeds = Array.isArray(r) ? r : (r && r.needs) || [];
      } catch (e) {
        showToast(e.message || '加载需求失败', 'error');
        return;
      }
      const openNeeds = myNeeds.filter(n => n.status === 'open');

      if (openNeeds.length === 0) {
        // 无 open 需求 → 引导发布
        if (confirm('您还没有进行中的寄养需求，先发布一条？')) {
          location.href = '/my.html?tab=needs';
        }
        return;
      }

      // 4. 弹出需求选择列表
      const selected = openNeeds.length === 1
        ? openNeeds[0]
        : openNeeds.length === 0
          ? null
          : await showNeedPicker(openNeeds);
      if (!selected) return;

      // 5. 二次确认 → POST /api/hosts/<hostId>/invite {needId}
      const petName = (selected.pet && selected.pet.name) || '宠物';
      const confirmMsg = `邀请 ${host.nickname || '寄养人'} 接单「${petName}」\n${selected.start_date} 至 ${selected.end_date}？`;
      if (!confirm(confirmMsg)) return;

      try {
        await ApiClient.post(`/hosts/${encodeURIComponent(state.hostId)}/invite`, { needId: selected.id });
        showToast('已通知寄养人，等待接单', 'success');
      } catch (e) {
        const msg = (e && e.message) || '邀请失败';
        // 429 后端返回「24 小时内已邀请过，请耐心等待」
        showToast(msg, 'error');
      }
    });
  }

  // 需求选择器：返回 Promise<need|null>
  function showNeedPicker(needs) {
    return new Promise(function (resolve) {
      const modal = document.createElement('div');
      modal.className = 'modal show';
      modal.innerHTML = `
        <div class="modal-mask"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h3>选择要邀请的需求</h3>
            <button type="button" class="modal-close" data-close>×</button>
          </div>
          <div class="modal-body invite-need-list">
            ${needs.map(n => {
              const petName = (n.pet && n.pet.name) || '宠物';
              const species = (n.pet && n.pet.species) || '';
              const icon = { '猫': '🐱', '狗': '🐶', '兔': '🐰', '其他': '🐾' }[species] || '🐾';
              return `<div class="invite-need-item" data-need-id="${n.id}">
                <span class="invite-need-icon">${icon}</span>
                <div class="invite-need-body">
                  <div class="invite-need-title">${escapeHtml(petName)}</div>
                  <div class="invite-need-dates">${escapeHtml(n.start_date)} 至 ${escapeHtml(n.end_date)}</div>
                </div>
                <span class="invite-need-arrow">›</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('[data-close]').addEventListener('click', () => {
        modal.remove();
        resolve(null);
      });
      modal.querySelector('.modal-mask').addEventListener('click', () => {
        modal.remove();
        resolve(null);
      });
      modal.querySelectorAll('.invite-need-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-need-id');
          const picked = needs.find(n => n.id === id);
          modal.remove();
          resolve(picked || null);
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
