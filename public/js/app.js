// public/js/app.js
// Task 15 — 全局底部 Tab 导航（自执行 IIFE）
//
// 依赖：/js/api.js（ApiClient 全局对象，用于 isAuthed()）
// 加载顺序：api.js → notifications.js → app.js → /js/pages/*.js
//
// 5 个 Tab：
//   🏠 首页    → /index.html
//   🔍 寄养人  → /hosts.html
//   🐾 宠物    → /my.html?tab=pets     （需登录）
//   📋 需求    → /my.html?tab=needs     （需登录）
//   👤 我的    → /my.html?tab=profile   （需登录）
//
// 行为：
//   - 仅移动端（window.innerWidth <= 768）渲染底部栏；桌面端不注入
//   - 当前页高亮（根据 location.pathname + location.search 的 tab 参数）
//   - 若当前在 my.html 且点击的是另一个 my tab → 只更新 ?tab= 并 dispatch
//     CustomEvent('tabchange', {detail:{tab}})，不整页刷新
//   - my.html 页面必须监听 'tabchange' 事件切换内部 Tab
//   - 未登录点击宠物/需求/我的 → 跳 /auth.html?next=...

(function () {
  'use strict';

  var MOBILE_MAX_W = 768;

  // Tab 定义
  var TABS = [
    { key: 'home',   icon: '🏠', label: '首页',   href: '/index.html',   requiresAuth: false },
    { key: 'hosts',  icon: '🔍', label: '寄养人', href: '/hosts.html',   requiresAuth: false },
    { key: 'pets',   icon: '🐾', label: '宠物',   href: '/my.html?tab=pets',   requiresAuth: true  },
    { key: 'needs',  icon: '📋', label: '需求',   href: '/my.html?tab=needs',  requiresAuth: true  },
    { key: 'profile',icon: '👤', label: '我的',   href: '/my.html?tab=profile', requiresAuth: true  },
  ];

  function isMobile() {
    return typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_W;
  }

  function pathname() {
    // wrangler 下 /index.html 与 / 会重定向到 /，规范化
    var p = location.pathname || '/';
    if (p === '/' || p === '/index.html' || p === '/index') return '/index.html';
    return p;
  }

  function currentTabKey() {
    var path = pathname();
    var params = new URLSearchParams(location.search);
    var tab = params.get('tab') || '';

    if (path === '/index.html') return 'home';
    if (path === '/hosts.html') return 'hosts';
    if (path === '/my.html') {
      if (tab === 'pets' || tab === 'needs' || tab === 'profile' || tab === 'orders' || tab === 'host') {
        // orders/host 也属于 my 页；这里 profile 是"我的"入口的默认（等价于 pets 高亮更合理？
        // 但按 Tab 定义 profile 就是"我的"，所以直接映射
        return tab === 'profile' ? 'profile' : (tab === 'pets' ? 'pets' : 'needs');
      }
      return 'profile'; // my.html 默认落在"我的"
    }
    return ''; // 其他页面（详情页、admin、auth）不高亮
  }

  function isActive(tab, currentKey) {
    return tab.key === currentKey;
  }

  function buildBar() {
    var currentKey = currentTabKey();
    var bar = document.createElement('nav');
    bar.className = 'bottom-tab-bar';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', '底部导航');

    TABS.forEach(function (tab) {
      var a = document.createElement('a');
      a.className = 'bottom-tab' + (isActive(tab, currentKey) ? ' active' : '');
      a.href = tab.href;
      a.dataset.key = tab.key;
      a.dataset.href = tab.href;
      a.dataset.requiresAuth = tab.requiresAuth ? '1' : '0';
      a.innerHTML =
        '<span class="bottom-tab-icon">' + tab.icon + '</span>' +
        '<span class="bottom-tab-label">' + tab.label + '</span>';
      bar.appendChild(a);
    });

    document.body.appendChild(bar);

    // 移动端给 body 加底部留白，避免内容被遮挡
    document.body.classList.add('has-bottom-tabbar');

    // 点击拦截（阻止默认跳转以便统一处理登录 & 事件派发）
    bar.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('.bottom-tab') : null;
      if (!target) return;
      e.preventDefault();
      onTabClick(target);
    });
  }

  function onTabClick(tabEl) {
    var requiresAuth = tabEl.dataset.requiresAuth === '1';
    if (requiresAuth && !ApiClient.isAuthed()) {
      var next = encodeURIComponent(tabEl.dataset.href || tabEl.href);
      location.href = '/auth.html?next=' + next;
      return;
    }

    var targetHref = tabEl.dataset.href || tabEl.href;
    var targetPath = targetHref.split('?')[0];
    var currentPath = pathname();

    // 同页面 my.html 内部切换 → 只更新 ?tab= 并派发事件
    if (currentPath === '/my.html' && targetPath === '/my.html') {
      var params = new URLSearchParams(targetHref);
      var tab = params.get('tab') || 'profile';
      // 更新 URL（不刷新）
      var newUrl = location.pathname + '?tab=' + encodeURIComponent(tab) +
                   (location.hash || '');
      try { history.pushState({}, '', newUrl); } catch (_) {}
      // 派发事件
      try {
        window.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: tab } }));
      } catch (_) {}
      // 更新高亮
      updateActive(tabEl);
      return;
    }

    // 其他情况直接跳转
    location.href = targetHref;
  }

  function updateActive(clicked) {
    var bar = document.querySelector('.bottom-tab-bar');
    if (!bar) return;
    bar.querySelectorAll('.bottom-tab').forEach(function (el) {
      el.classList.toggle('active', el === clicked);
    });
  }

  function init() {
    if (!isMobile()) return;
    if (document.body) {
      buildBar();
    } else {
      document.addEventListener('DOMContentLoaded', buildBar);
    }
  }

  // api.js 未加载时降级为无鉴权 tab（跳过 auth 检查）
  if (typeof ApiClient === 'undefined') {
    // 极端情况：脚本加载顺序错误。直接跳过
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
