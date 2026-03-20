/**
 * 数据库初始化脚本
 * 运行: node init-db.js
 * 创建表结构 + 插入初始老师数据
 */
const pool = require('./db');

async function initDB() {
  const conn = await pool.getConnection();
  try {
    console.log('🔧 开始初始化数据库...\n');

    // 1. 创建 teachers 表
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS teachers (
        id INT PRIMARY KEY COMMENT '老师ID',
        name VARCHAR(100) NOT NULL COMMENT '姓名',
        subjects VARCHAR(500) NOT NULL COMMENT '任教科目',
        venue VARCHAR(100) NOT NULL COMMENT '教室位置',
        icon VARCHAR(20) DEFAULT '👨‍🏫' COMMENT '图标',
        total_slots INT DEFAULT 12 COMMENT '总名额',
        limited_slots TINYINT(1) DEFAULT 0 COMMENT '是否限制时段(Vico/Lily只有10:30-12:00)',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='老师信息表'
    `);
    console.log('✅ teachers 表已创建');

    // 2. 创建 bookings 表
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY COMMENT '预约ID',
        teacher_id INT NOT NULL COMMENT '老师ID',
        teacher_name VARCHAR(100) NOT NULL COMMENT '老师姓名(冗余)',
        venue VARCHAR(100) NOT NULL COMMENT '教室(冗余)',
        student_name VARCHAR(100) NOT NULL COMMENT '学生姓名',
        phone VARCHAR(20) NOT NULL COMMENT '家长电话',
        date DATE NOT NULL COMMENT '预约日期',
        time_slot VARCHAR(20) NOT NULL COMMENT '时间段',
        notes TEXT COMMENT '备注',
        status TINYINT DEFAULT 1 COMMENT '状态: 1=有效 0=已取消',
        booked_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '预约时间',
        cancelled_at DATETIME DEFAULT NULL COMMENT '取消时间',
        cancelled_by VARCHAR(20) DEFAULT NULL COMMENT '取消者: parent=家长 admin=管理员',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_teacher_date (teacher_id, date, status),
        INDEX idx_student_date (student_name, date, status),
        INDEX idx_date_status (date, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预约记录表'
    `);
    console.log('✅ bookings 表已创建');

    // 3. 创建 audit_logs 表
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(20) NOT NULL COMMENT '操作类型: CREATE/CANCEL/EXPORT',
        target_type VARCHAR(20) COMMENT '对象类型: BOOKING',
        target_id INT COMMENT '对象ID',
        user_info VARCHAR(200) COMMENT '操作者信息(学生名+手机号)',
        ip_address VARCHAR(50) COMMENT 'IP地址',
        details JSON COMMENT '详细数据',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_action (action),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志'
    `);
    console.log('✅ audit_logs 表已创建');

    // 4. 创建 admin_config 表（系统配置，包含管理员密码）
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS admin_config (
        config_key VARCHAR(50) PRIMARY KEY COMMENT '配置键',
        config_value VARCHAR(500) NOT NULL COMMENT '配置值',
        description VARCHAR(200) COMMENT '说明',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置表'
    `);
    console.log('✅ admin_config 表已创建');

    // 5. 创建 students 学生名册表
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY COMMENT '学生ID',
        name VARCHAR(100) NOT NULL COMMENT '学生姓名',
        class_name VARCHAR(100) DEFAULT '' COMMENT '班级',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生名册'
    `);
    console.log('✅ students 表已创建');

    // 插入默认管理员密码（从环境变量读取，不在代码中硬编码）
    const [configExists] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM admin_config WHERE config_key = 'admin_password'"
    );
    if (configExists[0].cnt === 0) {
      const defaultPassword = process.env.ADMIN_PASSWORD;
      if (!defaultPassword) {
        console.log('⚠️  未设置 ADMIN_PASSWORD 环境变量，跳过管理员密码初始化。请手动设置：');
        console.log('   export ADMIN_PASSWORD=你的密码 && node init-db.js');
      } else {
        await conn.execute(
          "INSERT INTO admin_config (config_key, config_value, description) VALUES ('admin_password', ?, '管理员登录密码')",
          [defaultPassword]
        );
        console.log('✅ 已设置默认管理员密码（来自环境变量）');
      }
    } else {
      console.log('ℹ️  管理员密码已存在，跳过');
    }

    // 插入默认会议日期
    const [dateExists] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM admin_config WHERE config_key = 'meeting_date'"
    );
    if (dateExists[0].cnt === 0) {
      await conn.execute(
        "INSERT INTO admin_config (config_key, config_value, description) VALUES ('meeting_date', '2026-04-03', '家长会日期')"
      );
      console.log('✅ 已设置默认会议日期');
    } else {
      console.log('ℹ️  会议日期已存在，跳过');
    }

    // 插入默认时间段配置（全部时段）
    const [slotsAllExists] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM admin_config WHERE config_key = 'time_slots_all'"
    );
    if (slotsAllExists[0].cnt === 0) {
      await conn.execute(
        "INSERT INTO admin_config (config_key, config_value, description) VALUES ('time_slots_all', '10:20-10:30,10:30-10:40,10:40-10:50,10:50-11:00,11:00-11:10,11:10-11:20,11:20-11:30,11:30-11:40,11:40-11:50,11:50-12:00,12:00-12:10,12:10-12:20', '全部可选时间段')"
      );
      console.log('✅ 已设置默认全部时段');
    } else {
      console.log('ℹ️  全部时段配置已存在，跳过');
    }

    // 插入默认时间段配置（受限时段）
    const [slotsLimitedExists] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM admin_config WHERE config_key = 'time_slots_limited'"
    );
    if (slotsLimitedExists[0].cnt === 0) {
      await conn.execute(
        "INSERT INTO admin_config (config_key, config_value, description) VALUES ('time_slots_limited', '10:30-10:40,10:40-10:50,10:50-11:00,11:00-11:10,11:10-11:20,11:20-11:30,11:30-11:40,11:40-11:50,11:50-12:00', '受限老师可选时间段')"
      );
      console.log('✅ 已设置默认受限时段');
    } else {
      console.log('ℹ️  受限时段配置已存在，跳过');
    }

    // 插入默认名额配置
    const [slotsDefaultExists] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM admin_config WHERE config_key = 'default_total_slots'"
    );
    if (slotsDefaultExists[0].cnt === 0) {
      await conn.execute(
        "INSERT INTO admin_config (config_key, config_value, description) VALUES ('default_total_slots', '12', '新增教师默认名额数')"
      );
      console.log('✅ 已设置默认名额数');
    } else {
      console.log('ℹ️  默认名额配置已存在，跳过');
    }

    // 5. 插入初始老师数据（先清空再插入）
    const [existing] = await conn.execute('SELECT COUNT(*) as cnt FROM teachers');
    if (existing[0].cnt === 0) {
      await conn.execute(`
        INSERT INTO teachers (id, name, subjects, venue, icon, total_slots, limited_slots) VALUES
        (1,  'Eros, Michael',  'Omnibus IIA, Upper-Inter, Rhetoric, AP Cal, Algebra 2, AP 统计', '教室 A', '👨‍🏫', 12, 0),
        (2,  'Kit, Ximena',    'Omnibus IIIA, Advanced Eng, AP US 历史, 西班牙语', '教室 B', '👩‍🏫', 12, 0),
        (3,  'Vico',           'Java/科创', '教室 C', '👨‍💻', 10, 1),
        (4,  'Lily',           '日语', '教室 C', '👩‍🏫', 10, 1),
        (5,  'Elsie, Lilibet', 'Pre-Inter, Starter, Grammar & Writing, Vocabulary', '教室 D', '👩‍🏫', 12, 0),
        (6,  'Rachel, Josie',  '化学, AP 心理, AP 经济, 摄影', '教室 F', '👩‍🔬', 12, 0),
        (7,  'Lucy',           '生物, AP 生物', '教室 F', '👩‍🔬', 12, 0),
        (8,  'Micke, Elvin',   'Omnibus IIIB, Junior Thesis, Pre-Inter, 物理, AP 物理, AP 化学, Algebra 1', '教室 I', '👨‍🏫', 12, 0),
        (9,  'Eren, Yolanda',  'Omnibus IIB, Pre-Inter, Debate, Pre-cal, AP Cal, Physical Science', '教室 J', '👩‍🏫', 12, 0),
        (10, 'June',           '升学规划', '会议室', '📋', 12, 0),
        (11, '周校',           '校长', '董事长办公室', '🎓', 12, 0)
      `);
      console.log('✅ 已插入 11 位老师数据');
    } else {
      console.log('ℹ️  teachers 表已有数据，跳过插入');
    }

    console.log('\n🎉 数据库初始化完成！');
  } catch (err) {
    console.error('❌ 初始化失败:', err.message);
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

initDB();
