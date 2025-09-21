# Railway 部署指南

## 部署步骤

### 1. 准备工作
- 注册 [Railway](https://railway.app/) 账号
- 安装 Railway CLI（可选）

### 2. 部署方式

#### 方式一：通过 GitHub（推荐）
1. 将代码推送到 GitHub 仓库
2. 在 Railway 控制台点击 "New Project"
3. 选择 "Deploy from GitHub repo"
4. 选择你的仓库
5. Railway 会自动检测到 Node.js 项目并开始部署

#### 方式二：通过 Railway CLI
```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 初始化项目
railway init

# 部署
railway up
```

### 3. 环境变量配置
在 Railway 项目设置中添加以下环境变量：

```
TELEGRAM_BOT_TOKEN=你的Telegram机器人Token
TELEGRAM_CHAT_ID=你的Telegram聊天ID
```

### 4. 部署配置
- `railway.json`: Railway 部署配置
- `Dockerfile`: Docker 容器配置
- `.dockerignore`: Docker 构建忽略文件

### 5. 监控和日志
- 在 Railway 控制台可以查看应用日志
- 应用会每5分钟自动检测一次EMA信号
- 发现信号时会自动发送 Telegram 通知

### 6. 注意事项
- Railway 免费版有使用限制
- 长期运行的监控服务建议升级到付费版
- 确保 Telegram Bot Token 和 Chat ID 正确配置

## 故障排除

### 常见问题
1. **部署失败**: 检查 package.json 依赖是否正确
2. **应用崩溃**: 查看 Railway 日志，检查环境变量配置
3. **Telegram 通知不工作**: 验证 Bot Token 和 Chat ID

### 本地测试
```bash
# 安装依赖
npm install

# 设置环境变量
export TELEGRAM_BOT_TOKEN=your_token
export TELEGRAM_CHAT_ID=your_chat_id

# 运行应用
node bsc_active_tokens_analyzer.js
```