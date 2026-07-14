/**
 * FlashChat Web - 服务器入口 V0.3
 * Express + Socket.IO + SQLite (better-sqlite3) + JWT 认证
 * V0.3 新增：完整好友系统（好友请求/接受/拒绝/删除、私聊需好友验证）
 *
 * 启动: node server.js
 * 访问: http://localhost:3000  /  http://<本机IP>:3000
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

// ============================================================
// 配置常量
// ============================================================
const APP_VERSION = 'v0.4';
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // 监听所有网络接口，允许局域网访问
const JWT_SECRET = process.env.JWT_SECRET || 'flashchat-secret-key-v0.2-please-change-in-production';
const JWT_EXPIRES_IN = '7d';
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'chat.db');
const MESSAGES_PAGE_SIZE = 20;
const SERVER_START_TIME = new Date().toISOString();
const MUSIC_DIR = path.join(DB_DIR, 'music');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';

// 头像可选背景色（随机分配给新用户）
const AVATAR_COLORS = [
  '#F44336', '#E91E63', '#9C27B0', '#673AB7',
  '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
  '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
  '#FFC107', '#FF9800', '#FF5722', '#795548',
  '#607D8B', '#E6194B', '#3CB44B', '#4363D8',
];

// ============================================================
// 数据库初始化
// ============================================================
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT,
    avatar_color TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_conv_members ON conversation_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON conversation_members(conversation_id);

  -- V0.3 新增：好友关系表
  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    addressee_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    UNIQUE(requester_id, addressee_id)
  );

  CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
  CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
  CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

  -- V0.4 新增：音乐表
  CREATE TABLE IF NOT EXISTS music (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    filesize INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    play_count INTEGER DEFAULT 0
  );
`);

// 预编译语句（参数化查询，防 SQL 注入）
const stmts = {
  insertUser: db.prepare(
    'INSERT INTO users (id, username, password_hash, nickname, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  searchUsers: db.prepare(
    'SELECT id, username, nickname, avatar_color, created_at FROM users WHERE username LIKE ? OR nickname LIKE ? LIMIT 20'
  ),
  updateUserProfile: db.prepare('UPDATE users SET nickname = ? WHERE id = ?'),

  insertConversation: db.prepare(
    'INSERT INTO conversations (id, type, name, avatar_color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getConversationById: db.prepare('SELECT * FROM conversations WHERE id = ?'),
  insertMember: db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)'
  ),
  getMembersByConversation: db.prepare(
    'SELECT user_id FROM conversation_members WHERE conversation_id = ?'
  ),
  getConversationsByUser: db.prepare(
    `SELECT c.* FROM conversations c
     INNER JOIN conversation_members cm ON c.id = cm.conversation_id
     WHERE cm.user_id = ? ORDER BY c.created_at DESC`
  ),
  getPrivateConversation: db.prepare(
    `SELECT c.* FROM conversations c
     WHERE c.type = 'private'
     AND EXISTS (SELECT 1 FROM conversation_members cm1 WHERE cm1.conversation_id = c.id AND cm1.user_id = ?)
     AND EXISTS (SELECT 1 FROM conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id = ?)`
  ),

  insertMessage: db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  getMessagesDesc: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
  ),
  getMessagesBefore: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
  ),
  getLastMessage: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
  ),
  getMessageCount: db.prepare(
    'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?'
  ),

  // V0.3 新增：好友关系预编译语句
  insertFriendship: db.prepare(
    'INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getFriendship: db.prepare(
    'SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ?'
  ),
  getFriendshipById: db.prepare(
    'SELECT * FROM friendships WHERE id = ?'
  ),
  getIncomingRequests: db.prepare(
    'SELECT * FROM friendships WHERE addressee_id = ? AND status = ? ORDER BY created_at DESC'
  ),
  getOutgoingRequests: db.prepare(
    'SELECT * FROM friendships WHERE requester_id = ? AND status = ? ORDER BY created_at DESC'
  ),
  getFriends: db.prepare(
    `SELECT * FROM friendships
     WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
     ORDER BY accepted_at DESC`
  ),
  updateFriendshipStatus: db.prepare(
    "UPDATE friendships SET status = ?, accepted_at = ? WHERE id = ?"
  ),
  deleteFriendship: db.prepare(
    'DELETE FROM friendships WHERE id = ?'
  ),
  getFriendshipBetween: db.prepare(
    `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)`
  ),

  // V0.4 新增：音乐系统预编译语句
  insertMusic: db.prepare(
    'INSERT INTO music (id, title, filename, original_name, filesize, mime_type, uploaded_by, uploaded_at, play_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)'
  ),
  getMusicById: db.prepare('SELECT * FROM music WHERE id = ?'),
  getAllMusic: db.prepare('SELECT * FROM music ORDER BY uploaded_at DESC'),
  deleteMusicRow: db.prepare('DELETE FROM music WHERE id = ?'),
  incMusicPlayCount: db.prepare('UPDATE music SET play_count = play_count + 1 WHERE id = ?'),
};

// ============================================================
// 在线状态管理
// 维护 userId -> Set<socketId> 的映射
// ============================================================
const onlineSockets = new Map(); // userId -> Set<socketId>
const socketToUser = new Map(); // socketId -> userId
// 用户当前正在查看的会话（用于已读判定）
const userActiveConversation = new Map(); // userId -> conversationId

function setUserOnline(userId, socketId) {
  if (!onlineSockets.has(userId)) {
    onlineSockets.set(userId, new Set());
  }
  onlineSockets.get(userId).add(socketId);
  socketToUser.set(socketId, userId);
}

function setUserOffline(userId, socketId) {
  const sockets = onlineSockets.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      onlineSockets.delete(userId);
      return true; // 用户完全离线
    }
  }
  socketToUser.delete(socketId);
  return false;
}

function isUserOnline(userId) {
  const sockets = onlineSockets.get(userId);
  return !!sockets && sockets.size > 0;
}

/**
 * 让用户所有在线 socket 加入指定会话 room
 * 用于会话创建后让已连接的成员 socket 也能收到该会话的实时事件
 */
