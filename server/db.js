const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  // 腾讯云 MySQL 需要
  connectTimeout: 10000,
});

// 测试连接
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL 连接成功');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL 连接失败:', err.message);
  });

module.exports = pool;
