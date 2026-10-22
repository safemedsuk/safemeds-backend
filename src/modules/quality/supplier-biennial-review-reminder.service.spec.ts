import { SupplierBiennialReviewReminderService } from './supplier-biennial-review-reminder.service'

describe('SupplierBiennialReviewReminderService (pure rules)', () => {
  const created = new Date('2024-03-10T00:00:00Z')
  const approved = new Date('2025-06-01T00:00:00Z')
  const review = new Date('2026-02-01T00:00:00Z')

  it('anchors on the latest review when one exists', () => {
    expect(
      SupplierBiennialReviewReminderService.anchorFor(
        { createdAt: created, lastQualifiedAt: approved },
        review,
      ),
    ).toEqual(review)
  })

  it('falls back to the last qualification (approval) when no review exists yet', () => {
    expect(
      SupplierBiennialReviewReminderService.anchorFor(
        { createdAt: created, lastQualifiedAt: approved },
        null,
      ),
    ).toEqual(approved)
  })

  it('falls back to the creation date for a supplier never approved or reviewed', () => {
    expect(
      SupplierBiennialReviewReminderService.anchorFor(
        { createdAt: created, lastQualifiedAt: null },
        null,
      ),
    ).toEqual(created)
  })

  it('the review is due exactly 24 months after the anchor', () => {
    const due = SupplierBiennialReviewReminderService.dueAtFor(created)
    expect(due.toISOString()).toBe('2026-03-10T00:00:00.000Z')
  })

  it('does not remind more than 30 days ahead of the due date', () => {
    const due = new Date('2026-03-10T00:00:00Z')
    const now = new Date(due.getTime() - 60 * 24 * 60 * 60 * 1000)
    expect(SupplierBiennialReviewReminderService.shouldRemind(due, now, null)).toBe(false)
  })

  it('reminds within 30 days of the due date, and keeps reminding once overdue', () => {
    const due = new Date('2026-03-10T00:00:00Z')
    expect(
      SupplierBiennialReviewReminderService.shouldRemind(
        due,
        new Date(due.getTime() - 5 * 86400000),
        null,
      ),
    ).toBe(true)
    expect(
      SupplierBiennialReviewReminderService.shouldRemind(
        due,
        new Date(due.getTime() + 86400000),
        null,
      ),
    ).toBe(true)
  })

  it('never sends twice for the same due date (dedupe)', () => {
    const due = new Date('2026-03-10T00:00:00Z')
    expect(SupplierBiennialReviewReminderService.shouldRemind(due, due, due)).toBe(false)
  })

  it('a new due date (after a fresh review) is reminded again', () => {
    const oldDue = new Date('2026-03-10T00:00:00Z')
    const newDue = new Date('2028-03-10T00:00:00Z')
    expect(SupplierBiennialReviewReminderService.shouldRemind(newDue, newDue, oldDue)).toBe(true)
  })
})
