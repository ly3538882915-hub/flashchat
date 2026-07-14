/**
 * FlashChat Web V0.2 - 认证页面逻辑（登录/注册）
 * 增加转场动画、错误抖动动画、标签滑动指示器
 */

(function () {
  'use strict';

  // 如果已登录，直接跳转聊天页
  const token = localStorage.getItem('fc_token');
  const userStr = localStorage.getItem('fc_user');
  if (token && userStr) {
    window.location.href = '/chat.html';
    return;
  }

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabs = document.querySelectorAll('.auth-tab');
  const tabIndicator = document.getElementById('tab-indicator');

  // 标签切换 — 带滑动指示器动画
  function moveTabIndicator(activeTab) {
    if (!activeTab || !tabIndicator) return;
    const parent = activeTab.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    tabIndicator.style.width = tabRect.width + 'px';
    tabIndicator.style.transform = `translateX(${tabRect.left - parentRect.left}px)`;
  }

  // 初始化指示器位置
  function initTabIndicator() {
    const activeTab = document.querySelector('.auth-tab.active');
    moveTabIndicator(activeTab);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      moveTabIndicator(tab);

      if (target === 'login') {
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
      } else {
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
      }
    });
  });

  // 窗口大小变化时重新定位指示器
  window.addEventListener('resize', initTabIndicator);

  // 错误提示 — 带抖动动画
  function showError(elId, message) {
    const el = document.getElementById(elId);
    el.textContent = message || '';
    if (message) {
      el.classList.remove('shake');
      // 触发重排以重启动画
      void el.offsetWidth;
      el.classList.add('shake');
    }
  }

  // 转场动画 — 成功后淡出再跳转
  function transitionToChat() {
    const card = document.querySelector('.auth-card');
    const body = document.body;
    body.classList.add('page-transition-out');
    if (card) {
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
    }
    setTimeout(() => {
      window.location.href = '/chat.html';
    }, 300);
  }

  // 登录提交
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('login-error', '');

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
      showError('login-error', '请填写用户名和密码');
      return;
    }

    const submitBtn = loginForm.querySelector('.auth-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    submitBtn.disabled = true;
    btnText.textContent = '登录中...';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError('login-error', data.error || '登录失败');
        submitBtn.disabled = false;
        btnText.textContent = '登录';
        return;
      }

      // 保存登录信息
      localStorage.setItem('fc_token', data.token);
      localStorage.setItem('fc_user', JSON.stringify(data.user));

      // 转场动画后跳转
      transitionToChat();
    } catch (err) {
      showError('login-error', '网络错误，请重试');
      submitBtn.disabled = false;
      btnText.textContent = '登录';
    }
  });

  // 注册提交
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('register-error', '');

    const username = document.getElementById('reg-username').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!username || !nickname || !password) {
      showError('register-error', '请填写所有字段');
      return;
    }

    const submitBtn = registerForm.querySelector('.auth-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    submitBtn.disabled = true;
    btnText.textContent = '注册中...';

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, nickname }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError('register-error', data.error || '注册失败');
        submitBtn.disabled = false;
        btnText.textContent = '注册';
        return;
      }

      // 注册成功，自动登录
      localStorage.setItem('fc_token', data.token);
      localStorage.setItem('fc_user', JSON.stringify(data.user));

      // 转场动画后跳转
      transitionToChat();
    } catch (err) {
      showError('register-error', '网络错误，请重试');
      submitBtn.disabled = false;
      btnText.textContent = '注册';
    }
  });

  // 回车键提交
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginForm.requestSubmit();
  });

  // 初始化标签指示器
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabIndicator);
  } else {
    initTabIndicator();
  }
})();
