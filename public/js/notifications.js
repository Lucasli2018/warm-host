// public/js/notifications.js
// Task 14 — 通知系统前端公共模块
// 依赖：/js/api.js（ApiClient 全局对象）
// 自执行 IIFE：DOMContentLoaded 后自动注入铃铛 + 60s 轮询
//
// 页面接入：在 api.js 之后加载本文件即可，无需修改页面 HTML 结构。
// 若无 .header 容器，铃铛 fixed 定位到右上角。

(function () {
  'use strict';

  // ============ type → 图标映射 ============
  var ICONS = {
    order_pending:      '📨',
    order_accepted:     '✅',
    order_started:      '🐾',
    order_completed:    '🎉',
    order_cancelled:    '🚫',
    order_disputed:     '⚠️',
    order_invite:       '💌',
    review:             '⭐',
    sponsor_invite:     '🤝',
    sponsor_accepted:   '🛡️',
    host_approved:      '🎊',
    host_rejected:      '😔',
    host_suspended:     '⏸️',
    host_activated:     '▶️',
    blacklist_report:   '🚩',
    blacklist_confirmed:'🔴',
    blacklist_dismissed:'✅',
    banned:             '🚫',
  };
  var ICON_DEFAULT = '🔔';

  var POLL_INTERVAL_MS = 60000; // 60s
  var MAX_BADGE = 9;
  var LIST_LIMIT = 20;

  var bellBtn = null;
  var badge = null;
  var panel = null;
  var pollTimer = null;

  function iconFor(type) {
    return ICONS[type] || ICON_DEFAULT;
  }

  function fmtBadge(n) {
    if (n > MAX_BADGE) return MAX_BADGE + '+';
    return String(n);
  }

  function updateBadge(n) {
    if (!badge) return;
    n = Number(n) || 0;
    if (n > 0) {
      badge.textContent = fmtBadge(n);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

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

  function findHeader() {
    return document.querySelector('.header, header, [class*="header"]');
  }

  // ============ 注入铃铛 ============
  function ensureBell() {
    if (bellBtn) return bellBtn;
    // 复用页面已有的 .notif-bell（若存在）
    var existing = document.querySelector('.notif-bell');
    if (existing) {
      bellBtn = existing;
      badge = existing.querySelector('.notif-badge');
      if (!bellBtn._notifBound) {
        bellBtn._notifBound = true;
        bellBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          togglePanel();
        });
      }
      return bellBtn;
    }

    bellBtn = document.createElement('button');
    bellBtn.className = 'notif-bell';
    bellBtn.type = 'button';
    bellBtn.title = '通知';
    bellBtn.setAttribute('aria-label', '通知');

    var iconSpan = document.createElement('span');
    iconSpan.className = 'notif-bell-icon';
    iconSpan.textContent = '🔔';
    bellBtn.appendChild(iconSpan);

    badge = document.createElement('span');
    badge.className = 'notif-badge';
    badge.style.display = 'none';
    badge.textContent = '0';
    bellBtn.appendChild(badge);

    var headerEl = findHeader();
    if (headerEl) {
      // 优先替换 .header-placeholder 占位符
      var placeholder = headerEl.querySelector('.header-placeholder');
      if (placeholder) {
        headerEl.replaceChild(bellBtn, placeholder);
      } else {
        headerEl.appendChild(bellBtn);
      }
    } else {
      // 找不到 header，fixed 定位到右上角
      bellBtn.style.position = 'fixed';
      bellBtn.style.top = '10px';
      bellBtn.style.right = '10px';
      bellBtn.style.zIndex = '1000';
      document.body.appendChild(bellBtn);
    }

    bellBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    return bellBtn;
  }

  // ============ 通知面板 ============
  function positionPanel() {
    if (!panel) return;
    if (bellBtn) {
      var rect = bellBtn.getBoundingClientRect();
      panel.style.top = (rect.bottom + 4) + 'px';
      // 面板宽度固定，避免超出视口
      var w = Math.min(360, Math.max(280, window.innerWidth - 24));
      panel.style.width = w + 'px';
      var right = Math.max(8, window.innerWidth - rect.right);
      panel.style.right = right + 'px';
    } else {
      panel.style.top = '60px';
      panel.style.right = '10px';
    }
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.setAttribute('role', 'menu');

    var head = document.createElement('div');
    head.className = 'notif-panel-head';
    var title = document.createElement('span');
    title.className = 'notif-panel-title';
    title.textContent = '通知';
    var readAllBtn = document.createElement('button');
    readAllBtn.type = 'button';
    readAllBtn.className = 'notif-read-all';
    readAllBtn.textContent = '全部已读';
    head.appendChild(title);
    head.appendChild(readAllBtn);

    var body = document.createElement('div');
    body.className = 'notif-panel-body';

    var foot = document.createElement('div');
    foot.className = 'notif-panel-foot';

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(foot);
    document.body.appendChild(panel);

    readAllBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      markAllRead();
    });

    body.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.notif-item') : null;
      if (!item) return;
      e.stopPropagation();
      var id = item.getAttribute('data-id');
      var link = item.getAttribute('data-link');
      // 立即在本地标记已读（乐观更新）
      item.classList.remove('unread');
      var dot = item.querySelector('.notif-dot');
      if (dot) dot.remove();
      markOneRead(id, link);
    });

    foot.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.notif-view-all') : null;
      if (!btn) return;
      e.stopPropagation();
      loadList();
    });

    // 点击面板外部关闭
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && (!bellBtn || !bellBtn.contains(e.target))) {
        closePanel();
      }
    });

    window.addEventListener('resize', function () {
      if (panel && panel.style.display !== 'none') positionPanel();
    });

    return panel;
  }

  function closePanel() {
    if (panel) panel.style.display = 'none';
  }

  function openPanel() {
    var p = ensurePanel();
    p.style.display = '';
    positionPanel();
    loadList();
  }

  function togglePanel() {
    if (!panel) {
      openPanel();
    } else if (panel.style.display === 'none' || !panel.style.display) {
      openPanel();
    } else {
      closePanel();
    }
  }

  function renderList(items) {
    var body = panel.querySelector('.notif-panel-body');
    var foot = panel.querySelector('.notif-panel-foot');
    body.innerHTML = '';
    foot.innerHTML = '';

    if (!items || items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'notif-empty';
      empty.textContent = '暂无通知';
      body.appendChild(empty);
      return;
    }

    items.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'notif-item' + (n.read ? '' : ' unread');
      item.setAttribute('data-id', n.id);
      if (n.link) item.setAttribute('data-link', n.link);

      if (!n.read) {
        var dot = document.createElement('span');
        dot.className = 'notif-dot';
        item.appendChild(dot);
      }

      var icon = document.createElement('div');
      icon.className = 'notif-item-icon';
      icon.textContent = iconFor(n.type);

      var bodyEl = document.createElement('div');
      bodyEl.className = 'notif-item-body';

      var title = document.createElement('div');
      title.className = 'notif-item-title';
      title.textContent = n.title || '';

      var desc = document.createElement('div');
      desc.className = 'notif-item-desc';
      desc.textContent = (n.body || '').slice(0, 120);

      var time = document.createElement('div');
      time.className = 'notif-item-time';
      time.textContent = relativeTime(n.createdAt);

      bodyEl.appendChild(title);
      bodyEl.appendChild(desc);
      bodyEl.appendChild(time);

      item.appendChild(icon);
      item.appendChild(bodyEl);
      body.appendChild(item);
    });

    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'notif-view-all';
    more.textContent = '查看全部通知';
    foot.appendChild(more);
  }

  // ============ API 调用 ============
  function apiAvailable() {
    return typeof ApiClient !== 'undefined' && ApiClient && ApiClient.get && ApiClient.post;
  }

  function isAuthed() {
    return apiAvailable() && ApiClient.isAuthed && ApiClient.isAuthed();
  }

  async function loadList() {
    if (!apiAvailable() || !isAuthed()) return;
    try {
      var data = await ApiClient.get('/notifications?page=1&pageSize=' + LIST_LIMIT);
      renderList((data && data.notifications) || []);
      updateBadge((data && data.unreadCount) || 0);
    } catch (e) {
      // 静默：api.js 401 已处理
    }
  }

  async function markOneRead(id, link) {
    if (!apiAvailable() || !isAuthed() || !id) return;
    try {
      var r = await ApiClient.post('/notifications/read', { id: id });
      updateBadge((r && r.unreadCount) || 0);
    } catch (e) {
      // 静默
    }
    if (link) {
      // 稍等一下让后端有时间写
      setTimeout(function () { window.location.href = link; }, 80);
    }
  }

  async function markAllRead() {
    if (!apiAvailable() || !isAuthed()) return;
    try {
      var r = await ApiClient.post('/notifications/read', { all: true });
      updateBadge((r && r.unreadCount) || 0);
      if (panel) {
        var unread = panel.querySelectorAll('.notif-item.unread');
        for (var i = 0; i < unread.length; i++) {
          unread[i].classList.remove('unread');
          var d = unread[i].querySelector('.notif-dot');
          if (d) d.remove();
        }
      }
    } catch (e) {
      // 静默
    }
  }

  async function refreshBadge() {
    if (!apiAvailable() || !isAuthed()) return;
    try {
      var r = await ApiClient.get('/notifications?page=1&pageSize=1');
      updateBadge((r && r.unreadCount) || 0);
    } catch (e) {
      // 静默：api.js 401 已处理
    }
  }

  // ============ 轮询 ============
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') {
        refreshBadge();
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ============ 页面可见性联动 ============
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // 回到前台立刻刷一次
      refreshBadge();
      if (!pollTimer) startPoll();
    } else {
      // 切后台暂停轮询
      stopPoll();
    }
  }

  function init() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }
    ensureBell();
    refreshBadge();
    startPoll();
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  init();

  // 供调试 / 测试静态检查使用
  if (typeof window !== 'undefined') {
    window.__NOTIF_ICONS__ = ICONS;
  }
})();
