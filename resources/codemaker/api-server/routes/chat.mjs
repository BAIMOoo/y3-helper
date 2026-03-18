/**
 * 聊天路由 - 处理所有聊天相关的 API 端点
 */

import { streamChatCompletion } from '../ai-provider.mjs';

/**
 * 从请求体中提取消息和模型参数
 * @param {Object} body - 请求体
 * @returns {{ messages: Array, model: string }}
 */
function extractParams(body) {
  const messages = body?.messages || [];
  const model = body?.model || '';
  return { messages, model };
}

/**
 * 处理流式聊天请求
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {Object} body - 解析后的请求体
 */
async function handleStreamChat(req, res, body) {
  // 打印调试信息
  console.log('[Chat] 收到请求，参数 keys:', Object.keys(body));
  console.log('[Chat] api_key:', body.api_key ? '✅ 有' : '❌ 无');
  console.log('[Chat] app_key:', body.app_key ? '✅ 有' : '❌ 无');
  console.log('[Chat] base_url:', body.base_url || '❌ 无');
  if (body.tools) {
    console.log('[Chat] tools 数量:', body.tools.length);
  }
  
  // 直接透传完整的请求体给 AI Provider
  await streamChatCompletion(body, res);
}

/**
 * 注册聊天路由
 * @param {Map} routes - 路由映射
 */
export function registerChatRoutes(routes) {
  // =============================================
  // 主要聊天端点
  // POST /proxy/gpt/gpt/text_chat_stream/:event
  // =============================================
  routes.set('POST:/proxy/gpt/gpt/text_chat_stream', handleStreamChat);

  // =============================================
  // Codebase 聊天端点
  // POST /proxy/gpt/u5_chat/codebase_chat_stream
  // =============================================
  routes.set('POST:/proxy/gpt/u5_chat/codebase_chat_stream', handleStreamChat);

  // =============================================
  // Agent 聊天端点
  // POST /proxy/gpt/u5_chat/codebase_agent_stream
  // =============================================
  routes.set('POST:/proxy/gpt/u5_chat/codebase_agent_stream', handleStreamChat);

  // =============================================
  // Hangyan 前缀端点（与上面相同逻辑）
  // =============================================
  routes.set('POST:/proxy/gpt/hangyan/gpt/text_chat_stream', handleStreamChat);
  routes.set('POST:/proxy/gpt/hangyan/u5_chat/codebase_chat_stream', handleStreamChat);
  routes.set('POST:/proxy/gpt/hangyan/u5_chat/codebase_agent_stream', handleStreamChat);

  // =============================================
  // 辅助端点 - 返回简单 Mock 响应
  // =============================================
  
  // Token 计算
  routes.set('POST:/proxy/gpt/gpt/calculate_tokens', (req, res, body) => {
    const text = body?.text || body?.content || '';
    sendJson(res, { code: 0, data: { token_count: Math.ceil(text.length / 4) } });
  });
  routes.set('POST:/proxy/gpt/hangyan/gpt/calculate_tokens', (req, res, body) => {
    const text = body?.text || body?.content || '';
    sendJson(res, { code: 0, data: { token_count: Math.ceil(text.length / 4) } });
  });

  // 配额检查
  routes.set('GET:/proxy/gpt/gpt/check_limit', (req, res) => {
    sendJson(res, { code: 0, data: { remaining: 9999, limit: 10000, used: 1 } });
  });
  routes.set('GET:/proxy/gpt/hangyan/gpt/check_limit', (req, res) => {
    sendJson(res, { code: 0, data: { remaining: 9999, limit: 10000, used: 1 } });
  });

  // 图片上传
  routes.set('POST:/proxy/gpt/u5_chat/upload_img', (req, res) => {
    sendJson(res, { code: 0, data: { url: 'https://via.placeholder.com/300x200?text=Uploaded' } });
  });
  routes.set('POST:/proxy/gpt/hangyan/u5_chat/upload_img', (req, res) => {
    sendJson(res, { code: 0, data: { url: 'https://via.placeholder.com/300x200?text=Uploaded' } });
  });

  // 反馈
  routes.set('POST:/proxy/gpt/u5_chat/chat_feedback', (req, res) => {
    sendJson(res, { code: 0, message: 'Feedback received' });
  });
  routes.set('POST:/proxy/gpt/hangyan/u5_chat/chat_feedback', (req, res) => {
    sendJson(res, { code: 0, message: 'Feedback received' });
  });
}

/**
 * 发送 JSON 响应
 * @param {import('http').ServerResponse} res
 * @param {Object} data
 */
function sendJson(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