function joinUserSocketsToRoom(userId, conversationId) {
  if (isUserOnline(userId)) {
    io.in(`user:${userId}`).socketsJoin(conversationId);
  }
}

// ============================================================
// Express 应用
// ============================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// V0.4 新增：音乐上传 multer 配置
const musicUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MUSIC_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
    const allowedMime = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/x-aiff', 'application/ogg'];
    if (allowedMime.includes(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持音频文件 (mp3, wav, ogg, m4a, flac, aac)'));
    }
  },
});

// ----- 工具函数 -----
function pickAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function nowISO() {
  return new Date().toISOString();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatarColor: user.avatar_color,
    createdAt: user.created_at,
  };
}

function isAdmin(user) {
  return !!ADMIN_USERNAME && user.username === ADMIN_USERNAME;
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 获取本机局域网 IP 地址
 * 遍历所有网络接口，返回第一个非内部 IPv4 地址
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // 跳过内部回环地址和 IPv6
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 认证中间件（REST）
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmts.getUserById.get(payload.sub);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '认证令牌无效或已过期' });
  }
}

// 构建会话详情（含最后一条消息、成员、未读数）
function buildConversationDetail(conversation, currentUserId) {
  const members = stmts.getMembersByConversation
    .all(conversation.id)
    .map((row) => row.user_id);
  const lastMsgRow = stmts.getLastMessage.get(conversation.id);
  const lastMessage = lastMsgRow
    ? {
        id: lastMsgRow.id,
        content: lastMsgRow.content,
        senderId: lastMsgRow.sender_id,
        createdAt: lastMsgRow.created_at,
      }
    : null;

  // 未读数：进入会话时清零；否则从内存映射中获取累计未读
  let unreadCount = 0;
  const activeConv = userActiveConversation.get(currentUserId);
  if (activeConv !== conversation.id) {
    unreadCount = unreadMap.getIncoming(conversation.id, currentUserId);
  } else {
    unreadMap.clearIncoming(conversation.id, currentUserId);
  }

  // 私聊会话：显示对方昵称作为标题
  let displayName = conversation.name;
  let displayColor = conversation.avatar_color;
  if (conversation.type === 'private') {
    const otherId = members.find((m) => m !== currentUserId) || currentUserId;
    const other = stmts.getUserById.get(otherId);
    if (other) {
      displayName = other.nickname;
      displayColor = other.avatar_color;
    }
  }

  return {
    id: conversation.id,
    type: conversation.type,
    name: displayName,
    avatarColor: displayColor,
    createdBy: conversation.created_by,
    createdAt: conversation.created_at,
    members,
    lastMessage,
    unreadCount,
  };
}

