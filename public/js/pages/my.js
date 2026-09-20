// warm-host · 我的页面
// 当前只做宠物 Tab 的基础功能，其余 3 Tab 占位

const PET_SPECIES_ICON = { '猫': '🐱', '狗': '🐶', '兔': '🐰', '其他': '🐾' };
const PERSONALITY_TAGS = ['友善', '粘人', '怕生', '拆家', '安静', '活泼'];
const MAX_PHOTOS = 9;

document.addEventListener('DOMContentLoaded', async () => {
  // 未登录跳转登录页
  if (!ApiClient.getToken()) {
    location.href = '/auth.html';
    return;
  }

  // ============ Tab 切换 ============
  const tabs = document.querySelectorAll('.my-tab');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.my-content').forEach(c =>
        c.classList.toggle('active', c.id === `tab-${t.dataset.tab}`)
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

  // 初始加载
  await loadPets();
});
