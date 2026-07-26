import { testPrisma } from './utils/prisma-test-client'
import { resetDatabase } from './utils/reset-database'

afterEach(async () => {
  await resetDatabase(testPrisma)
})

afterAll(async () => {
  await testPrisma.$disconnect()
})
