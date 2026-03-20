const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const pool = require('./db');

const app = express();
const PORT = 3010;

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json());

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '../public')));

// 管理后台静态文件
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// 全局限流：15分钟内每IP最多200次
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { code: 429, message: '请求过于频繁，请稍后再试' }
});
app.use('/api/', globalLimiter);

// ==================== 管理员鉴权 ====================
const adminTokens = new Map(); // token -> { createdAt }

// 从数据库读取配置项
async function getConfig(key, defaultValue) {
  try {
    const [rows] = await pool.execute(
      "SELECT config_value FROM admin_config WHERE config_key = ?", [key]
    );
    return rows.length > 0 ? rows[0].config_value : defaultValue;
  } catch (err) {
    console.error(`读取配置 ${key} 失败:`, err.message);
    return defaultValue;
  }
}

// 获取会议日期（带缓存，5分钟刷新）
let meetingDateCache = { value: null, expiry: 0 };
async function getMeetingDate() {
  const now = Date.now();
  if (meetingDateCache.value && now < meetingDateCache.expiry) {
    return meetingDateCache.value;
  }
  const date = await getConfig('meeting_date', '2026-04-03');
  meetingDateCache = { value: date, expiry: now + 5 * 60 * 1000 };
  return date;
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 48; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}

// 清理过期 token（24小时）
setInterval(() => {
  const now = Date.now();
  for (const [token, info] of adminTokens) {
    if (now - info.createdAt > 24 * 60 * 60 * 1000) adminTokens.delete(token);
  }
}, 60 * 60 * 1000);

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ code: 401, message: '未登录或登录已过期' });
  }
  next();
}

// 预约操作限流：1分钟内每IP最多10次
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { code: 429, message: '操作过于频繁，请稍后再试' }
});

// 获取客户端真实 IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.ip;
}

