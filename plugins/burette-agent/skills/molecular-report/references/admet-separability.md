# ADMET Spread / MAE Separability Contract

Reference contract for reporting cohort-level ADMET separability in Burette
molecular reports (aligned with ADMETForge `champion_calibration.json` schema `1.0.0`).

## Formula & Status Thresholds

For a cohort of $n \ge 2$ compounds with finite predicted values $y_1, \dots, y_n$
in the calibration entry's exact `scale`:

```text
spread = max(y) - min(y)
xMAE   = spread / model_error
```

| Status | Condition | Ranking guidance |
| --- | --- | --- |
| `separable` | `xMAE >= 2.0` | Signal exceeds model error; safe to rank candidates |
| `borderline` | `1.0 <= xMAE < 2.0` | Marginal separation; use alongside orthogonal evidence |
| `noise` | `xMAE < 1.0` | Within model error; do not rank compounds on this endpoint |

## Calibration JSON Fields (`schema_version: "1.0.0"`)

Each entry under `endpoints[]` in `champion_calibration.json` provides:

- `endpoint`: canonical endpoint identifier (or `union__<property_id>`)
- `property_id`: ADMET property group (`pka_acid`, `logd`, `kinetic_solubility`, etc.)
- `metric`: `"mae"` or `"rmse"`
- `model_error`: champion validation error in `scale`
- `scale`, `units`, `target_transform`: exact error scale (never mix linear values with `clip_nonnegative_log10p1` or `log10` errors)
- `split`, `champion_model`, `rank`, `total_models`, `spearman`: champion benchmark provenance

## Recommended Summary Table Columns

Include these fields in markdown summary tables and `snapshot.datasets` table rows:

| Endpoint | Scale | Spread | Model MAE | xMAE | Separability | Champion |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `iupac_pka_acid_25c` | `pKa` | `2.50` | `0.468` | `5.34×` | `separable` | `Kumo-Tabular` |
| `herg_pic50` (example) | `pIC50` | `0.20` | `0.500` | `0.40×` | `noise` (do not rank) | `Multi-view ensemble` |
