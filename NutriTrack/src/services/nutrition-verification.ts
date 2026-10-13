import {
  GEMINI_CANDIDATE_MODELS,
  getStoredApiKey,
  type CompositionItem,
} from './gemini';

const MAX_RETRIES = 2;

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
type NutrientUnit = 'kcal' | 'kJ' | 'g' | 'mg' | 'µg' | 'IU';
type NutrientBasis =
  | 'per_100_g'
  | 'per_100_ml'
  | 'per_serving'
  | 'per_package'
  | 'consumed_amount'
  | 'unknown';

export type VerificationEvidenceStatus =
  | 'official_verified'
  | 'database_matched'
  | 'estimated'
  | 'unresolved';

export type NutritionValue = {
  value: number | null;
  unit: NutrientUnit;
  basis?: NutrientBasis;
  original_value?: number | null;
  original_unit?: string | null;
  conversion_note?: string;
};

export type NutritionSet = Partial<Record<NutrientKey, NutritionValue>>;

export type NutritionSource = {
  source_id: string;
  source_type:
    | 'official_brand'
    | 'official_restaurant'
    | 'official_label'
    | 'government_database'
    | 'reputable_database'
    | 'calculated_estimate'
    | 'other';
  source_name: string;
  source_url: string | null;
  retrieved_at: string;
  published_or_updated_at: string | null;
  evidence_status:
    | 'official_verified'
    | 'database_matched'
    | 'estimated'
    | 'unresolved'
    | 'search_result_only';
  match_basis: string;
  reference_amount: number | null;
  reference_unit: string | null;
  notes: string;
};

export type VerifiedNutritionItem = {
  item_id: string;
  name: string;
  preparation: string | null;
  consumed_weight_g: number | null;
  reference_amount: number | null;
  reference_unit: string | null;
  evidence_status: VerificationEvidenceStatus;
  match_confidence: number;
  match_notes: string;
  nutrients: NutritionSet;
  source_ids: string[];
  unresolved_fields: string[];
};

export type NutritionVerificationResult = {
  schema_version: '1.0.0';
  stage: 'verification';
  meal_id: string;
  status: 'complete' | 'partial' | 'failed' | 'needs_user_input';
  verified_items: VerifiedNutritionItem[];
  sources: NutritionSource[];
  errors: {
    code: string;
    message: string;
    recoverable: boolean;
    item_id?: string;
    suggested_action?: string;
  }[];
  metadata: {
    model: string;
    retrieved_at: string | null;
    grounding_source_count: number;
  };
};

type ConfirmedComposition = {
  schema_version: '1.0.0';
  stage: 'composition';
  meal_id: string;
  status: 'user_confirmed';
  items: CompositionItem[];
};

type GroundingChunk = {
  web?: {
    uri?: string;
    title?: string;
  };
};

type RawSourceReference = {
  url: string;
  source_type: NutritionSource['source_type'];
  evidence_status: NutritionSource['evidence_status'];
  match_basis: string;
  reference_amount?: unknown;
  reference_unit?: unknown;
  notes?: string;
};

type RawNutrient = {
  value?: unknown;
  unit?: unknown;
  basis?: unknown;
  original_value?: unknown;
  original_unit?: unknown;
  conversion_note?: unknown;
};

type RawVerifiedItem = {
  item_id?: unknown;
  official_source_not_found?: unknown;
  evidence_status?: unknown;
  match_confidence?: unknown;
  match_notes?: unknown;
  reference_amount?: unknown;
  reference_unit?: unknown;
  source_references?: unknown;
  nutrients?: unknown;
  unresolved_fields?: unknown;
};

const allowedSourceTypes = new Set<NutritionSource['source_type']>([
  'official_brand',
  'official_restaurant',
  'official_label',
  'government_database',
  'reputable_database',
  'calculated_estimate',
  'other',
]);

const allowedEvidenceStatuses = new Set<NutritionSource['evidence_status']>([
  'official_verified',
  'database_matched',
  'estimated',
  'unresolved',
  'search_result_only',
]);

const allowedBases = new Set<NutrientBasis>([
  'per_100_g',
  'per_100_ml',
  'per_serving',
  'per_package',
  'consumed_amount',
  'unknown',
]);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isGroundedUrl(value: unknown, groundedUrls: Set<string>): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && groundedUrls.has(value);
  } catch {
    return false;
  }
}

