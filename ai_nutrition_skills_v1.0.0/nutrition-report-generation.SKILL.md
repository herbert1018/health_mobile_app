---
description: Calculate and present a meal nutrition report from
  user-confirmed composition and source-verified nutrient data. Use
  after source verification; calculate deterministically and clearly
  label estimates and missing values.
name: nutrition-report-generation
version: 1.0.0
---

# Skill: nutrition-report-generation

## Purpose

Produce a traceable, readable report for the meal using the confirmed
food composition and verified nutrient records. Nutrition arithmetic
must be deterministic (ordinary code or a calculation engine), not
improvised by an LLM.

This Skill may generate explanatory prose, but it must not invent
missing nutrition data or silently turn estimates into facts.

## Preconditions

-   The composition has explicit user confirmation.
-   Each item has a verification record or an explicit `unresolved`
    status.
-   The input includes the nutrient values, source basis, portion
    amount, and units needed for calculation.
-   If the composition changed after verification, invalidate affected
    verification records and re-run source verification before
    calculating the final report.

## Calculation rules

1.  **Choose the edible amount**
    -   Use a user-confirmed weight when supplied.
    -   Otherwise use a defensible source-defined serving conversion.
    -   If neither exists, do not calculate a precise item total; mark
        it incomplete and ask the user for an amount or allow an
        explicitly labelled estimate.
2.  **Scale nutrient values**
    -   For values per 100 g:
        `amount_nutrient = nutrient_per_100g × edible_weight_g / 100`.
    -   For values per serving:
        `amount_nutrient = nutrient_per_serving × consumed_servings`,
        only when consumed servings are known and comparable.
    -   For per-package values: scale by consumed fraction only when
        package total and consumed fraction are known.
3.  **Aggregate**
    -   Sum each nutrient across items only when units and nutrient
        definitions match.
    -   Keep missing values distinct from zero. If any material item is
        unresolved, label totals as partial or estimated rather than
        presenting them as complete.
    -   Preserve unrounded values internally; round for display only.
4.  **Energy**
    -   Prefer directly sourced energy values when available.
    -   Do not force calories to match a simple macro formula when
        source conventions, fiber, polyols, alcohol, or rounding can
        explain differences.
    -   If energy is calculated from macros, mark it as calculated and
        document the method.
5.  **Uncertainty**
    -   Carry forward uncertainty from identification, portion
        estimation, source matching, and missing data.
    -   Do not present a single confidence score as a guarantee of
        accuracy. Provide per-item evidence status and a plain-language
        caveat.
6.  **Daily goals**
    -   The app, not this Skill, owns daily goals and daily accumulation
        in local storage.
    -   If a target is explicitly provided in the request, the report
        may compare meal values with that target, but must not infer a
        personalized target without sufficient context.
    -   A meal is not a diagnosis or medical assessment.
7.  **Units**
    -   Display energy in kcal; protein/carbohydrate/fat/fiber/sugars in
        g; sodium in mg by default.
    -   If source values use other units, normalize before aggregation
        and preserve source values in provenance.
8.  **Portion/serving interpretation**
    -   A "portion" for food groups (e.g. protein or carbohydrate
        exchanges) is not universal. Only report food-group servings if
        the app provides a documented exchange definition and the food
        can be mapped to it. Otherwise report grams and optionally
        describe the food, not a fabricated number of "servings".

## Output contract

Return JSON conforming to `nutrition-workflow.schema.json` with: -
`stage: "report"` - `status` - `meal_summary` - `item_reports[]` -
`totals` - `limitations[]` - `source_references[]` - `errors[]` if
applicable

Each item report must include: - item ID and name - consumed amount and
unit - nutrient totals with units - evidence status
(`official_verified`, `database_matched`, `estimated`, `unresolved`) -
source reference(s), if any - concise uncertainty notes

## Error handling

-   `COMPOSITION_NOT_CONFIRMED`: stop and return to the app's
    confirmation UI.
-   `VERIFICATION_MISSING`: request source verification or mark the
    affected item unresolved; do not fabricate values.
-   `STALE_VERIFICATION`: if an item name, preparation, weight, product
    variant, or serving basis changed, require
    re-verification/recalculation.
-   `INCOMPATIBLE_UNITS`: do not aggregate incompatible units.
-   `PARTIAL_TOTAL`: return only defensible partial totals and clearly
    state what's missing.
-   `CALCULATION_INVALID`: validate numeric inputs (finite,
    non-negative) and reject invalid values.
-   `NO_USABLE_NUTRIENT_DATA`: return an explanation and request
    additional information rather than a fake report.
-   `GOAL_NOT_PROVIDED`: omit goal comparison rather than inventing a
    daily target.

## Acceptance tests

1.  For an item with 12 g protein per 100 g and a confirmed edible
    amount of 150 g, the calculated protein is 18 g before display
    rounding.
2.  A missing nutrient is not treated as zero.
3.  If one item is unresolved, the report marks totals as
    partial/incomplete and names the unresolved item.
4.  Editing an item's preparation or weight after verification
    invalidates the old verification record.
5.  Values from per-100-g and per-serving sources are not summed until
    converted to the same consumed-amount basis.
6.  The report distinguishes official data, database matches, and
    estimates.
7.  Food-group exchange servings are omitted unless an explicit exchange
    system is configured.
8.  Daily accumulation is left to the app's local database; this Skill
    reports only the current meal unless a target/summary is explicitly
    supplied.
9.  Invalid negative weights or non-finite nutrient values are rejected.
