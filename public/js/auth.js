/**
 * FlashChat Web V0.6 - 认证页面逻辑（登录/注册）
 * V0.6 新增：违禁词前端验证、注册后公告弹窗
 */

(function () {
  'use strict';

  // V0.6 新增：违禁词列表（与后端同步）
  const BANNED_WORDS = [
    'sb', 'SB', '傻逼', '傻子', '操你', '草泥马', '日你', 'fuck', 'shit',
    'bitch', 'bastard', '智障', '废物', '滚蛋', '去死', '贱人', '婊子',
    '妈的', '他妈', '你妈', '王八蛋', '混蛋', '畜生', '狗屎', 'crap',
    'dick', 'pussy', 'asshole', 'nigger', '纳粹'
  ];

  function hasBannedWord(text) {
    const lower = text.toLowerCase();
    return BANNED_WORDS.some(w => lower.includes(w.toLowerCase()));
  }

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

    // V0.6 新增：前端违禁词检查
    if (hasBannedWord(username)) {
      showError('register-error', '用户名包含违禁词，请修改');
      return;
    }
    if (hasBannedWord(nickname)) {
      showError('register-error', '昵称包含违禁词，请修改');
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

      // V0.6 新增：注册成功后显示公告弹窗
      const isFreshRegister = true;
      showAnnouncement(isFreshRegister);
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

  // V0.6 新增：显示软件公告弹窗
  async function showAnnouncement() {
    try {
      const res = await fetch('/api/announcement');
      const data = await res.json();

      const modal = document.getElementById('announcement-modal');
      const titleEl = document.getElementById('announcement-title');
      const textEl = document.getElementById('announcement-text');
      const contentEl = document.getElementById('announcement-content');
      const confirmBtn = document.getElementById('announcement-confirm-btn');
      const scrollHint = document.getElementById('announcement-scroll-hint');

      if (titleEl) titleEl.textContent = data.title || '软件公告';
      if (textEl) textEl.textContent = data.content || '';

      if (modal) modal.style.display = 'flex';

      // 监听滚动 - 滚到底部才能点确认
      if (contentEl) {
        contentEl.addEventListener('scroll', function checkScroll() {
          if (contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 5) {
            if (confirmBtn) confirmBtn.disabled = false;
            if (scrollHint) scrollHint.style.display = 'none';
            contentEl.removeEventListener('scroll', checkScroll);
          }
        });
      }

      // 确认按钮 - 转场跳转
      if (confirmBtn) {
        confirmBtn.addEventListener('click', function handler() {
          if (modal) modal.style.display = 'none';
          confirmBtn.removeEventListener('click', handler);
          transitionToChat();
        });
      }
    } catch (err) {
      console.error('获取公告失败:', err);
      // 公告获取失败也允许进入
      transitionToChat();
    }
  }
})();
