import postgres from 'postgres';

// Database connection
export const db = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL)
  : postgres({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 54321,
      database: process.env.DB_NAME || 'electric',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
    });
