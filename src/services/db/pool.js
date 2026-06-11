import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;

// Global database connection pool instance
let pool = null;

if (DATABASE_URL) {
  // SSL is required on platforms like Railway when connection string contains sslmode=require
  const needsSsl =
    process.env.PGSSLMODE === "require" || DATABASE_URL.includes("sslmode=require");
  pool = new Pool({
    connectionString: DATABASE_URL,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {})
  });

  pool.on("error", (err) => {
    console.error("[db] pool error", err?.message || err);
  });
}

/**
 * Checks if the database is configured and initialized.
 * @returns {boolean} True if DB is available, false otherwise
 */
export function isDbEnabled() {
  return Boolean(pool);
}

/**
 * Returns the global pg.Pool database client instance.
 * Throws an error if the connection string was not defined.
 * @returns {pg.Pool} The database pool client
 */
export function getPool() {
  if (!pool) {
    throw new Error("DATABASE_URL not configured");
  }
  return pool;
}

/**
 * Executes a PostgreSQL query using the global connection pool.
 * @param {string} text - SQL statement to execute
 * @param {Array<any>} params - Query parameters
 * @returns {Promise<pg.QueryResult>} Result of the query execution
 */
export async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}