function isGovernmentFoodDatabase(url: string): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  return (
    hostname === 'fdc.nal.usda.gov' ||
    hostname === 'foodlabel.fda.gov.tw' ||
    (hostname === 'data.gov.tw' && new URL(url).pathname.includes('8543'))
  );
}

function sourceTypeForHost(
  url: string,
  proposedType: NutritionSource['source_type'],
): NutritionSource['source_type'] {
  if (isGovernmentFoodDatabase(url)) {
    return 'government_database';
  }

  if (proposedType === 'government_database') {
    return 'other';
  }

  return proposedType;
}

function evidenceStatusForReference(
  reference: RawSourceReference,
): NutritionSource['evidence_status'] {
  if (reference.evidence_status === 'search_result_only') {
    return 'search_result_only';
  }

  if (
    isGovernmentFoodDatabase(reference.url) &&
    ['database_matched', 'official_verified'].includes(reference.evidence_status)
  ) {
    return 'database_matched';
  }

  if (
    ['official_brand', 'official_restaurant', 'official_label'].includes(
      reference.source_type,
    ) &&
    reference.evidence_status === 'official_verified'
  ) {
    return 'official_verified';
  }

  if (
    reference.source_type === 'reputable_database' &&
    reference.evidence_status === 'database_matched'
  ) {
    return 'database_matched';
  }

  return 'unresolved';
}

function canonicalUnit(key: NutrientKey): 'kcal' | 'g' | 'mg' {
  if (key === 'energy') {
    return 'kcal';
  }

  if (key === 'sodium' || key === 'cholesterol') {
    return 'mg';
  }

  return 'g';
}

function convertUnit(
  value: number,
  from: NutrientUnit,
  to: 'kcal' | 'g' | 'mg',
): { value: number; note: string } | null {
  if (from === to) {
    return { value, note: '' };
  }

  if (from === 'kJ' && to === 'kcal') {
    return { value: value / 4.184, note: '依 1 kcal = 4.184 kJ 換算' };
  }

  if (from === 'mg' && to === 'g') {
    return { value: value / 1000, note: '依 1000 mg = 1 g 換算' };
  }

  if (from === 'g' && to === 'mg') {
    return { value: value * 1000, note: '依 1 g = 1000 mg 換算' };
  }

  return null;
}

function normalizeNutrient(
  rawValue: unknown,
  key: NutrientKey,
  referenceAmount: number | null,
  referenceUnit: string | null,
): NutritionValue | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const raw = rawValue as RawNutrient;
  if (
    !isFiniteNonNegative(raw.value) ||
    typeof raw.unit !== 'string' ||
    !['kcal', 'kJ', 'g', 'mg', 'µg', 'IU'].includes(raw.unit) ||
    typeof raw.basis !== 'string' ||
    !allowedBases.has(raw.basis as NutrientBasis)
  ) {
    return null;
  }

  const originalValue = isFiniteNonNegative(raw.original_value)
    ? raw.original_value
    : raw.value;
  const originalUnit = asTrimmedString(raw.original_unit) ?? raw.unit;
  const basis = raw.basis as NutrientBasis;
  const targetUnit = canonicalUnit(key);
  const converted = convertUnit(raw.value, raw.unit as NutrientUnit, targetUnit);
  const conversionNotes: string[] = [];

  if (!converted) {
    return {
      value: null,
      unit: targetUnit,
      basis: 'unknown',
      original_value: originalValue,
      original_unit: originalUnit,
      conversion_note: `無法安全地將 ${raw.unit} 換算為 ${targetUnit}`,
    };
  }

  let value = converted.value;
  if (converted.note) {
    conversionNotes.push(converted.note);
  }

  let normalizedBasis = basis;
  if (
    (basis === 'per_serving' || basis === 'per_package') &&
    referenceAmount != null &&
    referenceUnit?.toLowerCase() === 'g'
  ) {
    value = (value * 100) / referenceAmount;
    normalizedBasis = 'per_100_g';
    conversionNotes.push(`依來源標示 ${referenceAmount} g 換算為每 100 g`);
  }

  const modelConversionNote = asTrimmedString(raw.conversion_note);
  if (modelConversionNote) {
    conversionNotes.push(modelConversionNote);
  }

  return {
    value,
    unit: targetUnit,
    basis: normalizedBasis,
    original_value: originalValue,
    original_unit: originalUnit,
    conversion_note: conversionNotes.join('；'),
  };
}

