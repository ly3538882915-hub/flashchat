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
    // V0.3 新增：好友系统
    friends: [],               // 好友列表
    friendRequests: [],        // 好友请求列表
    activeTab: 'chats',        // 当前侧边栏标签
    // V0.4 新增：音乐系统
    musicList: [],             // 音乐列表
    currentMusic: null,        // 当前播放的音乐
    isPlaying: false,          // 是否正在播放
    isAdmin: false,            // 是否是管理员
    // V0.5 新增：管理员用户管理
    adminUsers: [],            // 管理员视角的用户列表
    // V0.6 新增：邮件和音乐建议
    mails: [],                 // 邮件列表
    unreadMails: 0,            // 未读邮件数
    musicSuggestions: [],      // 音乐建议列表
    // V0.66 新增：群聊信息
    groupInfoConvId: null,     // 当前打开群信息弹窗的会话ID
    groupInfoMembers: [],      // 群成员列表
    inviteSelectedFriends: [], // 邀请弹窗中选中的好友
    inviteConvId: null,        // 当前邀请好友入群的会话ID
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
    // V0.3 新增：好友系统
    friendsPanel: document.getElementById('friends-panel'),
    friendList: document.getElementById('friend-list'),
    friendRequestList: document.getElementById('friend-request-list'),
    friendRequestSection: document.getElementById('friend-requests-section'),
    friendRequestBadge: document.getElementById('friend-request-badge'),
    // V0.4 新增：音乐系统
    musicPanel: document.getElementById('music-panel'),
    musicListEl: document.getElementById('music-list'),
    musicUploadBtn: document.getElementById('music-upload-btn'),
    musicUploadModal: document.getElementById('music-upload-modal'),
    closeMusicUploadBtn: document.getElementById('close-music-upload-btn'),
    musicTitleInput: document.getElementById('music-title-input'),
    musicFileInput: document.getElementById('music-file-input'),
    fileUploadArea: document.getElementById('file-upload-area'),
    fileUploadHint: document.getElementById('file-upload-hint'),
    uploadMusicBtn: document.getElementById('upload-music-btn'),
    musicPlayer: document.getElementById('music-player'),
    playerTitle: document.getElementById('player-title'),
    playerCurrent: document.getElementById('player-current'),
    playerDuration: document.getElementById('player-duration'),
    playerPlayBtn: document.getElementById('player-play-btn'),
    playerPauseBtn: document.getElementById('player-pause-btn'),
    playerProgress: document.getElementById('player-progress'),
    playerProgressBar: document.getElementById('player-progress-bar'),
    audioPlayer: document.getElementById('audio-player'),
    // V0.5 新增：管理员用户管理
    adminPanel: document.getElementById('admin-panel'),
    adminUserList: document.getElementById('admin-user-list'),
    adminTotalCount: document.getElementById('admin-total-count'),
    adminOnlineCount: document.getElementById('admin-online-count'),
    adminRefreshBtn: document.getElementById('admin-refresh-btn'),
    adminTabs: document.querySelectorAll('.admin-only-tab'),
    // V0.6 新增：实时时钟
    clockDisplay: document.getElementById('clock-display'),
    // V0.6 新增：邮件系统
    mailPanel: document.getElementById('mail-panel'),
    mailRecipient: document.getElementById('mail-recipient'),
    mailSubject: document.getElementById('mail-subject'),
    mailContent: document.getElementById('mail-content'),
    sendMailBtn: document.getElementById('send-mail-btn'),
    mailList: document.getElementById('mail-list'),
    mailRefreshBtn: document.getElementById('mail-refresh-btn'),
    mailBadge: document.getElementById('mail-badge'),
    mailViewModal: document.getElementById('mail-view-modal'),
    mailViewSubject: document.getElementById('mail-view-subject'),
    mailViewSender: document.getElementById('mail-view-sender'),
    mailViewTime: document.getElementById('mail-view-time'),
    mailViewContent: document.getElementById('mail-view-content'),
    closeMailViewBtn: document.getElementById('close-mail-view-btn'),
    // V0.6 新增：音乐建议
    suggestionSongName: document.getElementById('suggestion-song-name'),
    suggestionArtist: document.getElementById('suggestion-artist'),
    suggestionNote: document.getElementById('suggestion-note'),
    submitSuggestionBtn: document.getElementById('submit-suggestion-btn'),
    musicSuggestionList: document.getElementById('music-suggestion-list'),
    // V0.6 新增：头像上传
    avatarUploadArea: document.getElementById('avatar-upload-area'),
    avatarUploadPreview: document.getElementById('avatar-upload-preview'),
    avatarFileInput: document.getElementById('avatar-file-input'),
    // V0.66 新增：群信息弹窗
    groupInfoModal: document.getElementById('group-info-modal'),
    closeGroupInfoBtn: document.getElementById('close-group-info-btn'),
    groupInfoName: document.getElementById('group-info-name'),
    groupInfoNotice: document.getElementById('group-info-notice'),
    saveGroupInfoBtn: document.getElementById('save-group-info-btn'),
    groupMemberCount: document.getElementById('group-member-count'),
    groupMemberList: document.getElementById('group-member-list'),
    inviteMemberBtn: document.getElementById('invite-member-btn'),
    leaveGroupBtn: document.getElementById('leave-group-btn'),
    // V0.66 新增：邀请成员弹窗
    inviteModal: document.getElementById('invite-modal'),
    closeInviteBtn: document.getElementById('close-invite-btn'),
    inviteFriendList: document.getElementById('invite-friend-list'),
    confirmInviteBtn: document.getElementById('confirm-invite-btn'),
    // V0.66 新增：info-btn 按钮
    infoBtn: document.getElementById('info-btn'),
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
  function createAvatar(name, color, size, avatarUrl) {
    const avatar = document.createElement('div');
    avatar.className = 'avatar' + (size ? ' ' + size : '');
    if (avatarUrl) {
      avatar.style.backgroundImage = 'url(' + avatarUrl + ')';
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
    } else {
      avatar.style.background = color || '#2AABEE';
      avatar.textContent = getInitial(name);
    }
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

    // V0.3 新增：好友请求通知
    state.socket.on('friend_request', (data) => {
      showToast(data.from.nickname + ' 请求加你为好友', 'info');
      loadFriendRequests();
    });

    // V0.3 新增：好友请求被接受/拒绝
    state.socket.on('friend_request_response', (data) => {
      if (data.status === 'accepted') {
        showToast((data.by ? data.by.nickname : '对方') + ' 接受了你的好友请求', 'success');
        loadFriends();
      } else if (data.status === 'rejected') {
        showToast('你的好友请求被拒绝', 'info');
      }
    });

    // V0.3 新增：好友被删除
    state.socket.on('friend_removed', (data) => {
      loadFriends();
      showToast('一段好友关系已结束', 'info');
    });

    // V0.65 新增：被封禁通知 - 显示覆盖层
    state.socket.on('banned', (data) => {
      var overlay = document.getElementById('banned-overlay');
      var reasonEl = document.getElementById('banned-reason-text');
      if (reasonEl) reasonEl.textContent = data.reason || '违反社区规范';
      if (overlay) overlay.style.display = 'flex';
      setTimeout(function() {
        if (overlay) overlay.style.display = 'none';
        localStorage.removeItem('fc_token');
        localStorage.removeItem('fc_user');
        window.location.href = '/index.html';
      }, 5000);
    });

    // V0.6 新增：被警告通知
    state.socket.on('warned', (data) => {
      showToast('管理员警告：' + data.reason, 'warning');
    });

    // V0.6 新增：新邮件通知
    state.socket.on('new_mail', (data) => {
      showToast('收到新邮件：' + data.subject + '（来自 ' + (data.from ? data.from.nickname : '未知') + '）', 'info');
      loadUnreadMailCount();
      if (state.activeTab === 'mail') {
        loadMails();
      }
    });

    // V0.66 新增：群信息更新通知
    state.socket.on('group_info_updated', (data) => {
      // 更新会话列表中的群名
      const conv = state.conversations.find((c) => c.id === data.conversationId);
      if (conv) {
        conv.name = data.name;
        if (data.description !== undefined) {
          conv.description = data.description;
        }
        renderConversationList();
        // 如果是当前打开的会话，更新头部
        if (state.currentConvId === data.conversationId) {
          el.headerName.textContent = data.name || '(未命名)';
        }
      }
      // 如果群信息弹窗正打开，刷新
      if (state.groupInfoConvId === data.conversationId) {
        openGroupInfo(data.conversationId);
      }
    });

    // V0.66 新增：有新成员加入群聊
    state.socket.on('members_added', (data) => {
      if (state.currentConvId === data.conversationId) {
        loadConversationInfo(data.conversationId);
      }
      // 如果群信息弹窗正打开，刷新成员列表
      if (state.groupInfoConvId === data.conversationId) {
        openGroupInfo(data.conversationId);
      }
    });

    // V0.66 新增：被加入新群聊
    state.socket.on('added_to_group', (data) => {
      showToast('您已被加入群聊：' + (data.conversation ? data.conversation.name : '新群聊'), 'success');
      loadConversations();
    });

    // V0.66 新增：有成员退出群聊
    state.socket.on('member_left', (data) => {
      if (state.currentConvId === data.conversationId) {
        loadConversationInfo(data.conversationId);
      }
      // 如果群信息弹窗正打开，刷新成员列表
      if (state.groupInfoConvId === data.conversationId) {
        openGroupInfo(data.conversationId);
      }
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

    const avatar = createAvatar(conv.name, conv.avatarColor, null, conv.otherAvatarUrl);
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
        // V0.66 新增：私聊会话显示对方头像，群聊显示默认头像
        // 先清除之前可能设置的背景图片和背景色
        el.headerAvatar.style.background = '';
        el.headerAvatar.style.backgroundImage = '';
        el.headerAvatar.style.backgroundSize = '';
        el.headerAvatar.style.backgroundPosition = '';
        if (conv.type === 'private' && conv.otherAvatarUrl) {
          el.headerAvatar.style.backgroundImage = 'url(' + conv.otherAvatarUrl + ')';
          el.headerAvatar.style.backgroundSize = 'cover';
          el.headerAvatar.style.backgroundPosition = 'center';
          el.headerAvatar.textContent = '';
        } else {
          el.headerAvatar.style.background = conv.avatarColor || '#2AABEE';
          el.headerAvatar.textContent = getInitial(conv.name);
        }
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

        const avatar = createAvatar(user.nickname, user.avatarColor, 'sm', user.avatarUrl);
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

  /** V0.3: 搜索用户回调 - 加好友而非直接私聊 */
  function addFriendCallback(user) {
    sendFriendRequest(user.id);
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

      const avatar = createAvatar(user.nickname, user.avatarColor, null, user.avatarUrl);
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
    // V0.6 新增：如果有自定义头像，使用图片
    if (currentUser.avatarUrl) {
      el.myAvatar.style.backgroundImage = `url(${currentUser.avatarUrl})`;
      el.myAvatar.style.backgroundSize = 'cover';
      el.myAvatar.style.backgroundPosition = 'center';
      el.myAvatar.textContent = '';
    }
    // V0.6 新增：更新设置弹窗中的头像预览
    if (el.avatarUploadPreview) {
      if (currentUser.avatarUrl) {
        el.avatarUploadPreview.style.backgroundImage = `url(${currentUser.avatarUrl})`;
        el.avatarUploadPreview.style.backgroundSize = 'cover';
        el.avatarUploadPreview.style.backgroundPosition = 'center';
        el.avatarUploadPreview.textContent = '';
      } else {
        el.avatarUploadPreview.style.background = currentUser.avatarColor || '#2AABEE';
        el.avatarUploadPreview.textContent = getInitial(currentUser.nickname || currentUser.username);
      }
    }
  }

  // ============================================================
  // V0.3 新增：好友系统
  // ============================================================

  /** 加载好友列表 */
  async function loadFriends() {
    try {
      const res = await apiFetch('/api/friends');
      const data = await res.json();
      state.friends = data.friends || [];
      renderFriendList();
    } catch (err) {
      console.error('加载好友列表失败:', err);
    }
  }

  /** 加载好友请求 */
  async function loadFriendRequests() {
    try {
      const res = await apiFetch('/api/friends/requests');
      const data = await res.json();
      state.friendRequests = data.requests || [];
      renderFriendRequests();
    } catch (err) {
      console.error('加载好友请求失败:', err);
    }
  }

  /** 渲染好友列表 */
  function renderFriendList() {
    el.friendList.innerHTML = '';
    if (state.friends.length === 0) {
      el.friendList.innerHTML = '<p class="empty-hint">还没有好友，点击右上角按钮搜索添加</p>';
      return;
    }
    state.friends.forEach((friend) => {
      const item = document.createElement('div');
      item.className = 'friend-list-item';

      const avatar = createAvatar(friend.nickname, friend.avatarColor, null, friend.avatarUrl);
      item.appendChild(avatar);

      const info = document.createElement('div');
      info.className = 'friend-item-info';

      const name = document.createElement('div');
      name.className = 'friend-item-name';
      name.textContent = friend.nickname;
      info.appendChild(name);

      const status = document.createElement('div');
      status.className = 'friend-item-status';
      status.textContent = friend.online ? '在线' : '离线';
      status.style.color = friend.online ? '#4caf50' : 'var(--text-tertiary)';
      info.appendChild(status);

      item.appendChild(info);

      // V0.6 新增：删除好友按钮
      var removeBtn = document.createElement('button');
      removeBtn.className = 'friend-action-btn remove';
      removeBtn.title = '删除好友';
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      removeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm('确定删除好友 ' + friend.nickname + ' 吗？')) {
          removeFriend(friend.friendshipId);
        }
      });
      item.appendChild(removeBtn);

      // 点击好友发起私聊
      item.addEventListener('click', () => {
        createPrivateConversation(friend.id);
      });

      el.friendList.appendChild(item);
    });
  }

  /** 渲染好友请求列表 */
  function renderFriendRequests() {
    const count = state.friendRequests.length;
    if (count === 0) {
      el.friendRequestSection.style.display = 'none';
      el.friendRequestBadge.style.display = 'none';
      return;
    }

    el.friendRequestSection.style.display = 'block';
    el.friendRequestBadge.style.display = 'flex';
    el.friendRequestBadge.textContent = count > 99 ? '99+' : count;

    el.friendRequestList.innerHTML = '';
    state.friendRequests.forEach((req) => {
      const item = document.createElement('div');
      item.className = 'friend-request-item';

      const avatar = createAvatar(req.from.nickname, req.from.avatarColor, 'sm', req.from.avatarUrl);
      item.appendChild(avatar);

      const info = document.createElement('div');
      info.className = 'friend-item-info';

      const name = document.createElement('div');
      name.className = 'friend-item-name';
      name.textContent = req.from.nickname;
      info.appendChild(name);

      const username = document.createElement('div');
      username.className = 'friend-item-username';
      username.textContent = '@' + req.from.username;
      info.appendChild(username);

      item.appendChild(info);

      // 接受按钮
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'friend-action-btn accept';
      acceptBtn.textContent = '接受';
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        acceptFriendRequest(req.id);
      });
      item.appendChild(acceptBtn);

      // 拒绝按钮
      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'friend-action-btn reject';
      rejectBtn.textContent = '拒绝';
      rejectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rejectFriendRequest(req.id);
      });
      item.appendChild(rejectBtn);

      el.friendRequestList.appendChild(item);
    });
  }

  /** 发送好友请求 */
  async function sendFriendRequest(targetUserId) {
    try {
      const res = await apiFetch('/api/friends/request', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '发送好友请求失败', 'error');
        return;
      }
      showToast('好友请求已发送', 'success');
    } catch (err) {
      console.error('发送好友请求失败:', err);
      showToast('发送好友请求失败', 'error');
    }
  }

  /** 接受好友请求 */
  async function acceptFriendRequest(friendshipId) {
    try {
      const res = await apiFetch(`/api/friends/${friendshipId}/accept`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '接受好友请求失败', 'error');
        return;
      }
      showToast('已添加好友', 'success');
      loadFriendRequests();
      loadFriends();
    } catch (err) {
      console.error('接受好友请求失败:', err);
    }
  }

  /** 拒绝好友请求 */
  async function rejectFriendRequest(friendshipId) {
    try {
      const res = await apiFetch(`/api/friends/${friendshipId}/reject`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '拒绝好友请求失败', 'error');
        return;
      }
      loadFriendRequests();
    } catch (err) {
      console.error('拒绝好友请求失败:', err);
    }
  }

  /** V0.6 新增：删除好友 */
  async function removeFriend(friendshipId) {
    try {
      const res = await apiFetch(`/api/friends/${friendshipId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '删除好友失败', 'error');
        return;
      }
      showToast('好友已删除', 'info');
      loadFriends();
    } catch (err) {
      console.error('删除好友失败:', err);
      showToast('删除好友失败', 'error');
    }
  }

  /** 切换侧边栏标签 */
  function switchSidebarTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.sidebar-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.stab === tabName);
    });
    el.convList.style.display = tabName === 'chats' ? 'block' : 'none';
    el.friendsPanel.style.display = tabName === 'friends' ? 'block' : 'none';
    el.musicPanel.style.display = tabName === 'music' ? 'block' : 'none';
    el.mailPanel.style.display = tabName === 'mail' ? 'block' : 'none';
    el.adminPanel.style.display = tabName === 'admin' ? 'block' : 'none';
    if (tabName === 'friends') {
      loadFriends();
      loadFriendRequests();
    }
    if (tabName === 'music') {
      loadMusicList();
      loadMusicSuggestions();
    }
    if (tabName === 'mail') {
      loadMails();
    }
    if (tabName === 'admin') {
      loadAdminUsers();
    }
  }

  // ============================================================
  // V0.4 新增：音乐系统
  // ============================================================

  /** 格式化音频时长 */
  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  /** 检查当前用户是否是管理员 */
  async function checkAdmin() {
    try {
      const res = await apiFetch('/api/me');
      const data = await res.json();
      state.isAdmin = !!(data.user && data.user.isAdmin);
      if (state.isAdmin) {
        el.musicUploadBtn.style.display = 'flex';
        // 显示"用户管理"标签
        el.adminTabs.forEach(function(tab) { tab.style.display = 'block'; });
      }
    } catch (err) {
      console.error('检查管理员状态失败:', err);
    }
  }

  /** 加载音乐列表 */
  async function loadMusicList() {
    try {
      const res = await apiFetch('/api/music/list');
      const data = await res.json();
      state.musicList = data.music || [];
      renderMusicList();
    } catch (err) {
      console.error('加载音乐列表失败:', err);
    }
  }

  /** 渲染音乐列表 */
  function renderMusicList() {
    el.musicListEl.innerHTML = '';
    if (state.musicList.length === 0) {
      el.musicListEl.innerHTML = '<p class="empty-hint">暂无音乐</p>';
      return;
    }
    state.musicList.forEach(function(music) {
      const item = document.createElement('div');
      item.className = 'music-list-item';
      if (state.currentMusic && state.currentMusic.id === music.id) {
        item.classList.add('playing');
      }

      const icon = document.createElement('div');
      icon.className = 'music-item-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
      item.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'music-item-info';

      const title = document.createElement('div');
      title.className = 'music-item-title';
      title.textContent = music.title;
      info.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'music-item-meta';
      const sizeMB = (music.filesize / 1024 / 1024).toFixed(1);
      meta.textContent = sizeMB + 'MB \u00b7 \u64ad\u653e' + music.playCount + '\u6b21';
      info.appendChild(meta);

      item.appendChild(info);

      // 管理员删除按钮
      if (state.isAdmin) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'music-delete-btn';
        deleteBtn.title = '删除';
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        deleteBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          deleteMusic(music.id);
        });
        item.appendChild(deleteBtn);
      }

      // 点击播放
      item.addEventListener('click', function() {
        playMusic(music);
      });

      el.musicListEl.appendChild(item);
    });
  }

  /** 播放音乐 */
  function playMusic(music) {
    state.currentMusic = music;
    el.audioPlayer.src = '/api/music/' + music.id + '/stream?token=' + encodeURIComponent(token);
    el.audioPlayer.play();
    state.isPlaying = true;
    el.musicPlayer.style.display = 'flex';
    el.playerTitle.textContent = music.title;
    el.playerPlayBtn.style.display = 'none';
    el.playerPauseBtn.style.display = 'block';
    renderMusicList();
  }

  /** 暂停/恢复播放 */
  function togglePlay() {
    if (state.isPlaying) {
      el.audioPlayer.pause();
      state.isPlaying = false;
      el.playerPlayBtn.style.display = 'block';
      el.playerPauseBtn.style.display = 'none';
    } else {
      el.audioPlayer.play();
      state.isPlaying = true;
      el.playerPlayBtn.style.display = 'none';
      el.playerPauseBtn.style.display = 'block';
    }
  }

  /** 删除音乐 */
  async function deleteMusic(musicId) {
    if (!confirm('确定删除这首音乐吗？')) return;
    try {
      const res = await apiFetch('/api/music/' + musicId, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || '删除失败', 'error');
        return;
      }
      showToast('音乐已删除', 'success');
      if (state.currentMusic && state.currentMusic.id === musicId) {
        el.audioPlayer.pause();
        el.audioPlayer.src = '';
        el.musicPlayer.style.display = 'none';
        state.currentMusic = null;
        state.isPlaying = false;
      }
      loadMusicList();
    } catch (err) {
      console.error('删除音乐失败:', err);
      showToast('删除音乐失败', 'error');
    }
  }

  /** 打开上传弹窗 */
  function openMusicUploadModal() {
    el.musicUploadModal.style.display = 'flex';
    el.musicTitleInput.value = '';
    el.musicFileInput.value = '';
    el.uploadMusicBtn.disabled = true;
    var mainP = el.fileUploadHint.querySelector('.file-upload-main');
    var subP = el.fileUploadHint.querySelector('.file-upload-sub');
    if (mainP) mainP.textContent = '点击选择音频文件';
    if (subP) subP.textContent = '支持 MP3, WAV, OGG, M4A, FLAC（最大 300MB）';
  }

  /** 关闭上传弹窗 */
  function closeMusicUploadModal() {
    el.musicUploadModal.style.display = 'none';
  }

  /** 上传音乐 */
  async function uploadMusic() {
    const file = el.musicFileInput.files[0];
    if (!file) {
      showToast('请先选择音频文件', 'error');
      return;
    }
    const title = el.musicTitleInput.value.trim() || file.name.replace(/\.[^.]+$/, '');
    const formData = new FormData();
    formData.append('music', file);
    formData.append('title', title);

    el.uploadMusicBtn.disabled = true;
    el.uploadMusicBtn.textContent = '上传中...';

    try {
      const res = await fetch('/api/music/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '上传失败', 'error');
        return;
      }
      showToast('音乐上传成功', 'success');
      closeMusicUploadModal();
      loadMusicList();
    } catch (err) {
      console.error('上传音乐失败:', err);
      showToast('上传音乐失败', 'error');
    } finally {
      el.uploadMusicBtn.disabled = false;
      el.uploadMusicBtn.textContent = '上传';
    }
  }

  // ============================================================
  // V0.5 新增：管理员用户管理
  // ============================================================

  /** 加载所有注册用户列表 */
  async function loadAdminUsers() {
    try {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || '获取用户列表失败', 'error');
        return;
      }
      const data = await res.json();
      state.adminUsers = data.users || [];
      el.adminTotalCount.textContent = data.total || 0;
      el.adminOnlineCount.textContent = data.online || 0;
      renderAdminUsers();
    } catch (err) {
      console.error('加载用户列表失败:', err);
      showToast('加载用户列表失败', 'error');
    }
  }

  /** 渲染用户列表 */
  function renderAdminUsers() {
    el.adminUserList.innerHTML = '';
    if (!state.adminUsers.length) {
      el.adminUserList.innerHTML = '<p class="empty-hint">暂无注册用户</p>';
      return;
    }
    state.adminUsers.forEach(function(user) {
      var item = document.createElement('div');
      item.className = 'admin-user-item';

      // 头像
      var avatar = document.createElement('div');
      avatar.className = 'avatar admin-user-avatar';
      // V0.66 新增：如果用户有自定义头像，使用图片
      if (user.avatarUrl) {
        avatar.style.backgroundImage = 'url(' + user.avatarUrl + ')';
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
        avatar.textContent = '';
      } else {
        avatar.style.background = user.avatarColor || '#2AABEE';
        var initial = (user.nickname || user.username || '?').charAt(0).toUpperCase();
        avatar.textContent = initial;
      }
      item.appendChild(avatar);

      // 信息
      var info = document.createElement('div');
      info.className = 'admin-user-info';
      var nameRow = document.createElement('div');
      nameRow.className = 'admin-user-name';
      nameRow.textContent = user.nickname || '(未设置昵称)';

      // 在线状态点
      var statusDot = document.createElement('span');
      statusDot.className = 'admin-status-dot ' + (user.isOnline ? 'online' : 'offline');
      nameRow.appendChild(statusDot);
      info.appendChild(nameRow);

      var metaRow = document.createElement('div');
      metaRow.className = 'admin-user-meta';
      var dateStr = user.createdAt ? new Date(user.createdAt).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }) : '未知';
      metaRow.textContent = '用户名: ' + user.username + '  ·  注册: ' + dateStr;
      if (user.warningCount > 0) {
        metaRow.textContent += '  ·  警告: ' + user.warningCount + '次';
      }
      if (user.banned) {
        metaRow.textContent += '  ·  已封禁';
      }
      info.appendChild(metaRow);

      item.appendChild(info);

      // V0.6 新增：管理员操作按钮（不能对自己操作）
      if (user.id !== currentUser.id) {
        var actions = document.createElement('div');
        actions.className = 'admin-user-actions';

        // 警告按钮
        var warnBtn = document.createElement('button');
        warnBtn.className = 'admin-action-btn warn';
        warnBtn.textContent = '警告';
        warnBtn.addEventListener('click', function() {
          var reason = prompt('请输入警告原因：');
          if (reason) warnUser(user.id, reason);
        });
        actions.appendChild(warnBtn);

        // 封禁/解封按钮
        if (user.banned) {
          var unbanBtn = document.createElement('button');
          unbanBtn.className = 'admin-action-btn unban';
          unbanBtn.textContent = '解封';
          unbanBtn.addEventListener('click', function() {
            if (confirm('确定解封 ' + user.nickname + ' 吗？')) {
              unbanUser(user.id);
            }
          });
          actions.appendChild(unbanBtn);
        } else {
          var banBtn = document.createElement('button');
          banBtn.className = 'admin-action-btn ban';
          banBtn.textContent = '封禁';
          banBtn.addEventListener('click', function() {
            var reason = prompt('请输入封禁原因：');
            if (reason) banUser(user.id, reason);
          });
          actions.appendChild(banBtn);
        }

        item.appendChild(actions);
      }
      el.adminUserList.appendChild(item);
    });
  }

  // ============================================================
  // V0.6 新增：实时时钟
  // ============================================================
  function updateClock() {
    var now = new Date();
    var y = now.getFullYear();
    var mo = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    var h = String(now.getHours()).padStart(2, '0');
    var mi = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    if (el.clockDisplay) {
      el.clockDisplay.textContent = y + '-' + mo + '-' + d + ' ' + h + ':' + mi + ':' + s;
    }
  }

  // ============================================================
  // V0.6 新增：管理员封禁/警告/解封
  // ============================================================
  async function banUser(userId, reason) {
    try {
      var res = await apiFetch('/api/admin/users/' + userId + '/ban', {
        method: 'POST',
        body: JSON.stringify({ reason: reason }),
      });
      var data = await res.json();
      if (!res.ok) { showToast(data.error || '封禁失败', 'error'); return; }
      showToast('用户已封禁', 'success');
      loadAdminUsers();
    } catch (err) {
      showToast('封禁失败', 'error');
    }
  }

  async function unbanUser(userId) {
    try {
      var res = await apiFetch('/api/admin/users/' + userId + '/unban', {
        method: 'POST',
      });
      var data = await res.json();
      if (!res.ok) { showToast(data.error || '解封失败', 'error'); return; }
      showToast('用户已解封', 'success');
      loadAdminUsers();
    } catch (err) {
      showToast('解封失败', 'error');
    }
  }

  async function warnUser(userId, reason) {
    try {
      var res = await apiFetch('/api/admin/users/' + userId + '/warn', {
        method: 'POST',
        body: JSON.stringify({ reason: reason }),
      });
      var data = await res.json();
      if (!res.ok) { showToast(data.error || '警告失败', 'error'); return; }
      showToast('警告已发送', 'success');
      loadAdminUsers();
    } catch (err) {
      showToast('警告失败', 'error');
    }
  }

  // ============================================================
  // V0.6 新增：音乐建议
  // ============================================================
  async function loadMusicSuggestions() {
    try {
      var res = await apiFetch('/api/music/suggestions');
      var data = await res.json();
      state.musicSuggestions = data.suggestions || [];
      renderMusicSuggestions();
    } catch (err) {
      console.error('加载音乐建议失败:', err);
    }
  }

  function renderMusicSuggestions() {
    if (!el.musicSuggestionList) return;
    el.musicSuggestionList.innerHTML = '';
    if (state.musicSuggestions.length === 0) {
      el.musicSuggestionList.innerHTML = '<p class="empty-hint">暂无建议</p>';
      return;
    }
    state.musicSuggestions.forEach(function(s) {
      var item = document.createElement('div');
      item.className = 'suggestion-item';
      var text = document.createElement('div');
      text.className = 'suggestion-text';
      text.innerHTML = '<strong>' + escapeHtml(s.songName) + '</strong>' +
        (s.artist ? ' - ' + escapeHtml(s.artist) : '') +
        (s.note ? '<br><span class="suggestion-note">' + escapeHtml(s.note) + '</span>' : '') +
        '<br><span class="suggestion-meta">@' + escapeHtml(s.suggestedBy ? s.suggestedBy.username : 'unknown') +
        ' · ' + formatTime(s.createdAt) + '</span>';
      item.appendChild(text);
      if (state.isAdmin) {
        var delBtn = document.createElement('button');
        delBtn.className = 'music-delete-btn';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        delBtn.addEventListener('click', function() { deleteSuggestion(s.id); });
        item.appendChild(delBtn);
      }
      el.musicSuggestionList.appendChild(item);
    });
  }

  async function submitSuggestion() {
    var songName = el.suggestionSongName.value.trim();
    var artist = el.suggestionArtist.value.trim();
    var note = el.suggestionNote.value.trim();
    if (!songName) { showToast('请输入歌曲名称', 'error'); return; }
    try {
      var res = await apiFetch('/api/music/suggestions', {
        method: 'POST',
        body: JSON.stringify({ songName: songName, artist: artist, note: note }),
      });
      var data = await res.json();
      if (!res.ok) { showToast(data.error || '提交失败', 'error'); return; }
      showToast('建议已提交', 'success');
      el.suggestionSongName.value = '';
      el.suggestionArtist.value = '';
      el.suggestionNote.value = '';
      loadMusicSuggestions();
    } catch (err) {
      showToast('提交失败', 'error');
    }
  }

  async function deleteSuggestion(id) {
    try {
      var res = await apiFetch('/api/music/suggestions/' + id, { method: 'DELETE' });
      if (!res.ok) { showToast('删除失败', 'error'); return; }
      showToast('已删除', 'success');
      loadMusicSuggestions();
    } catch (err) {
      showToast('删除失败', 'error');
    }
  }

  // ============================================================
  // V0.6 新增：邮件系统
  // ============================================================
  async function loadMails() {
    try {
      var res = await apiFetch('/api/mails');
      var data = await res.json();
      state.mails = data.mails || [];
      state.unreadMails = data.unreadCount || 0;
      renderMailList();
      updateMailBadge();
    } catch (err) {
      console.error('加载邮件失败:', err);
    }
  }

  async function loadUnreadMailCount() {
    try {
      var res = await apiFetch('/api/mails');
      var data = await res.json();
      state.unreadMails = data.unreadCount || 0;
      updateMailBadge();
    } catch (err) {
      console.error('加载未读邮件数失败:', err);
    }
  }

  function updateMailBadge() {
    if (state.unreadMails > 0) {
      el.mailBadge.style.display = 'flex';
      el.mailBadge.textContent = state.unreadMails > 99 ? '99+' : state.unreadMails;
    } else {
      el.mailBadge.style.display = 'none';
    }
  }

  function renderMailList() {
    el.mailList.innerHTML = '';
    if (state.mails.length === 0) {
      el.mailList.innerHTML = '<p class="empty-hint">暂无邮件</p>';
      return;
    }
    state.mails.forEach(function(m) {
      var item = document.createElement('div');
      item.className = 'mail-list-item' + (m.isRead ? '' : ' unread');
      var header = document.createElement('div');
      header.className = 'mail-item-header';
      var from = m.sender ? m.sender.nickname : '未知';
      header.innerHTML = '<span class="mail-from">' + escapeHtml(from) + '</span>' +
        '<span class="mail-time">' + formatTime(m.createdAt) + '</span>';
      item.appendChild(header);
      var subject = document.createElement('div');
      subject.className = 'mail-subject';
      if (!m.isRead) subject.innerHTML = '<span class="mail-unread-dot">●</span> ';
      subject.innerHTML += escapeHtml(m.subject);
      item.appendChild(subject);
      var preview = document.createElement('div');
      preview.className = 'mail-preview';
      preview.textContent = m.content.substring(0, 50) + (m.content.length > 50 ? '...' : '');
      item.appendChild(preview);
      // V0.65 新增：删除按钮
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'mail-delete-btn';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = '删除邮件';
      deleteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm('确定删除这封邮件吗？')) {
          deleteMail(m.id);
        }
      });
      item.appendChild(deleteBtn);
      item.addEventListener('click', function() { viewMail(m); });
      el.mailList.appendChild(item);
    });
  }

  async function viewMail(mail) {
    el.mailViewSubject.textContent = mail.subject;
    el.mailViewSender.textContent = mail.sender ? mail.sender.nickname + ' (@' + mail.sender.username + ')' : '未知';
    el.mailViewTime.textContent = new Date(mail.createdAt).toLocaleString('zh-CN');
    el.mailViewContent.textContent = mail.content;
    el.mailViewModal.style.display = 'flex';
    // 标记已读
    if (!mail.isRead) {
      try {
        await apiFetch('/api/mails/' + mail.id + '/read', { method: 'POST' });
        loadUnreadMailCount();
      } catch (err) {}
    }
  }

  async function sendMail() {
    var recipient = el.mailRecipient.value.trim();
    var subject = el.mailSubject.value.trim();
    var content = el.mailContent.value.trim();
    if (!recipient || !subject || !content) {
      showToast('请填写收件人、主题和内容', 'error');
      return;
    }
    try {
      var res = await apiFetch('/api/mails/send', {
        method: 'POST',
        body: JSON.stringify({ recipientNickname: recipient, subject: subject, content: content }),
      });
      var data = await res.json();
      if (!res.ok) { showToast(data.error || '发送失败', 'error'); return; }
      showToast('邮件已发送', 'success');
      el.mailRecipient.value = '';
      el.mailSubject.value = '';
      el.mailContent.value = '';
      loadMails();
    } catch (err) {
      showToast('发送失败', 'error');
    }
  }

  // V0.65 新增：删除邮件
  async function deleteMail(mailId) {
    try {
      var res = await apiFetch('/api/mails/' + mailId, { method: 'DELETE' });
      if (!res.ok) { showToast('删除失败', 'error'); return; }
      showToast('邮件已删除', 'success');
      loadMails();
    } catch (err) {
      showToast('删除失败', 'error');
    }
  }

  // V0.65 新增：@选择在线用户
  var onlineUserSuggestions = [];
  async function loadOnlineUsersForMail() {
    try {
      var res = await apiFetch('/api/users/online');
      var data = await res.json();
      onlineUserSuggestions = data.users || [];
    } catch (err) {
      onlineUserSuggestions = [];
    }
  }

  function showMailRecipientSuggestions(users) {
    var box = document.getElementById('mail-recipient-suggestions');
    if (!box) return;
    box.innerHTML = '';
    if (users.length === 0) {
      box.style.display = 'none';
      return;
    }
    users.forEach(function(u) {
      var item = document.createElement('div');
      item.className = 'recipient-suggestion-item';
      item.textContent = u.nickname;
      item.addEventListener('click', function() {
        el.mailRecipient.value = u.nickname;
        box.style.display = 'none';
      });
      box.appendChild(item);
    });
    box.style.display = 'block';
  }

  // ============================================================
  // V0.6 新增：头像上传
  // ============================================================
  async function uploadAvatar(file) {
    var formData = new FormData();
    formData.append('avatar', file);
    try {
      var res = await fetch('/api/users/avatar', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: formData,
      });
      var data = await res.json();
      if (!res.ok) { showToast(data.error || '上传失败', 'error'); return; }
      showToast('头像已更新', 'success');
      currentUser = data.user;
      localStorage.setItem('fc_user', JSON.stringify(currentUser));
      updateMyInfo();
    } catch (err) {
      showToast('上传失败', 'error');
    }
  }

  // ============================================================
  // V0.66 新增：群聊管理功能
  // ============================================================

  /**
   * 打开群信息弹窗，加载群名、公告、成员列表
   * @param {string} convId - 会话ID
   */
  async function openGroupInfo(convId) {
    state.groupInfoConvId = convId;
    var conv = state.conversations.find(function(c) { return c.id === convId; });

    // 重置弹窗内容
    el.groupInfoName.value = '';
    el.groupInfoNotice.value = '';
    el.groupInfoName.disabled = true;
    el.groupInfoNotice.disabled = true;
    el.saveGroupInfoBtn.style.display = 'none';
    el.groupMemberList.innerHTML = '<p class="modal-hint">加载中...</p>';
    el.groupMemberCount.textContent = '0';

    el.groupInfoModal.style.display = 'flex';

    // 加载会话详情（获取群名、公告、创建者）
    try {
      // 重新获取会话详情以获取最新的 description
      var res = await apiFetch('/api/conversations');
      if (res.ok) {
        var data = await res.json();
        var convs = data.conversations || [];
        var found = convs.find(function(c) { return c.id === convId; });
        if (found) {
          // 更新 state 中的会话信息
          var existingConv = state.conversations.find(function(c) { return c.id === convId; });
          if (existingConv) {
            existingConv.description = found.description;
            existingConv.createdBy = found.createdBy;
          }
          conv = found;
        }
      }
    } catch (err) {
      console.error('加载会话详情失败:', err);
    }

    if (conv) {
      el.groupInfoName.value = conv.name || '';
      el.groupInfoNotice.value = conv.description || '';

      // 判断当前用户是否是群主
      var isOwner = conv.createdBy === currentUser.id;
      if (isOwner) {
        el.groupInfoName.disabled = false;
        el.groupInfoNotice.disabled = false;
        el.saveGroupInfoBtn.style.display = 'block';
      } else {
        el.groupInfoName.disabled = true;
        el.groupInfoNotice.disabled = true;
        el.saveGroupInfoBtn.style.display = 'none';
      }
    }

    // 加载群成员列表
    try {
      var memberRes = await apiFetch('/api/conversations/' + convId + '/members');
      if (memberRes.ok) {
        var memberData = await memberRes.json();
        var members = memberData.members || [];
        state.groupInfoMembers = members;
        renderGroupMembers(members, conv);
      }
    } catch (err) {
      console.error('加载群成员失败:', err);
      el.groupMemberList.innerHTML = '<p class="modal-hint">加载成员失败</p>';
    }
  }

  /**
   * 渲染群成员列表
   * @param {Array} members - 成员列表
   * @param {Object} conv - 会话对象
   */
  function renderGroupMembers(members, conv) {
    el.groupMemberList.innerHTML = '';
    el.groupMemberCount.textContent = members.length;

    if (members.length === 0) {
      el.groupMemberList.innerHTML = '<p class="modal-hint">暂无成员</p>';
      return;
    }

    members.forEach(function(m) {
      var item = document.createElement('div');
      item.className = 'group-member-item';

      // 头像（V0.66：支持自定义头像）
      var avatar = createAvatar(m.nickname, m.avatarColor, null, m.avatarUrl);
      item.appendChild(avatar);

      // 信息
      var info = document.createElement('div');
      info.className = 'group-member-info';

      var nameRow = document.createElement('div');
      nameRow.className = 'group-member-name';
      nameRow.textContent = m.nickname || m.username || '未知用户';

      // 群主标记
      if (conv && conv.createdBy === m.id) {
        var ownerBadge = document.createElement('span');
        ownerBadge.className = 'group-owner-badge';
        ownerBadge.textContent = '群主';
        nameRow.appendChild(ownerBadge);
      }

      info.appendChild(nameRow);

      var status = document.createElement('div');
      status.className = 'group-member-status' + (m.online ? ' online' : '');
      status.textContent = m.online ? '在线' : '离线';
      info.appendChild(status);

      item.appendChild(info);
      el.groupMemberList.appendChild(item);
    });
  }

  /**
   * 群主保存群名和群公告
   */
  async function saveGroupInfo() {
    var convId = state.groupInfoConvId;
    if (!convId) return;

    var name = el.groupInfoName.value.trim();
    var description = el.groupInfoNotice.value.trim();

    if (!name) {
      showToast('群名称不能为空', 'error');
      return;
    }

    try {
      var res = await apiFetch('/api/conversations/' + convId + '/group-info', {
        method: 'PUT',
        body: JSON.stringify({ name: name, description: description }),
      });
      var data = await res.json();
      if (!res.ok) {
        showToast(data.error || '保存失败', 'error');
        return;
      }
      showToast('群信息已更新', 'success');

      // 更新本地会话信息
      var conv = state.conversations.find(function(c) { return c.id === convId; });
      if (conv) {
        conv.name = name;
        conv.description = description;
      }
      // 更新头部
      if (state.currentConvId === convId) {
        el.headerName.textContent = name || '(未命名)';
      }
      renderConversationList();
    } catch (err) {
      console.error('保存群信息失败:', err);
      showToast('保存失败', 'error');
    }
  }

  /**
   * 退出群聊
   * @param {string} convId - 会话ID
   */
  async function leaveGroup(convId) {
    if (!convId) return;
    if (!confirm('确定退出此群聊吗？')) return;

    try {
      var res = await apiFetch('/api/conversations/' + convId + '/members', {
        method: 'DELETE',
      });
      var data = await res.json();
      if (!res.ok) {
        showToast(data.error || '退出群聊失败', 'error');
        return;
      }
      showToast('已退出群聊', 'info');

      // 关闭群信息弹窗
      el.groupInfoModal.style.display = 'none';
      state.groupInfoConvId = null;

      // 从会话列表中移除该会话
      state.conversations = state.conversations.filter(function(c) { return c.id !== convId; });

      // 如果当前正在查看该会话，返回空状态
      if (state.currentConvId === convId) {
        state.currentConvId = null;
        state.currentConv = null;
        state.messages = [];
        el.chatContent.style.display = 'none';
        el.chatEmpty.style.display = 'flex';
        el.chatContent.classList.remove('mobile-show');
      }

      renderConversationList();
    } catch (err) {
      console.error('退出群聊失败:', err);
      showToast('退出群聊失败', 'error');
    }
  }

  /**
   * 打开邀请弹窗，显示好友列表
   * @param {string} convId - 会话ID
   */
  async function openInviteModal(convId) {
    state.inviteConvId = convId;
    state.inviteSelectedFriends = [];
    el.inviteFriendList.innerHTML = '<p class="modal-hint">加载中...</p>';
    el.confirmInviteBtn.disabled = true;
    el.inviteModal.style.display = 'flex';

    // 加载好友列表
    try {
      var res = await apiFetch('/api/friends');
      if (!res.ok) {
        el.inviteFriendList.innerHTML = '<p class="modal-hint">加载好友列表失败</p>';
        return;
      }
      var data = await res.json();
      var friends = data.friends || [];

      // 获取当前群成员列表，过滤掉已是成员的好友
      var memberRes = await apiFetch('/api/conversations/' + convId + '/members');
      var existingMemberIds = [];
      if (memberRes.ok) {
        var memberData = await memberRes.json();
        var members = memberData.members || [];
        existingMemberIds = members.map(function(m) { return m.id; });
      }

      var availableFriends = friends.filter(function(f) {
        return existingMemberIds.indexOf(f.id) === -1;
      });

      if (availableFriends.length === 0) {
        el.inviteFriendList.innerHTML = '<p class="modal-hint">没有可邀请的好友（所有好友已在群中）</p>';
        return;
      }

      renderInviteFriendList(availableFriends);
    } catch (err) {
      console.error('加载好友列表失败:', err);
      el.inviteFriendList.innerHTML = '<p class="modal-hint">加载好友列表失败</p>';
    }
  }

  /**
   * 渲染可邀请的好友列表
   * @param {Array} friends - 好友列表
   */
  function renderInviteFriendList(friends) {
    el.inviteFriendList.innerHTML = '';
    friends.forEach(function(friend) {
      var item = document.createElement('div');
      item.className = 'invite-friend-item';
      item.dataset.userId = friend.id;

      var avatar = createAvatar(friend.nickname, friend.avatarColor, null, friend.avatarUrl);
      item.appendChild(avatar);

      var info = document.createElement('div');
      info.className = 'invite-friend-info';

      var name = document.createElement('div');
      name.className = 'invite-friend-name';
      name.textContent = friend.nickname;
      info.appendChild(name);

      item.appendChild(info);

      // 选择框
      var check = document.createElement('div');
      check.className = 'invite-friend-check';
      item.appendChild(check);

      item.addEventListener('click', function() {
        var idx = state.inviteSelectedFriends.indexOf(friend.id);
        if (idx >= 0) {
          state.inviteSelectedFriends.splice(idx, 1);
          item.classList.remove('selected');
        } else {
          state.inviteSelectedFriends.push(friend.id);
          item.classList.add('selected');
        }
        el.confirmInviteBtn.disabled = state.inviteSelectedFriends.length === 0;
      });

      el.inviteFriendList.appendChild(item);
    });
  }

  /**
   * 确认邀请好友入群
   */
  async function confirmInvite() {
    var convId = state.inviteConvId;
    if (!convId || state.inviteSelectedFriends.length === 0) return;

    try {
      var res = await apiFetch('/api/conversations/' + convId + '/members', {
        method: 'POST',
        body: JSON.stringify({ userIds: state.inviteSelectedFriends }),
      });
      var data = await res.json();
      if (!res.ok) {
        showToast(data.error || '邀请失败', 'error');
        return;
      }
      showToast('已邀请 ' + (data.addedCount || state.inviteSelectedFriends.length) + ' 位好友入群', 'success');

      // 关闭邀请弹窗
      el.inviteModal.style.display = 'none';
      state.inviteSelectedFriends = [];
      state.inviteConvId = null;

      // 刷新群信息弹窗的成员列表
      if (state.groupInfoConvId === convId) {
        openGroupInfo(convId);
      }
    } catch (err) {
      console.error('邀请好友入群失败:', err);
      showToast('邀请失败', 'error');
    }
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
        searchUsers(el.userSearchInput.value, el.userSearchResults, addFriendCallback);
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

    // V0.3 新增：侧边栏标签切换（聊天/好友）
    document.querySelectorAll('.sidebar-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        switchSidebarTab(tab.dataset.stab);
      });
    });

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

    // V0.4 新增：音乐系统事件绑定
    el.musicUploadBtn.addEventListener('click', openMusicUploadModal);
    el.closeMusicUploadBtn.addEventListener('click', closeMusicUploadModal);
    el.musicUploadModal.addEventListener('click', function(e) {
      if (e.target === el.musicUploadModal) closeMusicUploadModal();
    });
    el.fileUploadArea.addEventListener('click', function() {
      el.musicFileInput.click();
    });
    el.musicFileInput.addEventListener('change', function() {
      var file = el.musicFileInput.files[0];
      if (file) {
        var mainP = el.fileUploadHint.querySelector('.file-upload-main');
        var subP = el.fileUploadHint.querySelector('.file-upload-sub');
        if (mainP) mainP.textContent = file.name;
        if (subP) subP.textContent = (file.size / 1024 / 1024).toFixed(1) + 'MB';
        el.uploadMusicBtn.disabled = false;
      }
    });
    el.uploadMusicBtn.addEventListener('click', uploadMusic);
    el.playerPlayBtn.addEventListener('click', togglePlay);
    el.playerPauseBtn.addEventListener('click', togglePlay);
    el.playerProgress.addEventListener('click', function(e) {
      var rect = el.playerProgress.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      if (el.audioPlayer.duration) {
        el.audioPlayer.currentTime = pct * el.audioPlayer.duration;
      }
    });
    el.audioPlayer.addEventListener('loadedmetadata', function() {
      el.playerDuration.textContent = formatDuration(el.audioPlayer.duration);
    });
    el.audioPlayer.addEventListener('timeupdate', function() {
      el.playerCurrent.textContent = formatDuration(el.audioPlayer.currentTime);
      if (el.audioPlayer.duration) {
        var pct = (el.audioPlayer.currentTime / el.audioPlayer.duration) * 100;
        el.playerProgressBar.style.width = pct + '%';
      }
    });
    el.audioPlayer.addEventListener('ended', function() {
      state.isPlaying = false;
      el.playerPlayBtn.style.display = 'block';
      el.playerPauseBtn.style.display = 'none';
      el.playerProgressBar.style.width = '0%';
    });

    // V0.5 新增：管理员用户管理事件绑定
    el.adminRefreshBtn.addEventListener('click', loadAdminUsers);

    // V0.6 新增：邮件系统事件绑定
    el.sendMailBtn.addEventListener('click', sendMail);
    el.mailRefreshBtn.addEventListener('click', loadMails);
    el.closeMailViewBtn.addEventListener('click', function() {
      el.mailViewModal.style.display = 'none';
    });
    el.mailViewModal.addEventListener('click', function(e) {
      if (e.target === el.mailViewModal) el.mailViewModal.style.display = 'none';
    });

    // V0.6 新增：音乐建议事件绑定
    el.submitSuggestionBtn.addEventListener('click', submitSuggestion);

    // V0.6 新增：头像上传事件绑定
    el.avatarUploadArea.addEventListener('click', function() {
      el.avatarFileInput.click();
    });
    el.avatarFileInput.addEventListener('change', function() {
      var file = el.avatarFileInput.files[0];
      if (file) uploadAvatar(file);
    });

    // V0.65.2 新增：字体切换
    var fontOptions = document.querySelectorAll('.font-option');
    fontOptions.forEach(function(opt) {
      opt.addEventListener('click', function() {
        var fontType = opt.getAttribute('data-font');
        fontOptions.forEach(function(o) { o.classList.remove('active'); });
        opt.classList.add('active');
        document.body.className = document.body.className.replace(/\s*font-\w+/g, '');
        if (fontType !== 'default') {
          document.body.classList.add('font-' + fontType);
        }
        localStorage.setItem('fc_font', fontType);
        showToast('字体已切换', 'success');
      });
    });

    // V0.65 新增：恢复字体设置
    var savedFont = localStorage.getItem('fc_font');
    if (savedFont && savedFont !== 'default') {
      document.body.classList.add('font-' + savedFont);
      fontOptions.forEach(function(o) {
        o.classList.toggle('active', o.getAttribute('data-font') === savedFont);
      });
    }

    // V0.65 新增：邮件收件人@选择
    if (el.mailRecipient) {
      el.mailRecipient.addEventListener('input', function() {
        var val = el.mailRecipient.value;
        var atIdx = val.lastIndexOf('@');
        if (atIdx >= 0) {
          var query = val.substring(atIdx + 1).toLowerCase();
          loadOnlineUsersForMail().then(function() {
            var filtered = onlineUserSuggestions.filter(function(u) {
              return u.nickname.toLowerCase().includes(query);
            });
            showMailRecipientSuggestions(filtered);
          });
        } else {
          var box = document.getElementById('mail-recipient-suggestions');
          if (box) box.style.display = 'none';
        }
      });
      el.mailRecipient.addEventListener('blur', function() {
        setTimeout(function() {
          var box = document.getElementById('mail-recipient-suggestions');
          if (box) box.style.display = 'none';
        }, 200);
      });
    }

    // V0.66 新增：群信息弹窗事件绑定
    // info-btn 按钮点击事件
    if (el.infoBtn) {
      el.infoBtn.addEventListener('click', function() {
        if (state.currentConvId && state.currentConv) {
          if (state.currentConv.type === 'group') {
            openGroupInfo(state.currentConvId);
          } else {
            // 私聊：显示对方信息（简单提示）
            var conv = state.currentConv;
            var otherMember = state.memberCache.values().next().value;
            showToast('私聊会话：' + (conv.name || '未知'), 'info');
          }
        }
      });
    }

    // 关闭群信息弹窗
    if (el.closeGroupInfoBtn) {
      el.closeGroupInfoBtn.addEventListener('click', function() {
        el.groupInfoModal.style.display = 'none';
        state.groupInfoConvId = null;
      });
    }
    if (el.groupInfoModal) {
      el.groupInfoModal.addEventListener('click', function(e) {
        if (e.target === el.groupInfoModal) {
          el.groupInfoModal.style.display = 'none';
          state.groupInfoConvId = null;
        }
      });
    }

    // 保存群信息
    if (el.saveGroupInfoBtn) {
      el.saveGroupInfoBtn.addEventListener('click', saveGroupInfo);
    }

    // 退出群聊
    if (el.leaveGroupBtn) {
      el.leaveGroupBtn.addEventListener('click', function() {
        leaveGroup(state.groupInfoConvId);
      });
    }

    // 邀请成员
    if (el.inviteMemberBtn) {
      el.inviteMemberBtn.addEventListener('click', function() {
        openInviteModal(state.groupInfoConvId);
      });
    }

    // 关闭邀请弹窗
    if (el.closeInviteBtn) {
      el.closeInviteBtn.addEventListener('click', function() {
        el.inviteModal.style.display = 'none';
        state.inviteSelectedFriends = [];
        state.inviteConvId = null;
      });
    }
    if (el.inviteModal) {
      el.inviteModal.addEventListener('click', function(e) {
        if (e.target === el.inviteModal) {
          el.inviteModal.style.display = 'none';
          state.inviteSelectedFriends = [];
          state.inviteConvId = null;
        }
      });
    }

    // 确认邀请
    if (el.confirmInviteBtn) {
      el.confirmInviteBtn.addEventListener('click', confirmInvite);
    }

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
    loadFriendRequests(); // V0.3: 启动时加载好友请求
    checkAdmin(); // V0.4: 检查管理员状态
    updateSendBtnIcon(); // 初始化发送按钮图标状态
    updateClock(); // V0.6: 启动时钟
    setInterval(updateClock, 1000); // V0.6: 每秒更新时钟
    loadUnreadMailCount(); // V0.6: 启动时加载未读邮件数
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