// 未读计数内存映射（key: conversationId, value: Map<userId, count>）
const unreadMap = {
  _data: new Map(),
  _ensure(convId) {
    if (!this._data.has(convId)) this._data.set(convId, new Map());
    return this._data.get(convId);
  },
  getIncoming(convId, userId) {
    const m = this._ensure(convId);
    return m.get(userId) || 0;
  },
  incIncoming(convId, userId) {
    const m = this._ensure(convId);
    m.set(userId, (m.get(userId) || 0) + 1);
  },
  clearIncoming(convId, userId) {
    const m = this._data.get(convId);
    if (m) m.set(userId, 0);
  },
};

// ============================================================
// REST API 路由
// ============================================================

// 服务器信息接口（V0.2 新增）
app.get('/api/server-info', (req, res) => {
  res.json({
    version: APP_VERSION,
    onlineUsers: onlineSockets.size,
    startedAt: SERVER_START_TIME,
  });
});

// 注册
app.post('/api/register', (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (!username || !password || !nickname) {
    return res.status(400).json({ error: '用户名、密码和昵称不能为空' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度需为 3-20 个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码长度至少 6 位' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: '用户名只能包含字母、数字和下划线' });
  }

  const existing = stmts.getUserByUsername.get(username);
  if (existing) {
    return res.status(409).json({ error: '该用户名已被注册' });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const avatarColor = pickAvatarColor();
  const createdAt = nowISO();

  stmts.insertUser.run(id, username, passwordHash, nickname, avatarColor, createdAt);

  const user = stmts.getUserById.get(id);
  const token = signToken(id);
  res.json({ token, user: publicUser(user) });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = stmts.getUserByUsername.get(username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = signToken(user.id);
  res.json({ token, user: publicUser(user) });
});

// 获取当前用户
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: { ...publicUser(req.user), isAdmin: isAdmin(req.user) } });
});

// 搜索用户
app.get('/api/users/search', authMiddleware, (req, res) => {
  const query = (req.query.query || '').toString().trim();
  if (!query) {
    return res.json({ users: [] });
  }
  const pattern = `%${query}%`;
  const users = stmts.searchUsers.all(pattern, pattern)
    .filter((u) => u.id !== req.user.id)
    .map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatarColor: u.avatar_color,
      online: isUserOnline(u.id),
    }));
  res.json({ users });
});

// 获取会话列表
app.get('/api/conversations', authMiddleware, (req, res) => {
  const convs = stmts.getConversationsByUser.all(req.user.id);
  const details = convs.map((c) => buildConversationDetail(c, req.user.id));
  // 按最后消息时间排序，无消息的排后面
  details.sort((a, b) => {
    const ta = a.lastMessage ? a.lastMessage.createdAt : a.createdAt;
    const tb = b.lastMessage ? b.lastMessage.createdAt : b.createdAt;
    return tb.localeCompare(ta);
  });
  res.json({ conversations: details });
});

// 创建/获取私聊会话
app.post('/api/conversations/private', authMiddleware, (req, res) => {
  const { targetUserId } = req.body || {};
  if (!targetUserId) {
    return res.status(400).json({ error: '缺少目标用户 ID' });
  }
  const target = stmts.getUserById.get(targetUserId);
  if (!target) {
    return res.status(404).json({ error: '目标用户不存在' });
  }
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: '不能与自己创建私聊' });
  }

  // V0.3 新增：检查好友关系（status === 'accepted' 才允许私聊）
  const friendship = stmts.getFriendshipBetween.get(req.user.id, targetUserId, targetUserId, req.user.id);
  if (!friendship || friendship.status !== 'accepted') {
    return res.status(403).json({ error: '需要先加好友才能发起私聊' });
  }

  // 查找已有私聊
  let conv = stmts.getPrivateConversation.get(req.user.id, targetUserId);
  if (!conv) {
    const id = uuidv4();
    const createdAt = nowISO();
    stmts.insertConversation.run(id, 'private', null, null, req.user.id, createdAt);
    stmts.insertMember.run(id, req.user.id, createdAt);
    stmts.insertMember.run(id, targetUserId, createdAt);
    conv = stmts.getConversationById.get(id);
    // 让双方在线 socket 加入新会话 room
    joinUserSocketsToRoom(req.user.id, conv.id);
    joinUserSocketsToRoom(targetUserId, conv.id);
  }

  res.json({ conversation: buildConversationDetail(conv, req.user.id) });
});