function buildVerificationPrompt(composition: ConfirmedComposition): string {
  return `
你是 NutriTrack 的營養資料來源查證模組。使用 Google Search 查找每項「已由使用者確認」的食物，不可使用模型記憶補寫資料。

餐點 ID：${composition.meal_id}
語言：繁體中文（zh-TW）
已確認食物組成：${JSON.stringify(composition.items)}

查證規則：
1. 先找相符的官方產品/餐廳資料，再找台灣政府食品營養資料庫或 USDA FoodData Central 等政府資料庫。官方來源必須匹配確切品名、產品規格、地區與烹調方式；未找到相符官方來源時，將 official_source_not_found 設為 true，即使找到資料庫 fallback 也不可省略此狀態。
2. 只回傳搜尋工具實際取得、且能直接支持營養數值的來源網址；網址必須逐字取自實際來源，不得自行組合或猜測。
3. 一項營養數值只有在來源明確列出數值、單位及基準時才能填入。不要由常識、模型記憶或相似食物預測數值。
4. 若只有搜尋摘要、來源頁無法支持數值、食物/烹調方式不匹配、或份量基準不明，將該項標為 unresolved 或 search_result_only，營養值留空。
5. source_references.url 必須是實際找到的來源網址；每一項資料都要提供支持它的 URL。來源若明確列出參考份量/單位，必須記錄在來源引用中；未列出就保留 null。不可捏造名稱、日期、網址、品項或來源值。
6. 優先讓同一食物的數值使用同一筆最匹配來源及相同份量基準；若來源間基準不同，不可混合正規化。保留來源原始值與原始單位；basis 只能使用 per_100_g、per_100_ml、per_serving、per_package、consumed_amount、unknown。
7. 未知營養素不要輸出該欄位，不可用 0 代替。不要估算或計算每餐營養總量。
8. 證據狀態只能為 official_verified、database_matched、estimated、unresolved。此任務不得使用 estimated；無可靠來源請用 unresolved。
9. candidate_names 是尚未確認的候選食材，不可用來斷定配方或查證營養值；只依 confirmed item name、preparation 與確定的 ingredients 查證。
10. 每個輸入 item_id 都必須回傳一筆。保留輸入 item_id 與 confirmed food name，不得新增或合併項目。

只輸出 JSON，不要 Markdown 或推理過程：
{
  "items": [
    {
      "item_id": "輸入中的 item_id",
      "official_source_not_found": false,
      "evidence_status": "database_matched",
      "match_confidence": 0.8,
      "match_notes": "簡短說明食物名稱、烹調方式與來源項目的匹配依據",
      "reference_amount": 100,
      "reference_unit": "g",
      "source_references": [
        {
          "url": "必須是搜尋實際取得的完整網址",
          "source_type": "government_database",
          "evidence_status": "database_matched",
          "match_basis": "來源頁直接列出相同食物每 100 g 的營養資料",
          "reference_amount": 100,
          "reference_unit": "g",
          "notes": "僅記錄來源明確提供的內容"
        }
      ],
      "nutrients": {
        "energy": {
          "value": 123,
          "unit": "kcal",
          "basis": "per_100_g",
          "original_value": 123,
          "original_unit": "kcal",
          "conversion_note": ""
        },
        "protein": {
          "value": 4.5,
          "unit": "g",
          "basis": "per_100_g",
          "original_value": 4.5,
          "original_unit": "g",
          "conversion_note": ""
        }
      },
      "unresolved_fields": []
    }
  ]
}
`;
}

