import pkg from 'pg';
const { Pool } = pkg;

let pool;

export async function setupDatabase() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://zipzop:zipzoppass@localhost:5432/zipzop'
  });

  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database error:', err);
    throw err;
  }
}

export function getPool() {
  return pool;
}

export async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('❌ Query error:', err);
    throw err;
  }
}
