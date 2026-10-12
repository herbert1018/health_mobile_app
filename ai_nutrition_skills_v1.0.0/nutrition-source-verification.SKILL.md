---
description: Find and validate nutrition data for a user-confirmed meal
  composition, preferring official brand/restaurant/product sources and
  then trustworthy food composition databases. Use only after the app
  confirms the composition.
name: nutrition-source-verification
version: 1.0.0
---

# Skill: nutrition-source-verification

## Purpose

Match each user-confirmed food item to the best available nutrition
source, preserve source provenance, and normalize nutrient values to a
clear reference basis. This Skill verifies source data; it does not
estimate the image composition and does not produce the final
user-facing report.

## Preconditions / hard gate

-   Input must contain a composition with `status: "user_confirmed"` or
    an equivalent explicit app confirmation flag.
-   If any material item identity or portion is still unresolved, return
    `needs_user_input` and identify the missing fields.
-   The app owns local storage. Do not request account information or
    persist user data remotely.

## Source priority

Use this order, while considering whether the source truly matches the
food:

1.  **Official product or restaurant source**: official nutrition page,
    official menu specification, manufacturer product page, or official
    product label supplied by the user.
2.  **Government food composition database**: prefer data relevant to
    the food's region and preparation. For Taiwan-oriented foods,
    consider the Taiwan FDA food nutrient composition database; for
    suitable entries, USDA FoodData Central is another reference.
3.  **Other reputable, transparent food composition source**: use only
    when the origin, serving basis, and nutrient definitions can be
    identified.
4.  **Calculated estimate from ingredients**: only when a source match
    is unavailable and ingredient/weight information is sufficient.
    Label as an estimate.

An official source is not automatically a match. Confirm product
variant, size, market/region, preparation, and serving basis. A chain
restaurant's published value may not match a customized portion or local
branch.

## Web lookup procedure

1.  Search the official brand/restaurant/manufacturer website using the
    exact candidate name, product/menu name, market/region, and size.
2.  Open the candidate source and confirm that it directly supports the
    claim. Do not rely on a search snippet alone when the page is
    accessible.
3.  Capture:
    -   `source_type`
    -   exact `source_name`
    -   exact `source_url` (only if actually observed)
    -   `retrieved_at` (ISO 8601 timestamp from runtime)
    -   `published_or_updated_at` if explicitly shown
    -   `match_basis`: why the source matches the confirmed item
    -   reference serving amount and unit
    -   nutrient values and units as published
4.  If no matching official result is found, record
    `official_source_not_found`; then query a trustworthy food
    composition database.
5.  If the source is inaccessible, ambiguous, or does not publish the
    requested nutrient, say so. Do not invent a URL, publication date,
    brand match, or nutrient value.
6.  When only a search result is available and the underlying page
    cannot be opened, mark the source as `search_result_only` and lower
    the evidence quality.
7.  Do not scrape around access controls, paywalls, CAPTCHAs, or terms
    restrictions.

## Matching and evidence status

Every item must receive one of these statuses: - `official_verified`:
exact official product/menu item and serving basis match. -
`database_matched`: a reputable food database entry is a reasonable
match, but not an exact branded serving. - `estimated`: derived from
ingredient values or a comparable food; must be explicitly labelled as
an estimate. - `unresolved`: no defensible nutrient source or
insufficient identity/portion information.

Store a separate match confidence from `0.0` to `1.0`. It is a heuristic
confidence score, not a statistically calibrated probability. Explain
the basis in a short `match_notes` string.

## Normalization and unit rules

-   Keep the original source values unchanged in `source_nutrients`.
-   Normalize nutrients to a per-100-g edible portion basis when the
    source provides mass-based data and a valid conversion is possible.
-   If a source gives values per serving, preserve `reference_amount`
    and `reference_unit`; scale to the user's confirmed edible amount
    only if the serving-to-portion conversion is defensible.
-   Use grams (`g`) for mass, millilitres (`mL`) for volume,
    kilocalories (`kcal`) for energy, and grams or milligrams for
    nutrient quantities as appropriate.
-   Never convert volume to mass without a justified food-specific
    density or a source-defined serving conversion.
-   Do not treat `1 serving`, `1 bowl`, `1 piece`, or `1 scoop` as a
    universal gram amount.
-   Distinguish carbohydrate, total sugars, added sugars, fiber, total
    fat, saturated fat, sodium, and cholesterol when source data
    distinguishes them.
-   Do not infer missing nutrients as zero. Use `null`/missing and
    explain.
-   If converting kJ to kcal, use 1 kcal = 4.184 kJ. If converting mg to
    g, divide by 1000. Preserve the original value and record the
    conversion.
-   Avoid false precision. Respect the source's reported precision and
    round only for display, not in intermediate calculations.

## Output contract

Return JSON conforming to `nutrition-workflow.schema.json` with: -
`stage: "verification"` - `status` - one `verified_items[]` record per
confirmed composition item - `sources[]` - `errors[]` if applicable

Each verified item should link to `item_id`, include evidence status,
match confidence, reference basis, normalized nutrient values, and
source references.

## Error handling

-   `COMPOSITION_NOT_CONFIRMED`: stop; return the human confirmation
    gate error.
-   `OFFICIAL_SOURCE_NOT_FOUND`: proceed to database fallback and
    preserve the failed official lookup status.
-   `SOURCE_MISMATCH`: reject the candidate source; explain mismatch
    such as size, country, recipe, or variant.
-   `SOURCE_UNAVAILABLE`: try another reputable source; if none, mark
    unresolved.
-   `NUTRIENT_MISSING`: leave the nutrient null; never silently fill it
    with zero.
-   `SERVING_BASIS_UNKNOWN`: do not scale per-serving data to grams; ask
    the user or mark unresolved.
-   `UNIT_CONVERSION_UNSUPPORTED`: preserve the original basis and
    request clarification or a suitable conversion factor.
-   `WEB_EVIDENCE_INSUFFICIENT`: do not label the value verified.
-   `CONFLICTING_SOURCES`: prefer the most directly matched official
    source, document conflicts, and surface uncertainty.

## Acceptance tests

1.  A confirmed packaged food with a matching official nutrition label
    is `official_verified`, with the exact observed URL and serving
    basis.
2.  A brand guess from the photo alone is not enough to claim official
    verification.
3.  If the official site has no nutrition data, the result records that
    fact and attempts a reputable database fallback.
4.  If only a per-serving value exists and serving mass is unknown, the
    system does not fabricate grams or scale the value.
5.  Missing sodium remains null rather than becoming zero.
6.  A result from a different country or product size is rejected or
    explicitly marked as an imperfect match.
7.  Every verified nutrient value can be traced to a source or an
    explicitly labelled estimate.
8.  No URLs, dates, product IDs, or nutrient values are invented.
