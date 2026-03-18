/**
 * AI Provider - 处理与 AI API 服务的通信
 * 
 * 支持任意 OpenAI 兼容的 API 服务（如 LinkAPI、OpenAI、Azure 等）
 * API Key 和 Base URL 必须由客户端提供，服务器不保留默认值
 */

import { config } from './config.mjs';

// 请求超时时间（60秒）
const REQUEST_TIMEOUT = 60000;

/**
 * 从请求体中提取 API Key
 * 优先级：客户端 > 服务器环境变量
 * 
 * @param {Object} requestBody - 请求体
 * @returns {string|null} API Key
 */
function extractApiKey(requestBody) {
  // 1. 客户端直接提供的 api_key
  if (requestBody.api_key) {
    return requestBody.api_key;
  }
  
  // 2. 客户端提供的 app_key（VS Code 配置 CodeChatApiKey）
  if (requestBody.app_key) {
    return requestBody.app_key;
  }
  
  // 3. 服务器环境变量（备用）
  if (config.apiKey) {
    return config.apiKey;
  }
  
  return null;
}

/**
 * 从请求体中提取 API Base URL
 * 优先级：客户端 > 服务器环境变量
 * 
 * @param {Object} requestBody - 请求体
 * @returns {string|null} API Base URL
 */
function extractBaseUrl(requestBody) {
  // 1. 客户端直接提供的 base_url
  if (requestBody.base_url) {
    return requestBody.base_url.replace(/\/$/, ''); // 移除末尾斜杠
  }
  
  // 2. 客户端提供的 api_base_url
  if (requestBody.api_base_url) {
    return requestBody.api_base_url.replace(/\/$/, '');
  }
  
  // 3. 服务器配置（可能为空）
  if (config.baseUrl) {
    return config.baseUrl;
  }
  
  return null;
}

/**
 * 发送流式聊天请求到 AI API，并将响应转发给客户端
 * @param {Object} requestBody - 完整的请求体（包含 messages, model, tools 等）
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 */
export async function streamChatCompletion(requestBody, res) {
  // 从请求体中提取配置
  const apiKey = extractApiKey(requestBody);
  const baseUrl = extractBaseUrl(requestBody);
  
  // 检查必需的配置
  if (!apiKey) {
    sendErrorSSE(res, 
      '⚠️ **未配置 API Key**\n\n' +
      '请在 VS Code 设置中配置：\n' +
      '1. 按 `Ctrl + ,` 打开设置\n' +
      '2. 搜索 `CodeMaker.CodeChatApiKey`\n' +
      '3. 填入你的 API Key'
    );
    return;
  }

  if (!baseUrl) {
    sendErrorSSE(res, 
      '⚠️ **未配置 API 地址**\n\n' +
      '请在 VS Code 设置中配置：\n' +
      '1. 按 `Ctrl + ,` 打开设置\n' +
      '2. 搜索 `CodeMaker.CodeChatApiBaseUrl`\n' +
      '3. 填入 API 地址（如 `https://api.openai.com`）'
    );
    return;
  }

  const url = `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  // 构建发送给 AI API 的请求体（移除客户端特有的字段）
  const { 
    app_id, 
    app_key, 
    api_key,
    base_url, 
    api_base_url,
    codebase_chat_mode, 
    ...restBody 
  } = requestBody;
  
  // 构建请求体
  const apiRequestBody = {
    ...restBody,
    stream: true,
  };
  
  // 如果有指定模型，使用指定的模型；否则不传 model 让 API 使用默认配置
  if (requestBody.model) {
    apiRequestBody.model = requestBody.model;
  } else if (config.defaultModel) {
    apiRequestBody.model = config.defaultModel;
  }
  // 如果都没有，不传 model 字段，让 LinkAPI 使用令牌默认模型

  console.log(`[AI Provider] 请求 ${baseUrl} 使用模型 ${apiRequestBody.model}`);
  console.log(`[AI Provider] 请求体:`, JSON.stringify(apiRequestBody, null, 2).slice(0, 500));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(apiRequestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 处理 HTTP 错误
    if (!response.ok) {
      const errorText = await response.text();
      handleHttpError(res, response.status, errorText, baseUrl);
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 流式转发响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (streamError) {
      console.error('流式读取错误:', streamError);
      sendErrorSSE(res, '流式传输中断');
    }

    res.end();

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      sendErrorSSE(res, '请求超时，请稍后重试');
    } else {
      console.error('AI API 请求错误:', error);
      sendErrorSSE(res, `请求失败: ${error.message}`);
    }
  }
}

/**
 * 处理 HTTP 错误响应
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {string} errorText
 * @param {string} baseUrl
 */
function handleHttpError(res, status, errorText, baseUrl) {
  let message;
  
  switch (status) {
    case 401:
      message = '❌ **API 认证失败**\n\n请检查 API Key 是否正确。';
      break;
    case 403:
      message = '❌ **API 访问被拒绝**\n\n请检查 API Key 权限或账户状态。';
      break;
    case 429:
      message = '⏳ **请求频率超限**\n\n请稍后重试。';
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      message = `🔧 **API 服务暂时不可用**\n\n服务器: ${baseUrl}\n请稍后重试。`;
      break;
    default:
      // 尝试解析错误详情
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) {
          detail = parsed.error.message;
        }
      } catch {}
      message = `❌ **API 请求失败 (${status})**\n\n${detail}`;
  }
  
  console.error(`AI API HTTP 错误 [${status}] (${baseUrl}):`, errorText);
  sendErrorSSE(res, message);
}

/**
 * 以 SSE 格式发送错误消息
 * @param {import('http').ServerResponse} res
 * @param {string} message
 */
function sendErrorSSE(res, message) {
  // 如果响应头还没发送，先设置
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }

  const id = 'error-' + Date.now();
  
  // 发送错误内容
  const data = JSON.stringify({
    id,
    choices: [{
      delta: { content: message, tool_calls: null },
      finish_reason: null,
      index: 0,
    }],
  });
  res.write(`data: ${data}\n\n`);

  // 发送结束标记
  const finalData = JSON.stringify({
    id,
    choices: [{
      delta: { content: '', tool_calls: null },
      finish_reason: 'stop',
      index: 0,
    }],
  });
  res.write(`data: ${finalData}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
