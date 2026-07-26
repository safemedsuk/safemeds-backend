import { execSync } from 'child_process'
import dotenv from 'dotenv'
import path from 'path'

/**
 * Runs once before the whole e2e suite: loads `.env.test` and applies every
 * migration to the dedicated `safemeds_test` database (never `safemeds_dev`).
 */
export default function globalSetup(): void {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') })

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  })
}
