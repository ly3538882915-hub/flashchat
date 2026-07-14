/**
 * FlashChat Web V0.2 - 聊天主界面逻辑
 * Socket.IO 连接、消息收发、会话管理、UI 交互
 * V0.2 新增：emoji 面板、滚动到底部按钮、消息分组、已读回执、发送按钮图标切换、staggered 动画
 */

(function () {
  'use strict';

  // ============================================================
  // 认证检查
  // ============================================================
  const token = localStorage.getItem('fc_token');
  const userStr = localStorage.getItem('fc_user');
  if (!token || !userStr) {
    window.location.href = '/index.html';
    return;
  }

  let currentUser = null;
  try {
    currentUser = JSON.parse(userStr);
  } catch (e) {
    localStorage.removeItem('fc_token');
    localStorage.removeItem('fc_user');
    window.location.href = '/index.html';
    return;
  }

  // ============================================================
  // 常用 Emoji 数据（50+，纯 JS 实现，不依赖外部库）
  // ============================================================
  const EMOJIS = [
    '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆',
    '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗',
    '🤗', '🤩', '🤔', '🤨', '😐', '😑', '😶', '🙄',
    '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫',
    '🥱', '😴', '😌', '😛', '😜', '😝', '🤤', '😒',
    '😓', '😔', '😕', '🙃', '🤑', '😲', '☹️', '🙁',
    '😖', '😞', '😟', '😤', '😢', '😭', '😦', '😧',
    '😨', '😩', '🤯', '😬', '😰', '😱', '🥳', '🥺',
    '😎', '🤓', '🧐', '😢', '👍', '👎', '👌', '✌️',
    '🤞', '🤟', '🤘', '👏', '🙌', '👐', '🤲', '🙏',
    '💪', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
    '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗',
    '💖', '💘', '💝', '🔥', '⭐', '🌟', '✨', '⚡',
  ];

  // ============================================================
  // 全局状态
  // ============================================================
  const state = {
    socket: null,
    conversations: [],         // 会话列表
    currentConvId: null,       // 当前打开的会话
    currentConv: null,         // 当前会话详情
    messages: [],              // 当前会话的消息列表
    hasMoreMessages: false,    // 是否还有更多历史消息
    oldestMessageAt: null,     // 当前最旧消息的时间戳（分页游标）
    selectedGroupMembers: [],  // 创建群聊时选中的成员
    typingTimers: new Map(),   // 正在输入的计时器
    isTyping: false,           // 自己是否正在输入
    searchTimer: null,         // 搜索防抖
    memberCache: new Map(),    // 用户信息缓存 userId -> user
    presenceCache: new Map(),  // 在线状态缓存 userId -> boolean
    unreadScrollCount: 0,      // 滚动离开后新增的未读消息数
    readMessages: new Set(),   // 已读消息 ID 集合（用于 ✓✓ 回执）
    convItemDelay: 0,          // staggered 动画延迟计数器
  };

  // ============================================================
  // DOM 元素引用
  // ============================================================
  const el = {
    convList: document.getElementById('conversation-list'),
    searchInput: document.getElementById('search-input'),
    myAvatar: document.getElementById('my-avatar'),
    myNickname: document.getElementById('my-nickname'),
    chatEmpty: document.getElementById('chat-empty'),
    chatContent: document.getElementById('chat-content'),
    chatHeader: document.getElementById('chat-header'),
    headerAvatar: document.getElementById('header-avatar'),
    headerName: document.getElementById('header-name'),
    headerStatus: document.getElementById('header-status'),
    messagesArea: document.getElementById('messages-area'),
    messagesList: document.getElementById('messages-list'),
    loadMoreWrapper: document.getElementById('load-more-wrapper'),
    loadMoreBtn: document.getElementById('load-more-btn'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    backBtn: document.getElementById('back-btn'),
    newChatBtn: document.getElementById('new-chat-btn'),
    menuBtn: document.getElementById('menu-btn'),
    typingIndicator: document.getElementById('typing-indicator'),
    // 滚动到底部按钮
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
    scrollBottomBadge: document.getElementById('scroll-bottom-badge'),
    // Emoji 面板
    emojiBtn: document.getElementById('emoji-btn'),
    emojiPanel: document.getElementById('emoji-panel'),
    emojiGrid: document.getElementById('emoji-grid'),
    // 附件按钮（占位）
    attachBtn: document.getElementById('attach-btn'),
    // 弹窗
    newChatModal: document.getElementById('new-chat-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    userSearchInput: document.getElementById('user-search-input'),
    userSearchResults: document.getElementById('user-search-results'),
    groupMemberSearch: document.getElementById('group-member-search'),
    groupSearchResults: document.getElementById('group-search-results'),
    groupNameInput: document.getElementById('group-name-input'),
    selectedMembers: document.getElementById('selected-members'),
    createGroupBtn: document.getElementById('create-group-btn'),
    modalTabIndicator: document.getElementById('modal-tab-indicator'),
    // 设置
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    settingsNickname: document.getElementById('settings-nickname'),
    saveProfileBtn: document.getElementById('save-profile-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    logoutIconBtn: document.getElementById('logout-icon-btn'),
    // Toast
    toastContainer: document.getElementById('toast-container'),
  };

  // ============================================================
  // 工具函数
  // ============================================================

  /** 获取认证请求头 */
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  /** 统一 fetch 封装，自动处理 401 */
  async function apiFetch(url, options) {
    const res = await fetch(url, {
      ...options,
      headers: { ...authHeaders(), ...(options && options.headers) },
    });
    if (res.status === 401) {
      localStorage.removeItem('fc_token');
      localStorage.removeItem('fc_user');
      window.location.href = '/index.html';
      throw new Error('认证已过期');
    }
    return res;
  }

  /** 获取姓名首字母（用于头像） */
  function getInitial(name) {
    if (!name) return '?';
    const trimmed = name.trim();
    if (trimmed.length === 0) return '?';
    return trimmed.charAt(0).toUpperCase();
  }

  /** 格式化时间显示 */
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const sameDay = d.toDateString() === now.toDateString();

    if (sameDay) {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return '昨天';
    }
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return days[d.getDay()];
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  /** 格式化消息内时间 */
  function formatMessageTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  /** 格式化日期分隔条 */
  function formatDateSeparator(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return '今天';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return '昨天';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /** 判断两个日期是否同一天 */
  function isSameDay(iso1, iso2) {
    if (!iso1 || !iso2) return false;
    return new Date(iso1).toDateString() === new Date(iso2).toDateString();
  }

  /** 显示 Toast 通知 */
  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type || ''}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /** HTML 转义，防止 XSS */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** 涟漪效果 */
  function addRipple(e) {
    const btn = e.currentTarget;
    const ripple = document.createElement('span');
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = e.clientX - rect.left - size / 2 + 'px';
    ripple.style.top = e.clientY - rect.top - size / 2 + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }

  /** 创建头像元素 */
  function createAvatar(name, color, size) {
    const avatar = document.createElement('div');
    avatar.className = 'avatar' + (size ? ' ' + size : '');
    avatar.style.background = color || '#2AABEE';
    avatar.textContent = getInitial(name);
    return avatar;
  }

  /**
   * 判断消息分组状态
   * 同一个发送者连续发的消息，第一条有尾巴，中间的没有尾巴，最后一条有尾巴
   * @param {Object} msg - 当前消息
   * @param {Object} prevMsg - 上一条消息
   * @param {Object} nextMsg - 下一条消息
   * @returns {Object} { grouped, firstInGroup, lastInGroup }
   */
  function getMessageGroupState(msg, prevMsg, nextMsg) {
    const sameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId;
    const sameSenderAsNext = nextMsg && nextMsg.senderId === msg.senderId;

    // 如果和前一条是同一发送者，则属于分组
    const grouped = sameSenderAsPrev;
    // 分组的第一条（前一条不是同一发送者，但下一条是）
    const firstInGroup = !sameSenderAsPrev && sameSenderAsNext;
    // 分组的最后一条（前一条是同一发送者，但下一条不是）
    const lastInGroup = sameSenderAsPrev && !sameSenderAsNext;
    // 单条消息（前后都不是同一发送者）
    const single = !sameSenderAsPrev && !sameSenderAsNext;

    return {
      grouped: grouped,
      firstInGroup: firstInGroup || single, // 单条消息也有尾巴
      lastInGroup: lastInGroup || single,   // 单条消息也有尾巴
    };
  }

  // ============================================================
  // Socket.IO 连接
  // ============================================================
  function connectSocket() {
    state.socket = io({
      auth: { token: token },
    });

    state.socket.on('connect', () => {
      console.log('Socket.IO 已连接');
    });

    state.socket.on('connect_error', (err) => {
      console.error('Socket.IO 连接错误:', err.message);
      if (err.message === '认证令牌无效' || err.message === '未提供认证令牌') {
        localStorage.removeItem('fc_token');
        localStorage.removeItem('fc_user');
        window.location.href = '/index.html';
      }
    });

    // 接收新消息
    state.socket.on('new_message', (message) => {
      handleNewMessage(message);
    });

    // 会话更新（未读数等）
    state.socket.on('conversation_updated', (data) => {
      handleConversationUpdated(data);
    });

    // 在线状态变更
    state.socket.on('presence_update', (data) => {
      handlePresenceUpdate(data);
    });

    // 正在输入
    state.socket.on('typing', (data) => {
      if (data.conversationId === state.currentConvId && data.userId !== currentUser.id) {
        showTypingIndicator(data.nickname);
      }
    });

    // 停止输入
    state.socket.on('stop_typing', (data) => {
      if (data.conversationId === state.currentConvId) {
        hideTypingIndicator();
      }
    });

    // V0.2 新增：消息已读回执（对方打开会话时收到）
    state.socket.on('message_read', (data) => {
      handleMessageRead(data);
    });
  }

  // ============================================================
  // 会话列表管理
  // ============================================================

  /** 加载会话列表 */
  async function loadConversations() {
    try {
      const res = await apiFetch('/api/conversations');
      const data = await res.json();
      state.conversations = data.conversations || [];
      state.convItemDelay = 0; // 重置 staggered 延迟
      renderConversationList();
    } catch (err) {
      console.error('加载会话列表失败:', err);
      showToast('加载会话列表失败', 'error');
    }
  }

  /** 渲染会话列表（含 staggered 入场动画） */
  function renderConversationList() {
    const filterText = el.searchInput.value.trim().toLowerCase();
    el.convList.innerHTML = '';

    const filtered = state.conversations.filter((c) => {
      if (!filterText) return true;
      return (c.name || '').toLowerCase().includes(filterText);
    });

    if (filtered.length === 0) {
      el.convList.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:14px;">暂无会话</div>';
      return;
    }

    filtered.forEach((conv, index) => {
      const item = createConversationItem(conv);
      // staggered 入场动画：每项延迟 30ms
      item.style.animationDelay = (index * 30) + 'ms';
      el.convList.appendChild(item);
    });
  }

  /** 创建会话列表项 */
  function createConversationItem(conv) {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (conv.id === state.currentConvId) item.classList.add('active');
    item.dataset.convId = conv.id;

    const avatar = createAvatar(conv.name, conv.avatarColor);
    item.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'conv-item-body';

    const top = document.createElement('div');
    top.className = 'conv-item-top';

    const name = document.createElement('div');
    name.className = 'conv-item-name';
    name.textContent = conv.name || '(未命名)';
    top.appendChild(name);

    const time = document.createElement('div');
    time.className = 'conv-item-time';
    time.textContent = conv.lastMessage ? formatTime(conv.lastMessage.createdAt) : '';
    top.appendChild(time);

    body.appendChild(top);

    const bottom = document.createElement('div');
    bottom.className = 'conv-item-bottom';

    const lastMsg = document.createElement('div');
    lastMsg.className = 'conv-item-last';
    if (conv.lastMessage) {
      const prefix = conv.lastMessage.senderId === currentUser.id ? '你: ' : '';
      lastMsg.textContent = prefix + conv.lastMessage.content;
    } else {
      lastMsg.textContent = '暂无消息';
    }
    bottom.appendChild(lastMsg);

    if (conv.unreadCount > 0) {
      const badge = document.createElement('div');
      badge.className = 'unread-badge';
      badge.textContent = conv.unreadCount > 99 ? '99+' : conv.unreadCount;
      bottom.appendChild(badge);
    }

    body.appendChild(bottom);
    item.appendChild(body);

    item.addEventListener('click', () => {
      openConversation(conv.id);
    });

    return item;
  }

  /** 更新会话列表中的某一项（新消息/未读变更后） */
  function updateConversationInList(convId, updates) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) {
      loadConversations();
      return;
    }
    if (updates.lastMessage) {
      conv.lastMessage = updates.lastMessage;
    }
    if (typeof updates.unreadCount === 'number') {
      conv.unreadCount = updates.unreadCount;
    }
    renderConversationList();
  }

  // ============================================================
  // 打开会话 & 加载消息
  // ============================================================

  async function openConversation(convId) {
    state.currentConvId = convId;
    state.messages = [];
    state.oldestMessageAt = null;
    state.hasMoreMessages = false;
    state.unreadScrollCount = 0; // 重置滚动未读计数

    // 标记已读（触发服务端 message_read 事件给对方）
    state.socket.emit('mark_read', { conversationId: convId });

    // 清除未读数
    const conv = state.conversations.find((c) => c.id === convId);
    if (conv) {
      conv.unreadCount = 0;
    }

    // 显示聊天区域
    el.chatEmpty.style.display = 'none';
    el.chatContent.style.display = 'flex';
    el.chatContent.classList.add('mobile-show');

    // 隐藏滚动到底部按钮
    hideScrollBottomBtn();

    // 更新会话列表高亮
    renderConversationList();

    // 加载会话详情和消息
    await loadConversationInfo(convId);
    await loadMessages(convId);

    el.messageInput.focus();
    updateSendBtnIcon();
  }

  /** 加载会话详情（标题、在线状态等） */
  async function loadConversationInfo(convId) {
    try {
      const conv = state.conversations.find((c) => c.id === convId);
      state.currentConv = conv;

      if (conv) {
        el.headerName.textContent = conv.name || '(未命名)';
        el.headerAvatar.style.background = conv.avatarColor || '#2AABEE';
        el.headerAvatar.textContent = getInitial(conv.name);
      }

      const res = await apiFetch(`/api/conversations/${convId}/members`);
      if (res.ok) {
        const data = await res.json();
        const members = data.members || [];

        members.forEach((m) => {
          state.memberCache.set(m.id, m);
          state.presenceCache.set(m.id, m.online);
        });

        updateHeaderStatus(conv, members);
      }
    } catch (err) {
      console.error('加载会话信息失败:', err);
    }
  }

  /** 更新头部在线状态 */
  function updateHeaderStatus(conv, members) {
    if (!conv) return;
    if (conv.type === 'private') {
      const other = members.find((m) => m.id !== currentUser.id);
      if (other) {
        el.headerStatus.textContent = other.online ? '在线' : '离线';
        el.headerStatus.className = 'header-status' + (other.online ? ' online' : '');
      }
    } else {
      const onlineCount = members.filter((m) => m.online).length;
      el.headerStatus.textContent = `${members.length} 位成员，${onlineCount} 人在线`;
      el.headerStatus.className = 'header-status';
    }
  }

  /** 加载消息（首次或分页） */
  async function loadMessages(convId, before) {
    try {
      let url = `/api/conversations/${convId}/messages?limit=20`;
      if (before) {
        url += `&before=${encodeURIComponent(before)}`;
      }
      const res = await apiFetch(url);
      const data = await res.json();

      const newMessages = data.messages || [];
      state.hasMoreMessages = !!data.hasMore;

      if (before) {
        state.messages = newMessages.concat(state.messages);
      } else {
        state.messages = newMessages;
      }

      if (state.messages.length > 0) {
        state.oldestMessageAt = state.messages[0].createdAt;
      }

      renderMessages(before ? 'prepend' : 'replace');
    } catch (err) {
      console.error('加载消息失败:', err);
      showToast('加载消息失败', 'error');
    }
  }

  /** 渲染消息列表 */
  function renderMessages(mode) {
    if (mode === 'prepend') {
      const scrollHeightBefore = el.messagesArea.scrollHeight;
      const scrollTopBefore = el.messagesArea.scrollTop;

      el.messagesList.innerHTML = '';
      renderAllMessages();

      const scrollHeightAfter = el.messagesArea.scrollHeight;
      el.messagesArea.scrollTop = scrollTopBefore + (scrollHeightAfter - scrollHeightBefore);
    } else {
      el.messagesList.innerHTML = '';
      renderAllMessages();
      // 滚动到底部
      el.messagesArea.scrollTop = el.messagesArea.scrollHeight;
    }

    el.loadMoreWrapper.style.display = state.hasMoreMessages ? 'block' : 'none';
  }

  /** 渲染全部消息（含日期分隔 + 消息分组） */
  function renderAllMessages() {
    let lastDate = null;
    state.messages.forEach((msg, index) => {
      // 日期分隔条
      if (!isSameDay(msg.createdAt, lastDate)) {
        const sep = document.createElement('div');
        sep.className = 'date-separator';
        sep.dataset.date = msg.createdAt;
        const span = document.createElement('span');
        span.textContent = formatDateSeparator(msg.createdAt);
        sep.appendChild(span);
        el.messagesList.appendChild(sep);
        lastDate = msg.createdAt;
      }

      // 获取前后消息用于分组判断
      const prevMsg = index > 0 ? state.messages[index - 1] : null;
      const nextMsg = index < state.messages.length - 1 ? state.messages[index + 1] : null;

      const msgEl = createMessageElement(msg, prevMsg, nextMsg);
      el.messagesList.appendChild(msgEl);
    });
  }

  /** 创建单个消息元素（含分组逻辑和已读回执） */
  function createMessageElement(msg, prevMsg, nextMsg) {
    const isOut = msg.senderId === currentUser.id;
    const row = document.createElement('div');
    row.className = 'message-row ' + (isOut ? 'out' : 'in');
    row.dataset.msgId = msg.id;

    // 消息分组逻辑
    const groupState = getMessageGroupState(msg, prevMsg, nextMsg);
    if (groupState.grouped) {
      row.classList.add('grouped');
    }
    if (groupState.firstInGroup) {
      row.classList.add('first-in-group');
    }
    if (groupState.lastInGroup) {
      row.classList.add('last-in-group');
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // 群聊中显示发送者昵称（仅分组第一条显示）
    if (!isOut && state.currentConv && state.currentConv.type === 'group' && !groupState.grouped) {
      const senderName = document.createElement('div');
      senderName.className = 'message-sender';
      const sender = msg.sender || state.memberCache.get(msg.senderId);
      senderName.textContent = sender ? sender.nickname : '未知用户';
      bubble.appendChild(senderName);
    }

    // 消息内容
    const content = document.createElement('span');
    content.className = 'message-content';
    content.innerHTML = escapeHtml(msg.content).replace(/\n/g, '<br>');
    bubble.appendChild(content);

    // 时间戳 + 已读回执（在气泡内右下角）
    const meta = document.createElement('span');
    meta.className = 'message-meta';

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatMessageTime(msg.createdAt);
    meta.appendChild(time);

    // 发送方消息显示已读回执 ✓ 或 ✓✓
    if (isOut) {
      const tick = document.createElement('span');
      tick.className = 'message-tick';
      // 检查是否已读
      if (state.readMessages.has(msg.id)) {
        tick.classList.add('read');
        tick.innerHTML = '&#10003;&#10003;'; // ✓✓
      } else {
        tick.innerHTML = '&#10003;'; // ✓
      }
      meta.appendChild(tick);
    }

    bubble.appendChild(meta);

    row.appendChild(bubble);
    return row;
  }

  /** 处理新消息（来自 Socket.IO） */
  function handleNewMessage(message) {
    if (message.conversationId === state.currentConvId) {
      state.messages.push(message);
      const prevMsg = state.messages.length >= 2 ? state.messages[state.messages.length - 2] : null;
      const msgEl = createMessageElement(message, prevMsg, null);
      el.messagesList.appendChild(msgEl);

      // 判断用户是否在底部附近
      const isNearBottom =
        el.messagesArea.scrollHeight - el.messagesArea.scrollTop - el.messagesArea.clientHeight < 100;

      if (isNearBottom) {
        // 平滑滚动到底部
        el.messagesArea.scrollTo({
          top: el.messagesArea.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        // 用户不在底部，增加滚动未读计数并显示按钮
        state.unreadScrollCount++;
        showScrollBottomBtn(state.unreadScrollCount);
      }

      // 标记已读（当前会话）
      state.socket.emit('mark_read', { conversationId: state.currentConvId });
    } else {
      // 非当前会话，更新未读数
      const conv = state.conversations.find((c) => c.id === message.conversationId);
      if (conv) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
        conv.lastMessage = {
          content: message.content,
          senderId: message.senderId,
          createdAt: message.createdAt,
        };
        renderConversationList();
      }
    }

    updateConversationLastMessage(message);
  }

  /** 更新会话列表最后一条消息 */
  function updateConversationLastMessage(message) {
    const conv = state.conversations.find((c) => c.id === message.conversationId);
    if (!conv) {
      loadConversations();
      return;
    }
    conv.lastMessage = {
      content: message.content,
      senderId: message.senderId,
      createdAt: message.createdAt,
    };
    // 重新排序：把该会话移到最前
    state.conversations = state.conversations.filter((c) => c.id !== conv.id);
    state.conversations.unshift(conv);
    renderConversationList();
  }

  /** 处理会话更新事件（未读数等） */
  function handleConversationUpdated(data) {
    const conv = state.conversations.find((c) => c.id === data.conversationId);
    if (!conv) {
      loadConversations();
      return;
    }
    if (data.lastMessage) {
      conv.lastMessage = data.lastMessage;
    }
    if (typeof data.unreadCount === 'number') {
      conv.unreadCount = data.unreadCount;
    }
    renderConversationList();
  }

  /** 处理在线状态更新 */
  function handlePresenceUpdate(data) {
    state.presenceCache.set(data.userId, data.online);
    const member = state.memberCache.get(data.userId);
    if (member) {
      member.online = data.online;
    }

    if (state.currentConv && state.currentConv.type === 'private') {
      const members = Array.from(state.memberCache.values()).filter((m) => {
        return state.currentConv.members && state.currentConv.members.includes(m.id);
      });
      if (members.length > 0) {
        updateHeaderStatus(state.currentConv, members);
      }
    }

    refreshSearchResultsPresence();
  }

  /** 刷新搜索结果中的在线标记 */
  function refreshSearchResultsPresence() {
    document.querySelectorAll('.user-result-item').forEach((item) => {
      const userId = item.dataset.userId;
      const online = state.presenceCache.get(userId);
      const statusEl = item.querySelector('.user-result-status');
      if (statusEl) {
        statusEl.textContent = online ? '在线' : '离线';
        statusEl.style.color = online ? '#4caf50' : 'var(--text-tertiary)';
      }
    });
  }

  /**
   * V0.2 新增：处理消息已读回执
   * 收到对方 mark_read 时，将自己发送的消息 ✓ 变为 ✓✓
   */
  function handleMessageRead(data) {
    if (!data || !data.conversationId) return;

    if (data.allRead) {
      // 对方打开了整个会话，所有自己发的消息标记为已读
      state.messages.forEach((msg) => {
        if (msg.senderId === currentUser.id && msg.conversationId === data.conversationId) {
          state.readMessages.add(msg.id);
        }
      });
    } else if (data.messageIds && data.messageIds.length > 0) {
      // 特定消息已读
      data.messageIds.forEach((id) => state.readMessages.add(id));
    }

    // 更新 DOM 中的已读回执（仅更新当前可见的消息）
    updateMessageTicks();
  }

  /** 更新所有消息的已读回执图标 */
  function updateMessageTicks() {
    document.querySelectorAll('.message-row.out').forEach((row) => {
      const msgId = row.dataset.msgId;
      const tick = row.querySelector('.message-tick');
      if (!tick) return;
      if (state.readMessages.has(msgId)) {
        tick.classList.add('read');
        tick.innerHTML = '&#10003;&#10003;';
      } else {
        tick.classList.remove('read');
        tick.innerHTML = '&#10003;';
      }
    });
  }

  // ============================================================
  // 发送消息
  // ============================================================
  function sendMessage() {
    const content = el.messageInput.value.trim();
    if (!content || !state.currentConvId) return;

    el.messageInput.value = '';
    autoResizeTextarea();
    stopTyping();
    updateSendBtnIcon(); // 输入框清空后切换回麦克风图标

    state.socket.emit(
      'send_message',
      { conversationId: state.currentConvId, content },
      (response) => {
        if (response && response.error) {
          showToast(response.error, 'error');
          el.messageInput.value = content;
          autoResizeTextarea();
          updateSendBtnIcon();
        } else if (response && response.ok) {
          if (response.message) {
            const exists = document.querySelector(`[data-msg-id="${response.message.id}"]`);
            if (!exists) {
              handleNewMessage(response.message);
            }
          }
        }
      }
    );
  }

  // ============================================================
  // 正在输入
  // ============================================================
  let typingTimeout = null;

  function startTyping() {
    if (!state.currentConvId) return;
    if (!state.isTyping) {
      state.isTyping = true;
      state.socket.emit('typing', { conversationId: state.currentConvId });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      stopTyping();
    }, 3000);
  }

  function stopTyping() {
    if (state.isTyping) {
      state.isTyping = false;
      state.socket.emit('stop_typing', { conversationId: state.currentConvId });
    }
    clearTimeout(typingTimeout);
  }

  function showTypingIndicator(nickname) {
    el.typingIndicator.style.display = 'flex';
    el.typingIndicator.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = `${nickname} 正在输入`;
    const dots = document.createElement('span');
    dots.className = 'typing-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';
    el.typingIndicator.appendChild(text);
    el.typingIndicator.appendChild(dots);

    clearTimeout(state.typingTimers.get('display'));
    state.typingTimers.set(
      'display',
      setTimeout(() => {
        hideTypingIndicator();
      }, 3000)
    );
  }

  function hideTypingIndicator() {
    el.typingIndicator.style.display = 'none';
  }

  // ============================================================
  // 文本框自适应高度
  // ============================================================
  function autoResizeTextarea() {
    el.messageInput.style.height = 'auto';
    el.messageInput.style.height = Math.min(el.messageInput.scrollHeight, 120) + 'px';
  }

  // ============================================================
  // V0.2 新增：发送按钮图标切换（麦克风 ↔ 发送箭头）
  // ============================================================
  function updateSendBtnIcon() {
    const hasContent = el.messageInput.value.trim().length > 0;
    if (hasContent) {
      el.sendBtn.classList.add('has-content');
    } else {
      el.sendBtn.classList.remove('has-content');
    }
  }

  // ============================================================
  // V0.2 新增：Emoji 面板
  // ============================================================

  /** 初始化 Emoji 面板 */
  function initEmojiPanel() {
    el.emojiGrid.innerHTML = '';
    EMOJIS.forEach((emoji) => {
      const item = document.createElement('span');
      item.className = 'emoji-item';
      item.textContent = emoji;
      item.addEventListener('click', () => {
        insertEmoji(emoji);
      });
      el.emojiGrid.appendChild(item);
    });
  }

  /** 插入 emoji 到输入框 */
  function insertEmoji(emoji) {
    const input = el.messageInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
    input.value = text.slice(0, start) + emoji + text.slice(end);
    // 移动光标到插入点之后
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    autoResizeTextarea();
    updateSendBtnIcon();
    startTyping();
  }

  /** 切换 Emoji 面板显示 */
  function toggleEmojiPanel() {
    if (el.emojiPanel.style.display === 'none' || !el.emojiPanel.style.display) {
      el.emojiPanel.style.display = 'block';
      el.emojiBtn.classList.add('active');
    } else {
      el.emojiPanel.style.display = 'none';
      el.emojiBtn.classList.remove('active');
    }
  }

  /** 关闭 Emoji 面板 */
  function closeEmojiPanel() {
    el.emojiPanel.style.display = 'none';
    el.emojiBtn.classList.remove('active');
  }

  // ============================================================
  // V0.2 新增：滚动到底部按钮
  // ============================================================

  /** 显示滚动到底部按钮（带未读数角标） */
  function showScrollBottomBtn(count) {
    el.scrollBottomBtn.style.display = 'flex';
    if (count && count > 0) {
      el.scrollBottomBadge.textContent = count > 99 ? '99+' : count;
      el.scrollBottomBadge.style.display = 'flex';
    } else {
      el.scrollBottomBadge.style.display = 'none';
    }
  }

  /** 隐藏滚动到底部按钮 */
  function hideScrollBottomBtn() {
    el.scrollBottomBtn.style.display = 'none';
    el.scrollBottomBadge.style.display = 'none';
    state.unreadScrollCount = 0;
  }

  /** 滚动到底部 */
  function scrollToBottom() {
    el.messagesArea.scrollTo({
      top: el.messagesArea.scrollHeight,
      behavior: 'smooth',
    });
    hideScrollBottomBtn();
  }

  /** 监听消息区域滚动 */
  function handleMessagesScroll() {
    if (!state.currentConvId) return;

    const isNearBottom =
      el.messagesArea.scrollHeight - el.messagesArea.scrollTop - el.messagesArea.clientHeight < 100;

    if (isNearBottom) {
      // 接近底部时隐藏按钮并重置计数
      if (el.scrollBottomBtn.style.display !== 'none') {
        hideScrollBottomBtn();
      }
    } else {
      // 不在底部时显示按钮（无未读数角标）
      if (el.scrollBottomBtn.style.display === 'none') {
        showScrollBottomBtn(0);
        el.scrollBottomBadge.style.display = 'none';
      }
    }
  }

  // ============================================================
  // 搜索用户
  // ============================================================
  async function searchUsers(query, resultsContainer, onClickCallback) {
    if (!query.trim()) {
      resultsContainer.innerHTML = '<p class="modal-hint">输入关键词搜索用户</p>';
      return;
    }

    try {
      const res = await apiFetch(`/api/users/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      const users = data.users || [];

      if (users.length === 0) {
        resultsContainer.innerHTML = '<p class="modal-hint">未找到用户</p>';
        return;
      }

      resultsContainer.innerHTML = '';
      users.forEach((user) => {
        state.memberCache.set(user.id, user);
        state.presenceCache.set(user.id, user.online);

        const item = document.createElement('div');
        item.className = 'user-result-item';
        item.dataset.userId = user.id;

        const avatar = createAvatar(user.nickname, user.avatarColor, 'sm');
        item.appendChild(avatar);

        const info = document.createElement('div');
        info.className = 'user-result-info';

        const name = document.createElement('div');
        name.className = 'user-result-name';
        name.textContent = user.nickname;
        info.appendChild(name);

        const username = document.createElement('div');
        username.className = 'user-result-username';
        username.textContent = '@' + user.username;
        info.appendChild(username);

        const status = document.createElement('div');
        status.className = 'user-result-status';
        status.textContent = user.online ? '在线' : '离线';
        status.style.color = user.online ? '#4caf50' : 'var(--text-tertiary)';
        info.appendChild(status);

        item.appendChild(info);
        item.addEventListener('click', () => onClickCallback(user, item));
        resultsContainer.appendChild(item);
      });
    } catch (err) {
      console.error('搜索用户失败:', err);
      resultsContainer.innerHTML = '<p class="modal-hint">搜索失败，请重试</p>';
    }
  }

  /** 私聊搜索回调 */
  function startPrivateChat(user) {
    createPrivateConversation(user.id);
    closeNewChatModal();
  }

  /** 创建私聊会话 */
  async function createPrivateConversation(targetUserId) {
    try {
      const res = await apiFetch('/api/conversations/private', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '创建会话失败', 'error');
        return;
      }

      const existing = state.conversations.find((c) => c.id === data.conversation.id);
      if (!existing) {
        state.conversations.unshift(data.conversation);
      }
      await loadConversations();
      openConversation(data.conversation.id);
    } catch (err) {
      console.error('创建私聊失败:', err);
      showToast('创建私聊失败', 'error');
    }
  }

  /** 群聊成员搜索回调 */
  function toggleGroupMember(user) {
    const idx = state.selectedGroupMembers.findIndex((m) => m.id === user.id);
    if (idx >= 0) {
      state.selectedGroupMembers.splice(idx, 1);
    } else {
      state.selectedGroupMembers.push(user);
    }
    renderSelectedMembers();
  }

  /** 渲染已选群成员 */
  function renderSelectedMembers() {
    el.selectedMembers.innerHTML = '';
    state.selectedGroupMembers.forEach((user) => {
      const chip = document.createElement('div');
      chip.className = 'selected-member-chip';

      const avatar = createAvatar(user.nickname, user.avatarColor);
      chip.appendChild(avatar);

      const name = document.createElement('span');
      name.textContent = user.nickname;
      chip.appendChild(name);

      const remove = document.createElement('span');
      remove.className = 'chip-remove';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        toggleGroupMember(user);
      });
      chip.appendChild(remove);

      el.selectedMembers.appendChild(chip);
    });

    el.createGroupBtn.disabled =
      state.selectedGroupMembers.length === 0 || !el.groupNameInput.value.trim();
  }

  /** 创建群聊 */
  async function createGroup() {
    const name = el.groupNameInput.value.trim();
    if (!name || state.selectedGroupMembers.length === 0) {
      showToast('请填写群名并选择成员', 'error');
      return;
    }

    try {
      const memberIds = state.selectedGroupMembers.map((m) => m.id);
      const res = await apiFetch('/api/conversations/group', {
        method: 'POST',
        body: JSON.stringify({ name, memberIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '创建群聊失败', 'error');
        return;
      }

      showToast('群聊创建成功', 'success');
      state.conversations.unshift(data.conversation);
      await loadConversations();
      closeNewChatModal();
      openConversation(data.conversation.id);
    } catch (err) {
      console.error('创建群聊失败:', err);
      showToast('创建群聊失败', 'error');
    }
  }

  // ============================================================
  // 弹窗管理
  // ============================================================
  function openNewChatModal() {
    el.newChatModal.style.display = 'flex';
    el.userSearchInput.value = '';
    el.groupNameInput.value = '';
    el.groupMemberSearch.value = '';
    el.userSearchResults.innerHTML = '<p class="modal-hint">输入关键词搜索用户</p>';
    el.groupSearchResults.innerHTML = '<p class="modal-hint">搜索并选择成员</p>';
    state.selectedGroupMembers = [];
    renderSelectedMembers();
    // 初始化弹窗标签指示器
    setTimeout(() => moveModalTabIndicator(document.querySelector('.modal-tab.active')), 50);
  }

  function closeNewChatModal() {
    el.newChatModal.style.display = 'none';
  }

  function openSettingsModal() {
    el.settingsModal.style.display = 'flex';
    el.settingsNickname.value = currentUser.nickname || '';
  }

  function closeSettingsModal() {
    el.settingsModal.style.display = 'none';
  }

  // 弹窗标签滑动指示器
  function moveModalTabIndicator(activeTab) {
    if (!activeTab || !el.modalTabIndicator) return;
    const wrapper = activeTab.closest('.modal-tabs-wrapper');
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    el.modalTabIndicator.style.width = tabRect.width + 'px';
    el.modalTabIndicator.style.height = tabRect.height + 'px';
    el.modalTabIndicator.style.transform = `translateX(${tabRect.left - wrapperRect.left}px)`;
  }

  // ============================================================
  // 设置
  // ============================================================
  async function saveProfile() {
    const nickname = el.settingsNickname.value.trim();
    if (!nickname) {
      showToast('昵称不能为空', 'error');
      return;
    }

    try {
      const res = await apiFetch('/api/users/profile', {
        method: 'PUT',
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '保存失败', 'error');
        return;
      }

      currentUser = data.user;
      localStorage.setItem('fc_user', JSON.stringify(currentUser));
      updateMyInfo();
      showToast('保存成功', 'success');
      closeSettingsModal();
      loadConversations();
    } catch (err) {
      console.error('保存资料失败:', err);
      showToast('保存失败', 'error');
    }
  }

  function logout() {
    if (state.socket) {
      state.socket.disconnect();
    }
    localStorage.removeItem('fc_token');
    localStorage.removeItem('fc_user');
    window.location.href = '/index.html';
  }

  // ============================================================
  // 更新当前用户信息显示
  // ============================================================
  function updateMyInfo() {
    el.myNickname.textContent = currentUser.nickname || currentUser.username;
    el.myAvatar.style.background = currentUser.avatarColor || '#2AABEE';
    el.myAvatar.textContent = getInitial(currentUser.nickname || currentUser.username);
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents() {
    // 发送消息
    el.sendBtn.addEventListener('click', (e) => {
      addRipple(e);
      sendMessage();
    });

    // 输入框 — 同时更新发送按钮图标
    el.messageInput.addEventListener('input', () => {
      autoResizeTextarea();
      updateSendBtnIcon();
      startTyping();
    });

    el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // 返回按钮（移动端）
    el.backBtn.addEventListener('click', () => {
      el.chatContent.classList.remove('mobile-show');
      state.socket.emit('leave_conversation');
      state.currentConvId = null;
    });

    // 新建聊天
    el.newChatBtn.addEventListener('click', openNewChatModal);
    el.closeModalBtn.addEventListener('click', closeNewChatModal);
    el.newChatModal.addEventListener('click', (e) => {
      if (e.target === el.newChatModal) closeNewChatModal();
    });

    // 弹窗标签切换 — 带滑动指示器
    document.querySelectorAll('.modal-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.mtab;
        document.querySelectorAll('.modal-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        moveModalTabIndicator(tab);
        document.querySelectorAll('.modal-pane').forEach((p) => p.classList.remove('active'));
        document.getElementById('pane-' + target).classList.add('active');
      });
    });

    // 私聊搜索（防抖）
    el.userSearchInput.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        searchUsers(el.userSearchInput.value, el.userSearchResults, startPrivateChat);
      }, 300);
    });

    // 群成员搜索（防抖）
    el.groupMemberSearch.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        searchUsers(el.groupMemberSearch.value, el.groupSearchResults, toggleGroupMember);
      }, 300);
    });

    // 群名输入
    el.groupNameInput.addEventListener('input', renderSelectedMembers);

    // 创建群聊
    el.createGroupBtn.addEventListener('click', createGroup);

    // 菜单按钮（打开设置）
    el.menuBtn.addEventListener('click', openSettingsModal);
    el.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) closeSettingsModal();
    });
    el.saveProfileBtn.addEventListener('click', saveProfile);
    el.logoutBtn.addEventListener('click', logout);
    el.logoutIconBtn.addEventListener('click', logout);

    // 会话列表搜索
    el.searchInput.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(renderConversationList, 200);
    });

    // 加载更多消息
    el.loadMoreBtn.addEventListener('click', () => {
      if (state.oldestMessageAt && state.hasMoreMessages) {
        loadMessages(state.currentConvId, state.oldestMessageAt);
      }
    });

    // V0.2 新增：Emoji 面板开关
    el.emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEmojiPanel();
    });

    // 点击其他区域关闭 Emoji 面板
    document.addEventListener('click', (e) => {
      if (el.emojiPanel.style.display !== 'none') {
        if (!el.emojiPanel.contains(e.target) && e.target !== el.emojiBtn && !el.emojiBtn.contains(e.target)) {
          closeEmojiPanel();
        }
      }
    });

    // V0.2 新增：附件按钮（占位，仅提示）
    el.attachBtn.addEventListener('click', () => {
      showToast('附件功能将在后续版本推出', 'info');
    });

    // V0.2 新增：滚动到底部按钮点击
    el.scrollBottomBtn.addEventListener('click', scrollToBottom);

    // V0.2 新增：监听消息区域滚动
    el.messagesArea.addEventListener('scroll', handleMessagesScroll);

    // 涟漪效果绑定到按钮
    document.querySelectorAll('.btn-primary, .send-btn, .icon-btn').forEach((btn) => {
      btn.addEventListener('click', addRipple);
    });

    // 阻止表单默认提交
    document.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', (e) => e.preventDefault());
    });

    // 窗口大小变化时重新定位弹窗标签指示器
    window.addEventListener('resize', () => {
      const activeTab = document.querySelector('.modal-tab.active');
      if (activeTab && el.newChatModal.style.display !== 'none') {
        moveModalTabIndicator(activeTab);
      }
    });
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    updateMyInfo();
    initEmojiPanel();
    bindEvents();
    connectSocket();
    loadConversations();
    updateSendBtnIcon(); // 初始化发送按钮图标状态
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