async function requestGroundedJson(
  apiKey: string,
  prompt: string,
): Promise<{ draft: any; chunks: GroundingChunk[]; model: string }> {
  const failures: string[] = [];

  for (const model of GEMINI_CANDIDATE_MODELS) {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${model}:generateContent`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      });

      let result: any;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok) {
        const message = result?.error?.message ?? `HTTP ${response.status}`;
        const apiStatus = result?.error?.status;
        const isOverloaded =
          response.status === 503 || apiStatus === 'UNAVAILABLE';
        const isTransient =
          [408, 429, 500, 502, 503, 504].includes(response.status) ||
          ['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'INTERNAL'].includes(apiStatus);
        const isQuotaLimited =
          response.status === 429 ||
          apiStatus === 'RESOURCE_EXHAUSTED' ||
          /quota|rate limit|resource exhausted/i.test(message);
        const isModelUnavailable =
          response.status === 404 ||
          ([400, 403].includes(response.status) &&
            /model.*(not found|not available|unavailable|not supported|not enabled|does not exist)|(?:access|permission).{0,30}model/i.test(message));

        if (isQuotaLimited || isModelUnavailable) {
          failures.push(`${model} (HTTP ${response.status}): ${message}`);
          if (model !== GEMINI_CANDIDATE_MODELS[GEMINI_CANDIDATE_MODELS.length - 1]) {
            break;
          }

          throw new Error(
            `營養查證的 Gemini 候選模型額度不足或不可用，已依序嘗試自定義所有模型`,
          );
        }

        if (isTransient && attempt < MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * 2 ** attempt),
          );
          continue;
        }

        if (isOverloaded) {
          failures.push(`${model} (HTTP ${response.status}): ${message}`);
          if (model !== GEMINI_CANDIDATE_MODELS[GEMINI_CANDIDATE_MODELS.length - 1]) {
            break;
          }

          throw new Error(
            `所有營養查證候選模型目前都無法服務：${failures.join('；')}`,
          );
        }

        throw new Error(`營養來源查證 API 失敗：${message}`);
      }

      const candidate = result?.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? '')
        .join('');
      if (!text) {
        throw new Error('營養來源查證沒有回傳 JSON 結果。');
      }

      let draft: any;
      try {
        draft = JSON.parse(text);
      } catch {
        throw new Error('營養來源查證回傳格式無效，請重新查證。');
      }

      const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks)
        ? candidate.groundingMetadata.groundingChunks
        : [];

      return { draft, chunks, model };
    }
  }

  throw new Error(
    `營養來源查證的候選模型都無法使用：${failures.join('；') || '未收到可用模型回應'}。請檢查專案總額度、模型存取權或稍後再試。`,
  );
}

function isGroundingQuotaFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota|額度|429|RESOURCE_EXHAUSTED|rate limit|所有營養查證候選模型目前都無法服務|候選模型額度不足/i.test(
    message,
  );
}

function buildEstimatePrompt(composition: ConfirmedComposition): string {
  const confirmedItems = composition.items.map((item) => ({
    item_id: item.item_id,
    name: item.name,
    preparation: item.preparation ?? null,
    ingredients: item.ingredients ?? [],
    estimated_weight_g: item.confirmed_weight_g ?? item.estimated_weight_g ?? null,
  }));

  return `
你是 NutriTrack 的備援營養估算模組。網路來源查證因額度不足而不可用，現在只能回傳明確標記的「AI 估算」，不可聲稱已查證或偽造資料來源。

已確認食物與份量：${JSON.stringify(confirmedItems)}

規則：
1. 只能根據已確認的食物名稱、烹調方式、已確認 ingredients 及重量估計常見營養範圍；candidate_names 不會提供給你，也不可補入未確認食材。
2. 每項只估算每 100 g 的 energy、protein、carbohydrate、fat；其他營養素不要猜。若食物描述不足以合理估計，該數值設為 null。
3. 數值是一般食物資料的近似推估，不是來源查證值；使用簡單精度，禁止假精確。
4. 不可回傳網址、品牌、資料庫名稱、來源日期、source reference 或整餐總量。
5. 保留輸入 item_id，每項都回傳一筆；不可新增或合併食物。

只輸出 JSON：
{
  "items": [
    {
      "item_id": "輸入中的 item_id",
      "match_notes": "AI 估算；未使用外部來源查證",
      "nutrients": {
        "energy": { "value": 130, "unit": "kcal" },
        "protein": { "value": 3, "unit": "g" },
        "carbohydrate": { "value": 28, "unit": "g" },
        "fat": { "value": null, "unit": "g" }
      }
    }
  ]
}
`;
}

async function requestEstimatedJson(
  apiKey: string,
  prompt: string,
): Promise<{ draft: any; model: string }> {
  const failures: string[] = [];

  for (const model of GEMINI_CANDIDATE_MODELS) {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${model}:generateContent`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      });

      let result: any;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok) {
        const message = result?.error?.message ?? `HTTP ${response.status}`;
        const apiStatus = result?.error?.status;
        const isQuotaLimited =
          response.status === 429 ||
          apiStatus === 'RESOURCE_EXHAUSTED' ||
          /quota|rate limit|resource exhausted/i.test(message);
        const isModelUnavailable =
          response.status === 404 ||
          ([400, 403].includes(response.status) &&
            /model.*(not found|not available|unavailable|not supported|not enabled|does not exist)|(?:access|permission).{0,30}model/i.test(message));
        const isOverloaded =
          response.status === 503 || apiStatus === 'UNAVAILABLE';

        if (isQuotaLimited || isModelUnavailable) {
          failures.push(`${model} (HTTP ${response.status}): ${message}`);
          break;
        }

        if (isOverloaded && attempt < MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * 2 ** attempt),
          );
          continue;
        }

        if (isOverloaded) {
          failures.push(`${model} (HTTP ${response.status}): ${message}`);
          break;
        }

        throw new Error(`AI 營養估算 API 失敗：${message}`);
      }

      const text = result?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? '')
        .join('');
      if (!text) {
        throw new Error('AI 營養估算沒有回傳 JSON。');
      }

      let draft: any;
      try {
        draft = JSON.parse(text);
      } catch {
        throw new Error('AI 營養估算回傳格式無效。');
      }

      if (!Array.isArray(draft?.items)) {
        throw new Error('AI 營養估算缺少 items 清單。');
      }

      return { draft, model };
    }
  }

  throw new Error(
    `AI 估算模型也無可用額度：${failures.join('；') || '所有候選模型皆無回應'}`,
  );
}

