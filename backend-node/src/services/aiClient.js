// 与 Go pkg/ai + application/services/ai_service 对齐：读取 ai_service_configs，调用 OpenAI 兼容的 chat completions
const aiConfigService = require('./aiConfigService');

// 使用前端设置的「默认」与「优先级」：listConfigs 已按 is_default DESC, priority DESC 排序
function getDefaultConfig(db, serviceType) {
  const configs = aiConfigService.listConfigs(db, serviceType);
  const active = configs.filter((c) => c.is_active);
  if (active.length === 0) return null;
  const defaultOne = active.find((c) => c.is_default);
  return defaultOne != null ? defaultOne : active[0];
}

function getConfigForModel(db, serviceType, modelName) {
  const configs = aiConfigService.listConfigs(db, serviceType);
  for (const config of configs) {
    if (!config.is_active) continue;
    const models = Array.isArray(config.model) ? config.model : [config.model];
    if (models.includes(modelName)) return config;
  }
  return null;
}

function buildChatUrl(config) {
  const base = (config.base_url || '').replace(/\/$/, '');
  let ep = config.endpoint || '/chat/completions';
  if (!ep.startsWith('/')) ep = '/' + ep;
  return base + ep;
}

function getModelFromConfig(config, preferredModel) {
  const models = Array.isArray(config.model) ? config.model : (config.model != null ? [config.model] : []);
  if (preferredModel && models.includes(preferredModel)) return preferredModel;
  if (config.default_model && models.includes(config.default_model)) return config.default_model;
  return models[0] || 'gpt-3.5-turbo';
}

async function generateText(db, log, serviceType, userPrompt, systemPrompt, options = {}) {
  const { model: preferredModel, temperature = 0.7 } = options;
  let config = preferredModel
    ? getConfigForModel(db, serviceType, preferredModel)
    : getDefaultConfig(db, serviceType);
  if (!config && preferredModel === undefined) {
    // 兜底：如果前端传了 undefined，且没找到默认，尝试重新找一下（可能 serviceType 传值问题，或者数据库问题）
    config = getDefaultConfig(db, 'text');
  }
  if (!config) {
    throw new Error(`未配置文本模型，请在「AI 配置」中添加 ${serviceType} 类型 且已启用的配置`);
  }
  const model = getModelFromConfig(config, preferredModel);
  const url = buildChatUrl(config);

  // 解析 settings 里的 max_tokens 上限（用户在 AI 配置里可设置 {"max_tokens": 8192}）
  let settingsMaxTokens = null;
  try {
    if (config.settings) {
      const s = typeof config.settings === 'string' ? JSON.parse(config.settings) : config.settings;
      if (s && typeof s.max_tokens === 'number' && s.max_tokens > 0) settingsMaxTokens = s.max_tokens;
    }
  } catch (_) {}

  // 最终 max_tokens：优先取调用方传入值，但不超过 settings 里的上限；
  // 若调用方未传，则使用 settings 值（有的话）；两者都没有则不传（让模型用自己默认值）。
  let finalMaxTokens = null;
  if (options.max_tokens != null) {
    finalMaxTokens = Number(options.max_tokens);
    if (settingsMaxTokens != null && finalMaxTokens > settingsMaxTokens) {
      log.warn('AI generateText: max_tokens 超过配置上限，已截断', {
        requested: finalMaxTokens, capped_to: settingsMaxTokens, model,
      });
      finalMaxTokens = settingsMaxTokens;
    }
  } else if (settingsMaxTokens != null) {
    finalMaxTokens = settingsMaxTokens;
  }

  const body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
    temperature: Number(temperature),
    ...(finalMaxTokens != null ? { max_tokens: finalMaxTokens } : {}),
  };
  log.info('AI generateText request', { url: url.slice(0, 60), model, max_tokens: finalMaxTokens ?? '(model default)' });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (config.api_key || ''),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    log.error('AI generateText failed', { status: res.status, body: errText.slice(0, 300) });
    throw new Error('AI 请求失败: ' + res.status + ' ' + errText.slice(0, 200));
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (content == null) {
    throw new Error('AI 返回格式异常');
  }
  return content;
}

module.exports = {
  getDefaultConfig,
  getConfigForModel,
  generateText,
};
