# PTC-Booking-System

家长会（Parent-Teacher Conference）预约系统 —— 用于学校家长会时段预约管理。

## 功能

### 家长端
- 按老师浏览可用时段，一键预约
- 查看/取消自己的预约
- 移动端优先设计，支持各种屏幕尺寸

### 管理端
- 仪表盘：预约数据总览（老师 × 时段交叉表）
- 老师管理：增删改查，设置名额、教室、科目
- 预约管理：查看/取消预约，筛选/搜索
- 学生名册：导入/管理学生白名单
- 数据导出：一键导出 Excel（总览 + 每个老师独立 sheet）
- 二维码分享：生成预约页面二维码
- 操作审计日志

## 技术栈

| 层面 | 技术 |
|---|---|
| 后端 | Node.js + Express 5 |
| 数据库 | MySQL（mysql2/promise） |
| 前端 | 原生 HTML/CSS/JS（无框架，单文件 SPA） |
| 前端 CDN | QRCode.js（二维码）、SheetJS（Excel 导出） |
| 进程管理 | PM2 |
| 反向代理 | Nginx |

## 项目结构

```
PTC-Booking-System/
├── admin/
│   └── index.html            # 管理后台（单文件 SPA）
├── public/
│   └── index.html            # 家长端预约页面（单文件 SPA）
├── server/
│   ├── app.js                # 主服务端程序（全部 API 路由）
│   ├── db.js                 # 数据库连接池
│   ├── init-db.js            # 数据库初始化（建表 + 种子数据）
│   ├── import-students.js    # 批量导入学生名册脚本
│   ├── .env.example          # 环境变量模板
│   ├── .env                  # 环境变量（需手动创建，已 gitignore）
│   └── package.json
└── README.md
```

## 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `server/.env`，填入 MySQL 连接信息和管理员初始密码：

```
DB_HOST=your_mysql_host
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=ptc_booking
ADMIN_PASSWORD=your_admin_password
```

### 3. 初始化数据库

```bash
cd server
npm run init-db
```

该脚本会创建 5 张表（teachers, bookings, audit_logs, admin_config, students）并插入初始数据（11 位老师、时段配置、管理员密码等）。

### 4. 启动服务

```bash
npm start
```

服务默认监听 `127.0.0.1:3010`（仅本机），需要通过 Nginx 等反向代理对外提供服务。

## 数据库设计

| 表名 | 说明 | 关键字段 |
|---|---|---|
| `teachers` | 老师信息 | id, name, subjects, venue, total_slots, limited_slots |
| `bookings` | 预约记录 | teacher_id, student_name, phone, date, time_slot, status |
| `audit_logs` | 操作审计 | action, target_type, user_info, ip_address, details(JSON) |
| `admin_config` | 系统配置 | config_key(PK), config_value — 存管理密码、会议日期、时段等 |
| `students` | 学生名册 | name(UNIQUE), class_name |

### 时段设计
- **全部时段**（12 个）：10:20-10:30 ~ 12:10-12:20，每段 10 分钟
- **受限时段**（9 个）：10:30-10:40 ~ 11:50-12:00（用于部分老师）
- 老师的 `limited_slots` 字段控制使用哪套时段

## API 端点

### 公开接口（家长端）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/teachers?date=YYYY-MM-DD` | 获取老师列表（含已约数） |
| GET | `/api/bookings?teacher_id=X&date=Y` | 查询某老师预约情况 |
| POST | `/api/bookings` | 创建预约（限流 5次/分钟） |
| GET | `/api/my-bookings?student_name=X&phone=Y&date=Z` | 查询我的预约 |
| DELETE | `/api/bookings/:id` | 取消预约 |
| GET | `/api/time-slots` | 获取时段配置 |
| GET | `/api/health` | 健康检查 |

### 管理员接口（需 `x-admin-token` 请求头）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/login` | 管理员登录 |
| POST | `/api/admin/logout` | 登出 |
| GET | `/api/admin/check` | 验证 token |
| GET | `/api/admin/dashboard?date=Y` | 仪表盘数据（含交叉表） |
| GET | `/api/admin/bookings?date=Y` | 预约列表（分页/搜索） |
| DELETE | `/api/admin/bookings/:id` | 删除预约 |
| GET/POST/PUT/DELETE | `/api/admin/teachers` | 老师 CRUD |
| GET | `/api/admin/logs` | 审计日志 |
| GET | `/api/admin/export?date=Y` | 导出预约数据 |
| GET/POST/DELETE | `/api/admin/students` | 学生名册管理 |
| POST | `/api/admin/students/batch` | 批量导入学生 |

## 部署

### 生产环境部署（Nginx 反向代理）

服务监听 `127.0.0.1:3010`，不对外暴露端口。通过 Nginx 配置子路径访问：

```nginx
# 不带尾斜杠自动补齐
location = /ptc {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    return 301 /ptc/;
}
location = /ptc/admin {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    return 301 /ptc/admin/;
}
location = /ptc/api {
    return 301 /ptc/api/;
}

# API 反向代理
location /ptc/api/ {
    proxy_pass http://127.0.0.1:3010/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 管理端静态文件
location /ptc/admin/ {
    alias /path/to/ptc-booking/admin/;
    try_files $uri $uri/ /ptc/admin/index.html;
}

# 家长端静态文件
location /ptc/ {
    alias /path/to/ptc-booking/public/;
    try_files $uri $uri/ /ptc/index.html;
}
```

### PM2 进程管理

```bash
# 首次启动
cd server && pm2 start app.js --name ptc-booking

# 重启
pm2 restart ptc-booking

# 查看日志
pm2 logs ptc-booking

# 查看状态
pm2 list
```

### 更新部署

前端文件（无需重启后端）：
```bash
# 上传前端文件到服务器对应目录即可
scp admin/index.html user@server:/path/to/ptc-booking/admin/
scp public/index.html user@server:/path/to/ptc-booking/public/
```

后端文件（需重启）：
```bash
scp server/app.js user@server:/path/to/ptc-booking/server/
ssh user@server "source ~/.nvm/nvm.sh && pm2 restart ptc-booking"
```

## 安全措施

- 后端仅监听 `127.0.0.1`，不对外暴露端口
- 全局 API 限流：200 次/15 分钟
- 预约操作限流：5 次/分钟
- 管理员密码存储在数据库 `admin_config` 表中，支持后台修改
- 全量操作审计日志（`audit_logs` 表）
- `.env` 已加入 `.gitignore`，不提交到仓库

## 注意事项

- 前端为单文件 SPA，无构建步骤，直接编辑 HTML 即可
- 子路径部署时，前端的 `API_BASE` 会基于 `window.location.pathname` 自动检测，无需硬编码
- `import-students.js` 是一次性脚本，学生名册也可在管理后台批量导入
- 会议日期、时段配置等均可在管理后台动态修改
