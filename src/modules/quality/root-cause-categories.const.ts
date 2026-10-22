/**
 * QualCloud Phase 1 Pass A2 — the one curated root-cause category list
 * every CAPA (deviation, OOS/OOT, complaint, audit finding, ...) draws
 * from. Exposed to the UI via `GET /capas/root-cause-categories`, so
 * adding or renaming a category is a one-file change here, never a
 * frontend copy.
 *
 * `other` is the escape hatch: when chosen, the caller must supply
 * `rootCauseOther` (typed free text), and that typed text — not the
 * literal key `other` — is what gets stored in `Capa.rootCauseCategory`.
 * Every listed category stores its own key.
 */
export const ROOT_CAUSE_CATEGORIES = [
  { key: 'human_error_training', label: 'Human error / inadequate training' },
  { key: 'procedure_inadequate', label: 'Procedure inadequate or unclear' },
  { key: 'procedure_not_followed', label: 'Procedure not followed' },
  { key: 'equipment_failure', label: 'Equipment failure or malfunction' },
  { key: 'equipment_design', label: 'Equipment design or suitability' },
  { key: 'equipment_calibration', label: 'Calibration' },
  { key: 'maintenance', label: 'Maintenance (planned or unplanned)' },
  { key: 'materials_supplier', label: 'Materials or supplier quality' },
  { key: 'raw_material_quality', label: 'Raw material quality or specification' },
  { key: 'packaging_component', label: 'Packaging component' },
  { key: 'environment_hvac', label: 'Environment: HVAC, pressure or airflow' },
  { key: 'environment_cleaning', label: 'Cleaning or sanitisation' },
  { key: 'contamination_cross', label: 'Contamination or cross-contamination' },
  { key: 'measurement_method', label: 'Measurement or test method' },
  { key: 'measurement_analytical', label: 'Analytical or laboratory error' },
  { key: 'sampling_error', label: 'Sampling error' },
  { key: 'software_computerised_system', label: 'Software or computerised system' },
  { key: 'data_integrity', label: 'Data integrity or documentation gap' },
  { key: 'documentation_error', label: 'Documentation or record error' },
  { key: 'labelling_error', label: 'Labelling error' },
  { key: 'process_parameter', label: 'Process parameter out of control' },
  { key: 'validation_gap', label: 'Validation gap or inadequate validation' },
  { key: 'design_facility_layout', label: 'Facility or layout design' },
  { key: 'storage_transport', label: 'Storage or transport conditions' },
  { key: 'change_control_gap', label: 'Change control gap' },
  { key: 'communication', label: 'Communication or handover failure' },
  { key: 'management_oversight', label: 'Management or oversight' },
  { key: 'supplier_failure', label: 'Supplier failure' },
  { key: 'other', label: 'Other (type it)' },
] as const

export type RootCauseCategoryKey = (typeof ROOT_CAUSE_CATEGORIES)[number]['key']

export const OTHER_ROOT_CAUSE_KEY = 'other' as const

export function isListedRootCauseKey(value: string): boolean {
  return ROOT_CAUSE_CATEGORIES.some((c) => c.key === value)
}