// 创建群聊
app.post('/api/conversations/group', authMiddleware, (req, res) => {
  const { name, memberIds } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '群组名称不能为空' });
  }
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: '至少选择一个成员' });
  }

  const id = uuidv4();
  const createdAt = nowISO();
  const avatarColor = pickAvatarColor();
  stmts.insertConversation.run(id, 'group', name.trim(), avatarColor, req.user.id, createdAt);
  // 创建者自动加入
  stmts.insertMember.run(id, req.user.id, createdAt);
  // 让创建者 socket 加入新会话 room
  joinUserSocketsToRoom(req.user.id, id);
  // 其他成员加入
  for (const memberId of memberIds) {
    if (memberId === req.user.id) continue;
    const m = stmts.getUserById.get(memberId);
    if (m) {
      stmts.insertMember.run(id, memberId, createdAt);
      // 让成员 socket 加入新会话 room
      joinUserSocketsToRoom(memberId, id);
    }
  }

  const conv = stmts.getConversationById.get(id);
  res.json({ conversation: buildConversationDetail(conv, req.user.id) });
});

// 获取历史消息（分页）
app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const convId = req.params.id;
  const conv = stmts.getConversationById.get(convId);
  if (!conv) {
    return res.status(404).json({ error: '会话不存在' });
  }
  // 校验成员资格
  const members = stmts.getMembersByConversation.all(convId).map((r) => r.user_id);
  if (!members.includes(req.user.id)) {
    return res.status(403).json({ error: '无权访问该会话' });
  }

  const before = req.query.before ? req.query.before.toString() : null;
  const limit = Math.min(
    parseInt(req.query.limit, 10) || MESSAGES_PAGE_SIZE,
    50
  );

  let rows;
  if (before) {
    rows = stmts.getMessagesBefore.all(convId, before, limit);
  } else {
    rows = stmts.getMessagesDesc.all(convId, limit);
  }

  // 反转为时间正序，并附带发送者信息
  const messages = rows.reverse().map((m) => {
    const sender = stmts.getUserById.get(m.sender_id);
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      sender: publicUser(sender),
      content: m.content,
      createdAt: m.created_at,
    };
  });

  // 标记已读
  userActiveConversation.set(req.user.id, convId);
  unreadMap.clearIncoming(convId, req.user.id);

  res.json({ messages, hasMore: rows.length === limit });
});

// 更新个人资料
app.put('/api/users/profile', authMiddleware, (req, res) => {
  const { nickname } = req.body || {};
  if (!nickname || !nickname.trim()) {
    return res.status(400).json({ error: '昵称不能为空' });
  }
  stmts.updateUserProfile.run(nickname.trim(), req.user.id);
  const user = stmts.getUserById.get(req.user.id);
  res.json({ user: publicUser(user) });
});

// 获取用户在线状态
app.get('/api/users/:id/presence', authMiddleware, (req, res) => {
  const userId = req.params.id;
  const user = stmts.getUserById.get(userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json({ userId, online: isUserOnline(userId) });
});

// 获取群组成员详情
app.get('/api/conversations/:id/members', authMiddleware, (req, res) => {
  const convId = req.params.id;
  const conv = stmts.getConversationById.get(convId);
  if (!conv) {
    return res.status(404).json({ error: '会话不存在' });
  }
  const members = stmts.getMembersByConversation.all(convId).map((r) => r.user_id);
  if (!members.includes(req.user.id)) {
    return res.status(403).json({ error: '无权访问该会话' });
  }
  const details = members.map((mid) => {
    const u = stmts.getUserById.get(mid);
    return {
      ...publicUser(u),
      online: isUserOnline(mid),
    };
  });
  res.json({ members: details });
});

// ============================================================
// V0.3 新增：好友系统 API 路由
// ============================================================

// 发送好友请求
app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { targetUserId } = req.body || {};
  if (!targetUserId) {
    return res.status(400).json({ error: '缺少目标用户 ID' });
  }
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: '不能加自己为好友' });
  }
  const target = stmts.getUserById.get(targetUserId);
  if (!target) {
    return res.status(404).json({ error: '目标用户不存在' });
  }

  // 检查是否已有好友关系
  const existing = stmts.getFriendshipBetween.get(req.user.id, targetUserId, targetUserId, req.user.id);
  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(409).json({ error: '你们已经是好友了' });
    }
    if (existing.status === 'pending' && existing.requester_id === req.user.id) {
      return res.status(409).json({ error: '已发送过好友请求，等待对方确认' });
    }
    // 如果对方之前请求加我（pending），直接接受
    if (existing.status === 'pending' && existing.requester_id === targetUserId) {
      stmts.updateFriendshipStatus.run('accepted', nowISO(), existing.id);
      // 通知对方
      io.to(`user:${targetUserId}`).emit('friend_request_response', {
        id: existing.id, status: 'accepted', by: publicUser(req.user),
      });
      return res.json({ friendship: { id: existing.id, status: 'accepted' } });
    }
    // 如果之前被拒绝过，重新发起请求
    if (existing.status === 'rejected') {
      stmts.updateFriendshipStatus.run('pending', null, existing.id);
      io.to(`user:${targetUserId}`).emit('friend_request', {
        id: existing.id, from: publicUser(req.user),
      });
      return res.json({ friendship: { id: existing.id, status: 'pending' } });
    }
  }

  const id = uuidv4();
  const createdAt = nowISO();
  stmts.insertFriendship.run(id, req.user.id, targetUserId, 'pending', createdAt, null);

  // Socket.IO 实时通知对方
  io.to(`user:${targetUserId}`).emit('friend_request', {
    id, from: publicUser(req.user),
  });

  res.json({ friendship: { id, status: 'pending' } });
});

