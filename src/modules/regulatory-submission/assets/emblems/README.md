# Regulatory authority emblems

Small, static, version-controlled image assets — one per `RegulatoryAuthority`
that has a real, sourced emblem/coat-of-arms image, looked up at PDF-render
time by `RegulatoryAuthority.emblemAssetKey`. This is build-time reference
content, the same category as the MedDRA/WHODrug seed data — not a
per-tenant upload, and not something `RegulatorySubmissionPdfService`
fabricates or substitutes a placeholder for when missing.

## `kenya-coat-of-arms.png`

Kenya's national Coat of Arms (with the "HARAMBEE" motto and national
flag stripes), extracted directly from the real PPB E2B report sample at
`vigicloud docs/E2b5318.pdf` (`pdfimages -png` against page 1, RGB + soft-mask
layers recombined into one RGBA PNG via Pillow) — the exact artwork PPB
itself uses on this exact form, not a substitute sourced elsewhere.
100×87px, transparent background.

## Adding a new authority's emblem

1. Source the real, correct emblem/coat-of-arms image for that specific
   authority (or its country, if the authority has no emblem of its own)
   from an authoritative source — a real PPB-style form sample like the
   one above is ideal, since it's demonstrably the artwork the authority
   itself uses.
2. Save it here as `<country-iso-lowercase>-<short-name>.png`, RGBA,
   background transparent if possible, roughly the same 100×87 aspect
   ratio the layout was designed around (bigger is fine, will be scaled
   down; very different aspect ratios may need `RegulatorySubmissionPdfService`
   adjusted).
3. Set `RegulatoryAuthority.emblemAssetKey` to the filename without its
   extension (e.g. `"uganda-nda"`) via a `prisma/country-rules.seed-data.ts`
   `AuthoritySeed` entry — not a runtime admin upload; this is intentionally
   symmetric with how the rest of that authority's letterhead fields
   (`formCode`/`ministryName`/etc.) are seeded.

Never invent, approximate, or reuse another country's emblem as a
stand-in — an authority with no real sourced emblem yet should have
`emblemAssetKey: null` and render the clean text-only letterhead instead;
see `RegulatoryAuthority.emblemAssetKey`'s own schema doc comment.
