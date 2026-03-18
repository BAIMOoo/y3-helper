/**
 * 历史记录路由 - 处理聊天历史相关的 API 端点
 * 支持文件持久化：通过环境变量 CHAT_HISTORY_PATH 指定存储目录
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// 内存存储 + 文件持久化
const chatHistories = new Map();
let nextId = 1;

// 持久化文件路径
const storagePath = process.env.CHAT_HISTORY_PATH || '';
const historyFilePath = storagePath ? join(storagePath, 'chat_histories.json') : '';

/**
 * 从文件加载历史记录到内存
 */
function loadFromFile() {
  if (!historyFilePath) { return; }
  try {
    if (!existsSync(historyFilePath)) { return; }
    const raw = readFileSync(historyFilePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data && data.histories) {
      for (const session of data.histories) {
        chatHistories.set(session._id, session);
      }
      nextId = data.nextId || (chatHistories.size + 1);
      console.log(`[History] 从文件加载了 ${chatHistories.size} 个会话`);
    }
  } catch (err) {
    console.error('[History] 加载历史记录文件失败:', err.message);
  }
}

/**
 * 将内存中的历史记录写入文件
 */
function saveToFile() {
  if (!historyFilePath) { return; }
  try {
    if (storagePath && !existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }
    const data = {
      nextId,
      histories: Array.from(chatHistories.values()),
    };
    writeFileSync(historyFilePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[History] 保存历史记录文件失败:', err.message);
  }
}

// 启动时加载
loadFromFile();

function makeSession(overrides = {}) {
  const id = String(nextId++);
  const now = new Date().toISOString();
  return {
    _id: id,
    topic: 'New Chat',
    chat_type: 'codebase',
    chat_repo: '',
    metadata: {
      create_time: now,
      update_time: now,
      creator: 'demo-user',
    },
    data: {
      messages: [],
      model: 'gpt-4o',
    },
    ...overrides,
  };
}

/**
 * 注册历史记录路由
 * @param {Map} routes - 路由映射
 */
export function registerHistoryRoutes(routes) {
  // GET /proxy/gpt/u5_chat/chat_histories - 获取所有会话
  routes.set('GET:/proxy/gpt/u5_chat/chat_histories', (req, res) => {
    const items = Array.from(chatHistories.values());
    console.log(`[History] GET all - 返回 ${items.length} 个会话:`);
    items.forEach(s => {
      console.log(`  - ID: ${s._id}, topic: ${s.topic}, chat_type: ${s.chat_type}, messages: ${s.data?.messages?.length || 0}`);
    });
    sendJson(res, { items, total: items.length });
  });

  // POST /proxy/gpt/u5_chat/chat_histories - 创建新会话
  routes.set('POST:/proxy/gpt/u5_chat/chat_histories', (req, res, body) => {
    const session = makeSession({
      topic: body.topic || 'New Chat',
      chat_type: body.chat_type || 'codebase',
      data: body.data || { messages: [], model: 'gpt-4o' },
    });
    chatHistories.set(session._id, session);
    saveToFile();
    sendJson(res, session);
  });

  // GET /proxy/gpt/u5_chat/chat_histories/:id - 获取单个会话
  routes.set('GET:/proxy/gpt/u5_chat/chat_histories/:id', (req, res) => {
    const id = req.params?.id;
    const session = getOrCreateSessionInternal(id);
    sendJson(res, session);
  });

  // PUT /proxy/gpt/u5_chat/chat_histories/:id - 更新会话
  routes.set('PUT:/proxy/gpt/u5_chat/chat_histories/:id', (req, res, body) => {
    const id = req.params?.id;
    console.log(`[History] PUT /${id} - 收到数据:`, JSON.stringify(body, null, 2).slice(0, 500));
    const updated = updateSessionInternal(id, body);
    saveToFile();
    console.log(`[History] PUT /${id} - 更新后 messages: ${updated.data?.messages?.length || 0}`);
    sendJson(res, updated);
  });

  // PATCH /proxy/gpt/u5_chat/chat_histories/:id - 部分更新会话
  routes.set('PATCH:/proxy/gpt/u5_chat/chat_histories/:id', (req, res, body) => {
    const id = req.params?.id;
    const updated = updateSessionInternal(id, body);
    saveToFile();
    sendJson(res, updated);
  });

  // DELETE /proxy/gpt/u5_chat/chat_histories/:id - 删除会话
  routes.set('DELETE:/proxy/gpt/u5_chat/chat_histories/:id', (req, res) => {
    const id = req.params?.id;
    chatHistories.delete(id);
    saveToFile();
    sendJson(res, { code: 0, message: 'Deleted' });
  });

  // Hangyan 前缀
  routes.set('GET:/proxy/gpt/hangyan/u5_chat/chat_histories', (req, res) => {
    const items = Array.from(chatHistories.values());
    sendJson(res, { items, total: items.length });
  });

  routes.set('POST:/proxy/gpt/hangyan/u5_chat/chat_histories', (req, res, body) => {
    const session = makeSession({
      topic: body.topic || 'New Chat',
      chat_type: body.chat_type || 'codebase',
      data: body.data || { messages: [], model: 'gpt-4o' },
    });
    chatHistories.set(session._id, session);
    saveToFile();
    sendJson(res, session);
  });
}

/**
 * 根据 ID 获取或创建会话（用于动态路由）
 */
export function getOrCreateSession(id) {
  if (!chatHistories.has(id)) {
    const session = makeSession({ _id: id });
    chatHistories.set(id, session);
  }
  return chatHistories.get(id);
}

/**
 * 更新会话
 */
export function updateSession(id, updates) {
  let history = chatHistories.get(id);
  if (!history) {
    history = makeSession({ _id: id });
  }
  const updated = {
    ...history,
    ...updates,
    _id: history._id,
    metadata: {
      ...history.metadata,
      ...(updates.metadata || {}),
      update_time: new Date().toISOString(),
    },
  };
  chatHistories.set(id, updated);
  return updated;
}

// 内部使用的函数
function getOrCreateSessionInternal(id) {
  if (!chatHistories.has(id)) {
    const now = new Date().toISOString();
    const session = {
      _id: id,
      topic: 'New Chat',
      chat_type: 'codebase',
      chat_repo: '',
      metadata: {
        create_time: now,
        update_time: now,
        creator: 'demo-user',
      },
      data: {
        messages: [],
        model: 'gpt-4o',
      },
    };
    chatHistories.set(id, session);
  }
  return chatHistories.get(id);
}

function updateSessionInternal(id, updates) {
  let history = chatHistories.get(id);
  if (!history) {
    history = getOrCreateSessionInternal(id);
  }
  const updated = {
    ...history,
    ...updates,
    _id: history._id,
    metadata: {
      ...history.metadata,
      ...(updates.metadata || {}),
      update_time: new Date().toISOString(),
    },
  };
  chatHistories.set(id, updated);
  return updated;
}

function sendJson(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
