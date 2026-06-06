# Daydream Generator

把一点灵感，锻成角色卡。

## 功能

- **Character Card V2** — 生成符合 SillyTavern 规范的角色卡 JSON / PNG
- **多模型支持** — OpenAI、Gemini、Anthropic、任意 OpenAI 兼容端点
- **浏览器直连** — API Key 留在浏览器，CORS 失败时才走后端临时代理
- **网络搜索** — 识别到真实作品角色时，自动调用 Tavily 搜索官方设定
- **智能采访** — LLM 先提问确认关键设定（支持单选/多选），再生成卡片
- **多模态输入** — 截图、图片、视频作为参考素材（视频仅 Gemini）
- **PNG 嵌入** — 头像 + JSON 元数据嵌入同一张 PNG，SillyTavern 可直接导入
- **有效期直链** — 生成带过期时间的 Vercel Blob 分享链接
- **本地历史** — 浏览器缓存最近 30 张卡片，可恢复和管理

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 构建
npm run build

# 运行测试
npm test
```

打开 `http://localhost:3000`，填写你的 LLM API Key 即可使用。

## 环境变量

在 `.env.local`（本地）或部署平台的环境变量面板中配置：

| 变量 | 说明 | 必填 |
|------|------|------|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 存储 token（直链功能） | 用直链时必填 |
| `SHARE_SECRET` | 直链签名密钥，任意随机字符串 | 用直链时必填 |
| `TAVILY_API_KEY` | Tavily 搜索 API Key（服务端优先） | 可选 |
| `CRON_SECRET` | 定时清理接口鉴权 | 可选 |

> 不配置 Blob 和 SHARE_SECRET 时，除直链外的所有功能正常运行。

生成 SHARE_SECRET：

```bash
openssl rand -hex 32
```

## 部署到 Vercel

1. 将代码推送到 GitHub
2. 在 [vercel.com](https://vercel.com) 导入项目，框架自动识别为 Next.js
3. 在 Storage 面板创建 Blob Store 并关联项目（自动注入 `BLOB_READ_WRITE_TOKEN`）
4. 在 Settings → Environment Variables 填写 `SHARE_SECRET` 和可选的 `TAVILY_API_KEY`
5. 推送即自动部署

### Cron 清理（可选）

项目根目录创建 `vercel.json`：

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup-shares",
      "schedule": "0 3 * * *"
    }
  ]
}
```

每天自动清理过期的分享文件。

## 使用流程

```
连接 → 灵感 → 生成 → 微调 → 导出
```

1. **连接** — 选择 Provider，填写 API Key（可选 Tavily Key 启用搜索）
2. **灵感** — 写描述、上传参考截图/图片/视频
3. **生成** — LLM 先提问确认设定，回答后自动生成卡片；识别真实角色时自动搜索
4. **微调** — 设置头像、手动编辑 JSON
5. **导出** — 下载 JSON/PNG、生成有效期直链、保存到本地历史

## 安全说明

- LLM API Key 默认只存在浏览器内存，点击"保存连接配置"才写入 localStorage
- 直连失败走后端代理时，Key 仅用于本次请求转发，不做任何持久化
- Tavily Key 同理：服务端有配置则客户端无需填写
- 直链文件存储在 Vercel Blob，到期后由 cron 自动删除
