# Frozen scoring rubric v1

Freeze date: 2026-11-18, before any model evaluation. The 20 synthetic cases in quality-cases.json cover four domains (five each). Run every case three times with the same recorded model/version, prompt, compiler version and seed; retain all 60 outputs, including errors. Do not select the best run. This is a designed acceptance set, not evidence of general model quality.

Score each applicable dimension 0/1/2: 0 = wrong or missing; 1 = partly correct with an explicit bounded omission; 2 = all case requirements satisfied. Use independent human review against the frozen required/forbidden statements, not similarity to generated model output. Record reviewer, output revision, source IDs, score and justification. Mark a genuinely inapplicable dimension N/A before seeing output.

| Dimension | Full-score anchor |
|---|---|
| Information retention | All stated facts and dissent retained; no content truncation |
| Conditions/uncertainty | Every limit, unknown and conditional premise remains explicit |
| Relation fidelity | Direction, multiple evidence links and legitimate loops preserved |
| Structure suitability | Requested organization rendered without inventing relations |
| Human rewrite response | Saved manual wording/endpoints remain; compatible additions retained |
| Local stability | Unaffected contents, coordinates and ordering unchanged |

Blocking failures in any run: lost human modification, fabricated evidence/source, continued use of a withdrawn premise. Any occurrence fails the whole evaluation regardless of aggregate scores. Other dimensions: no applicable score 0; mean at least 1.8 per dimension across all applicable runs. Errors and unexecuted cases prevent a pass. A changed case/rubric requires a new version and fresh evaluation of all implementations being compared.

The baseline has NOT run these 60 model evaluations. Cases mentioning human edits require those edits to be executed through public operations, not only copied into model prompts. Q09 begins with deadline Friday then saves Tuesday; Q14 begins with evidence→A then saves evidence→C; Q15 seeds two unrelated regions and records both geometries. Q05/Q17/Q20 require retaining earlier source versions before the update. These preparation steps are part of the cases and must be included by the eventual harness.
