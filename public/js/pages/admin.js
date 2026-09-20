// warm-host · 管理后台页面
// 三个 Tab：寄养人审核 / 用户管理 / 邀请码
// 登录守卫：未登录跳 auth.html；非 admin 显示"无权限"

const HOST_STATUS_LABELS = {
  pending: '待审核',
  active: '已通过',
  rejected: '已拒绝',
  suspended: '已暂停',
};

const HOST_STATUS_CLASS = {
  pending: 'admin-status-pending',
  active: 'admin-status-active',
  rejected: 'admin-status-rejected',
  suspended: 'admin-status-suspended',
};

const ADMIN_USER_ROLE_CLASS = {
  admin: 'admin-role-admin',
  user: 'admin-role-user',
};

document.addEventListener('DOMContentLoaded', async () => {
  // ============ 登录守卫 ============
  if (!ApiClient.getToken()) {
    location.href = '/auth.html';
    return;
  }

  let me = null;
  try {
    me = await ApiClient.get('/auth/me');
  } catch (err) {
    // 401 会由 ApiClient 自动跳 auth.html；其他错误兜底
    if (err.message && err.message.includes('未登录')) return;
    showToast('加载用户信息失败：' + err.message, 'error');
    return;
  }

  // ============ Admin 守卫 ============
  if (!me || me.role !== 'admin') {
    document.getElementById('admin-shell').classList.add('admin-hidden');
    document.getElementById('admin-denied').classList.remove('admin-hidden');
    return;
  }

  document.getElementById('admin-denied').classList.add('admin-hidden');
  document.getElementById('admin-shell').classList.remove('admin-hidden');

  // ============ Tab 切换 ============
  const tabs = document.querySelectorAll('.admin-tab');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.admin-pane').forEach(p =>
        p.classList.toggle('active', p.id === `admin-tab-${t.dataset.tab}`)
      );
    });
  });

  // ============ 退出登录 ============
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (!confirm('确定退出登录？')) return;
    try { await ApiClient.post('/auth/logout', null); } catch {}
    ApiClient.setToken(null);
    location.href = '/auth.html';
  });

  // ============ 寄养人审核 ============
  const hostsListEl = document.getElementById('hosts-list');
  const hostChips = document.querySelectorAll('.admin-filter-chip');
  let currentHostStatus = 'pending';

  async function loadHosts() {
    hostsListEl.innerHTML = '<div class="empty-state"><span class="emoji">⏳</span><h3>加载中…</h3></div>';
    try {
      const list = await ApiClient.get(`/admin/hosts?status=${encodeURIComponent(currentHostStatus)}`);
      if (!Array.isArray(list) || list.length === 0) {
        hostsListEl.innerHTML = `<div class="empty-state">
          <span class="emoji">🐾</span>
          <h3>暂无「${HOST_STATUS_LABELS[currentHostStatus] || currentHostStatus}」状态的寄养人</h3>
        </div>`;
        return;
      }
      hostsListEl.innerHTML = list.map(renderHostCard).join('');
      bindHostActions();
    } catch (err) {
      hostsListEl.innerHTML = `<div class="empty-state">
        <span class="emoji">❌</span>
        <h3>加载失败</h3>
        <p>${escapeHtml(err.message || '请稍后重试')}</p>
      </div>`;
    }
  }

  function renderHostCard(h) {
    const avatar = h.avatarKey ? `/api/users/${h.id}/photo` : '';
    const avatarHtml = avatar
      ? `<img class="admin-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(h.nickname)}">`
      : `<div class="admin-avatar admin-avatar-placeholder">🐾</div>`;
    const profile = h.hostProfile || {};
    const capacity = [
      profile.capacity_count ? `容量 ${profile.capacity_count} 只` : '',
      profile.district ? `📍 ${profile.district}` : '',
      profile.daily_rate_cents ? `¥${formatPrice(profile.daily_rate_cents)}/日` : '',
    ].filter(Boolean).join(' · ');
    const experience = profile.experience ? `<div class="admin-host-exp">${escapeHtml(profile.experience)}</div>` : '';
    const species = (profile.capacity_species || []).map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('');
    const verified = profile.is_verified ? `<span class="chip chip-trust">已认证</span>` : '';
    const sponsored = profile.is_sponsored ? `<span class="chip chip-trust">已担保</span>` : '';
    const realName = h.realName ? `<span class="admin-host-realname">实名：${escapeHtml(h.realName)}</span>` : '';
    const idCard = h.hasIdCard ? `<span class="chip">已上传身份证</span>` : '';
    const applied = `<span class="admin-host-applied">申请于 ${escapeHtml((h.appliedAt || '').slice(0, 10))}</span>`;

    return `<div class="admin-host-card card">
      <div class="admin-host-head">
        ${avatarHtml}
        <div class="admin-host-name-block">
          <div class="admin-host-name">
            ${escapeHtml(h.nickname)}
            <span class="admin-status ${HOST_STATUS_CLASS[h.hostStatus] || ''}">${HOST_STATUS_LABELS[h.hostStatus] || h.hostStatus}</span>
          </div>
          <div class="admin-host-phone">${escapeHtml(h.phone)}</div>
        </div>
      </div>
      <div class="admin-host-badges">${species} ${verified} ${sponsored} ${realName} ${idCard}</div>
      <div class="admin-host-meta">${escapeHtml(capacity)}</div>
      ${experience}
      ${applied}
      <div class="admin-host-actions">
        ${h.hostStatus === 'pending' ? `
          <button class="btn btn-primary admin-action" data-action="verify" data-id="${h.id}">✅ 通过</button>
          <button class="btn btn-danger admin-action" data-action="reject" data-id="${h.id}">❌ 拒绝</button>
        ` : ''}
        ${h.hostStatus === 'active' ? `
          <button class="btn btn-secondary admin-action" data-action="suspend" data-id="${h.id}">⏸ 暂停</button>
        ` : ''}
        ${h.hostStatus === 'suspended' ? `
          <button class="btn btn-primary admin-action" data-action="activate" data-id="${h.id}">▶ 恢复</button>
        ` : ''}
        ${h.hostStatus === 'rejected' ? `
          <button class="btn btn-primary admin-action" data-action="verify" data-id="${h.id}">✅ 转为通过</button>
        ` : ''}
      </div>
    </div>`;
  }

  function bindHostActions() {
    hostsListEl.querySelectorAll('.admin-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const actionLabel = {
          verify: '通过',
          reject: '拒绝',
          suspend: '暂停',
          activate: '恢复',
        }[action] || action;
        const tip = {
          verify: '确定通过此寄养人？',
          reject: '确定拒绝此寄养人？',
          suspend: '确定暂停此寄养人？',
          activate: '确定恢复此寄养人？',
        }[action];
        if (!confirm(tip)) return;
        btn.disabled = true;
        try {
          await ApiClient.post(`/admin/hosts/${encodeURIComponent(id)}`, { action });
          showToast('操作成功', 'success');
          await loadHosts();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  hostChips.forEach(chip => {
    chip.addEventListener('click', () => {
      hostChips.forEach(c => c.classList.toggle('active', c === chip));
      currentHostStatus = chip.dataset.status;
      loadHosts();
    });
  });

  loadHosts();

  // ============ 用户管理 ============
  const userListEl = document.getElementById('users-list');
  const searchInput = document.getElementById('user-search');
  const btnSearch = document.getElementById('btn-user-search');
  const btnPrev = document.getElementById('btn-users-prev');
  const btnNext = document.getElementById('btn-users-next');
  const pagerLabel = document.getElementById('users-pager-label');
  let userPage = 1;
  let userQuery = '';

  async function loadUsers() {
    userListEl.innerHTML = '<div class="empty-state"><span class="emoji">⏳</span><h3>加载中…</h3></div>';
    try {
      const q = userQuery.trim();
      const params = new URLSearchParams({ page: String(userPage) });
      if (q) params.set('q', q);
      const data = await ApiClient.get(`/admin/users?${params.toString()}`);
      const users = data.users || [];
      pagerLabel.textContent = `${data.page} / ${data.totalPages}`;
      btnPrev.disabled = data.page <= 1;
      btnNext.disabled = data.page >= data.totalPages;

      if (users.length === 0) {
        userListEl.innerHTML = `<div class="empty-state">
          <span class="emoji">🔍</span>
          <h3>未找到用户</h3>
        </div>`;
        return;
      }
      userListEl.innerHTML = renderUserTable(users, me.id);
      bindUserActions();
    } catch (err) {
      userListEl.innerHTML = `<div class="empty-state">
        <span class="emoji">❌</span>
        <h3>加载失败</h3>
        <p>${escapeHtml(err.message || '请稍后重试')}</p>
      </div>`;
    }
  }

  function renderUserTable(users, currentAdminId) {
    const rows = users.map(u => {
      const isSelf = u.id === currentAdminId;
      const isAdmin = u.role === 'admin';
      const roleClass = ADMIN_USER_ROLE_CLASS[u.role] || '';
      const roleLabel = isAdmin ? '管理员' : '用户';
      const statusLabel = HOST_STATUS_LABELS[u.hostStatus] || u.hostStatus;
      const bannedTag = u.banned ? '<span class="chip admin-chip-banned">已禁用</span>' : '';
      const actions = isAdmin
        ? '<span class="admin-cell-muted">—</span>'
        : u.banned
          ? `<button class="btn btn-ghost" data-action="unban" data-id="${u.id}" data-name="${escapeHtml(u.nickname)}">恢复</button>`
          : `<button class="btn btn-danger" data-action="ban" data-id="${u.id}" data-name="${escapeHtml(u.nickname)}">禁用</button>`;
      return `<tr>
        <td>${escapeHtml(u.nickname)}<br><span class="admin-cell-muted">${escapeHtml(u.phone)}</span></td>
        <td><span class="chip ${roleClass}">${roleLabel}</span> ${bannedTag}</td>
        <td>${escapeHtml(statusLabel)}<br><span class="admin-cell-muted">${u.isHost ? '寄养人' : '主人'}</span></td>
        <td>${u.orderCount} 单<br>${u.petCount} 宠物</td>
        <td>${escapeHtml((u.createdAt || '').slice(0, 10))}</td>
        <td class="admin-cell-actions">${actions}</td>
      </tr>`;
    }).join('');

    return `<table class="admin-table">
      <thead>
        <tr>
          <th>用户</th><th>身份</th><th>寄养状态</th><th>数据</th><th>注册时间</th><th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function bindUserActions() {
    userListEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const name = btn.dataset.name || '该用户';
        const tip = action === 'ban'
          ? `确定禁用「${name}」？该用户将被强制下线，且无法登录。`
          : `确定恢复「${name}」？`;
        if (!confirm(tip)) return;
        btn.disabled = true;
        try {
          await ApiClient.post('/admin/users/ban', {
            userId: id,
            banned: action === 'ban' ? 1 : 0,
            reason: action === 'ban' ? '管理员操作' : '',
          });
          showToast(action === 'ban' ? '已禁用' : '已恢复', 'success');
          await loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  btnSearch.addEventListener('click', () => {
    userQuery = searchInput.value;
    userPage = 1;
    loadUsers();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSearch.click();
  });
  btnPrev.addEventListener('click', () => {
    if (userPage > 1) { userPage -= 1; loadUsers(); }
  });
  btnNext.addEventListener('click', () => {
    userPage += 1; loadUsers();
  });

  loadUsers();

  // ============ 邀请码 ============
  const codesTotal = document.getElementById('codes-total');
  const codesAvailable = document.getElementById('codes-available');
  const codesUsed = document.getElementById('codes-used');
  const codesList = document.getElementById('codes-list');
  const codesCount = document.getElementById('codes-count');
  const btnGenerate = document.getElementById('btn-generate-codes');
  const codesGenerated = document.getElementById('codes-generated');

  async function loadCodes() {
    try {
      const data = await ApiClient.get('/admin/invite-codes');
      codesTotal.textContent = data.total ?? 0;
      codesAvailable.textContent = data.available ?? 0;
      codesUsed.textContent = data.used ?? 0;
      const recent = data.recent || [];
      if (recent.length === 0) {
        codesList.innerHTML = '<div class="admin-code-empty">暂无可用邀请码</div>';
      } else {
        codesList.innerHTML = recent.map(r =>
          `<div class="admin-code-item">
            <code>${escapeHtml(r.code)}</code>
            <span class="admin-cell-muted">${escapeHtml((r.createdAt || '').slice(0, 10))}</span>
          </div>`
        ).join('');
      }
    } catch (err) {
      codesTotal.textContent = '-';
      codesAvailable.textContent = '-';
      codesUsed.textContent = '-';
      codesList.innerHTML = `<div class="admin-code-empty">加载失败：${escapeHtml(err.message || '')}</div>`;
    }
  }

  btnGenerate.addEventListener('click', async () => {
    const count = parseInt(codesCount.value, 10);
    if (!Number.isFinite(count) || count < 1 || count > 100) {
      showToast('数量必须在 1-100 之间', 'error');
      return;
    }
    if (!confirm(`确定生成 ${count} 个邀请码？`)) return;
    btnGenerate.disabled = true;
    try {
      const data = await ApiClient.post('/admin/invite-codes', { count });
      const preview = (data.codes || []).slice(0, 10).map(c => c).join('  ');
      codesGenerated.textContent = data.codes && data.codes.length > 10
        ? `已生成 ${data.codes.length} 个（前 10）：${preview}…`
        : `已生成 ${data.codes.length} 个：${preview}`;
      showToast(`已生成 ${data.generated} 个`, 'success');
      await loadCodes();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnGenerate.disabled = false;
    }
  });

  loadCodes();
});
