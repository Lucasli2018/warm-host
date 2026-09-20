// warm-host · 我的页面
// 宠物 Tab（CRUD + R2 多图）+ 寄养 Tab（档案 + 可接单日期）
// 其余 2 Tab（需求、订单）占位

const PET_SPECIES_ICON = { '猫': '🐱', '狗': '🐶', '兔': '🐰', '其他': '🐾' };
const PERSONALITY_TAGS = ['友善', '粘人', '怕生', '拆家', '安静', '活泼'];
const MAX_PHOTOS = 9;

// ============ 寄养人相关常量 ============
const HOST_SPECIES = ['猫', '狗', '兔', '其他'];
const HOST_SIZES = ['小型', '中型', '大型'];
const HOST_GENDERS = ['公', '母', '未知'];
const HOST_SERVICES = ['可上门接送', '宠物医院合作', '有隔离空间', '24小时监控'];

// 状态徽章文本
const HOST_STATUS_LABELS = {
  pending: '审核中',
  active: '已通过',
  rejected: '已拒绝',
  suspended: '已暂停',
};

document.addEventListener('DOMContentLoaded', async () => {
  // 未登录跳转登录页
  if (!ApiClient.getToken()) {
    location.href = '/auth.html';
    return;
  }

  // ============ Tab 切换 ============
  const tabs = document.querySelectorAll('.my-tab');
  let activeTabName = 'pets';
  function activateTab(name) {
    tabs.forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('.my-content').forEach(c =>
      c.classList.toggle('active', c.id === `tab-${name}`)
    );
    activeTabName = name;
  }
  tabs.forEach(t => {
    t.addEventListener('click', () => activateTab(t.dataset.tab));
  });

  // ============ 退出登录 ============
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (!confirm('确定退出登录？')) return;
    try { await ApiClient.post('/auth/logout', null); } catch {}
    ApiClient.setToken(null);
    location.href = '/auth.html';
  });

  // ============ 宠物列表 ============
  const petListEl = document.getElementById('pet-list');
  async function loadPets() {
    try {
      const pets = await ApiClient.get('/pets/my');
      if (!pets || pets.length === 0) {
        petListEl.innerHTML = `<div class="empty-state">
          <span class="emoji">🐾</span>
          <h3>还没有宠物档案</h3>
          <p>点上面的按钮添加第一只吧</p>
        </div>`;
        return;
      }
      petListEl.innerHTML = pets.map(renderPetCard).join('');
      // 绑定事件
      petListEl.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', () => {
          const petId = el.dataset.petId;
          const action = el.dataset.action;
          if (action === 'edit') openPetModal(petId);
          else if (action === 'delete') confirmDeletePet(petId, el);
        });
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderPetCard(pet) {
    const cover = pet.cover_key ? `/api/pets/${pet.id}/photos/${pet.cover_key}` : '';
    const coverHtml = cover
      ? `<img class="pet-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(pet.name)}">`
      : `<div class="pet-cover pet-cover-placeholder">${PET_SPECIES_ICON[pet.species] || '🐾'}</div>`;
    const info = [
      pet.gender ? pet.gender : '',
      pet.age ? pet.age : '',
      pet.weight ? pet.weight : '',
    ].filter(Boolean).join(' · ');
    const personality = (pet.personality || []).slice(0, 3).map(t => `<span class="chip chip-cta">${escapeHtml(t)}</span>`).join('');
    return `<div class="pet-card card">
      ${coverHtml}
      <div class="pet-info">
        <div class="pet-name">${escapeHtml(pet.name)} <span class="pet-species">${PET_SPECIES_ICON[pet.species] || '🐾'}</span></div>
        ${pet.breed ? `<div class="pet-breed">${escapeHtml(pet.breed)}</div>` : ''}
        ${info ? `<div class="pet-meta">${escapeHtml(info)}</div>` : ''}
        ${personality ? `<div class="pet-tags">${personality}</div>` : ''}
      </div>
      <div class="pet-actions">
        <button class="btn btn-ghost" data-action="edit" data-pet-id="${pet.id}">编辑</button>
        <button class="btn btn-ghost pet-delete" data-action="delete" data-pet-id="${pet.id}">删除</button>
      </div>
    </div>`;
  }

  // ============ 宠物表单 Modal ============
  const modal = document.getElementById('pet-modal');
  const petForm = document.getElementById('pet-form');
  const personalityChips = document.getElementById('personality-chips');
  const photoPicker = document.getElementById('photo-picker');
  const photoInput = document.getElementById('photo-input');

  // 渲染性格 chips
  personalityChips.innerHTML = PERSONALITY_TAGS.map(t =>
    `<span class="chip chip-cursor" data-value="${t}">${t}</span>`
  ).join('');
  const selectedPersonality = new Set();
  personalityChips.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      const v = c.dataset.value;
      if (selectedPersonality.has(v)) {
        selectedPersonality.delete(v);
        c.classList.remove('chip-primary');
      } else {
        if (selectedPersonality.size >= 6) {
          showToast('最多选 6 个性格标签', 'warning');
          return;
        }
        selectedPersonality.add(v);
        c.classList.add('chip-primary');
      }
    });
  });

  // 当前编辑的宠物（编辑模式）
  let editingPet = null;
  // 待上传的新照片（FormData 未生成前的 File 列表）
  let pendingFiles = [];

  function resetForm() {
    petForm.reset();
    petForm.querySelector('[name="petId"]').value = '';
    selectedPersonality.clear();
    personalityChips.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-primary'));
    pendingFiles = [];
    editingPet = null;
    renderPhotoPicker();
    document.getElementById('pet-modal-title').textContent = '添加宠物';
  }

  function fillForm(pet) {
    editingPet = pet;
    petForm.reset();
    petForm.querySelector('[name="petId"]').value = pet.id;
    petForm.querySelector('[name="name"]').value = pet.name || '';
    petForm.querySelector('[name="species"]').value = pet.species || '';
    petForm.querySelector('[name="breed"]').value = pet.breed || '';
    petForm.querySelector('[name="gender"]').value = pet.gender || '';
    petForm.querySelector('[name="age"]').value = pet.age || '';
    petForm.querySelector('[name="weight"]').value = pet.weight || '';
    petForm.querySelector('[name="health_notes"]').value = pet.health_notes || '';
    petForm.querySelector('[name="daily_habits"]').value = pet.daily_habits || '';
    petForm.querySelector('[name="special_needs"]').value = pet.special_needs || '';

    selectedPersonality.clear();
    (pet.personality || []).forEach(t => {
      selectedPersonality.add(t);
      const chip = personalityChips.querySelector(`[data-value="${t}"]`);
      if (chip) chip.classList.add('chip-primary');
    });

    // 已有照片 + 新选照片
    pendingFiles = [];
    renderPhotoPicker();
    document.getElementById('pet-modal-title').textContent = '编辑宠物';
  }

  function renderPhotoPicker() {
    const existing = (editingPet && editingPet.photos) || [];
    const coverKey = (editingPet && editingPet.cover_key) || null;

    let html = '';
    // 已有照片
    existing.forEach(k => {
      const url = `/api/pets/${editingPet.id}/photos/${k}`;
      html += `<div class="photo-item">
        <img src="${escapeHtml(url)}" alt="photo">
        ${coverKey === k ? '<span class="photo-badge">主图</span>' : ''}
        <button type="button" class="photo-cover-btn" data-action="set-cover" data-key="${escapeHtml(k)}">设为主图</button>
        <button type="button" class="photo-del-btn" data-action="del-photo" data-key="${escapeHtml(k)}">×</button>
      </div>`;
    });
    // 新选待上传
    pendingFiles.forEach((file, i) => {
      html += `<div class="photo-item">
        <img src="${URL.createObjectURL(file)}" alt="new">
        <button type="button" class="photo-del-btn" data-action="del-pending" data-idx="${i}">×</button>
      </div>`;
    });

    if (existing.length + pendingFiles.length < MAX_PHOTOS) {
      html += `<div class="photo-add" data-action="pick">+</div>`;
    }

    photoPicker.innerHTML = html;

    // 绑定事件
    photoPicker.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        if (action === 'pick') {
          photoInput.click();
        } else if (action === 'set-cover' && editingPet) {
          try {
            await ApiClient.put(`/pets/${editingPet.id}/photos`, { coverKey: el.dataset.key });
            showToast('已设为主图', 'success');
            await loadPets();
            // 重新加载当前编辑数据
            const fresh = await ApiClient.get(`/pets/${editingPet.id}`);
            fillForm(fresh);
          } catch (err) {
            showToast(err.message, 'error');
          }
        } else if (action === 'del-photo' && editingPet) {
          if (!confirm('确定删除这张照片？')) return;
          try {
            await ApiClient.request('DELETE', `/pets/${editingPet.id}/photos`, { photoKey: el.dataset.key });
            showToast('已删除', 'success');
            await loadPets();
            const fresh = await ApiClient.get(`/pets/${editingPet.id}`);
            fillForm(fresh);
          } catch (err) {
            showToast(err.message, 'error');
          }
        } else if (action === 'del-pending') {
          pendingFiles.splice(parseInt(el.dataset.idx), 1);
          renderPhotoPicker();
        }
      });
    });
  }

  photoInput.addEventListener('change', () => {
    const files = Array.from(photoInput.files || []);
    if (files.length === 0) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const max = 5 * 1024 * 1024;
    const currentCount = ((editingPet && editingPet.photos) || []).length + pendingFiles.length;
    const remaining = MAX_PHOTOS - currentCount;

    let added = 0;
    for (const file of files) {
      if (added >= remaining) {
        showToast(`最多 ${MAX_PHOTOS} 张，已忽略多余`, 'warning');
        break;
      }
      if (!allowed.includes(file.type)) {
        showToast(`不支持的格式：${file.name}`, 'warning');
        continue;
      }
      if (file.size > max) {
        showToast(`图片过大：${file.name}`, 'warning');
        continue;
      }
      pendingFiles.push(file);
      added++;
    }
    photoInput.value = '';
    renderPhotoPicker();
  });

  function openPetModal(petId) {
    resetForm();
    if (!petId) {
      modal.classList.add('show');
      return;
    }
    ApiClient.get(`/pets/${petId}`).then(pet => {
      fillForm(pet);
      modal.classList.add('show');
    }).catch(err => showToast(err.message, 'error'));
  }

  function closePetModal() {
    modal.classList.remove('show');
    resetForm();
  }

  document.getElementById('btn-add-pet').addEventListener('click', () => openPetModal(null));
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closePetModal));
  modal.querySelector('.modal-mask').addEventListener('click', closePetModal);

  // ============ 表单提交 ============
  petForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(petForm);
    const data = Object.fromEntries(fd.entries());
    data.personality = Array.from(selectedPersonality);

    if (!data.name || !data.name.trim()) {
      showToast('请输入宠物名字', 'error');
      return;
    }
    if (!data.species) {
      showToast('请选择种类', 'error');
      return;
    }

    const btn = document.getElementById('pet-submit');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '保存中…';

    try {
      if (!data.petId) {
        // 创建
        const newPet = await ApiClient.post('/pets', {
          name: data.name.trim(),
          species: data.species,
          breed: data.breed,
          gender: data.gender,
          age: data.age,
          weight: data.weight,
          personality: data.personality,
          health_notes: data.health_notes,
          daily_habits: data.daily_habits,
          special_needs: data.special_needs,
        });
        showToast('创建成功', 'success');
        // 上传照片
        await uploadPhotos(newPet.id, pendingFiles);
        closePetModal();
        await loadPets();
      } else {
        // 更新
        const petId = data.petId;
        await ApiClient.put(`/pets/${petId}`, {
          name: data.name.trim(),
          species: data.species,
          breed: data.breed,
          gender: data.gender,
          age: data.age,
          weight: data.weight,
          personality: data.personality,
          health_notes: data.health_notes,
          daily_habits: data.daily_habits,
          special_needs: data.special_needs,
        });
        showToast('更新成功', 'success');
        await uploadPhotos(petId, pendingFiles);
        closePetModal();
        await loadPets();
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  async function uploadPhotos(petId, files) {
    if (!files || files.length === 0) return;
    let uploaded = 0;
    for (const file of files) {
      try {
        await ApiClient.upload(`/pets/${petId}/photos`, file);
        uploaded++;
      } catch (err) {
        showToast(`第 ${uploaded + 1} 张上传失败：${err.message}`, 'error');
        break;
      }
    }
  }

  // ============ 删除宠物 ============
  async function confirmDeletePet(petId, el) {
    const btn = el;
    if (btn.dataset.confirming === '1') {
      // 第二次点击，执行删除
      try {
        await ApiClient.delete(`/pets/${petId}`);
        showToast('已删除', 'success');
        await loadPets();
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else {
      // 第一次点击，进入确认态
      btn.dataset.confirming = '1';
      const originalText = btn.textContent;
      btn.textContent = '再次点击确认';
      btn.style.color = 'var(--color-error)';
      setTimeout(() => {
        btn.dataset.confirming = '0';
        btn.textContent = originalText;
        btn.style.color = '';
      }, 3000);
    }
  }

  // ============ 寄养 Tab ============
  // 状态:
  //   none     - 未申请（未提交过申请，profile=null 且 status 非 pending/active/rejected/suspended）
  //   pending  - 审核中（只读视图）
  //   rejected - 已拒绝（可重新申请）
  //   active   - 已通过（可编辑 + 可接单日期）
  const HOST_STATES = {
    NONE: 'none',
    PENDING: 'pending',
    REJECTED: 'rejected',
    ACTIVE: 'active',
  };

  const hostBanner = document.getElementById('host-banner');
  const hostSponsorHint = document.getElementById('host-sponsor-hint');
  const hostForm = document.getElementById('host-form');
  const hostFormTitle = document.getElementById('host-form-title');
  const hostFormSubmit = document.getElementById('host-form-submit');
  const hostAvailability = document.getElementById('host-availability');

  // chips 容器
  const capacitySpeciesChips = document.getElementById('capacity-species-chips');
  const capacitySizeChips = document.getElementById('capacity-size-chips');
  const capacityGenderChips = document.getElementById('capacity-gender-chips');
  const specialServicesChips = document.getElementById('special-services-chips');

  // 多选状态
  const selectedSpecies = new Set();
  const selectedSizes = new Set();
  const selectedGenders = new Set();
  const selectedServices = new Set();

  // 当前寄养 Tab 状态
  let hostState = HOST_STATES.NONE;
  let currentProfile = null;
  let currentAvailability = [];

  // ============ Chip 通用渲染 ============
  function renderChips(container, options, selectedSet, maxCount) {
    container.innerHTML = options.map(o =>
      `<span class="chip chip-cursor" data-value="${escapeHtml(o)}">${escapeHtml(o)}</span>`
    ).join('');
    container.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', () => {
        const v = c.dataset.value;
        if (selectedSet.has(v)) {
          selectedSet.delete(v);
          c.classList.remove('chip-primary');
        } else {
          if (maxCount && selectedSet.size >= maxCount) return;
          selectedSet.add(v);
          c.classList.add('chip-primary');
        }
      });
    });
  }
  renderChips(capacitySpeciesChips, HOST_SPECIES, selectedSpecies);
  renderChips(capacitySizeChips, HOST_SIZES, selectedSizes);
  renderChips(capacityGenderChips, HOST_GENDERS, selectedGenders);
  renderChips(specialServicesChips, HOST_SERVICES, selectedServices, 4);

  function setChipsFromValues(container, selectedSet, values, maxCount) {
    selectedSet.clear();
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-primary'));
    (values || []).forEach(v => {
      if (maxCount && selectedSet.size >= maxCount) return;
      selectedSet.add(v);
      const chip = container.querySelector(`[data-value="${escapeAttr(v)}"]`);
      if (chip) chip.classList.add('chip-primary');
    });
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function readHostFormValues() {
    return {
      bio: (hostForm.querySelector('[name="bio"]').value || '').trim(),
      capacity_count: parseInt(hostForm.querySelector('[name="capacity_count"]').value, 10),
      daily_rate_cents: parseInt(hostForm.querySelector('[name="daily_rate_cents"]').value, 10),
      district: (hostForm.querySelector('[name="district"]').value || '').trim(),
      address_fuzzy: (hostForm.querySelector('[name="address_fuzzy"]').value || '').trim(),
      experience: (hostForm.querySelector('[name="experience"]').value || '').trim(),
      capacity_species: Array.from(selectedSpecies),
      capacity_size: Array.from(selectedSizes),
      capacity_gender: Array.from(selectedGenders),
      special_services: Array.from(selectedServices),
    };
  }

  function validateHostFormValues(v) {
    if (!v.capacity_species.length) return '请至少选择一种可寄养品种';
    if (!v.capacity_size.length) return '请至少选择一种可寄养体型';
    if (!v.capacity_gender.length) return '请至少选择一种可寄养性别';
    if (!Number.isFinite(v.capacity_count) || v.capacity_count < 1 || v.capacity_count > 10) {
      return '同时寄养数量需在 1-10 之间';
    }
    if (!v.district) return '请填写所在区域';
    if (!Number.isFinite(v.daily_rate_cents) || v.daily_rate_cents < 0) {
      return '日费必须为非负整数（分）';
    }
    return null;
  }

  function setHostFormReadOnly(readOnly) {
    hostForm.querySelectorAll('input, textarea, select').forEach(el => {
      el.disabled = readOnly;
    });
    hostForm.querySelectorAll('.chip').forEach(c => {
      c.style.pointerEvents = readOnly ? 'none' : '';
    });
  }

  // ============ Banner 渲染 ============
  function showBanner(html, kind) {
    hostBanner.className = `host-banner host-banner-${kind || 'info'}`;
    hostBanner.innerHTML = html;
    hostBanner.classList.remove('host-banner-hidden');
  }
  function hideBanner() {
    hostBanner.classList.add('host-banner-hidden');
    hostBanner.innerHTML = '';
  }
  function showSponsorHint(html) {
    hostSponsorHint.innerHTML = html;
    hostSponsorHint.classList.remove('host-banner-hidden');
  }
  function hideSponsorHint() {
    hostSponsorHint.classList.add('host-banner-hidden');
    hostSponsorHint.innerHTML = '';
  }

  // ============ 寄养 Tab 主渲染 ============
  async function loadHost() {
    try {
      const data = await ApiClient.get('/hosts/me');
      const status = data.user?.host_status || 'none';
      currentProfile = data.profile || null;
      currentAvailability = data.availability || [];

      if (status === 'active' && currentProfile) {
        hostState = HOST_STATES.ACTIVE;
        renderHostActive();
      } else if (status === 'pending' && currentProfile) {
        hostState = HOST_STATES.PENDING;
        renderHostPending();
      } else if (status === 'rejected' && currentProfile) {
        hostState = HOST_STATES.REJECTED;
        renderHostRejected();
      } else if (status === 'suspended' && currentProfile) {
        hostState = HOST_STATES.PENDING;
        renderHostPending();
      } else {
        hostState = HOST_STATES.NONE;
        renderHostNone();
      }
    } catch (err) {
      if (err.message && err.message.includes('未登录')) {
        location.href = '/auth.html';
        return;
      }
      // 未申请时可能返回 403
      if (err.message === '您尚未申请成为寄养人') {
        hostState = HOST_STATES.NONE;
        renderHostNone();
        return;
      }
      showToast(err.message, 'error');
    }
  }

  function renderHostNone() {
    hideBanner();
    hideSponsorHint();
    hostFormTitle.textContent = '申请成为寄养人';
    hostFormSubmit.textContent = '提交申请';
    setHostFormReadOnly(false);
    // 清空表单
    hostForm.reset();
    hostForm.querySelector('[name="capacity_count"]').value = 2;
    hostForm.querySelector('[name="daily_rate_cents"]').value = 10000;
    setChipsFromValues(capacitySpeciesChips, selectedSpecies, ['猫', '狗']);
    setChipsFromValues(capacitySizeChips, selectedSizes, ['小型', '中型']);
    setChipsFromValues(capacityGenderChips, selectedGenders, ['公', '母']);
    setChipsFromValues(specialServicesChips, selectedServices, []);
    hostAvailability.classList.add('host-banner-hidden');
  }

  function renderHostPending() {
    showBanner(
      `<span class="host-banner-icon">⏳</span>
       <div>
         <div class="host-banner-title">寄养人申请审核中</div>
         <div class="host-banner-sub">管理员审核通过后即可设置可接单日期</div>
       </div>`,
      'amber'
    );
    hostFormTitle.textContent = '寄养人档案（审核中·只读）';
    hostFormSubmit.style.display = 'none';
    setHostFormReadOnly(true);
    fillHostFormFromProfile(currentProfile);
    hostAvailability.classList.add('host-banner-hidden');
  }

  function renderHostRejected() {
    showBanner(
      `<span class="host-banner-icon">⚠️</span>
       <div>
         <div class="host-banner-title">申请未通过</div>
         <div class="host-banner-sub">您可以修改档案后重新提交申请</div>
       </div>`,
      'danger'
    );
    hostFormTitle.textContent = '修改档案 · 重新申请';
    hostFormSubmit.style.display = '';
    hostFormSubmit.textContent = '重新提交申请';
    setHostFormReadOnly(false);
    fillHostFormFromProfile(currentProfile);
    hostAvailability.classList.add('host-banner-hidden');
  }

  function renderHostActive() {
    hideBanner();
    // 首单担保提示
    if (!currentProfile.is_sponsored) {
      showSponsorHint(
        `<span class="host-banner-icon">🤝</span>
         <div>
           <div class="host-banner-title">首单需要担保人</div>
           <div class="host-banner-sub">首单寄养需邀请担保人做信誉背书 · <span class="host-hint-link">去邀请</span></div>
         </div>`
      );
    } else {
      hideSponsorHint();
    }
    hostFormTitle.textContent = '寄养人档案（可编辑）';
    hostFormSubmit.style.display = '';
    hostFormSubmit.textContent = '保存修改';
    setHostFormReadOnly(false);
    fillHostFormFromProfile(currentProfile);
    hostAvailability.classList.remove('host-banner-hidden');
    initCalendar(); // initCalendar 内部会调用 renderCalendar + renderAvailabilityRanges
  }

  function fillHostFormFromProfile(profile) {
    hostForm.reset();
    if (!profile) return;
    hostForm.querySelector('[name="bio"]').value = profile.bio || '';
    hostForm.querySelector('[name="capacity_count"]').value = profile.capacity_count || 1;
    hostForm.querySelector('[name="daily_rate_cents"]').value = profile.daily_rate_cents || 0;
    hostForm.querySelector('[name="district"]').value = profile.district || '';
    hostForm.querySelector('[name="address_fuzzy"]').value = profile.address_fuzzy || '';
    hostForm.querySelector('[name="experience"]').value = profile.experience || '';
    setChipsFromValues(capacitySpeciesChips, selectedSpecies, profile.capacity_species);
    setChipsFromValues(capacitySizeChips, selectedSizes, profile.capacity_size);
    setChipsFromValues(capacityGenderChips, selectedGenders, profile.capacity_gender);
    setChipsFromValues(specialServicesChips, selectedServices, profile.special_services);
  }

  // ============ 表单提交（申请 / 更新 / 重新申请） ============
  hostForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readHostFormValues();
    const err = validateHostFormValues(v);
    if (err) {
      showToast(err, 'error');
      return;
    }

    const isApply = hostState === HOST_STATES.NONE || hostState === HOST_STATES.REJECTED;
    const btn = hostFormSubmit;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = isApply ? '提交中…' : '保存中…';

    try {
      if (isApply) {
        await ApiClient.post('/hosts/apply', v);
        showToast('申请已提交，等待审核', 'success');
      } else {
        await ApiClient.post('/hosts/me', v);
        showToast('档案已更新', 'success');
      }
      await loadHost();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // ============ 可接单日期日历 ============
  // 状态
  const calState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0-based
    ranges: [], // [{id, start_date, end_date, note}]
    pickingStart: null, // 'YYYY-MM-DD'
    pickingEnd: null,
    minDate: null, // 不允许选早于今天
    maxDate: null, // 不允许选晚于 +1 年
  };

  function fmtYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseYMD(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }

  function compareYMD(a, b) {
    // 字符串比较即可（YYYY-MM-DD 字典序 == 时间序）
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function isInRange(dateStr, range) {
    return compareYMD(dateStr, range.start_date) >= 0 && compareYMD(dateStr, range.end_date) <= 0;
  }

  function initCalendar() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    calState.minDate = today;
    const max = new Date(today);
    max.setFullYear(max.getFullYear() + 1);
    calState.maxDate = max;
    calState.year = today.getFullYear();
    calState.month = today.getMonth();
    // 同步已有区间
    calState.ranges = currentAvailability.map(a => ({
      id: a.id,
      start_date: a.start_date,
      end_date: a.end_date,
      note: a.note || '',
    }));
    calState.pickingStart = null;
    calState.pickingEnd = null;
    renderCalendar();
    renderAvailabilityRanges();
  }

  function renderCalendar() {
    const grid = document.getElementById('cal-grid');
    const monthLabel = document.getElementById('cal-month-label');
    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');
    if (!grid) return;

    monthLabel.textContent = `${calState.year} 年 ${calState.month + 1} 月`;

    // 边界：不允许早于当前月
    const now = new Date();
    now.setDate(1);
    const curMonthStart = new Date(calState.year, calState.month, 1);
    prevBtn.disabled = curMonthStart <= now;
    // 不允许晚于当前月 +2 月
    const maxMonthStart = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    nextBtn.disabled = curMonthStart >= maxMonthStart;

    // 网格表头（周一为第一列）
    const headers = ['一', '二', '三', '四', '五', '六', '日'];

    // 计算该月 1 号是星期几（0=周日 → 周一为 0）
    const firstDay = new Date(calState.year, calState.month, 1);
    const firstWeekday = (firstDay.getDay() + 6) % 7; // 周一=0
    const daysInMonth = new Date(calState.year, calState.month + 1, 0).getDate();

    const todayStr = fmtYMD(new Date());
    const minStr = calState.minDate ? fmtYMD(calState.minDate) : '';
    const maxStr = calState.maxDate ? fmtYMD(calState.maxDate) : '';

    let html = headers.map(h => `<div class="cal-head">${h}</div>`).join('');

    // 前置空格
    for (let i = 0; i < firstWeekday; i++) {
      html += '<div class="cal-cell cal-cell-empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = fmtYMD(new Date(calState.year, calState.month, d));
      const inPast = minStr ? compareYMD(dateStr, minStr) < 0 : false;
      const inFuture = maxStr ? compareYMD(dateStr, maxStr) > 0 : false;
      const disabled = inPast || inFuture;
      const isToday = dateStr === todayStr;
      const inAnyRange = calState.ranges.some(r => isInRange(dateStr, r));
      const isPickingStart = calState.pickingStart === dateStr;
      const isPickingEnd = calState.pickingEnd === dateStr;
      const inPickingRange = calState.pickingStart && calState.pickingEnd
        ? isInRange(dateStr, { start_date: calState.pickingStart, end_date: calState.pickingEnd })
        : false;

      const classes = ['cal-cell'];
      if (disabled) classes.push('cal-cell-disabled');
      if (isToday) classes.push('cal-cell-today');
      if (inAnyRange) classes.push('cal-cell-range');
      if (inPickingRange) classes.push('cal-cell-picking');
      if (isPickingStart || isPickingEnd) classes.push('cal-cell-anchor');

      html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${d}</div>`;
    }

    grid.innerHTML = html;

    // 绑定点击
    grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => onCalDateClick(cell.dataset.date));
    });
  }

  function onCalDateClick(dateStr) {
    // 未选中起点：设为起点
    if (!calState.pickingStart) {
      calState.pickingStart = dateStr;
      calState.pickingEnd = null;
    } else if (!calState.pickingEnd) {
      if (compareYMD(dateStr, calState.pickingStart) < 0) {
        showToast('结束日期需晚于起始日期', 'warning');
        calState.pickingStart = dateStr;
        calState.pickingEnd = null;
      } else {
        calState.pickingEnd = dateStr;
        // 自动加入 ranges
        const range = {
          id: 'pending-' + crypto.randomUUID ? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()) : String(Date.now()),
          start_date: calState.pickingStart,
          end_date: calState.pickingEnd,
          note: '',
        };
        calState.ranges.push(range);
        calState.pickingStart = null;
        calState.pickingEnd = null;
      }
    } else {
      // 已有区间，重置
      calState.pickingStart = dateStr;
      calState.pickingEnd = null;
    }
    renderCalendar();
    renderAvailabilityRanges();
  }

  function renderAvailabilityRanges() {
    const box = document.getElementById('cal-ranges');
    if (!box) return;
    if (calState.ranges.length === 0) {
      box.innerHTML = '<div class="cal-ranges-empty">尚未添加任何可接单区间</div>';
      return;
    }
    box.innerHTML = calState.ranges.map((r, i) => {
      const days = parseRangeDays(r.start_date, r.end_date);
      return `<div class="cal-range-item">
        <div class="cal-range-idx">#${i + 1}</div>
        <div class="cal-range-body">
          <div class="cal-range-date">${escapeHtml(r.start_date)} 至 ${escapeHtml(r.end_date)}</div>
          <div class="cal-range-meta">${days} 天 · 未保存</div>
        </div>
        <button type="button" class="cal-range-del" data-idx="${i}" title="删除">×</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.cal-range-del').forEach(btn => {
      btn.addEventListener('click', () => {
        calState.ranges.splice(parseInt(btn.dataset.idx, 10), 1);
        renderCalendar();
        renderAvailabilityRanges();
      });
    });
  }

  function parseRangeDays(startStr, endStr) {
    const s = parseYMD(startStr);
    const e = parseYMD(endStr);
    if (!s || !e) return 0;
    return Math.round((e - s) / (24 * 60 * 60 * 1000)) + 1;
  }

  // ============ 日历导航按钮 ============
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calState.month--;
    if (calState.month < 0) { calState.month = 11; calState.year--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calState.month++;
    if (calState.month > 11) { calState.month = 0; calState.year++; }
    renderCalendar();
  });

  // ============ 保存可接单日期 ============
  document.getElementById('host-availability-save')?.addEventListener('click', async () => {
    if (calState.ranges.length === 0) {
      showToast('请先添加至少一个可接单区间', 'warning');
      return;
    }
    const btn = document.getElementById('host-availability-save');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '保存中…';
    try {
      const payload = calState.ranges.map(r => ({
        start_date: r.start_date,
        end_date: r.end_date,
        note: r.note || '',
      }));
      const res = await ApiClient.put('/hosts/me/availability', payload);
      showToast(`已保存 ${res.count} 个区间`, 'success');
      await loadHost();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // ============ 需求 Tab ============
  // 状态映射
  const NEED_STATUS = {
    open:      { label: '招募中', kind: 'amber'  },
    matched:   { label: '已接单', kind: 'blue'   },
    filled:    { label: '已成交', kind: 'green'  },
    cancelled: { label: '已取消', kind: 'gray'   },
    expired:   { label: '已过期', kind: 'gray'   },
  };
  const PET_SPECIES_ICON_NEED = PET_SPECIES_ICON;

  const needListEl = document.getElementById('needs-list');
  const needModal = document.getElementById('need-modal');
  const needForm = document.getElementById('need-form');
  const needFormTitle = document.getElementById('need-modal-title');
  const petSelect = needForm.querySelector('[name="petId"]');

  let editingNeed = null;
  let myPetsCache = [];

  function statusBadge(status) {
    const s = NEED_STATUS[status] || { label: status, kind: 'gray' };
    return `<span class="badge badge-need-${s.kind}">${s.label}</span>`;
  }

  function fmtPriceYuan(cents) {
    if (cents === null || cents === undefined || cents === '') return '面议';
    const n = Number(cents);
    if (!Number.isFinite(n)) return '面议';
    return (n % 100 === 0 ? (n / 100).toString() : (n / 100).toFixed(2)) + ' 元/天';
  }

  function todayYMD() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function plusDaysYMD(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function loadNeeds() {
    try {
      const needs = await ApiClient.get('/needs/my');
      if (!needs || needs.length === 0) {
        if (myPetsCache.length === 0) {
          needListEl.innerHTML = `<div class="empty-state">
            <span class="emoji">🐾</span>
            <h3>还没有宠物档案</h3>
            <p>先添加宠物档案才能发布寄养需求</p>
            <button class="btn btn-primary" onclick="document.getElementById('btn-add-pet').click()">去添加宠物</button>
          </div>`;
        } else {
          needListEl.innerHTML = `<div class="empty-state">
            <span class="emoji">📝</span>
            <h3>还没有寄养需求</h3>
            <p>点击右上角「发布寄养需求」开始</p>
          </div>`;
        }
        return;
      }
      needListEl.innerHTML = needs.map(renderNeedCard).join('');
      needListEl.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', () => {
          const needId = el.dataset.needId;
          const action = el.dataset.action;
          if (action === 'edit') openNeedModal(needId);
          else if (action === 'cancel') confirmCancelNeed(needId, el);
        });
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderNeedCard(need) {
    const pet = need.pet || {};
    const cover = pet.cover_key ? `/api/pets/${pet.id}/photos/${pet.cover_key}` : '';
    const coverHtml = cover
      ? `<img class="need-pet-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(pet.name || '')}">`
      : `<div class="need-pet-cover need-pet-cover-placeholder">${PET_SPECIES_ICON_NEED[pet.species] || '🐾'}</div>`;
    const metaBits = [];
    if (pet.breed) metaBits.push(pet.breed);
    if (pet.gender) metaBits.push(pet.gender);
    if (pet.age) metaBits.push(pet.age);
    const meta = metaBits.join(' · ');

    const price = fmtPriceYuan(need.expected_price_cents);
    const dateRange = need.start_date && need.end_date
      ? `${need.start_date} 至 ${need.end_date}`
      : '-';

    let actionsHtml = '';
    if (need.status === 'open') {
      actionsHtml = `
        <button class="btn btn-ghost" data-action="edit" data-need-id="${need.id}">编辑</button>
        <button class="btn btn-ghost need-cancel" data-action="cancel" data-need-id="${need.id}">取消</button>
      `;
    } else if (need.status === 'matched' || need.status === 'filled') {
      actionsHtml = `<div class="need-order-hint">${need.status === 'matched' ? '⚡ 寄养人已接单，请在订单中查看' : '🎉 已成交，可在订单中查看'}</div>`;
    }

    return `<div class="need-card card">
      <div class="need-card-head">
        ${coverHtml}
        <div class="need-card-title">
          <div class="need-pet-name">${escapeHtml(pet.name || '未命名宠物')} <span class="need-pet-species">${PET_SPECIES_ICON_NEED[pet.species] || '🐾'}</span></div>
          ${meta ? `<div class="need-pet-meta">${escapeHtml(meta)}</div>` : ''}
        </div>
        <div class="need-card-status">${statusBadge(need.status)}</div>
      </div>
      <div class="need-card-body">
        <div class="need-row"><span class="need-label">日期</span><span class="need-value">${escapeHtml(dateRange)}</span></div>
        ${need.expected_area ? `<div class="need-row"><span class="need-label">期望区域</span><span class="need-value">${escapeHtml(need.expected_area)}</span></div>` : ''}
        <div class="need-row"><span class="need-label">期望日费</span><span class="need-value">${escapeHtml(price)}</span></div>
        ${need.description ? `<div class="need-row"><span class="need-label">说明</span><span class="need-value">${escapeHtml(need.description)}</span></div>` : ''}
      </div>
      ${actionsHtml ? `<div class="need-card-actions">${actionsHtml}</div>` : ''}
    </div>`;
  }

  function resetNeedForm() {
    needForm.reset();
    needForm.querySelector('[name="needId"]').value = '';
    editingNeed = null;
    // 填充宠物下拉
    petSelect.innerHTML = '<option value="">请选择宠物</option>' +
      myPetsCache.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.species ? ' · ' + (PET_SPECIES_ICON_NEED[p.species] || '🐾') : ''}${p.breed ? ' · ' + escapeHtml(p.breed) : ''}</option>`).join('');
    // 默认日期：明天起 3 天
    needForm.querySelector('[name="startDate"]').value = plusDaysYMD(1);
    needForm.querySelector('[name="endDate"]').value = plusDaysYMD(3);
    needForm.querySelector('[name="startDate"]').min = todayYMD();
    needForm.querySelector('[name="endDate"]').min = plusDaysYMD(1);
    document.getElementById('need-submit').textContent = '发布';
    needFormTitle.textContent = '发布寄养需求';
  }

  function fillNeedForm(need) {
    editingNeed = need;
    needForm.reset();
    petSelect.innerHTML = '<option value="">请选择宠物</option>' +
      myPetsCache.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.species ? ' · ' + (PET_SPECIES_ICON_NEED[p.species] || '🐾') : ''}${p.breed ? ' · ' + escapeHtml(p.breed) : ''}</option>`).join('');
    needForm.querySelector('[name="needId"]').value = need.id;
    needForm.querySelector('[name="petId"]').value = need.pet_id;
    needForm.querySelector('[name="startDate"]').value = need.start_date;
    needForm.querySelector('[name="endDate"]').value = need.end_date;
    needForm.querySelector('[name="expectedArea"]').value = need.expected_area || '';
    // 分 → 元
    if (need.expected_price_cents !== null && need.expected_price_cents !== undefined) {
      const yuan = need.expected_price_cents / 100;
      needForm.querySelector('[name="expectedPrice"]').value = Number.isInteger(yuan) ? yuan : yuan.toFixed(2);
    }
    needForm.querySelector('[name="description"]').value = need.description || '';
    needForm.querySelector('[name="startDate"]').min = todayYMD();
    needForm.querySelector('[name="endDate"]').min = plusDaysYMD(1);
    document.getElementById('need-submit').textContent = '保存修改';
    needFormTitle.textContent = '编辑寄养需求';
  }

  function openNeedModal(needId) {
    if (myPetsCache.length === 0) {
      showToast('请先添加宠物档案', 'warning');
      return;
    }
    if (!needId) {
      resetNeedForm();
      needModal.classList.add('show');
      return;
    }
    ApiClient.get(`/needs/${needId}`).then(need => {
      fillNeedForm(need);
      needModal.classList.add('show');
    }).catch(err => showToast(err.message, 'error'));
  }

  function closeNeedModal() {
    needModal.classList.remove('show');
    editingNeed = null;
  }

  document.getElementById('btn-add-need').addEventListener('click', () => {
    openNeedModal(null);
  });
  needModal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeNeedModal));
  needModal.querySelector('.modal-mask').addEventListener('click', closeNeedModal);

  needForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(needForm);
    const data = Object.fromEntries(fd.entries());

    if (!data.petId) {
      showToast('请选择宠物', 'error');
      return;
    }
    if (!data.startDate || !data.endDate) {
      showToast('请选择日期区间', 'error');
      return;
    }
    if (data.startDate >= data.endDate) {
      showToast('起始日期必须早于结束日期', 'error');
      return;
    }
    if (data.startDate < todayYMD()) {
      showToast('起始日期不能早于今天', 'error');
      return;
    }

    // 元 → 分
    let expectedPriceCents = null;
    if (data.expectedPrice !== '' && data.expectedPrice !== undefined && data.expectedPrice !== null) {
      const yuan = Number(data.expectedPrice);
      if (!Number.isFinite(yuan) || yuan < 0) {
        showToast('期望日费必须为非负数字', 'error');
        return;
      }
      expectedPriceCents = Math.round(yuan * 100);
    }

    const btn = document.getElementById('need-submit');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = editingNeed ? '保存中…' : '发布中…';

    try {
      const payload = {
        startDate: data.startDate,
        endDate: data.endDate,
        expectedArea: data.expectedArea || '',
        expectedPriceCents,
        description: data.description || '',
      };
      if (!editingNeed) {
        payload.petId = data.petId;
        await ApiClient.post('/needs', payload);
        showToast('需求已发布', 'success');
      } else {
        await ApiClient.put(`/needs/${editingNeed.id}`, payload);
        showToast('需求已更新', 'success');
      }
      closeNeedModal();
      await loadNeeds();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  async function confirmCancelNeed(needId, el) {
    if (el.dataset.confirming === '1') {
      try {
        await ApiClient.delete(`/needs/${needId}`);
        showToast('需求已取消', 'success');
        await loadNeeds();
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else {
      el.dataset.confirming = '1';
      const originalText = el.textContent;
      el.textContent = '再次点击确认取消';
      el.style.color = 'var(--color-error)';
      setTimeout(() => {
        el.dataset.confirming = '0';
        el.textContent = originalText;
        el.style.color = '';
      }, 3000);
    }
  }

  // ============ 宠物缓存（供需求下拉） ============
  async function refreshPetsCache() {
    try {
      const pets = await ApiClient.get('/pets/my');
      myPetsCache = Array.isArray(pets) ? pets : [];
    } catch (err) {
      myPetsCache = [];
    }
  }

  // ============ 订单 Tab ============
  // 状态 → 徽章类名 + 文案映射
  const ORDER_STATUS = {
    pending:     { label: '等待确认', cls: 'badge-order-amber' },
    accepted:    { label: '已确认',   cls: 'badge-order-blue'  },
    in_progress: { label: '进行中',   cls: 'badge-order-green' },
    completed:   { label: '已完成',   cls: 'badge-order-done'  },
    cancelled:   { label: '已取消',   cls: 'badge-order-gray'  },
    disputed:    { label: '申诉中',   cls: 'badge-order-red'   },
  };

  const ordersListEl = document.getElementById('orders-list');
  const ordersRoleSeg = document.getElementById('orders-role-seg');
  let currentRole = 'owner';

  function fmtMD(dateStr) {
    if (!dateStr) return '-';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return dateStr;
    return `${m[2]}-${m[3]}`;
  }

  function fmtDT(iso) {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return iso;
    }
  }

  function orderDateRange(o) {
    const s = fmtMD(o.startDate);
    const e = fmtMD(o.endDate);
    const days = o.durationDays || parseRangeDays(o.startDate, o.endDate);
    return `${s} ~ ${e}（${days} 天）`;
  }

  function orderStatusBadge(status) {
    const s = ORDER_STATUS[status] || { label: status, cls: 'badge-order-gray' };
    return `<span class="badge ${s.cls}">${s.label}</span>`;
  }

  function avatarHtml(userId, avatarKey, fallbackEmoji) {
    if (userId && avatarKey) {
      const fallback = fallbackEmoji || '👤';
      return `<img class="order-peer-avatar" src="/api/users/${escapeHtml(userId)}/photo" alt="" onerror="this.outerHTML='<div class=\\"order-peer-avatar-fallback\\">${fallback}</div>'">`;
    }
    return `<div class="order-peer-avatar-fallback">${fallbackEmoji || '👤'}</div>`;
  }

  function renderOrderCard(o) {
    const pet = o.pet || {};
    const petIcon = PET_SPECIES_ICON[pet.species] || '🐾';
    const petCoverUrl = pet.coverKey ? `/api/pets/${pet.id}/photos/${pet.coverKey}` : '';
    const petCoverHtml = petCoverUrl
      ? `<img class="order-pet-cover" src="${escapeHtml(petCoverUrl)}" alt="${escapeHtml(pet.name || '')}" onerror="this.outerHTML='<div class=\\"order-pet-cover order-pet-cover-placeholder\\">${petIcon}</div>'">`
      : `<div class="order-pet-cover order-pet-cover-placeholder">${petIcon}</div>`;

    // 对方信息：isOwnerView 时显示 host，否则显示 owner
    const peer = o.isOwnerView ? (o.host || {}) : (o.owner || {});
    const peerLabel = o.isOwnerView
      ? (peer.district || peer.addressFuzzy || '未知区域')
      : '宠物主人';
    const peerFallback = o.isOwnerView ? '🏠' : '👤';
    const peerAvatarHtml = avatarHtml(peer.id, peer.avatarKey, peerFallback);

    // 金额
    const priceText = formatPrice(o.totalPriceCents);
    let amountHtml = `
      <div class="order-amount-row">
        <span class="order-amount-label">参考总价</span>
        <span class="order-amount-value">¥${escapeHtml(priceText)}</span>
      </div>`;
    if (o.isOwnerView && o.host && o.host.dailyRateCents) {
      amountHtml += `<div class="order-amount-sub">寄养人参考价 ¥${escapeHtml(formatPrice(o.host.dailyRateCents))} / 天</div>`;
    }

    // 操作区
    const isOwner = o.isOwnerView;
    let actionsHtml = '';
    if (o.status === 'pending') {
      if (isOwner) {
        actionsHtml = `
          <button class="btn btn-primary btn-flex" data-action="accept" data-order-id="${o.id}">确认接单</button>
          <button class="btn btn-secondary btn-flex" data-action="cancel" data-order-id="${o.id}">取消</button>`;
      } else {
        actionsHtml = `
          <div class="order-hint">⏳ 等待主人确认</div>
          <button class="btn btn-secondary btn-flex" data-action="cancel" data-order-id="${o.id}">取消</button>`;
      }
    } else if (o.status === 'accepted') {
      if (isOwner) {
        actionsHtml = `
          <div class="order-hint">🤝 等待寄养人交接</div>
          <button class="btn btn-secondary btn-flex" data-action="cancel" data-order-id="${o.id}">取消</button>`;
      } else {
        actionsHtml = `
          <button class="btn btn-primary btn-flex" data-action="start" data-order-id="${o.id}">确认开始寄养</button>
          <button class="btn btn-secondary btn-flex" data-action="cancel" data-order-id="${o.id}">取消</button>`;
      }
    } else if (o.status === 'in_progress') {
      if (isOwner) {
        actionsHtml = `
          <div class="order-hint">🐾 寄养进行中</div>
          <button class="btn btn-secondary btn-flex" data-action="dispute" data-order-id="${o.id}">发起申诉</button>`;
      } else {
        actionsHtml = `
          <button class="btn btn-primary btn-flex" data-action="complete" data-order-id="${o.id}">完成寄养</button>
          <button class="btn btn-secondary btn-flex" data-action="dispute" data-order-id="${o.id}">发起申诉</button>`;
      }
    } else if (o.status === 'completed') {
      actionsHtml = `
        <div class="order-hint">🎉 本次寄养已完成</div>` +
        (o.reviewed
          ? `<span class="review-done-badge">已评价</span>`
          : `<button class="btn btn-primary btn-flex" data-review-link="${o.id}" data-peer-id="${o.isOwnerView ? (o.host && o.host.id) : (o.owner && o.owner.id)}" data-peer-name="${escapeHtml(o.isOwnerView ? (o.host && o.host.nickname) : (o.owner && o.owner.nickname))}">去评价</button>`);
    } else if (o.status === 'cancelled') {
      actionsHtml = `<div class="order-hint">🚫 订单已取消</div>`;
    } else if (o.status === 'disputed') {
      actionsHtml = `<div class="order-hint">⚠️ 等待管理员处理</div>`;
    }

    // 详情折叠区
    const personalityTags = (pet.personality || []).map(t => `<span class="chip chip-cta">${escapeHtml(t)}</span>`).join('');
    const timeline = [];
    if (o.createdAt)   timeline.push({ t: o.createdAt,   label: '订单创建' });
    if (o.acceptedAt)  timeline.push({ t: o.acceptedAt,  label: '主人确认接单' });
    if (o.startedAt)   timeline.push({ t: o.startedAt,   label: '寄养已开始' });
    if (o.completedAt) timeline.push({ t: o.completedAt, label: '寄养完成' });
    if (o.cancelledAt) timeline.push({ t: o.cancelledAt, label: '订单取消' });
    const timelineHtml = timeline.length
      ? `<div class="order-timeline">${timeline.map(x => `<div class="order-timeline-item"><span class="order-timeline-time">${escapeHtml(fmtDT(x.t))}</span><span class="order-timeline-label">${escapeHtml(x.label)}</span></div>`).join('')}</div>`
      : '';

    const detailHtml = `
      <div class="order-detail-expand">
        ${personalityTags ? `<div class="order-detail-row"><span class="order-detail-label">宠物性格</span><div class="order-detail-chips">${personalityTags}</div></div>` : ''}
        ${pet.healthNotes ? `<div class="order-detail-row"><span class="order-detail-label">健康说明</span><div class="order-detail-text">${escapeHtml(pet.healthNotes)}</div></div>` : ''}
        ${pet.dailyHabits ? `<div class="order-detail-row"><span class="order-detail-label">日常习惯</span><div class="order-detail-text">${escapeHtml(pet.dailyHabits)}</div></div>` : ''}
        ${pet.specialNeeds ? `<div class="order-detail-row"><span class="order-detail-label">特殊需求</span><div class="order-detail-text">${escapeHtml(pet.specialNeeds)}</div></div>` : ''}
        ${o.host && o.host.id ? `<div class="order-detail-row"><span class="order-detail-label">寄养人区域</span><div class="order-detail-text">${escapeHtml(o.host.district || o.host.addressFuzzy || '-')}</div></div>` : ''}
        ${timelineHtml}
      </div>`;

    return `
      <div class="order-card card" data-order-id="${o.id}">
        <div class="order-card-body" data-toggle-detail>
          <div class="order-card-head">
            <span class="order-card-badge">${orderStatusBadge(o.status)}</span>
            <span class="order-card-date">${escapeHtml(orderDateRange(o))}</span>
          </div>
          <div class="order-card-pet">
            ${petCoverHtml}
            <div class="order-pet-info">
              <div class="order-pet-name">${escapeHtml(pet.name || '未命名宠物')} <span class="order-pet-icon">${petIcon}</span></div>
              ${pet.breed ? `<div class="order-pet-breed">${escapeHtml(pet.breed)}</div>` : ''}
              <div class="order-pet-meta">${escapeHtml([pet.gender, pet.age].filter(Boolean).join(' · '))}</div>
            </div>
          </div>
          <div class="order-card-peer">
            ${peerAvatarHtml}
            <div class="order-peer-info">
              <div class="order-peer-name">${escapeHtml(peer.nickname || '未知用户')}</div>
              <div class="order-peer-region">${escapeHtml(peerLabel)}</div>
            </div>
          </div>
          ${amountHtml}
        </div>
        ${actionsHtml ? `<div class="order-card-actions">${actionsHtml}</div>` : ''}
        ${detailHtml}
      </div>`;
  }

  function renderOrderSkeleton() {
    ordersListEl.innerHTML = `
      <div class="order-skeleton">
        <div class="skeleton" style="height:14px;width:40%;margin-bottom:10px"></div>
        <div class="skeleton" style="height:14px;width:30%;margin-bottom:10px"></div>
        <div class="skeleton" style="height:120px;margin-bottom:14px"></div>
        <div class="skeleton" style="height:120px;margin-bottom:14px"></div>
        <div class="skeleton" style="height:120px"></div>
      </div>`;
  }

  function renderOrderEmpty(role) {
    if (role === 'host') {
      ordersListEl.innerHTML = `<div class="order-empty">
        <span class="emoji">🏠</span>
        <h3>还没有寄养订单</h3>
        <p>当有主人下单给你时，订单会出现在这里</p>
      </div>`;
    } else {
      ordersListEl.innerHTML = `<div class="order-empty">
        <span class="emoji">📋</span>
        <h3>还没有寄养订单</h3>
        <p>在「需求」Tab 发布需求，被寄养人接单后生成订单</p>
      </div>`;
    }
  }

  async function loadOrders() {
    renderOrderSkeleton();
    try {
      const data = await ApiClient.get(`/orders/my?role=${currentRole}`);
      const orders = (data && data.orders) || [];
      if (orders.length === 0) {
        renderOrderEmpty(currentRole);
        return;
      }
      ordersListEl.innerHTML = orders.map(renderOrderCard).join('');
      // 绑定操作按钮
      ordersListEl.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmOrderAction(btn, btn.dataset.orderId, btn.dataset.action);
        });
      });
      // 评价链接 → 打开评价弹窗
      ordersListEl.querySelectorAll('[data-review-link]').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openReviewModal(a.dataset.reviewLink, a.dataset.peerId, a.dataset.peerName);
        });
      });
      // 卡片点击 → 展开详情
      ordersListEl.querySelectorAll('.order-card').forEach(card => {
        const body = card.querySelector('[data-toggle-detail]');
        if (body) {
          body.addEventListener('click', () => {
            card.classList.toggle('order-card-expanded');
          });
        }
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // 角色切换
  function setRole(role) {
    if (role !== 'owner' && role !== 'host') role = 'owner';
    currentRole = role;
    ordersRoleSeg.querySelectorAll('.seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.role === role);
    });
    loadOrders();
  }
  ordersRoleSeg.querySelectorAll('.seg-btn').forEach(b => {
    b.addEventListener('click', () => setRole(b.dataset.role));
  });

  // ============ 状态操作自定义确认弹窗 ============
  let confirmState = null;
  function confirmOrderAction(btn, orderId, action) {
    if (!orderId || !action) return;
    // 幂等：已打开则忽略
    if (confirmState && confirmState.open) return;
    const modal = document.getElementById('order-confirm-modal');
    const titleEl = document.getElementById('order-confirm-title');
    const descEl = document.getElementById('order-confirm-desc');
    const cancelBtn = document.getElementById('order-confirm-cancel');
    const okBtn = document.getElementById('order-confirm-ok');
    const okText = okBtn.querySelector('.btn-text');
    const okLoading = okBtn.querySelector('.btn-loading');

    const titles = {
      accept:   '确认接单？',
      start:    '确认开始寄养？',
      complete: '确认完成寄养？',
      cancel:   '取消订单？',
      dispute:  '发起申诉？',
    };
    const descs = {
      accept:   '确认后寄养人需与主人交接，订单进入「已确认」状态',
      start:    '确认后订单进入「进行中」，宠物进入你照看',
      complete: '确认寄养已顺利完成，宠物已交还主人',
      cancel:   '取消后订单不可恢复，请谨慎操作',
      dispute:  '发起申诉后订单将等待管理员人工介入',
    };

    titleEl.textContent = titles[action] || '确认操作？';
    descEl.textContent = descs[action] || '';
    okText.style.display = '';
    okLoading.style.display = 'none';
    okBtn.disabled = false;
    modal.classList.add('show');
    confirmState = { open: true, orderId, action, btn };

    cancelBtn.onclick = () => closeConfirm();
    modal.querySelector('.modal-mask').onclick = () => closeConfirm();
    modal.querySelector('[data-close]').onclick = () => closeConfirm();

    okBtn.onclick = async () => {
      if (!confirmState || !confirmState.open) return;
      okText.style.display = 'none';
      okLoading.style.display = '';
      okBtn.disabled = true;
      try {
        const res = await ApiClient.post(`/orders/${orderId}/status`, { action });
        showToast(res && res.label ? res.label : '操作成功', 'success');
        closeConfirm();
        await loadOrders();
      } catch (err) {
        showToast(err.message, 'error');
        okText.style.display = '';
        okLoading.style.display = 'none';
        okBtn.disabled = false;
      }
    };
  }
  function closeConfirm() {
    const modal = document.getElementById('order-confirm-modal');
    modal.classList.remove('show');
    if (confirmState) {
      confirmState.open = false;
      confirmState = null;
    }
  }

  // ============ 评价弹窗 ============
  const REVIEW_TAGS = ['照顾周到', '沟通顺畅', '环境整洁', '按时接送', '有爱心', '经验丰富', '会拍照', '有急救知识'];
  const MAX_REVIEW_TAGS = 6;
  const MAX_REVIEW_PHOTOS = 6;
  const MAX_REVIEW_CONTENT = 500;
  const MAX_REVIEW_PHOTO_SIZE = 5 * 1024 * 1024;
  const ALLOWED_REVIEW_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const reviewModal = document.getElementById('review-modal');
  const reviewStarsEl = document.getElementById('review-stars');
  const reviewTagsEl = document.getElementById('review-tags');
  const reviewTextarea = document.getElementById('review-textarea');
  const reviewCharNow = document.getElementById('review-char-now');
  const reviewFileInput = document.getElementById('review-file-input');
  const reviewPreviewEl = document.getElementById('review-preview');
  const reviewSubmitBtn = document.getElementById('review-submit');
  const reviewPeerLabel = document.getElementById('review-peer-label');

  const reviewState = {
    orderId: null,
    peerId: null,
    peerName: '',
    rating: 0,
    tags: new Set(),
    // 每项: { file: File, key: string|null } — key=null 表示尚未上传
    items: [],
  };

  function renderReviewTags() {
    reviewTagsEl.innerHTML = REVIEW_TAGS.map(t =>
      `<span class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`
    ).join('');
    reviewTagsEl.querySelectorAll('.tag-chip').forEach(c => {
      c.addEventListener('click', () => {
        const v = c.dataset.tag;
        if (reviewState.tags.has(v)) {
          reviewState.tags.delete(v);
          c.classList.remove('active');
        } else {
          if (reviewState.tags.size >= MAX_REVIEW_TAGS) {
            showToast(`最多选择 ${MAX_REVIEW_TAGS} 个标签`, 'warning');
            return;
          }
          reviewState.tags.add(v);
          c.classList.add('active');
        }
      });
    });
  }

  function renderReviewStars() {
    const stars = reviewStarsEl.querySelectorAll('.star');
    stars.forEach(s => {
      const v = parseInt(s.dataset.v, 10);
      if (v <= reviewState.rating) {
        s.classList.add('active');
        s.textContent = '★';
      } else {
        s.classList.remove('active');
        s.textContent = '☆';
      }
    });
  }

  reviewStarsEl.querySelectorAll('.star').forEach(s => {
    s.addEventListener('click', () => {
      reviewState.rating = parseInt(s.dataset.v, 10);
      renderReviewStars();
    });
  });

  function renderReviewPreview() {
    let html = '';
    reviewState.items.forEach((item, i) => {
      const isUploading = item.uploading === true;
      html += `<div class="review-thumb">
        <img src="${URL.createObjectURL(item.file)}" alt="preview" data-idx="${i}">
        <button type="button" class="review-thumb-del" data-idx="${i}" ${isUploading ? 'disabled' : ''}>×</button>
      </div>`;
    });
    if (reviewState.items.length < MAX_REVIEW_PHOTOS) {
      html += '<div class="review-thumb review-thumb-add" id="review-add-photo">+</div>';
    }
    reviewPreviewEl.innerHTML = html;

    reviewPreviewEl.querySelectorAll('.review-thumb-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx, 10);
        if (reviewState.items[i] && reviewState.items[i].uploading) return;
        reviewState.items.splice(i, 1);
        renderReviewPreview();
      });
    });
    const addBtn = document.getElementById('review-add-photo');
    if (addBtn) {
      addBtn.addEventListener('click', () => reviewFileInput.click());
    }
  }

  reviewFileInput.addEventListener('change', () => {
    const files = Array.from(reviewFileInput.files || []);
    if (files.length === 0) return;
    const remaining = MAX_REVIEW_PHOTOS - reviewState.items.length;
    if (remaining <= 0) {
      showToast(`最多 ${MAX_REVIEW_PHOTOS} 张`, 'warning');
      reviewFileInput.value = '';
      return;
    }
    let added = 0;
    for (const f of files) {
      if (added >= remaining) {
        showToast(`最多 ${MAX_REVIEW_PHOTOS} 张，已忽略多余`, 'warning');
        break;
      }
      if (!ALLOWED_REVIEW_TYPES.includes(f.type)) {
        showToast(`不支持的格式：${f.name}`, 'warning');
        continue;
      }
      if (f.size > MAX_REVIEW_PHOTO_SIZE) {
        showToast(`图片过大：${f.name}`, 'warning');
        continue;
      }
      reviewState.items.push({ file: f, key: null });
      added++;
    }
    reviewFileInput.value = '';
    renderReviewPreview();
  });

  function resetReviewState() {
    reviewState.orderId = null;
    reviewState.peerId = null;
    reviewState.peerName = '';
    reviewState.rating = 0;
    reviewState.tags.clear();
    reviewState.items = [];
    reviewTextarea.value = '';
    reviewCharNow.textContent = '0';
    reviewPeerLabel.textContent = '评价对象';
    renderReviewTags();
    renderReviewStars();
    renderReviewPreview();
    reviewSubmitBtn.disabled = false;
    reviewSubmitBtn.querySelector('.btn-text').style.display = '';
    reviewSubmitBtn.querySelector('.btn-loading').style.display = 'none';
    reviewSubmitBtn.querySelector('.btn-loading').textContent = '提交中…';
  }

  function openReviewModal(orderId, peerId, peerName) {
    resetReviewState();
    reviewState.orderId = orderId;
    reviewState.peerId = peerId;
    reviewState.peerName = peerName || '对方';
    reviewPeerLabel.textContent = `评价：${reviewState.peerName}`;
    reviewModal.classList.add('show');
  }

  function closeReviewModal() {
    reviewModal.classList.remove('show');
    resetReviewState();
  }

  reviewModal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeReviewModal));
  reviewModal.querySelector('.modal-mask').addEventListener('click', closeReviewModal);

  // 字符计数
  reviewTextarea.addEventListener('input', () => {
    reviewCharNow.textContent = String(reviewTextarea.value.length);
  });

  // 上传单张
  async function uploadReviewPhoto(file) {
    const token = ApiClient.getToken();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/reviews/upload?orderId=${encodeURIComponent(reviewState.orderId)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      throw new Error(data.error || `上传失败 (${res.status})`);
    }
    return data.key;
  }

  reviewSubmitBtn.addEventListener('click', async () => {
    if (!reviewState.orderId) return;
    if (reviewState.rating < 1 || reviewState.rating > 5) {
      showToast('请选择星级', 'warning');
      return;
    }
    const content = reviewTextarea.value.trim();
    if (content.length > MAX_REVIEW_CONTENT) {
      showToast(`评价内容最多 ${MAX_REVIEW_CONTENT} 字`, 'error');
      return;
    }

    // 先上传未上传的图片
    const toUpload = reviewState.items.filter(it => !it.key);
    if (toUpload.length > 0) {
      reviewSubmitBtn.disabled = true;
      reviewSubmitBtn.querySelector('.btn-text').style.display = 'none';
      reviewSubmitBtn.querySelector('.btn-loading').style.display = '';
      reviewSubmitBtn.querySelector('.btn-loading').textContent = `上传中 0/${toUpload.length}…`;
      try {
        for (let i = 0; i < toUpload.length; i++) {
          const item = toUpload[i];
          item.uploading = true;
          renderReviewPreview();
          const key = await uploadReviewPhoto(item.file);
          item.key = key;
          item.uploading = false;
          reviewSubmitBtn.querySelector('.btn-loading').textContent = `上传中 ${i + 1}/${toUpload.length}…`;
        }
      } catch (err) {
        showToast('图片上传失败：' + err.message + '（已上传的已保留，可重试）', 'error');
        toUpload.forEach(it => { it.uploading = false; });
        reviewSubmitBtn.disabled = false;
        reviewSubmitBtn.querySelector('.btn-text').style.display = '';
        reviewSubmitBtn.querySelector('.btn-loading').style.display = 'none';
        reviewSubmitBtn.querySelector('.btn-loading').textContent = '提交中…';
        renderReviewPreview();
        return;
      }
    }

    // 提交评价
    reviewSubmitBtn.disabled = true;
    reviewSubmitBtn.querySelector('.btn-text').style.display = 'none';
    reviewSubmitBtn.querySelector('.btn-loading').style.display = '';
    reviewSubmitBtn.querySelector('.btn-loading').textContent = '提交中…';

    try {
      await ApiClient.post(`/orders/${reviewState.orderId}/review`, {
        rating: reviewState.rating,
        content: content,
        tags: Array.from(reviewState.tags),
        photos: reviewState.items.filter(it => it.key).map(it => it.key),
      });
      showToast('感谢您的评价！', 'success');
      closeReviewModal();
      await loadOrders();
    } catch (err) {
      showToast(err.message || '提交失败', 'error');
      reviewSubmitBtn.disabled = false;
      reviewSubmitBtn.querySelector('.btn-text').style.display = '';
      reviewSubmitBtn.querySelector('.btn-loading').style.display = 'none';
      reviewSubmitBtn.querySelector('.btn-loading').textContent = '提交中…';
    }
  });

  // 初始加载（宠物 + 寄养 + 需求 并行；宠物缓存后再拉需求）
  await Promise.all([loadPets(), loadHost()]);
  await refreshPetsCache();
  await loadNeeds();

  // ============ URL 参数 (?tab=orders & role=host) ============
  try {
    const params = new URLSearchParams(location.search);
    const initRole = params.get('role') === 'host' ? 'host' : 'owner';
    if (params.get('tab') === 'orders') {
      activateTab('orders');
      setRole(initRole);
    } else {
      // 默认 owner 角色，但不主动加载（避免无用请求）
      setRole(initRole);
    }
  } catch (err) {
    // URL 解析失败静默
  }
});
