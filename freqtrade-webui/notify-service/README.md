# Premium Notifier Service

后端服务，用于定时扫描高分交易品种并发送邮件通知。

## 功能

- RESTful API 管理扫描任务
- 动态定时任务调度（1h/4h/12h/24h）
- 自定义筛选条件（趋势评分、盈亏比、移动止损）
- 支持全部热门品种或手动选择
- 邮件通知
- 手动触发扫描

## 安装

```bash
cd notify-service
npm install
```

## 配置

复制 `.env.example` 到 `.env` 并填写配置：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PORT=3031

# SMTP 配置（示例：QQ邮箱）
EMAIL_HOST=smtp.qq.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=your-email@qq.com
EMAIL_PASS=your-smtp-password  # QQ邮箱需要使用授权码
```

## 开发

```bash
npm run dev
```

## 生产部署

```bash
# 构建
npm run build

# 启动
npm start

# 或使用 PM2
pm2 start dist/index.js --name premium-notifier
pm2 save
```

## API 接口

### 获取所有任务
```
GET /api/notify/tasks
```

### 创建任务
```
POST /api/notify/tasks
Content-Type: application/json

{
  "name": "高分品种监控",
  "email": "notify@example.com",
  "interval": "1h",
  "enabled": true,
  "filters": {
    "minTrendScore": 60,
    "minRiskReward": 1.5,
    "maxTrailingStop": 5
  },
  "pairs": ["*"],  // 或 ["BTC-USDT", "ETH-USDT"]
  "timeframes": ["1H", "4H"]
}
```

### 更新任务
```
PUT /api/notify/tasks/:id
Content-Type: application/json

{
  "enabled": false
}
```

### 删除任务
```
DELETE /api/notify/tasks/:id
```

### 启用/停用任务
```
POST /api/notify/tasks/:id/toggle
```

### 手动触发任务
```
POST /api/notify/tasks/:id/trigger
```

## 数据存储

任务配置存储在 `data/tasks.json`（自动创建）。

## 日志

所有扫描和通知日志输出到控制台，可通过 PM2 或其他工具管理。
