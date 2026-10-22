import { testPrisma } from './utils/prisma-test-client'
import { resetDatabase } from './utils/reset-database'

afterEach(async () => {
  await resetDatabase(testPrisma)
}, 15000)

afterAll(async () => {
  await testPrisma.$disconnect()
})
