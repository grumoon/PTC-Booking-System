// 临时脚本：批量导入学生名册
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  const names = [
    '薛乐孜', '姜玉铭', '张罡源', '卢嫣然', '卢怡然',
    '张树诚', '严梓昇', '徐紫嫣', '曹佳阳', '龙玉坤',
    '杨临轩', '陈嘉铭', '王元楷', '杨毅铭', '贺然',
    '童诗倩', '翟曼清', '熊丹煜', '王紫宸', '余荣镇',
    '邓紫阳', '陆政铭', '李逸轩', '许嘉玲', '曹雨沐',
    '熊艺婷', '刘妍辰', '杨梓陌', '赵子墨', '孙一轩'
  ];

  let added = 0, skipped = 0;
  for (const name of names) {
    try {
      await pool.execute('INSERT INTO students (name) VALUES (?)', [name]);
      added++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        skipped++;
        console.log(`  ⏭️ ${name} (已存在，跳过)`);
      } else {
        throw e;
      }
    }
  }

  console.log(`\n🎉 导入完成：新增 ${added} 人，跳过 ${skipped} 人，共 ${names.length} 人`);

  // 验证
  const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM students');
  console.log(`📊 名册总人数：${rows[0].cnt}`);

  await pool.end();
})();
