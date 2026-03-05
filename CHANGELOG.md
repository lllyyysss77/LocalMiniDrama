# Changelog

所有版本的重要改动记录在此文件中，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.2.0] - 2026-03-05

### 新增

- **Google Gemini 图片生成支持**：新增 `callGeminiImageApi`，使用 `generateContent` 接口，支持 `gemini-2.5-flash-image`、`gemini-3.1-flash-image-preview`、`gemini-3-pro-image-preview` 等模型
- **Google Gemini (Veo) 视频生成支持**：新增 `callGeminiVideoApi`，支持 `veo-3.1-generate-preview`、`veo-3.0-generate-preview`、`veo-3.0-fast-generate-preview` 等模型，含异步任务轮询
- **Gemini 参考图支持（图床方案）**：分镜图片生成时，参考图先上传至中转图床获取公开 URL，再通过 `fileData.fileUri` 传给 Gemini，彻底解决 `inlineData` base64 导致的 503 内存溢出问题
- **图床上传缓存**：新增 `image_proxy_cache` 表，本地图片路径与图床 URL 一一映射，相同图片只上传一次，命中缓存时跳过上传（附 `migrations/12_image_proxy_cache.sql`）
- **API 接口规范字段**：数据库新增 `api_protocol` 列（`migrations/11_add_api_protocol.sql`），可为每条 AI 配置显式指定接口类型（`openai` / `volcengine` / `dashscope` / `gemini` / `nano_banana`），优先级高于厂商自动推断，解决中转站自定义配置走错接口的问题
- **AI 配置页面「接口规范」字段**：自定义厂商时显示下拉框供用户选择接口类型；预设厂商自动填充，无需手动选
- **Gemini 作为分镜图片生成厂商**：在 AI 配置页面，分镜图片生成 (`storyboard_image`) 服务类型增加 Gemini 系列模型选项
- **Gemini 作为视频生成厂商**：在 AI 配置页面，视频生成 (`video`) 服务类型增加 Google Gemini (Veo) 系列模型选项
- **图片/视频风格扩展**：在 `DramaDetail.vue`、`FilmCreate.vue`、`FilmList.vue` 三处将风格选项从 8 个扩展至 29 个，按写实、动漫、中国风、绘画、幻想、数字六大类使用 `el-option-group` 分组展示
- **新增 3:4 竖版比例**：画面比例选项新增「3:4 竖版」
- **分镜生成数量上限提升**：前端 `storyboardCount` 最大值从 50 提升至 200
- **全链路生成日志**：图片生成全链路（接收请求 → 解析参考图 → 图床上传 → Gemini API → 保存图片）均打印带计时的结构化日志，便于排查耗时瓶颈
- **`max_tokens` 自适应上限**：`aiClient.generateText` 读取 AI 配置 `settings.max_tokens` 作为上限，调用方传入值超出时自动截断并打印警告，避免不同模型因上限差异导致 400 错误

### 修复

- **修复 Gemini `MALFORMED_FUNCTION_CALL` 错误**：`generateContent` 接口的请求体中，`aspectRatio` / `numberOfImages` 必须直接放在 `generationConfig` 顶层，而非嵌套在 `imageGenerationConfig`（该字段为 Imagen 独立接口专属），嵌套写法会干扰模型内部 `google:image_gen` 工具调用
- **修复分镜生成 `max_tokens` 超限 400 错误**：移除 `episodeStoryboardService.js` 中写死的 `32768`，由 AI 配置的 `settings.max_tokens` 控制或由模型使用默认值
- **修复分镜生成静默失败**：`onGenerateStoryboard` 轮询超时时间从 6 分钟延长至 15 分钟；正确检查 `pollRes.status` 只在 `completed` 时显示成功提示；超时/失败给出明确提示
- **修复 HTTP 500 错误信息不清晰**：`request.js` Axios 拦截器将后端具体错误信息写回 `error.message`，消除「Request failed with status code 500」的模糊提示
- **图床上传重试机制**：`uploadToImageProxy` 上传失败时自动重试最多 3 次，每次均打印尝试序号和耗时

### 架构

- 确认 `desktop/backend-app` 为构建时由 `copy-backend.js` 自动从 `backend-node` 生成，无需手动同步，日常只需维护 `backend-node`

---

## [1.1.9] - 2026-02-xx

- NanoBanana 图片厂商支持
- AI 配置导出 / 导入
- 端点字段可配置
- 分镜参考图优先本地 Base64
- doubao-seedream 参数修正

---

## [1.1.8] - 2026-02-xx

- 多项 UI/UX 优化（Aurora 渐变背景、玻璃拟态卡片、双行 Logo）
- DramaDetail / FilmCreate / AiConfig 页面风格统一
- 面包屑导航与返回按钮位置优化

---

## [1.1.0] - 2026-01-xx

- 初始公开版本