// 接受好友请求
app.post('/api/friends/:id/accept', authMiddleware, (req, res) => {
  const friendship = stmts.getFriendshipById.get(req.params.id);
  if (!friendship) {
    return res.status(404).json({ error: '好友请求不存在' });
  }
  if (friendship.addressee_id !== req.user.id) {
    return res.status(403).json({ error: '无权操作此请求' });
  }
  if (friendship.status !== 'pending') {
    return res.status(400).json({ error: '该请求已被处理' });
  }

  const acceptedAt = nowISO();
  stmts.updateFriendshipStatus.run('accepted', acceptedAt, friendship.id);

  // 通知请求方
  io.to(`user:${friendship.requester_id}`).emit('friend_request_response', {
    id: friendship.id, status: 'accepted', by: publicUser(req.user),
  });

  res.json({ friendship: { id: friendship.id, status: 'accepted' } });
});

// 拒绝好友请求
app.post('/api/friends/:id/reject', authMiddleware, (req, res) => {
  const friendship = stmts.getFriendshipById.get(req.params.id);
  if (!friendship) {
    return res.status(404).json({ error: '好友请求不存在' });
  }
  if (friendship.addressee_id !== req.user.id) {
    return res.status(403).json({ error: '无权操作此请求' });
  }
  if (friendship.status !== 'pending') {
    return res.status(400).json({ error: '该请求已被处理' });
  }

  stmts.updateFriendshipStatus.run('rejected', null, friendship.id);

  // 通知请求方
  io.to(`user:${friendship.requester_id}`).emit('friend_request_response', {
    id: friendship.id, status: 'rejected',
  });

  res.json({ friendship: { id: friendship.id, status: 'rejected' } });
});

// 获取好友列表
app.get('/api/friends', authMiddleware, (req, res) => {
  const rows = stmts.getFriends.all(req.user.id, req.user.id);
  const friends = rows.map((row) => {
    const otherId = row.requester_id === req.user.id ? row.addressee_id : row.requester_id;
    const u = stmts.getUserById.get(otherId);
    return {
      friendshipId: row.id,
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatarColor: u.avatar_color,
      online: isUserOnline(u.id),
      since: row.accepted_at,
    };
  });
  res.json({ friends });
});

// 获取好友请求列表（收到的待处理请求）
app.get('/api/friends/requests', authMiddleware, (req, res) => {
  const rows = stmts.getIncomingRequests.all(req.user.id, 'pending');
  const requests = rows.map((row) => {
    const u = stmts.getUserById.get(row.requester_id);
    return {
      id: row.id,
      from: {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatarColor: u.avatar_color,
      },
      createdAt: row.created_at,
    };
  });
  res.json({ requests });
});

