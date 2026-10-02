/**
 * QualCloud (Phase 13) Stage 9 — the "map each PPB/East African GMP
 * Compendium item to a QualCloud record" requirement. Seeded today as a
 * structurally-real, `unverified: true` set of section headings drawn
 * straight from the Build Priority doc's own verified inspection-scope
 * list (premises, equipment, processes, personnel competence,
 * documentation, quality control, storage, input traceability) — each
 * mapped to the QualCloud record type that answers it. This mirrors
 * `AUDIT_REQUIREMENTS`'s own precedent (VigiCloud Stage 16.2) exactly:
 * a real starting structure, honestly flagged as not yet a per-item
 * guideline citation, until a field expert confirms the real East
 * African GMP Compendium wording — see `todo-qualcloud.md`'s own open
 * item 3 ("The real East African GMP Compendium's literal
 * inspection-checklist text, to replace the currently-structural-but-
 * `unverified` checklist template").
 *
 * `mappedRecordType` is a resolver key read by
 * `InspectionReadinessService`'s own `SYSTEM_RESOLVERS` map — never a
 * literal table name.
 */
export interface InspectionChecklistSectionSeed {
  sectionKey: string
  title: string
  description: string
  mappedRecordType: string
  sortOrder: number
  guidelineReference?: string
}

export const INSPECTION_CHECKLIST_SECTIONS: InspectionChecklistSectionSeed[] = [
  {
    sectionKey: 'premises',
    title: 'Premises',
    description:
      'Facility layout, cleanliness, and environmental controls appropriate to the operations conducted.',
    mappedRecordType: 'facility_status',
    sortOrder: 1,
  },
  {
    sectionKey: 'equipment',
    title: 'Equipment',
    description:
      'Equipment qualification (DQ/IQ/OQ/PQ) status, and calibration/maintenance currency.',
    mappedRecordType: 'equipment_qualification',
    sortOrder: 2,
  },
  {
    sectionKey: 'processes',
    title: 'Processes',
    description:
      'Open deviations, CAPA effectiveness, and change-control discipline across manufacturing/quality processes.',
    mappedRecordType: 'open_critical_deviations',
    sortOrder: 3,
  },
  {
    sectionKey: 'personnel_competence',
    title: 'Personnel Competence',
    description: 'Staff training records current and complete for their assigned roles.',
    mappedRecordType: 'training_compliance',
    sortOrder: 4,
  },
  {
    sectionKey: 'documentation',
    title: 'Documentation',
    description:
      'Controlled documents (SOPs, specifications) effective, current, and not overdue for periodic review.',
    mappedRecordType: 'controlled_document_currency',
    sortOrder: 5,
  },
  {
    sectionKey: 'quality_control',
    title: 'Quality Control',
    description: 'OOS/OOT investigations closed with a documented, defensible root cause.',
    mappedRecordType: 'oos_backlog',
    sortOrder: 6,
  },
  {
    sectionKey: 'storage',
    title: 'Storage',
    description: 'Batch quarantine/release status and storage-condition compliance.',
    mappedRecordType: 'batch_quality_status',
    sortOrder: 7,
  },
  {
    sectionKey: 'input_traceability',
    title: 'Input Traceability',
    description: "Every batch's own genealogy (upstream/downstream) resolvable and complete.",
    mappedRecordType: 'batch_traceability',
    sortOrder: 8,
  },
]