function buildEstimatedVerification(
  composition: ConfirmedComposition,
  draft: any,
  model: string,
  generatedAt: string,
  groundingFailure: string,
): NutritionVerificationResult {
  const estimatesById = new Map(
    (draft.items as any[])
      .filter((item) => typeof item?.item_id === 'string')
      .map((item) => [item.item_id as string, item]),
  );
  const sources: NutritionSource[] = [];
  const verifiedItems: VerifiedNutritionItem[] = composition.items.map((item, index) => {
    const estimate = estimatesById.get(item.item_id);
    const rawNutrients =
      estimate?.nutrients && typeof estimate.nutrients === 'object'
        ? estimate.nutrients as Record<string, RawNutrient>
        : {};
    const nutrients: NutritionSet = {};

    for (const key of NUTRIENT_KEYS) {
      const raw = rawNutrients[key];
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const normalized = normalizeNutrient(
        {
          ...raw,
          basis: 'per_100_g',
          original_value: raw.value,
          original_unit: raw.unit,
        },
        key,
        100,
        'g',
      );
      if (normalized?.value != null) {
        nutrients[key] = normalized;
      }
    }

    const hasEstimates = Object.keys(nutrients).length > 0;
    const sourceId = `ai_estimate_${index + 1}`;
    const sourceIds = hasEstimates ? [sourceId] : [];
    if (hasEstimates) {
      sources.push({
        source_id: sourceId,
        source_type: 'calculated_estimate',
        source_name: 'Gemini AI 營養估算（非外部來源）',
        source_url: null,
        retrieved_at: generatedAt,
        published_or_updated_at: null,
        evidence_status: 'estimated',
        match_basis: '根據已確認名稱、烹調方式、食材與每 100 g 份量進行語言模型估算；沒有外部來源查證。',
        reference_amount: 100,
        reference_unit: 'g',
        notes: `僅供參考，未經來源驗證。觸發原因：${groundingFailure}`,
      });
    }

    const unresolvedFields: string[] = NUTRIENT_KEYS.filter(
      (key) => nutrients[key] == null,
    );
    if (!hasEstimates) {
      unresolvedFields.push('AI 估算亦無法提供可用數值');
    }

    return {
      item_id: item.item_id,
      name: item.name,
      preparation: item.preparation ?? null,
      consumed_weight_g:
        item.confirmed_weight_g ?? item.estimated_weight_g ?? null,
      reference_amount: hasEstimates ? 100 : null,
      reference_unit: hasEstimates ? 'g' : null,
      evidence_status: hasEstimates ? 'estimated' : 'unresolved',
      match_confidence: 0,
      match_notes:
        asTrimmedString(estimate?.match_notes) ??
        (hasEstimates
          ? 'AI 推估值，不是來源查證結果。'
          : '沒有可用外部來源或 AI 估算數值。'),
      nutrients,
      source_ids: sourceIds,
      unresolved_fields: unresolvedFields,
    };
  });

  return {
    schema_version: '1.0.0',
    stage: 'verification',
    meal_id: composition.meal_id,
    status: 'partial',
    verified_items: verifiedItems,
    sources,
    errors: [
      {
        code: 'SOURCE_UNAVAILABLE',
        message: `Google Search grounding 額度/容量不足；${sources.length > 0 ? '已改用 AI 推估，數值未經來源查證。' : 'AI 推估也沒有可用數值，未知項目保留空值。'}`,
        recoverable: true,
        suggested_action: '稍後重新執行來源查證，或檢視報告中的 AI 估算與未知項目。',
      },
    ],
    metadata: {
      model,
      retrieved_at: generatedAt,
      grounding_source_count: 0,
    },
  };
}