// 删除好友
app.delete('/api/friends/:id', authMiddleware, (req, res) => {
  const friendship = stmts.getFriendshipById.get(req.params.id);
  if (!friendship) {
    return res.status(404).json({ error: '好友关系不存在' });
  }
  if (friendship.requester_id !== req.user.id && friendship.addressee_id !== req.user.id) {
    return res.status(403).json({ error: '无权操作' });
  }

  const otherId = friendship.requester_id === req.user.id ? friendship.addressee_id : friendship.requester_id;
  stmts.deleteFriendship.run(friendship.id);

  // 通知对方
  io.to(`user:${otherId}`).emit('friend_removed', { id: friendship.id });

  res.json({ ok: true });
});

// ============================================================
// V0.4 新增：音乐系统 API 路由
// ============================================================

// 上传音乐（仅管理员）
app.post('/api/music/upload', authMiddleware, (req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: '仅管理员可上传音乐' });
  }
  next();
}, musicUpload.single('music'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到文件或文件格式不支持' });
  }
  const id = uuidv4();
  const title = (req.body.title || req.file.originalname).replace(/\.[^.]+$/, '');
  const uploadedAt = nowISO();
  stmts.insertMusic.run(
    id, title, req.file.filename, req.file.originalname,
    req.file.size, req.file.mimetype, req.user.id, uploadedAt
  );
  const music = stmts.getMusicById.get(id);
  res.json({
    music: {
      id: music.id,
      title: music.title,
      originalName: music.original_name,
      filesize: music.filesize,
      uploadedAt: music.uploaded_at,
      playCount: music.play_count,
    },
  });
});

// 获取音乐列表（所有登录用户）
app.get('/api/music/list', authMiddleware, (req, res) => {
  const rows = stmts.getAllMusic.all();
  const musicList = rows.map((m) => ({
    id: m.id,
    title: m.title,
    originalName: m.original_name,
    filesize: m.filesize,
    uploadedAt: m.uploaded_at,
    playCount: m.play_count,
  }));
  res.json({ music: musicList });
});

// 流式播放音乐（支持 query token 认证，因为 <audio> 标签不支持自定义 Header）
app.get('/api/music/:id/stream', (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmts.getUserById.get(payload.sub);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
  } catch (err) {
    return res.status(401).json({ error: '认证令牌无效' });
  }

  const music = stmts.getMusicById.get(req.params.id);
  if (!music) {
    return res.status(404).json({ error: '音乐不存在' });
  }
  const filePath = path.join(MUSIC_DIR, music.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '音乐文件丢失' });
  }
  // 增加播放次数
  stmts.incMusicPlayCount.run(music.id);
  // sendFile 自动支持 Range 请求（可拖动进度条）
  res.sendFile(filePath);
});

// 删除音乐（仅管理员）
app.delete('/api/music/:id', authMiddleware, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: '仅管理员可删除音乐' });
  }
  const music = stmts.getMusicById.get(req.params.id);
  if (!music) {
    return res.status(404).json({ error: '音乐不存在' });
  }
  const filePath = path.join(MUSIC_DIR, music.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { /* 忽略文件删除错误 */ }
  }
  stmts.deleteMusicRow.run(music.id);
  res.json({ ok: true });
});

// 前端路由回退
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// Socket.IO 实时通信
// ============================================================

