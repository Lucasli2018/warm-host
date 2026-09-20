// warm-host · 前端全局 API client
// 所有页面共享：fetch 封装 + token 管理 + toast + html 转义

const ApiClient = {
  baseUrl: '/api',

  // --- Token 管理（localStorage） ---
  getToken() {
    try {
      return localStorage.getItem('warm-host-token');
    } catch {
      return null;
    }
  },

  setToken(token) {
    try {
      if (token) localStorage.setItem('warm-host-token', token);
      else localStorage.removeItem('warm-host-token');
    } catch {
      // localStorage 不可用时静默失败
    }
  },

  isAuthed() {
    return !!this.getToken();
  },

  // --- 核心 request ---
  async request(method, path, body, isFormData = false) {
    const headers = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData && body) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
      });
    } catch (err) {
      throw new Error('网络错误，请检查连接');
    }

    // 401 处理：清除 token，非 auth 路径跳转登录
    if (res.status === 401) {
      this.setToken(null);
      // 不在 /auth/ 路径上时自动跳转（避免 auth 页面自身 401 造成循环）
      if (!path.startsWith('/auth/')) {
        location.href = '/auth.html';
      }
      throw new Error('未登录或会话已过期');
    }

    // 解析响应体
    let data = {};
    try {
      data = await res.json();
    } catch {
      // 非 JSON 响应（如 204 No Content），忽略
    }

    if (!res.ok) {
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  },

  // --- 便捷方法 ---
  get(path) {
    return this.request('GET', path);
  },

  post(path, body, isFormData = false) {
    return this.request('POST', path, body, isFormData);
  },

  put(path, body) {
    return this.request('PUT', path, body);
  },

  delete(path) {
    return this.request('DELETE', path);
  },

  // --- 便捷：上传文件 ---
  upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    return this.request('POST', path, fd, true);
  },
};

// ============ 全局工具函数 ============

/**
 * 显示一个 toast 提示（3 秒自动消失）
 * @param {string} msg - 消息文本
 * @param {'info'|'success'|'error'|'warning'} type - 类型
 */
function showToast(msg, type = 'info') {
  if (!msg) return;
  // 若 body 尚未就绪，延迟到 DOMContentLoaded 后执行
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => showToast(msg, type), { once: true });
    return;
  }
  // 同一时刻最多一个 toast，避免堆叠
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  // 下一帧加上 show class，触发 CSS transition
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * 将字符串转义为 HTML 安全文本（防 XSS）
 * @param {any} str - 待转义内容
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * 格式化金额：分 → 元（不带 ¥ 符号）
 * @param {number} cents - 分
 */
function formatPrice(cents) {
  if (cents === null || cents === undefined || isNaN(cents)) return '-';
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/**
 * 格式化日期区间
 * @param {string} start - 'YYYY-MM-DD'
 * @param {string} end   - 'YYYY-MM-DD'
 */
function formatDateRange(start, end) {
  if (!start && !end) return '-';
  if (!start || !end) return start || end;
  if (start === end) return start;
  return `${start} 至 ${end}`;
}

/**
 * 将天数转为文字（用于订单时长显示）
 * @param {number} days
 */
function formatDays(days) {
  if (!days) return '-';
  return `${days} 天`;
}

/**
 * 简单的星级评分渲染
 * @param {number} rating - 1-5 浮点
 */
function renderStars(rating) {
  const full = Math.floor(rating || 0);
  const half = (rating - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★★★★★'.slice(0, full) + (half ? '½' : '') + '☆☆☆☆☆'.slice(0, empty);
}

/**
 * 从 JSON 字符串解析数组（容错）
 * @param {string|null} json - 存储的 JSON 字符串
 * @param {any[]} fallback
 */
function parseJsonArray(json, fallback = []) {
  if (!json) return fallback;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
