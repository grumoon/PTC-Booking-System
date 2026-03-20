# 威睿达思（深圳）家长会预约系统 - 完整设计文档

**文档版本**: v1.0  
**创建日期**: 2026-03-20  
**最后更新**: 2026-03-20  
**作者**: Claude

---

## 目录

1. [项目概述](#1-项目概述)
2. [需求分析](#2-需求分析)
3. [系统架构](#3-系统架构)
4. [数据模型](#4-数据模型)
5. [功能设计](#5-功能设计)
6. [技术方案对比](#6-技术方案对比)
7. [安全设计](#7-安全设计)
8. [部署方案](#8-部署方案)
9. [开发计划](#9-开发计划)
10. [附录](#10-附录)

---

## 1. 项目概述

### 1.1 项目背景

威睿达思（深圳）学校需要一套家长会预约系统，用于管理家长与任课老师的一对一面谈预约。

### 1.2 会议信息

| 项目 | 内容 |
|------|------|
| 会议日期 | 2026年4月3日（周五） |
| 会议时间 | 9:00-12:20 |
| 会议形式 | 第一阶段 9:00-10:10 集中家长会；第二阶段 10:20-12:20 一对一面谈 |
| 面谈时长 | 每家庭10分钟 |

### 1.3 参与老师（11位）

| ID | 姓名 | 科目 | 教室 | 名额 | 特殊时段限制 |
|----|------|------|------|------|-------------|
| 1 | Eros, Michael | Omnibus IIA, Upper-Inter, Rhetoric, AP Cal, Algebra 2, AP 统计 | 教室 A | 12 | 无 |
| 2 | Kit, Ximena | Omnibus IIIA, Advanced Eng, AP US 历史, 西班牙语 | 教室 B | 12 | 无 |
| 3 | Vico | Java/科创 | 教室 C | 10 | 仅 10:30-12:00 |
| 4 | Lily | 日语 | 教室 C | 10 | 仅 10:30-12:00 |
| 5 | Elsie, Lilibet | Pre-Inter, Starter, Grammar & Writing, Vocabulary | 教室 D | 12 | 无 |
| 6 | Rachel, Josie | 化学, AP 心理, AP 经济, 摄影 | 教室 F | 12 | 无 |
| 7 | Lucy | 生物, AP 生物 | 教室 F | 12 | 无 |
| 8 | Micke, Elvin | Omnibus IIIB, Junior Thesis, Pre-Inter, 物理, AP 物理, AP 化学, Algebra 1 | 教室 I | 12 | 无 |
| 9 | Eren, Yolanda | Omnibus IIB, Pre-Inter, Debate, Pre-cal, AP Cal, Physical Science | 教室 J | 12 | 无 |
| 10 | June | 升学规划 | 会议室 | 12 | 无 |
| 11 | 周校 | 校长 | 董事长办公室 | 12 | 无 |

### 1.4 时间段设置

**普通老师时段（12个）:**
```
10:20-10:30, 10:30-10:40, 10:40-10:50, 10:50-11:00,
11:00-11:10, 11:10-11:20, 11:20-11:30, 11:30-11:40,
11:40-11:50, 11:50-12:00, 12:00-12:10, 12:10-12:20
```

**Java/日语老师限制时段（9个）:**
```
10:30-10:40, 10:40-10:50, 10:50-11:00,
11:00-11:10, 11:10-11:20, 11:20-11:30, 11:30-11:40,
11:40-11:50, 11:50-12:00
```

---

## 2. 需求分析

### 2.1 用户角色

| 角色 | 描述 | 核心需求 |
|------|------|---------|
| **家长** | 学生家长 | 查看老师信息、预约时段、查看/取消自己的预约 |
| **老师** | 任课老师 | 查看自己的预约名单、导出数据 |
| **管理员** | 学校行政人员 | 管理老师信息、查看全局数据、导出报表 |

### 2.2 功能需求

#### 2.2.1 家长端

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 浏览老师信息 | P0 | 查看所有老师的科目、教室、剩余名额 |
| 预约面谈 | P0 | 选择老师、填写信息、选择时段 |
| 冲突检测 | P0 | 同一学生不能同时预约两个老师 |
| 查看我的预约 | P0 | 列表展示已预约信息 |
| 取消预约 | P0 | 输入手机号验证后取消 |
| 接收提醒 | P1 | 预约成功通知、会议前提醒 |
| 地图导航 | P2 | 教室位置导航 |

#### 2.2.2 老师/管理端

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 查看预约名单 | P0 | 按时间排序的预约列表 |
| 导出数据 | P0 | 导出 CSV/Excel |
| 实时数据看板 | P1 | 各老师预约率统计 |
| 管理老师信息 | P1 | 添加/修改老师信息 |
| 群发通知 | P2 | 紧急变更时通知已预约家长 |

### 2.3 非功能需求

| 需求 | 描述 |
|------|------|
| 并发支持 | 支持多家长同时预约，防止超卖 |
| 响应速度 | 页面加载 < 3秒，操作响应 < 1秒 |
| 可用性 | 99.5% 可用时间 |
| 数据安全 | 家长信息加密存储，操作留痕 |
| 移动端优先 | 主要使用场景为微信手机端 |

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         客户端层                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  微信浏览器  │  │  手机浏览器  │  │      PC浏览器        │ │
│  │   (主要)    │  │             │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        接入层                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              腾讯云 CDN / Nginx                      │   │
│  │         (静态资源加速 / 反向代理 / HTTPS)             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        应用层                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 腾讯云 CVM                          │   │
│  │  ┌─────────────┐  ┌─────────────────────────────┐  │   │
│  │  │  Nginx      │  │   Node.js API 服务           │  │   │
│  │  │  (静态页面)  │  │   ├─ GET  /api/bookings     │  │   │
│  │  │             │  │   ├─ POST /api/bookings     │  │   │
│  │  │             │  │   ├─ DELETE /api/bookings   │  │   │
│  │  │             │  │   └─ GET  /api/teachers     │  │   │
│  │  └─────────────┘  └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        数据层                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              腾讯云数据库 (MySQL/PostgreSQL)         │   │
│  │              ┌─────────────────┐                    │   │
│  │              │   ptc_booking   │                    │   │
│  │              │   teachers      │                    │   │
│  │              │   audit_logs    │                    │   │
│  │              └─────────────────┘                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS | 单页应用，无框架依赖 |
| 反向代理 | Nginx | 静态托管、负载均衡、HTTPS |
| 后端 | Node.js + Express | 轻量 API 服务 |
| 数据库 | MySQL 8.0 / PostgreSQL 14 | 腾讯云托管 |
| 缓存 | Redis (可选) | 高频数据缓存 |
| 监控 | 腾讯云监控 | 基础监控告警 |

---

## 4. 数据模型

### 4.1 实体关系图

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  teachers   │       │  bookings   │       │  students   │
│  (老师)     │◄──────│  (预约)     │──────►│  (学生)     │
└─────────────┘       └─────────────┘       └─────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ audit_logs  │
                       │  (审计日志)  │
                       └─────────────┘
```

### 4.2 数据表结构

#### 4.2.1 teachers（老师表）

```sql
CREATE TABLE teachers (
    id INT PRIMARY KEY COMMENT '老师ID',
    name VARCHAR(50) NOT NULL COMMENT '姓名',
    subjects VARCHAR(200) NOT NULL COMMENT '任教科目',
    venue VARCHAR(50) NOT NULL COMMENT '教室位置',
    icon VARCHAR(10) DEFAULT '👨‍🏫' COMMENT '图标',
    total_slots INT DEFAULT 12 COMMENT '总名额',
    limited_slots TINYINT(1) DEFAULT 0 COMMENT '是否限制时段',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='老师信息表';
```

#### 4.2.2 bookings（预约表）

```sql
CREATE TABLE bookings (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '预约ID',
    teacher_id INT NOT NULL COMMENT '老师ID',
    teacher_name VARCHAR(50) NOT NULL COMMENT '老师姓名（冗余）',
    venue VARCHAR(50) NOT NULL COMMENT '教室（冗余）',
    student_name VARCHAR(50) NOT NULL COMMENT '学生姓名',
    phone VARCHAR(20) NOT NULL COMMENT '家长电话',
    date DATE NOT NULL COMMENT '预约日期',
    time_slot VARCHAR(20) NOT NULL COMMENT '时间段',
    notes TEXT COMMENT '备注',
    status TINYINT DEFAULT 1 COMMENT '状态：1=有效 0=已取消',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 索引
    INDEX idx_teacher_date (teacher_id, date),
    INDEX idx_student (student_name, phone),
    INDEX idx_date (date),
    
    -- 唯一约束：防止同一老师同一时段重复预约
    UNIQUE KEY uk_teacher_slot (teacher_id, date, time_slot, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预约记录表';
```

#### 4.2.3 audit_logs（审计日志表）

```sql
CREATE TABLE audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(20) NOT NULL COMMENT '操作类型：CREATE/CANCEL/LOGIN',
    target_type VARCHAR(20) COMMENT '对象类型：BOOKING/USER',
    target_id INT COMMENT '对象ID',
    user_info VARCHAR(100) COMMENT '操作者信息',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    user_agent TEXT COMMENT '浏览器信息',
    details JSON COMMENT '详细数据',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志';
```

### 4.3 初始数据

```sql
-- 插入老师数据
INSERT INTO teachers (id, name, subjects, venue, icon, total_slots, limited_slots) VALUES
(1, 'Eros, Michael', 'Omnibus IIA, Upper-Inter, Rhetoric, AP Cal, Algebra 2, AP 统计', '教室 A', '👨‍🏫', 12, 0),
(2, 'Kit, Ximena', 'Omnibus IIIA, Advanced Eng, AP US 历史, 西班牙语', '教室 B', '👩‍🏫', 12, 0),
(3, 'Vico', 'Java/科创', '教室 C', '👨‍💻', 10, 1),
(4, 'Lily', '日语', '教室 C', '👩‍🏫', 10, 1),
(5, 'Elsie, Lilibet', 'Pre-Inter, Starter, Grammar & Writing, Vocabulary', '教室 D', '👩‍🏫', 12, 0),
(6, 'Rachel, Josie', '化学, AP 心理, AP 经济, 摄影', '教室 F', '👩‍🔬', 12, 0),
(7, 'Lucy', '生物, AP 生物', '教室 F', '👩‍🔬', 12, 0),
(8, 'Micke, Elvin', 'Omnibus IIIB, Junior Thesis, Pre-Inter, 物理, AP 物理, AP 化学, Algebra 1', '教室 I', '👨‍🏫', 12, 0),
(9, 'Eren, Yolanda', 'Omnibus IIB, Pre-Inter, Debate, Pre-cal, AP Cal, Physical Science', '教室 J', '👩‍🏫', 12, 0),
(10, 'June', '升学规划', '会议室', '📋', 12, 0),
(11, '周校', '校长', '董事长办公室', '🎓', 12, 0);
```

---

## 5. 功能设计

### 5.1 家长端流程

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 进入页面 │───►│浏览老师 │───►│点击预约 │───►│填写信息 │───►│选择时段 │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
                                                                   │
                              ┌─────────────────────────────────────┘
                              ▼
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│查看预约 │◄───│  完成   │◄───│确认提交 │◄───│冲突检测 │
│  列表   │    │         │    │         │    │         │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
      │
      ▼
┌─────────┐
│取消预约 │
│(需验证) │
└─────────┘
```

### 5.2 API 接口设计

#### 5.2.1 获取老师列表

```
GET /api/teachers

Response:
{
    "code": 0,
    "data": [
        {
            "id": 1,
            "name": "Eros, Michael",
            "subjects": "Omnibus IIA, Upper-Inter...",
            "venue": "教室 A",
            "icon": "👨‍🏫",
            "total_slots": 12,
            "available_slots": 8,
            "limited_slots": false
        }
    ]
}
```

#### 5.2.2 获取预约列表

```
GET /api/bookings?date=2026-04-03

Response:
{
    "code": 0,
    "data": [
        {
            "id": 1,
            "teacher_id": 1,
            "teacher_name": "Eros, Michael",
            "venue": "教室 A",
            "student_name": "张三",
            "phone": "138****1234",
            "time_slot": "10:30-10:40",
            "notes": "想了解数学学习情况"
        }
    ]
}
```

#### 5.2.3 创建预约

```
POST /api/bookings
Content-Type: application/json

Request:
{
    "teacher_id": 1,
    "student_name": "张三",
    "phone": "13800138000",
    "date": "2026-04-03",
    "time_slot": "10:30-10:40",
    "notes": "想了解数学学习情况"
}

Response:
{
    "code": 0,
    "message": "预约成功",
    "data": {
        "id": 123,
        "teacher_name": "Eros, Michael",
        "venue": "教室 A",
        "time_slot": "10:30-10:40"
    }
}

Error Response:
{
    "code": 1001,
    "message": "该时段已被预约"
}
```

#### 5.2.4 取消预约

```
DELETE /api/bookings/:id
Content-Type: application/json

Request:
{
    "phone": "13800138000"  // 验证手机号
}

Response:
{
    "code": 0,
    "message": "取消成功"
}
```

### 5.3 冲突检测逻辑

```javascript
// 预约前检测
async function checkConflict(teacherId, studentName, timeSlot, date) {
    // 1. 检查老师该时段是否已被预约
    const teacherBooked = await db.query(
        'SELECT * FROM bookings WHERE teacher_id = ? AND date = ? AND time_slot = ? AND status = 1',
        [teacherId, date, timeSlot]
    );
    if (teacherBooked.length > 0) {
        return { conflict: true, reason: '该时段已被预约' };
    }
    
    // 2. 检查学生该时段是否已预约其他老师
    const studentBooked = await db.query(
        'SELECT * FROM bookings WHERE student_name = ? AND date = ? AND time_slot = ? AND status = 1',
        [studentName, date, timeSlot]
    );
    if (studentBooked.length > 0) {
        return { 
            conflict: true, 
            reason: `您已在该时段预约了 ${studentBooked[0].teacher_name}` 
        };
    }
    
    return { conflict: false };
}
```

---

## 6. 技术方案对比

### 6.1 方案对比表

| 维度 | 方案A: 纯静态+Supabase | 方案B: 腾讯云CVM+MySQL | 方案C: 微信小程序云开发 |
|------|----------------------|----------------------|----------------------|
| **部署位置** | Netlify + Supabase(海外) | 腾讯云CVM + 云数据库 | 微信云开发(国内) |
| **访问速度** | ⭐⭐ 慢(海外节点) | ⭐⭐⭐⭐⭐ 快(国内) | ⭐⭐⭐⭐⭐ 快(国内) |
| **开发成本** | ⭐⭐⭐⭐⭐ 最低 | ⭐⭐⭐ 中等 | ⭐⭐⭐ 中等 |
| **运维成本** | ⭐⭐⭐⭐⭐ 无 | ⭐⭐⭐ 需维护服务器 | ⭐⭐⭐⭐ 较低 |
| **身份验证** | ❌ 无 | ✅ 可自建 | ✅ 微信内置 |
| **数据安全** | ⭐⭐ 低(Anon Key暴露) | ⭐⭐⭐⭐⭐ 高(完全控制) | ⭐⭐⭐⭐ 较高 |
| **并发处理** | ⭐⭐ 弱 | ⭐⭐⭐⭐⭐ 强 | ⭐⭐⭐⭐ 较强 |
| **扩展性** | ⭐⭐ 差 | ⭐⭐⭐⭐⭐ 好 | ⭐⭐⭐⭐ 较好 |
| **费用** | ¥0 | 已有资源¥0 | ¥0-50/月 |

### 6.2 推荐方案

**当前阶段（紧急上线）**: 方案B - 腾讯云CVM+MySQL
- 用户已有腾讯云资源
- 国内访问速度快
- 数据安全可控
- 支持高并发

**长期规划**: 方案C - 微信小程序
- 更好的用户体验
- 微信生态整合
- 便于后续功能扩展

---

## 7. 安全设计

### 7.1 数据安全

| 措施 | 实现方式 |
|------|---------|
| 传输加密 | 全站 HTTPS，TLS 1.3 |
| 数据库加密 | 腾讯云数据库自动加密 |
| 敏感信息脱敏 | 手机号显示为 138****1234 |
| 数据备份 | 每日自动备份，保留7天 |

### 7.2 访问控制

```javascript
// API 限流
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100 // 每IP最多100次请求
});
app.use('/api/', limiter);

// 创建预约限流（更严格）
const bookingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1分钟
    max: 5 // 每分钟最多5次预约尝试
});
app.use('/api/bookings', bookingLimiter);
```

### 7.3 审计日志

所有关键操作记录日志：
- 预约创建
- 预约取消
- 数据导出
- 管理员操作

### 7.4 防护措施

| 风险 | 防护措施 |
|------|---------|
| SQL注入 | 使用参数化查询 |
| XSS攻击 | 输入过滤，输出转义 |
| CSRF攻击 | 使用Token验证 |
| 暴力破解 | 限流 + 验证码 |
| 数据泄露 | 最小权限原则，敏感字段加密 |

---

## 8. 部署方案

### 8.1 服务器配置

**推荐配置（腾讯云CVM）:**
- CPU: 2核
- 内存: 4GB
- 带宽: 5Mbps
- 系统: Ubuntu 22.04 LTS

### 8.2 部署步骤

```bash
# 1. 安装依赖
sudo apt update
sudo apt install -y nodejs npm nginx mysql-client

# 2. 部署应用
cd /var/www/ptc
git clone [your-repo] .
npm install

# 3. 配置 Nginx
sudo cp nginx.conf /etc/nginx/sites-available/ptc
sudo ln -s /etc/nginx/sites-available/ptc /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 4. 启动服务
npm start

# 5. 配置 PM2 守护进程
npm install -g pm2
pm2 start app.js --name ptc-booking
pm2 save
pm2 startup
```

### 8.3 Nginx 配置

```nginx
server {
    listen 80;
    server_name ptc.veritas.edu.cn;
    
    # 强制 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ptc.veritas.edu.cn;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # 静态页面
    location / {
        root /var/www/ptc/public;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    # API 代理
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 9. 开发计划

### 9.1 里程碑

| 阶段 | 时间 | 目标 | 交付物 |
|------|------|------|--------|
| **MVP** | 3天 | 基础预约功能 | 可运行的预约系统 |
| **V1.0** | +2天 | 完善功能+测试 | 完整功能+文档 |
| **V1.1** | +3天 | 优化+监控 | 性能优化+监控告警 |

### 9.2 任务分解

#### MVP 阶段（3天）

| 天数 | 任务 | 负责人 |
|------|------|--------|
| Day 1 | 数据库设计+API开发 | 后端 |
| Day 1 | 前端页面重构 | 前端 |
| Day 2 | API联调+冲突检测 | 全栈 |
| Day 2 | 取消预约功能 | 全栈 |
| Day 3 | 测试+Bug修复 | 全栈 |
| Day 3 | 部署上线 | 运维 |

#### V1.0 阶段（+2天）

| 任务 | 说明 |
|------|------|
| 管理后台 | 老师查看预约名单 |
| 数据导出 | CSV/Excel导出 |
| 审计日志 | 操作记录 |
| 性能优化 | 数据库索引优化 |
| 安全加固 | 限流+验证 |

---

## 10. 附录

### 10.1 环境变量配置

```bash
# .env
NODE_ENV=production
PORT=3000

# 数据库配置
DB_HOST=your-db-instance.mysql.tencentcdb.com
DB_PORT=3306
DB_USER=ptc_user
DB_PASSWORD=your-secure-password
DB_NAME=ptc_booking

# 安全配置
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

### 10.2 监控指标

| 指标 | 告警阈值 |
|------|---------|
| API 响应时间 | > 500ms |
| 错误率 | > 1% |
| 数据库连接数 | > 80% |
| 服务器CPU | > 80% |
| 服务器内存 | > 80% |

### 10.3 应急预案

| 场景 | 应对措施 |
|------|---------|
| 数据库连接失败 | 自动重试+降级到本地缓存 |
| 高并发导致卡顿 | 启用限流+队列机制 |
| 数据异常 | 暂停写入，人工检查 |
| 服务器宕机 | 自动重启+通知管理员 |

### 10.4 联系方式

| 角色 | 职责 | 联系方式 |
|------|------|---------|
| 系统管理员 | 技术问题 | [待填写] |
| 学校行政 | 业务问题 | [待填写] |
| 紧急联系 | 系统故障 | [待填写] |

---

## 文档更新记录

| 版本 | 日期 | 更新内容 | 作者 |
|------|------|---------|------|
| v1.0 | 2026-03-20 | 初始版本 | Claude |

---

*本文档为威睿达思（深圳）家长会预约系统的完整设计文档，供开发团队参考使用。*
