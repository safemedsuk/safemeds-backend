import { equipmentDueStatus } from './equipment-due-status.util'

describe('equipmentDueStatus', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  const day = 24 * 60 * 60 * 1000

  it('is not_scheduled when no due date is set', () => {
    expect(equipmentDueStatus(null, now)).toBe('not_scheduled')
  })

  it('is overdue once the due date has passed', () => {
    expect(equipmentDueStatus(new Date(now.getTime() - day), now)).toBe('overdue')
  })

  it('is due_soon within 30 days, inclusive of the boundary', () => {
    expect(equipmentDueStatus(new Date(now.getTime() + day), now)).toBe('due_soon')
    expect(equipmentDueStatus(new Date(now.getTime() + 30 * day), now)).toBe('due_soon')
  })

  it('is current beyond 30 days', () => {
    expect(equipmentDueStatus(new Date(now.getTime() + 31 * day), now)).toBe('current')
  })
})
