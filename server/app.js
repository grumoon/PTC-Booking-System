const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const pool = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT) || 3010;

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json());

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '../public')));

// 全局限流：15分钟内每IP最多200次
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { code: 429, message: '请求过于频繁，请稍后再试' }
});
app.use('/api/', globalLimiter);

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
    const date = req.query.date || process.env.MEETING_DATE || '2026-04-03';

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
    const date = req.query.date || process.env.MEETING_DATE || '2026-04-03';

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
    const date = req.body.date || process.env.MEETING_DATE || '2026-04-03';

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

// 4. 取消预约
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
    const date = req.query.date || process.env.MEETING_DATE || '2026-04-03';

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

// SPA fallback — 所有非 API 路由返回 index.html
app.get('/{*path}', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// ==================== 启动服务 ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PTC Booking API 运行在 http://0.0.0.0:${PORT}`);
  console.log(`📅 会议日期: ${process.env.MEETING_DATE || '2026-04-03'}`);
});
