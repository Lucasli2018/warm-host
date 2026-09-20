// warm-host · 登录 / 注册页面逻辑
// 绑定到 public/auth.html

document.addEventListener('DOMContentLoaded', () => {
  // 已登录则直接跳转首页
  if (ApiClient.getToken()) {
    location.href = '/index.html';
    return;
  }

  // ============ Tab 切换 ============
  const tabBtns = document.querySelectorAll('.tab-btn');
  const forms = document.querySelectorAll('.auth-form');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      forms.forEach(f => f.classList.toggle('active', f.id === `${target}-form`));
      // 切换后清空错误态
      forms.forEach(f => f.querySelectorAll('input').forEach(i => i.style.borderColor = ''));
    });
  });

  // ============ 邀请码输入：自动大写 ============
  const inviteInput = document.getElementById('reg-invite');
  if (inviteInput) {
    inviteInput.addEventListener('input', () => {
      const pos = inviteInput.selectionStart;
      inviteInput.value = inviteInput.value.toUpperCase();
      // 保持光标位置（字符数不变时）
      try { inviteInput.setSelectionRange(pos, pos); } catch {}
    });
  }

  // ============ 手机号格式校验（11 位中国大陆手机，宽松匹配） ============
  function isValidPhone(phone) {
    return /^1[3-9]\d{9}$/.test(phone.trim()) || phone === 'admin';
  }

  // ============ 登录 ============
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const phone = loginForm.phone.value.trim();
      const password = loginForm.password.value;

      if (!isValidPhone(phone)) {
        showToast('请输入正确的手机号', 'error');
        loginForm.phone.focus();
        return;
      }
      if (password.length < 6) {
        showToast('密码至少 6 位', 'error');
        loginForm.password.focus();
        return;
      }

      const btn = loginForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '登录中…';

      try {
        const data = await ApiClient.post('/auth/login', { phone, password });
        ApiClient.setToken(data.token);
        showToast('登录成功', 'success');
        setTimeout(() => {
          location.href = data.user && data.user.role === 'admin' ? '/admin.html' : '/index.html';
        }, 500);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  // ============ 注册 ============
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const phone = registerForm.phone.value.trim();
      const nickname = registerForm.nickname.value.trim();
      const password = registerForm.password.value;
      const inviteCode = registerForm.inviteCode.value.trim().toUpperCase();

      if (!isValidPhone(phone)) {
        showToast('请输入正确的手机号', 'error');
        registerForm.phone.focus();
        return;
      }
      if (nickname.length < 2) {
        showToast('昵称至少 2 个字符', 'error');
        registerForm.nickname.focus();
        return;
      }
      if (password.length < 6) {
        showToast('密码至少 6 位', 'error');
        registerForm.password.focus();
        return;
      }
      if (inviteCode.length !== 6) {
        showToast('邀请码需为 6 位', 'error');
        registerForm.inviteCode.focus();
        return;
      }

      const btn = registerForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '注册中…';

      try {
        const data = await ApiClient.post('/auth/register', {
          phone,
          password,
          nickname,
          inviteCode,
        });
        ApiClient.setToken(data.token);
        showToast('注册成功！已为你分配 3 个邀请码', 'success');
        setTimeout(() => {
          location.href = '/index.html';
        }, 800);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }
});