// 记录审计日志
async function logAudit(action, targetType, targetId, userInfo, ip, details) {
  try {
    await pool.execute(
      'INSERT INTO audit_logs (action, target_type, target_id, user_info, ip_address, details) VALUES (?, ?, ?, ?, ?, ?)',
      [action, targetType, targetId, userInfo, ip, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('审计日志写入失败:', err.message);
  }
}

// ==================== API 路由 ====================

// 1. 获取老师列表（含剩余名额）
app.get('/api/teachers', async (req, res) => {
  try {
    const date = req.query.date || await getMeetingDate();

    const [teachers] = await pool.execute('SELECT * FROM teachers ORDER BY id');

    // 统计每位老师已预约数
    const [counts] = await pool.execute(
      `SELECT teacher_id, COUNT(*) as booked_count
       FROM bookings
       WHERE date = ? AND status = 1
       GROUP BY teacher_id`,
      [date]
    );

    const countMap = {};
    counts.forEach(c => { countMap[c.teacher_id] = c.booked_count; });

    const result = teachers.map(t => ({
      id: t.id,
      name: t.name,
      subjects: t.subjects,
      venue: t.venue,
      icon: t.icon,
      total_slots: t.total_slots,
      booked_count: countMap[t.id] || 0,
      available_slots: t.total_slots - (countMap[t.id] || 0),
      limited_slots: !!t.limited_slots
    }));

    res.json({ code: 0, data: result });
  } catch (err) {
    console.error('获取老师列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 2. 获取预约列表
app.get('/api/bookings', async (req, res) => {
  try {
    const date = req.query.date || await getMeetingDate();

    const [rows] = await pool.execute(
      `SELECT id, teacher_id, teacher_name, venue, student_name, phone, date, time_slot, notes, created_at
       FROM bookings
       WHERE date = ? AND status = 1
       ORDER BY time_slot ASC`,
      [date]
    );

    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取预约列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 3. 创建预约
app.post('/api/bookings', bookingLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { teacher_id, student_name, phone, time_slot, notes } = req.body;
    const date = req.body.date || await getMeetingDate();

    // 参数校验
    if (!teacher_id || !student_name?.trim() || !phone?.trim() || !time_slot) {
      return res.status(400).json({ code: 400, message: '请填写完整信息' });
    }

    await conn.beginTransaction();

    // 查老师信息
    const [teacherRows] = await conn.execute('SELECT * FROM teachers WHERE id = ?', [teacher_id]);
    if (teacherRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ code: 1000, message: '老师不存在' });
    }
    const teacher = teacherRows[0];

    // 检查1：该老师该时段是否已被预约
    const [slotCheck] = await conn.execute(
      'SELECT id FROM bookings WHERE teacher_id = ? AND date = ? AND time_slot = ? AND status = 1 FOR UPDATE',
      [teacher_id, date, time_slot]
    );
    if (slotCheck.length > 0) {
      await conn.rollback();
      return res.status(409).json({ code: 1001, message: '该时段已被预约' });
    }

    // 检查2：该学生该时段是否已预约其他老师
    const [studentCheck] = await conn.execute(
      'SELECT teacher_name FROM bookings WHERE student_name = ? AND date = ? AND time_slot = ? AND status = 1',
      [student_name.trim(), date, time_slot]
    );
    if (studentCheck.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        code: 1002,
        message: `该学生在此时段已预约了 ${studentCheck[0].teacher_name}`
      });
    }

    // 检查3：该老师名额是否已满
    const [countCheck] = await conn.execute(
      'SELECT COUNT(*) as cnt FROM bookings WHERE teacher_id = ? AND date = ? AND status = 1',
      [teacher_id, date]
    );
    if (countCheck[0].cnt >= teacher.total_slots) {
      await conn.rollback();
      return res.status(409).json({ code: 1003, message: '该老师名额已满' });
    }

    // 插入预约
    const [result] = await conn.execute(
      `INSERT INTO bookings (teacher_id, teacher_name, venue, student_name, phone, date, time_slot, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [teacher_id, teacher.name, teacher.venue, student_name.trim(), phone.trim(), date, time_slot, notes || '']
    );

    await conn.commit();

    const bookingId = result.insertId;

    // 审计日志
    await logAudit('CREATE', 'BOOKING', bookingId,
      `${student_name.trim()} / ${phone.trim()}`,
      getClientIP(req),
      { teacher_id, teacher_name: teacher.name, time_slot, date }
    );

    res.json({
      code: 0,
      message: '预约成功',
      data: {
        id: bookingId,
        teacher_id,
        teacher_name: teacher.name,
        venue: teacher.venue,
        student_name: student_name.trim(),
        phone: phone.trim(),
        date,
        time_slot,
        notes: notes || ''
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('创建预约失败:', err);

    // 处理数据库唯一约束冲突
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1001, message: '该时段已被预约（并发冲突）' });
    }
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  } finally {
    conn.release();
  }
});

// 4. 查询我的预约（根据手机号）
app.get('/api/my-bookings', rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { code: 429, message: '查询过于频繁，请稍后再试' }
}), async (req, res) => {
  try {
    const phone = req.query.phone?.trim();
    const date = req.query.date || await getMeetingDate();

    if (!phone) {
      return res.status(400).json({ code: 400, message: '请输入手机号' });
    }

    const [rows] = await pool.execute(
      `SELECT id, teacher_id, teacher_name, venue, student_name, phone, date, time_slot, notes, created_at
       FROM bookings
       WHERE phone = ? AND date = ? AND status = 1
       ORDER BY time_slot ASC`,
      [phone, date]
    );

    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('查询我的预约失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 5. 取消预约
app.delete('/api/bookings/:id', bookingLimiter, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const { phone } = req.body || {};
    const isAdmin = req.query.admin === 'true';

    if (!bookingId) {
      return res.status(400).json({ code: 400, message: '无效的预约ID' });
    }

    // 查找预约
    const [rows] = await pool.execute(
      'SELECT * FROM bookings WHERE id = ? AND status = 1',
      [bookingId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '预约不存在或已取消' });
    }

    const booking = rows[0];

    // 非管理员需验证手机号
    if (!isAdmin) {
      if (!phone?.trim()) {
        return res.status(400).json({ code: 400, message: '请输入手机号验证身份' });
      }
      if (phone.trim() !== booking.phone) {
        return res.status(403).json({ code: 403, message: '手机号不正确' });
      }
    }

    // 软删除（status 改为 0）
    await pool.execute(
      'UPDATE bookings SET status = 0 WHERE id = ?',
      [bookingId]
    );

    // 审计日志
    await logAudit('CANCEL', 'BOOKING', bookingId,
      `${booking.student_name} / ${phone || 'admin'}`,
      getClientIP(req),
      { teacher_name: booking.teacher_name, time_slot: booking.time_slot, date: booking.date }
    );

    res.json({ code: 0, message: '取消成功' });
  } catch (err) {
    console.error('取消预约失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 5. 导出数据（管理员用）
app.get('/api/export', async (req, res) => {
  try {
    const date = req.query.date || await getMeetingDate();

    const [rows] = await pool.execute(
      `SELECT b.id, b.teacher_name, b.venue, b.student_name, b.phone, b.date, b.time_slot, b.notes, b.created_at
       FROM bookings b
       WHERE b.date = ? AND b.status = 1
       ORDER BY b.time_slot ASC, b.teacher_name ASC`,
      [date]
    );

    // 审计日志
    await logAudit('EXPORT', 'BOOKING', null, 'admin', getClientIP(req), { count: rows.length, date });

    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('导出数据失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ code: 0, status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ code: 503, status: 'db_error', message: err.message });
  }
});

// ==================== 管理后台 API ====================

// 管理员登录
app.post('/api/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { code: 429, message: '登录尝试过多，请15分钟后再试' }
}), async (req, res) => {
  const { password } = req.body;
  const adminPassword = await getConfig('admin_password', 'ptc2026admin');
  if (password !== adminPassword) {
    await logAudit('ADMIN_LOGIN_FAIL', 'ADMIN', null, 'admin', getClientIP(req), null);
    return res.status(403).json({ code: 403, message: '密码错误' });
  }
  const token = generateToken();
  adminTokens.set(token, { createdAt: Date.now() });
  await logAudit('ADMIN_LOGIN', 'ADMIN', null, 'admin', getClientIP(req), null);
  res.json({ code: 0, data: { token } });
});

// 管理员登出
app.post('/api/admin/logout', adminAuth, (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  adminTokens.delete(token);
  res.json({ code: 0, message: '已登出' });
});

// 验证 token 是否有效
app.get('/api/admin/check', adminAuth, (req, res) => {
  res.json({ code: 0, message: 'ok' });
});

// 仪表盘统计
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const date = req.query.date || await getMeetingDate();

    // 总预约数
    const [totalRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM bookings WHERE date = ? AND status = 1', [date]
    );
    // 总取消数
    const [cancelRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM bookings WHERE date = ? AND status = 0', [date]
    );
    // 按老师统计
    const [teacherStats] = await pool.execute(`
      SELECT t.id, t.name, t.total_slots,
        COALESCE(b.booked, 0) as booked_count,
        t.total_slots - COALESCE(b.booked, 0) as available_count
      FROM teachers t
      LEFT JOIN (
        SELECT teacher_id, COUNT(*) as booked
        FROM bookings WHERE date = ? AND status = 1
        GROUP BY teacher_id
      ) b ON t.id = b.teacher_id
      ORDER BY t.id
    `, [date]);

    // 按时段统计
    const [slotStats] = await pool.execute(`
      SELECT time_slot, COUNT(*) as count
      FROM bookings WHERE date = ? AND status = 1
      GROUP BY time_slot ORDER BY time_slot
    `, [date]);

    // 总名额
    const [slotsTotal] = await pool.execute('SELECT SUM(total_slots) as total FROM teachers');

    res.json({
      code: 0,
      data: {
        date,
        total_bookings: totalRows[0].total,
        total_cancelled: cancelRows[0].total,
        total_capacity: slotsTotal[0].total || 0,
        booking_rate: slotsTotal[0].total ? Math.round(totalRows[0].total / slotsTotal[0].total * 100) : 0,
        teacher_stats: teacherStats,
        slot_stats: slotStats
      }
    });
  } catch (err) {
    console.error('仪表盘统计失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 预约列表（管理员 - 支持筛选 + 分页）
app.get('/api/admin/bookings', adminAuth, async (req, res) => {
  try {
    const date = req.query.date || await getMeetingDate();
    const teacher_id = req.query.teacher_id;
    const student = req.query.student;
    const time_slot = req.query.time_slot;
    const status = req.query.status !== undefined ? parseInt(req.query.status) : 1;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    let where = 'WHERE b.date = ? AND b.status = ?';
    let params = [date, status];

    if (teacher_id) {
      where += ' AND b.teacher_id = ?';
      params.push(parseInt(teacher_id));
    }
    if (student) {
      where += ' AND b.student_name LIKE ?';
      params.push(`%${student}%`);
    }
    if (time_slot) {
      where += ' AND b.time_slot = ?';
      params.push(time_slot);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM bookings b ${where}`, params
    );

    const [rows] = await pool.execute(
      `SELECT b.id, b.teacher_id, b.teacher_name, b.venue, b.student_name, b.phone,
              b.date, b.time_slot, b.notes, b.status, b.created_at
       FROM bookings b ${where}
       ORDER BY b.time_slot ASC, b.teacher_name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      code: 0,
      data: {
        list: rows,
        total: countRows[0].total,
        page,
        limit,
        pages: Math.ceil(countRows[0].total / limit)
      }
    });
  } catch (err) {
    console.error('管理员查询预约失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 管理员取消预约
app.delete('/api/admin/bookings/:id', adminAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const [rows] = await pool.execute('SELECT * FROM bookings WHERE id = ? AND status = 1', [bookingId]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '预约不存在或已取消' });
    }
    const booking = rows[0];
    await pool.execute('UPDATE bookings SET status = 0 WHERE id = ?', [bookingId]);
    await logAudit('ADMIN_CANCEL', 'BOOKING', bookingId, 'admin',
      getClientIP(req),
      { teacher_name: booking.teacher_name, student_name: booking.student_name, time_slot: booking.time_slot }
    );
    res.json({ code: 0, message: '已取消' });
  } catch (err) {
    console.error('管理员取消预约失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 教师管理 - 列表
app.get('/api/admin/teachers', adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM teachers ORDER BY id');
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取教师列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 教师管理 - 新增
app.post('/api/admin/teachers', adminAuth, async (req, res) => {
  try {
    const { id, name, subjects, venue, icon, total_slots, limited_slots } = req.body;
    if (!name?.trim() || !subjects?.trim() || !venue?.trim()) {
      return res.status(400).json({ code: 400, message: '姓名、科目、教室不能为空' });
    }
    let teacherId = id;
    if (!teacherId) {
      const [maxRow] = await pool.execute('SELECT MAX(id) as maxId FROM teachers');
      teacherId = (maxRow[0].maxId || 0) + 1;
    }
    await pool.execute(
      `INSERT INTO teachers (id, name, subjects, venue, icon, total_slots, limited_slots)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [teacherId, name.trim(), subjects.trim(), venue.trim(), icon || '👨‍🏫', total_slots || 12, limited_slots ? 1 : 0]
    );
    await logAudit('CREATE_TEACHER', 'TEACHER', teacherId, 'admin', getClientIP(req), { name: name.trim() });
    res.json({ code: 0, message: '添加成功', data: { id: teacherId } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 409, message: '该 ID 已存在' });
    }
    console.error('新增教师失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 教师管理 - 修改
app.put('/api/admin/teachers/:id', adminAuth, async (req, res) => {
  try {
    const teacherId = parseInt(req.params.id);
    const { name, subjects, venue, icon, total_slots, limited_slots } = req.body;
    const [existing] = await pool.execute('SELECT * FROM teachers WHERE id = ?', [teacherId]);
    if (existing.length === 0) {
      return res.status(404).json({ code: 404, message: '教师不存在' });
    }
    await pool.execute(
      `UPDATE teachers SET name = ?, subjects = ?, venue = ?, icon = ?, total_slots = ?, limited_slots = ?
       WHERE id = ?`,
      [
        name?.trim() || existing[0].name,
        subjects?.trim() || existing[0].subjects,
        venue?.trim() || existing[0].venue,
        icon || existing[0].icon,
        total_slots !== undefined ? total_slots : existing[0].total_slots,
        limited_slots !== undefined ? (limited_slots ? 1 : 0) : existing[0].limited_slots,
        teacherId
      ]
    );
    await logAudit('UPDATE_TEACHER', 'TEACHER', teacherId, 'admin', getClientIP(req), { name: name?.trim() });
    res.json({ code: 0, message: '修改成功' });
  } catch (err) {
    console.error('修改教师失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 教师管理 - 删除
app.delete('/api/admin/teachers/:id', adminAuth, async (req, res) => {
  try {
    const teacherId = parseInt(req.params.id);
    const [existing] = await pool.execute('SELECT * FROM teachers WHERE id = ?', [teacherId]);
    if (existing.length === 0) {
      return res.status(404).json({ code: 404, message: '教师不存在' });
    }
    // 检查是否有有效预约
    const [bookingCount] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM bookings WHERE teacher_id = ? AND status = 1', [teacherId]
    );
    if (bookingCount[0].cnt > 0) {
      return res.status(409).json({
        code: 409,
        message: `该教师还有 ${bookingCount[0].cnt} 个有效预约，请先取消预约再删除`
      });
    }
    await pool.execute('DELETE FROM teachers WHERE id = ?', [teacherId]);
    await logAudit('DELETE_TEACHER', 'TEACHER', teacherId, 'admin', getClientIP(req), { name: existing[0].name });
    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    console.error('删除教师失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 审计日志
app.get('/api/admin/logs', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const action = req.query.action;

    let where = '';
    let params = [];
    if (action) {
      where = 'WHERE action = ?';
      params.push(action);
    }

    const [countRows] = await pool.execute(`SELECT COUNT(*) as total FROM audit_logs ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      code: 0,
      data: {
        list: rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
        total: countRows[0].total,
        page, limit,
        pages: Math.ceil(countRows[0].total / limit)
      }
    });
  } catch (err) {
    console.error('查询审计日志失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 导出 CSV（管理员版）
app.get('/api/admin/export', adminAuth, async (req, res) => {
  try {
    const date = req.query.date || await getMeetingDate();
    const [rows] = await pool.execute(
      `SELECT b.id, b.teacher_name, b.venue, b.student_name, b.phone,
              b.date, b.time_slot, b.notes, b.created_at
       FROM bookings b WHERE b.date = ? AND b.status = 1
       ORDER BY b.time_slot ASC, b.teacher_name ASC`,
      [date]
    );
    await logAudit('ADMIN_EXPORT', 'BOOKING', null, 'admin', getClientIP(req), { count: rows.length, date });
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('管理员导出失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// SPA fallback — 所有非 API、非 admin 路由返回 index.html
app.get('/{*path}', (req, res) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// ==================== 启动服务 ====================
app.listen(PORT, '0.0.0.0', async () => {
  const meetingDate = await getMeetingDate();
  console.log(`🚀 PTC Booking API 运行在 http://0.0.0.0:${PORT}`);
  console.log(`📅 会议日期: ${meetingDate}`);
});