function buildUnresolvedVerification(
  composition: ConfirmedComposition,
  generatedAt: string,
  reason: string,
): NutritionVerificationResult {
  return {
    schema_version: '1.0.0',
    stage: 'verification',
    meal_id: composition.meal_id,
    status: 'partial',
    verified_items: composition.items.map((item) => ({
      item_id: item.item_id,
      name: item.name,
      preparation: item.preparation ?? null,
      consumed_weight_g:
        item.confirmed_weight_g ?? item.estimated_weight_g ?? null,
      reference_amount: null,
      reference_unit: null,
      evidence_status: 'unresolved',
      match_confidence: 0,
      match_notes: '來源查證與 AI 推估皆不可用。',
      nutrients: {},
      source_ids: [],
      unresolved_fields: [...NUTRIENT_KEYS, '來源查證額度不足', 'AI 估算額度不足'],
    })),
    sources: [],
    errors: [
      {
        code: 'SOURCE_UNAVAILABLE',
        message: `來源查證與 AI 推估都無法使用；所有未知值已保留為空。${reason}`,
        recoverable: true,
        suggested_action: '稍後重試，或使用可用的營養資料來源。',
      },
    ],
    metadata: {
      model: 'none',
      retrieved_at: generatedAt,
      grounding_source_count: 0,
    },
  };
}

