import type { CompositionItem } from './gemini';
import type {
  NutritionSet,
  NutritionSource,
  NutritionVerificationResult,
  NutritionValue,
  VerifiedNutritionItem,
} from './nutrition-verification';

const NUTRIENT_KEYS = [
  'energy',
  'protein',
  'carbohydrate',
  'total_sugars',
  'added_sugars',
  'fat',
  'saturated_fat',
  'fiber',
  'sodium',
  'cholesterol',
] as const;

type NutrientKey = (typeof NUTRIENT_KEYS)[number];
type ReportStatus = 'complete' | 'partial';

export type NutritionReportItem = {
  item_id: string;
  name: string;
  consumed_amount: number | null;
  consumed_unit: string | null;
  consumed_weight_g: number | null;
  evidence_status: VerifiedNutritionItem['evidence_status'];
  nutrients: NutritionSet;
  source_ids: string[];
  uncertainty_notes: string[];
};

export type NutritionReport = {
  schema_version: '1.0.0';
  stage: 'report';
  meal_id: string;
  status: ReportStatus;
  meal_summary: string;
  item_reports: NutritionReportItem[];
  totals: NutritionSet;
  limitations: string[];
  source_references: string[];
  errors: {
    code: string;
    message: string;
    recoverable: boolean;
    item_id?: string;
    suggested_action?: string;
  }[];
  metadata: {
    calculation_version: string;
    generated_at: string;
  };
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function displayedBasisValue(
  verifiedValue: NutritionValue | undefined,
  consumedWeightG: number | null,
): number | null {
  if (!verifiedValue || !isFiniteNonNegative(verifiedValue.value)) {
    return null;
  }

  if (verifiedValue.basis === 'per_100_g' && consumedWeightG != null) {
    return (verifiedValue.value * consumedWeightG) / 100;
  }

  return null;
}

function reportValue(value: number | null, unit: NutritionValue['unit']): NutritionValue {
  return {
    value,
    unit,
    basis: 'consumed_amount',
    original_value: null,
    original_unit: null,
    conversion_note: '',
  };
}

function totalUnit(key: NutrientKey): NutritionValue['unit'] {
  if (key === 'energy') {
    return 'kcal';
  }
  if (key === 'sodium' || key === 'cholesterol') {
    return 'mg';
  }
  return 'g';
}

export function generateNutritionReport(
  mealId: string,
  compositionItems: CompositionItem[],
  verification: NutritionVerificationResult,
): NutritionReport {
  if (verification.stage !== 'verification' || verification.meal_id !== mealId) {
    throw new Error('VERIFICATION_MISSING：查證結果與餐點不相符。');
  }

  const verifiedById = new Map(
    verification.verified_items.map((item) => [item.item_id, item]),
  );
  const limitations: string[] = [];
  const itemReports = compositionItems.map((item) => {
    const verified = verifiedById.get(item.item_id);
    if (!verified) {
      throw new Error(`VERIFICATION_MISSING：缺少 ${item.name} 的查證結果。`);
    }

    const rawWeight = item.confirmed_weight_g ?? item.estimated_weight_g ?? null;
    if (rawWeight !== null && !isFiniteNonNegative(rawWeight)) {
      throw new Error(`CALCULATION_INVALID：${item.name} 的重量無效。`);
    }
    // 0 g 視為未知重量，避免被算成「攝取 0」。
    const weight = rawWeight !== null && rawWeight > 0 ? rawWeight : null;

    const nutrients: NutritionSet = {};
    const uncertaintyNotes: string[] = [];
    uncertaintyNotes.push(
      `影像辨識信心指標 ${Math.round(item.identification_confidence * 100)}%，不確定性 ${item.uncertainty}；此信心值未經統計校準。`,
    );
    if (item.portion_confidence != null) {
      uncertaintyNotes.push(
        `模型回報份量信心指標 ${Math.round(item.portion_confidence * 100)}%。`,
      );
    }
    if (item.candidate_names?.length) {
      uncertaintyNotes.push(
        `待確認食材候選：${item.candidate_names.join('、')}；未視為已確認配方查證。`,
      );
      limitations.push(
        `${item.name} 尚有未確認食材候選，營養匹配可能不完整。`,
      );
    }

    if (item.confirmed_weight_g != null) {
      uncertaintyNotes.push('份量使用使用者確認重量。');
    } else if (item.estimated_weight_g != null) {
      uncertaintyNotes.push('份量使用 AI 估計重量計算，結果為估計值。');
    } else {
      uncertaintyNotes.push('沒有可用重量，無法計算此項實際攝取量。');
      limitations.push(`${item.name} 沒有確認重量或可靠估計重量，項目營養量保留未知。`);
    }

    if (verified.evidence_status === 'unresolved') {
      uncertaintyNotes.push(verified.match_notes || '營養來源尚未解決。');
      limitations.push(`${item.name} 尚無可用的營養來源。`);
    } else if (verified.evidence_status === 'estimated') {
      uncertaintyNotes.push('營養值為 AI 估算，並非外部來源查證。');
      limitations.push(`${item.name} 的營養值為 AI 估算，未經來源驗證。`);
    }

    for (const key of NUTRIENT_KEYS) {
      const sourceValue = verified.nutrients[key];
      const amount = displayedBasisValue(sourceValue, weight);
      if (amount !== null) {
        nutrients[key] = reportValue(amount, totalUnit(key));
      }
    }

    for (const key of ['energy', 'protein', 'carbohydrate', 'fat'] as const) {
      if (nutrients[key]?.value == null) {
        uncertaintyNotes.push(`${key} 缺少可計算的來源值或重量基準。`);
      }
    }

    return {
      item_id: item.item_id,
      name: item.name,
      consumed_amount: weight,
      consumed_unit: weight == null ? null : 'g',
      consumed_weight_g: weight,
      evidence_status: verified.evidence_status,
      nutrients,
      source_ids: verified.source_ids,
      uncertainty_notes: Array.from(new Set(uncertaintyNotes)),
    } satisfies NutritionReportItem;
  });

  const totals: NutritionSet = {};
  for (const key of NUTRIENT_KEYS) {
    const values = itemReports.map((item) => item.nutrients[key]?.value);
    const knownValues = values.filter(isFiniteNonNegative);
    const missingNames = itemReports
      .filter((item) => item.nutrients[key]?.value == null)
      .map((item) => item.name);

    if (knownValues.length > 0) {
      totals[key] = reportValue(
        knownValues.reduce((total, value) => total + value, 0),
        totalUnit(key),
      );
    }

    if (missingNames.length > 0) {
      limitations.push(
        `${key} 總量只加總有來源與可計算重量的項目；未納入：${missingNames.join('、')}。`,
      );
    }
  }

  const hasIncompleteNutrientData = itemReports.some((item) =>
    NUTRIENT_KEYS.some((key) => item.nutrients[key]?.value == null),
  );
  const hasUnresolvedEvidence = itemReports.some(
    (item) => item.evidence_status === 'unresolved',
  );
  const hasEstimatedEvidence = itemReports.some(
    (item) => item.evidence_status === 'estimated',
  );
  const hasUnconfirmedIngredients = compositionItems.some(
    (item) => (item.candidate_names?.length ?? 0) > 0,
  );
  const status: ReportStatus =
    hasIncompleteNutrientData ||
    hasUnresolvedEvidence ||
    hasEstimatedEvidence ||
    hasUnconfirmedIngredients
      ? 'partial'
      : 'complete';

  if (status === 'partial') {
    limitations.unshift('本報告為部分結果；未知資料未以 0 代替。');
  }
  limitations.push('營養報告僅供飲食紀錄參考，不構成醫療診斷。');

  const sourceById = new Map(
    verification.sources.map((source: NutritionSource) => [source.source_id, source]),
  );
  const sourceReferences = Array.from(
    new Set(
      itemReports.flatMap((item) =>
        item.source_ids
          .map((sourceId) => sourceById.get(sourceId)?.source_url)
          .filter((url): url is string => Boolean(url)),
      ),
    ),
  );

  return {
    schema_version: '1.0.0',
    stage: 'report',
    meal_id: mealId,
    status,
    meal_summary: `本餐包含 ${compositionItems.length} 項食物；${itemReports.filter((item) => item.evidence_status === 'official_verified' || item.evidence_status === 'database_matched').length} 項有查證來源。`,
    item_reports: itemReports,
    totals,
    limitations: Array.from(new Set(limitations)),
    source_references: sourceReferences,
    errors:
      status === 'partial'
        ? [
            {
              code: 'PARTIAL_TOTAL',
              message: '部分項目缺少來源數值或重量，總量不完整。',
              recoverable: true,
              suggested_action: '補充食物重量或等待可用的營養資料來源。',
            },
          ]
        : [],
    metadata: {
      calculation_version: '1.0.0',
      generated_at: new Date().toISOString(),
    },
  };
}