// Socket.IO 认证中间件
io.use((socket, next) => {
  const token = (socket.handshake.auth && socket.handshake.auth.token) || null;
  if (!token) {
    return next(new Error('未提供认证令牌'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmts.getUserById.get(payload.sub);
    if (!user) {
      return next(new Error('用户不存在'));
    }
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('认证令牌无效'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  const userId = user.id;
  const wasOffline = !isUserOnline(userId);
  setUserOnline(userId, socket.id);

  // 加入该用户参与的所有会话 room
  const convs = stmts.getConversationsByUser.all(userId);
  for (const c of convs) {
    socket.join(c.id);
  }

  // 如果用户从离线变为在线，广播状态
  if (wasOffline) {
    broadcastPresence(userId, true);
  }

  // ---- 事件: send_message ----
  socket.on('send_message', (payload, ack) => {
    try {
      const { conversationId, content } = payload || {};
      if (!conversationId || !content || !content.trim()) {
        if (typeof ack === 'function') ack({ error: '参数无效' });
        return;
      }
      // 校验成员资格
      const members = stmts.getMembersByConversation
        .all(conversationId)
        .map((r) => r.user_id);
      if (!members.includes(userId)) {
        if (typeof ack === 'function') ack({ error: '无权发送消息到该会话' });
        return;
      }

      const id = uuidv4();
      const createdAt = nowISO();
      stmts.insertMessage.run(id, conversationId, userId, content.trim(), createdAt);

      const message = {
        id,
        conversationId,
        senderId: userId,
        sender: publicUser(user),
        content: content.trim(),
        createdAt,
      };

      // 推送给会话 room 内所有用户
      io.to(conversationId).emit('new_message', message);

      // 对不在线该会话的用户累计未读
      const conv = stmts.getConversationById.get(conversationId);
      for (const memberId of members) {
        if (memberId === userId) continue;
        const active = userActiveConversation.get(memberId);
        if (active !== conversationId) {
          unreadMap.incIncoming(conversationId, memberId);
          // 若用户在线，通过其私有 channel 推送未读更新提示
          if (isUserOnline(memberId)) {
            io.to(`user:${memberId}`).emit('conversation_updated', {
              conversationId,
              lastMessage: { content: message.content, senderId: userId, createdAt },
              unreadCount: unreadMap.getIncoming(conversationId, memberId),
            });
          }
        } else {
          // 对方正在查看该会话，通知发送方消息已读（✓✓）
          io.to(`user:${userId}`).emit('message_read', {
            conversationId,
            messageIds: [id],
          });
        }
      }

      if (typeof ack === 'function') ack({ ok: true, message });
    } catch (err) {
      console.error('send_message error:', err);
      if (typeof ack === 'function') ack({ error: '服务器内部错误' });
    }
  });

  // ---- 事件: mark_read ----
  socket.on('mark_read', (payload) => {
    const { conversationId } = payload || {};
    if (!conversationId) return;
    userActiveConversation.set(userId, conversationId);
    unreadMap.clearIncoming(conversationId, userId);

    // 通知该会话中所有消息的发送者：对方已读（用于 ✓✓ 回执）
    const members = stmts.getMembersByConversation
      .all(conversationId)
      .map((r) => r.user_id);
    for (const memberId of members) {
      if (memberId === userId) continue;
      io.to(`user:${memberId}`).emit('message_read', {
        conversationId,
        // 通知发送方该会话的消息已被读，前端据此将 ✓ 变为 ✓✓
        allRead: true,
      });
    }
  });

  // ---- 事件: leave_conversation ----
  socket.on('leave_conversation', () => {
    userActiveConversation.delete(userId);
  });

  // ---- 事件: typing ----
  socket.on('typing', (payload) => {
    const { conversationId } = payload || {};
    if (!conversationId) return;
    socket.to(conversationId).emit('typing', {
      conversationId,
      userId,
      nickname: user.nickname,
    });
  });

  // ---- 事件: stop_typing ----
  socket.on('stop_typing', (payload) => {
    const { conversationId } = payload || {};
    if (!conversationId) return;
    socket.to(conversationId).emit('stop_typing', {
      conversationId,
      userId,
    });
  });

  // ---- 加入私有用户 room（用于接收定向推送） ----
  socket.join(`user:${userId}`);

  // ---- 断开连接 ----
  socket.on('disconnect', () => {
    const fullyOffline = setUserOffline(userId, socket.id);
    if (fullyOffline) {
      userActiveConversation.delete(userId);
      broadcastPresence(userId, false);
    }
  });
});

// 广播在线状态给用户所在会话的其他成员
function broadcastPresence(userId, online) {
  const convs = stmts.getConversationsByUser.all(userId);
  const notified = new Set();
  for (const c of convs) {
    const members = stmts.getMembersByConversation.all(c.id).map((r) => r.user_id);
    for (const memberId of members) {
      if (memberId === userId || notified.has(memberId)) continue;
      notified.add(memberId);
      io.to(`user:${memberId}`).emit('presence_update', { userId, online });
    }
  }
}

// ============================================================
// 启动服务器
// ============================================================
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  io.close();
  server.close();
  db.close();
  process.exit(0);
});

server.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  console.log('========================================');
  console.log(`  FlashChat Web ${APP_VERSION} 已启动`);
  console.log('========================================');
  console.log(`  本机访问地址:   http://localhost:${PORT}`);
  console.log(`  局域网访问地址: http://${localIP}:${PORT}`);
  console.log('----------------------------------------');
  console.log(`  数据库: ${DB_PATH}`);
  console.log(`  监听: ${HOST}:${PORT} (允许外部访问)`);
  console.log('----------------------------------------');
  console.log('  按 Ctrl+C 停止服务');
  console.log('========================================');
});