export async function verifyNutritionSources(
  composition: ConfirmedComposition,
): Promise<NutritionVerificationResult> {
  if (composition.status !== 'user_confirmed') {
    throw new Error('COMPOSITION_NOT_CONFIRMED：請先確認食物組成。');
  }

  if (!composition.items.length) {
    throw new Error('沒有可查證的食物項目。');
  }

  const itemsWithoutWeight = composition.items.filter(
    (item) => item.confirmed_weight_g == null && item.estimated_weight_g == null,
  );
  if (itemsWithoutWeight.length > 0) {
    return {
      schema_version: '1.0.0',
      stage: 'verification',
      meal_id: composition.meal_id,
      status: 'needs_user_input',
      verified_items: composition.items.map((item) => ({
        item_id: item.item_id,
        name: item.name,
        preparation: item.preparation ?? null,
        consumed_weight_g: item.confirmed_weight_g ?? item.estimated_weight_g ?? null,
        reference_amount: null,
        reference_unit: null,
        evidence_status: 'unresolved',
        match_confidence: 0,
        match_notes:
          item.confirmed_weight_g == null && item.estimated_weight_g == null
            ? '份量尚未確認；依查證 Skill 暫停營養來源查證。'
            : '查證因同餐另一項份量未確認而暫停。',
        nutrients: {},
        source_ids: [],
        unresolved_fields:
          item.confirmed_weight_g == null && item.estimated_weight_g == null
            ? ['consumed_weight_g']
            : ['verification_not_run_due_to_unresolved_portion'],
      })),
      sources: [],
      errors: itemsWithoutWeight.map((item) => ({
        code: 'PORTION_UNCERTAIN',
        message: `${item.name} 沒有可用重量估計，請輸入確認重量後再查證。`,
        recoverable: true,
        item_id: item.item_id,
        suggested_action: '輸入合理重量；不可填入未測量的精確值。',
      })),
      metadata: {
        model: 'not_called',
        retrieved_at: null,
        grounding_source_count: 0,
      },
    };
  }

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    throw new Error('請先到設定頁輸入並儲存 Gemini API Key。');
  }

  const retrievedAt = new Date().toISOString();
  let searchResult: Awaited<ReturnType<typeof requestGroundedJson>>;
  try {
    searchResult = await requestGroundedJson(
      apiKey,
      buildVerificationPrompt(composition),
    );
  } catch (error) {
    if (!isGroundingQuotaFailure(error)) {
      throw error;
    }

    const groundingFailure = error instanceof Error ? error.message : String(error);
    try {
      const estimateResult = await requestEstimatedJson(
        apiKey,
        buildEstimatePrompt(composition),
      );
      return buildEstimatedVerification(
        composition,
        estimateResult.draft,
        estimateResult.model,
        new Date().toISOString(),
        groundingFailure,
      );
    } catch (estimateError) {
      const estimateFailure =
        estimateError instanceof Error ? estimateError.message : String(estimateError);
      return buildUnresolvedVerification(
        composition,
        new Date().toISOString(),
        `${groundingFailure}；${estimateFailure}`,
      );
    }
  }

  const { draft, chunks, model } = searchResult;

  if (!Array.isArray(draft?.items)) {
    throw new Error('營養來源查證缺少 items 清單，無法建立可追溯結果。');
  }

  const groundedChunks = chunks
    .map((chunk) => ({
      url: chunk.web?.uri,
      title: chunk.web?.title,
    }))
    .filter(
      (chunk): chunk is { url: string; title: string | undefined } =>
        typeof chunk.url === 'string' && chunk.url.startsWith('https://'),
    );
  const groundedUrls = new Set(groundedChunks.map((chunk) => chunk.url));
  const rawItems = draft.items as RawVerifiedItem[];
  const itemById = new Map(
    rawItems
      .filter((item) => typeof item.item_id === 'string')
      .map((item) => [item.item_id as string, item]),
  );

  const sourceReferencesByItem = new Map<string, RawSourceReference[]>();
  for (const item of rawItems) {
    if (typeof item.item_id !== 'string' || !Array.isArray(item.source_references)) {
      continue;
    }

    const references = item.source_references.filter(
      (reference: any): reference is RawSourceReference =>
        reference &&
        isGroundedUrl(reference.url, groundedUrls) &&
        typeof reference.source_type === 'string' &&
        allowedSourceTypes.has(reference.source_type) &&
        typeof reference.evidence_status === 'string' &&
        allowedEvidenceStatuses.has(reference.evidence_status) &&
        typeof reference.match_basis === 'string' &&
        reference.match_basis.trim().length > 0,
    );
    sourceReferencesByItem.set(item.item_id, references);
  }

  const sourceIdByUrl = new Map<string, string>();
  const sources: NutritionSource[] = [];
  for (const reference of Array.from(sourceReferencesByItem.values()).flat()) {
    if (sourceIdByUrl.has(reference.url)) {
      continue;
    }

    const chunk = groundedChunks.find((candidate) => candidate.url === reference.url);
    const sourceId = `nutrition_source_${sources.length + 1}`;
    sourceIdByUrl.set(reference.url, sourceId);
    sources.push({
      source_id: sourceId,
      source_type: sourceTypeForHost(reference.url, reference.source_type),
      source_name: chunk?.title || new URL(reference.url).hostname,
      source_url: reference.url,
      retrieved_at: retrievedAt,
      published_or_updated_at: null,
      evidence_status: evidenceStatusForReference(reference),
      match_basis: reference.match_basis || 'Google Search grounding 引用來源；請檢視原始頁面確認匹配。',
      reference_amount:
        isFiniteNonNegative(reference.reference_amount) &&
        reference.reference_amount > 0
          ? reference.reference_amount
          : null,
      reference_unit: asTrimmedString(reference.reference_unit),
      notes: reference.notes || '',
    });
  }

  const verifiedItems: VerifiedNutritionItem[] = composition.items.map((item) => {
    const raw = itemById.get(item.item_id);
    const validReferences = sourceReferencesByItem.get(item.item_id) ?? [];
    const sourceIds = validReferences
      .map((reference) => sourceIdByUrl.get(reference.url))
      .filter((sourceId): sourceId is string => Boolean(sourceId));
    const hasGroundedEvidence = sourceIds.length > 0;
    const claimedStatus = raw?.evidence_status;
    const evidenceStatus: VerificationEvidenceStatus =
      !hasGroundedEvidence ||
      !['official_verified', 'database_matched', 'estimated', 'unresolved'].includes(
        String(claimedStatus),
      ) ||
      claimedStatus === 'estimated' ||
      !validReferences.some(
        (reference) => evidenceStatusForReference(reference) === claimedStatus,
      )
        ? 'unresolved'
        : claimedStatus as VerificationEvidenceStatus;

    const referenceAmount = isFiniteNonNegative(raw?.reference_amount)
      ? raw.reference_amount
      : null;
    const referenceUnit = asTrimmedString(raw?.reference_unit);
    const rawNutrients =
      raw?.nutrients && typeof raw.nutrients === 'object'
        ? raw.nutrients as Record<string, RawNutrient>
        : {};
    const nutrients: NutritionSet = {};

    if (evidenceStatus !== 'unresolved') {
      for (const key of NUTRIENT_KEYS) {
        const normalized = normalizeNutrient(
          rawNutrients[key],
          key,
          referenceAmount,
          referenceUnit,
        );
        if (normalized) {
          nutrients[key] = normalized;
        }
      }
    }

    const unresolvedFields = Array.isArray(raw?.unresolved_fields)
      ? raw.unresolved_fields.filter((field): field is string => typeof field === 'string')
      : [];
    if (!hasGroundedEvidence) {
      unresolvedFields.push('沒有可核對的 Google Search grounding 來源');
    }
    if (!Object.keys(nutrients).length) {
      unresolvedFields.push('來源未提供可驗證的營養數值');
    }

    return {
      item_id: item.item_id,
      name: item.name,
      preparation: item.preparation ?? null,
      consumed_weight_g:
        item.confirmed_weight_g ?? item.estimated_weight_g ?? null,
      reference_amount: referenceAmount,
      reference_unit: referenceUnit,
      evidence_status: evidenceStatus,
      match_confidence:
        typeof raw?.match_confidence === 'number' &&
        Number.isFinite(raw.match_confidence)
          ? Math.max(0, Math.min(1, raw.match_confidence))
          : 0,
      match_notes:
        asTrimmedString(raw?.match_notes) ?? '來源不足，無法確認匹配。',
      nutrients,
      source_ids: sourceIds,
      unresolved_fields: Array.from(new Set(unresolvedFields)),
    };
  });

  const unresolvedCount = verifiedItems.filter(
    (item) => item.evidence_status === 'unresolved',
  ).length;
  const officialSourceNotFoundItems = composition.items.filter((item) => {
    const references = sourceReferencesByItem.get(item.item_id) ?? [];
    const hasOfficialReference = references.some(
      (reference) =>
        ['official_brand', 'official_restaurant', 'official_label'].includes(
          reference.source_type,
        ) && evidenceStatusForReference(reference) === 'official_verified',
    );
    return itemById.get(item.item_id)?.official_source_not_found === true || !hasOfficialReference;
  });

  return {
    schema_version: '1.0.0',
    stage: 'verification',
    meal_id: composition.meal_id,
    status: unresolvedCount === 0 ? 'complete' : 'partial',
    verified_items: verifiedItems,
    sources,
    errors: [
      ...officialSourceNotFoundItems.map((item) => ({
          code: 'OFFICIAL_SOURCE_NOT_FOUND',
          message: `未找到 ${item.name} 的匹配官方來源；已依 Skill 嘗試資料庫 fallback。`,
          recoverable: true,
          item_id: item.item_id,
          suggested_action: '檢視下方資料庫來源與匹配依據。',
      })),
      ...(groundedUrls.size === 0
        ? [
            {
              code: 'WEB_EVIDENCE_INSUFFICIENT',
              message: '搜尋結果沒有提供可引用的來源網址；營養值已保留為未知。',
              recoverable: true,
              suggested_action: '檢查網路與 Gemini 搜尋 grounding 可用性後重試。',
            },
          ]
        : []),
    ],
    metadata: {
      model,
      retrieved_at: retrievedAt,
      grounding_source_count: groundedUrls.size,
    },
  };
}