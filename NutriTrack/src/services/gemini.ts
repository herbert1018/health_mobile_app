
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_KEY_STORAGE = 'nutritrack_gemini_api_key';
export const GEMINI_CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
] as const;
const PROMPT_VERSION = '1.0.0';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TRANSIENT_RETRIES = 2;

type GeminiJsonResponse = {
  value: any;
  model: string;
};

async function requestGeminiJson(
  apiKey: string,
  base64Image: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
  prompt: string,
  emptyResponseMessage: string,
): Promise<GeminiJsonResponse> {
  const failures: string[] = [];

  for (let modelIndex = 0; modelIndex < GEMINI_CANDIDATE_MODELS.length; modelIndex += 1) {
    const model = GEMINI_CANDIDATE_MODELS[modelIndex];
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${model}:generateContent`;

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            thinkingConfig: { thinkingBudget: 512 },
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
        const isTransient =
          [408, 429, 500, 502, 503, 504].includes(response.status) ||
          ['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'INTERNAL'].includes(apiStatus);
        const isOverloaded =
          response.status === 503 ||
          apiStatus === 'UNAVAILABLE' ||
          /high demand|temporarily unavailable/i.test(message);
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
          if (modelIndex < GEMINI_CANDIDATE_MODELS.length - 1) {
            break;
          }

          throw new Error(
            `Gemini API 呼叫失敗：候選模型額度不足或不可用，已依序嘗試：${failures.join('；')}`,
          );
        }

        if (isTransient && attempt < MAX_TRANSIENT_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * 2 ** attempt),
          );
          continue;
        }

        if (isOverloaded && modelIndex < GEMINI_CANDIDATE_MODELS.length - 1) {
          failures.push(`${model} (HTTP ${response.status}): ${message}`);
          break;
        }

        if (isOverloaded) {
          failures.push(`${model} (HTTP ${response.status}): ${message}`);
          throw new Error(
            `Gemini API 呼叫失敗：所有候選模型目前都無法服務：${failures.join('；')}`,
          );
        }

        if (isTransient) {
          throw new Error(
            `Gemini API 呼叫失敗（HTTP ${response.status}，模型 ${model} 已重試 ${MAX_TRANSIENT_RETRIES} 次）：${message}。請稍後再試。`,
          );
        }

        throw new Error(`Gemini API 呼叫失敗：${message}`);
      }

      const text = result?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? '')
        .join('');
      if (!text) {
        throw new Error(emptyResponseMessage);
      }

      return { value: JSON.parse(text), model };
    }
  }

  throw new Error(
    `Gemini API 呼叫失敗：所有候選模型都無法使用：${failures.join('；') || '未收到可用模型回應'}。請檢查專案總額度、模型存取權或稍後再試。`,
  );
}

/** 跨平台 API Key 儲存管理 */
export async function getStoredApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage.getItem(API_KEY_STORAGE);
  }

  return SecureStore.getItemAsync(API_KEY_STORAGE);
}

export async function setStoredApiKey(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(API_KEY_STORAGE, value);
    return;
  }

  await SecureStore.setItemAsync(API_KEY_STORAGE, value);
}

export async function deleteStoredApiKey(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.removeItem(API_KEY_STORAGE);
    return;
  }

  await SecureStore.deleteItemAsync(API_KEY_STORAGE);
}

export type CompositionItem = {
  item_id: string;
  name: string;
  candidate_names?: string[];
  preparation?: string | null;
  ingredients?: string[];
  estimated_weight_g?: number | null;
  confirmed_weight_g?: number | null;
  portion_description?: string | null;
  identification_confidence: number;
  portion_confidence?: number | null;
  uncertainty: 'low' | 'medium' | 'high';
  field_origins?: Record<
    string,
    | 'ai_estimated'
    | 'user_provided'
    | 'user_confirmed'
    | 'source_verified'
    | 'database'
  >;
  notes?: string;
};

export type CompositionResult = {
  schema_version: '1.0.0';
  stage: 'composition';
  meal_id: string;
  status:
    | 'needs_user_input'
    | 'needs_user_confirmation';
  locale: string;
  created_at: string;
  user_text?: string;
  items: CompositionItem[];
  needs_confirmation: string[];
  source_candidates: {
    candidate_type:
      | 'brand'
      | 'restaurant'
      | 'packaged_product'
      | 'menu_item'
      | 'other';
    candidate_name: string;
    evidence?: string;
    source_url?: string | null;
    verification_status:
      | 'candidate'
      | 'verified'
      | 'rejected'
      | 'unresolved';
  }[];
  errors: {
    code: string;
    message: string;
    recoverable: boolean;
    item_id?: string;
    suggested_action?: string;
  }[];
  metadata: {
    model: string;
    prompt_version: string;
    image_count: number;
  };
};

export type DetectedFoodObject = {
  object_id: string;
  name: string;
  quantity: number;
  region_description: string;
  confidence: number | null;
};

export type ObjectDetectionResult = {
  meal_id: string;
  status: 'needs_user_input' | 'needs_user_confirmation';
  model?: string;
  objects: DetectedFoodObject[];
  errors: {
    code: string;
    message: string;
    recoverable: boolean;
    suggested_action?: string;
  }[];
};

type AnalyzeOptions = {
  mealId: string;
  base64Image: string;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  userText?: string;
  existingComposition?: CompositionResult;
  editRequest?: string;
  confirmedObjects?: DetectedFoodObject[];
};

type DetectObjectsOptions = {
  mealId: string;
  base64Image: string;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
};

function makeError(
  code: string,
  message: string,
  suggestedAction: string,
) {
  return {
    code,
    message,
    recoverable: true,
    suggested_action: suggestedAction,
  };
}

function isFiniteNonNegative(
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateDraft(value: any): boolean {
  if (
    !value ||
    !['needs_user_input', 'needs_user_confirmation'].includes(value.status) ||
    !Array.isArray(value.items)
  ) {
    return false;
  }

  for (const item of value.items) {
    if (
      !item ||
      typeof item.item_id !== 'string' ||
      !item.item_id.trim() ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      !isFiniteNonNegative(item.identification_confidence) ||
      item.identification_confidence > 1 ||
      !['low', 'medium', 'high'].includes(item.uncertainty)
    ) {
      return false;
    }

    if (
      (item.ingredients !== undefined && !isStringArray(item.ingredients)) ||
      (item.candidate_names !== undefined && !isStringArray(item.candidate_names))
    ) {
      return false;
    }

    if (
      item.estimated_weight_g !== undefined &&
      item.estimated_weight_g !== null &&
      !isFiniteNonNegative(item.estimated_weight_g)
    ) {
      return false;
    }

    if (
      item.portion_confidence !== undefined &&
      item.portion_confidence !== null &&
      (
        !isFiniteNonNegative(item.portion_confidence) ||
        item.portion_confidence > 1
      )
    ) {
      return false;
    }
  }

  return true;
}

function validateObjectDraft(value: any): boolean {
  return (
    value &&
    ['needs_user_input', 'needs_user_confirmation'].includes(value.status) &&
    Array.isArray(value.objects) &&
    Array.isArray(value.errors) &&
    value.objects.every(
      (item: any) =>
        item &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        typeof item.region_description === 'string' &&
        item.region_description.trim().length > 0 &&
        isFiniteNonNegative(item.confidence) &&
        item.confidence <= 1,
    )
  );
}

function buildObjectDetectionPrompt(mealId: string, retry = false) {
  return `
你是 NutriTrack 的餐點影像物件辨識模組。現在只辨識照片中可見的食物物件與位置，不分析食材組成、重量或營養。

餐點 ID：${mealId}
語言：繁體中文（zh-TW）
${retry ? '上一次輸出不符合格式。請修正並只輸出符合格式的有效 JSON。' : ''}

規則：
1. 若照片不可讀、沒有可見餐點或餐點嚴重遮蔽，回傳 needs_user_input、空 objects，並附上簡潔錯誤；不可猜測。
2. 將畫面中可區分的食物物件/區域分開列出；只把外觀相同且成群的物件合併為一項，並以 quantity 表示可見數量。
3. region_description 以簡短相對位置描述照片中的區域，例如「盤子左側」或「碗中央」；不要捏造看不清楚的細節。
4. name 只描述可見物件，不推測隱藏食材、品牌、店家或營養資料。
5. confidence 必須介於 0 到 1，代表辨識信心指標，並非校準機率。
6. 正常辨識回傳 needs_user_confirmation。此階段不提供重量、食物組成或營養資料。

只輸出 JSON：
{
  "status": "needs_user_confirmation",
  "objects": [
    {
      "object_id": "${mealId}_object_1",
      "name": "可見物件名稱",
      "quantity": 1,
      "region_description": "盤子左側",
      "confidence": 0.8
    }
  ],
  "errors": []
}
`;
}

function buildPrompt(options: AnalyzeOptions, retry = false) {
  const existing = options.existingComposition
    ? JSON.stringify(options.existingComposition)
    : 'null';
  const confirmedObjects = options.confirmedObjects
    ? JSON.stringify(options.confirmedObjects)
    : '[]';

  return `
你是 NutriTrack 的食物照片辨識模組。

餐點 ID：${options.mealId}
語言：繁體中文（zh-TW）
${retry ? '上一次輸出不符合格式，請只輸出有效 JSON。' : ''}

規則：
1. 若圖片不清楚或沒有食物，status 設為 needs_user_input，並在 errors 附上一則簡短 message，items 為空陣列。
2. 直接辨識照片中可區分的食物項目，逐項列出。
3. 複合料理只把照片可見的食材放入 ingredients；不確定的可能食材放入 candidate_names。看不出內部食材時，ingredients 為空陣列。
4. 依食物種類、數量與尺寸，為每項食物給出一個整數的 estimated_weight_g（公克），不需逐步計算。證據不足時才用 null。這是估計值，portion_description 用一句短句說明份量。
5. identification_confidence 為 0 到 1 的信心指標；uncertainty 只能是 low、medium 或 high。
6. 不計算營養數值，不捏造品牌、餐廳或網址。
7. 正常辨識時 status 為 needs_user_confirmation。

只輸出 JSON，不要 Markdown 或其他說明：
{
  "status": "needs_user_confirmation",
  "items": [
    {
      "item_id": "${options.mealId}_item_1",
      "name": "白飯",
      "candidate_names": [],
      "ingredients": [],
      "estimated_weight_g": 180,
      "portion_description": "約一碗",
      "identification_confidence": 0.95,
      "uncertainty": "medium"
    }
  ],
  "errors": []
}
`;
}

export async function detectFoodObjects(
  options: DetectObjectsOptions,
): Promise<ObjectDetectionResult> {
  const {
    mealId,
    base64Image,
    mimeType = 'image/jpeg',
  } = options;

  if (!mealId.trim()) {
    throw new Error('缺少餐點 ID，無法建立辨識紀錄。');
  }

  if (!base64Image) {
    throw new Error('沒有取得照片資料，請重新選取照片。');
  }

  const estimatedBytes = Math.floor((base64Image.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error(
      'IMAGE_TOO_LARGE：照片超過目前設定的 15 MB 上限，請先縮小或壓縮照片。',
    );
  }

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    throw new Error('請先到設定頁輸入並儲存 Gemini API Key。');
  }

  const callModel = (retry: boolean) =>
    requestGeminiJson(
      apiKey,
      base64Image,
      mimeType,
      buildObjectDetectionPrompt(mealId, retry),
      'AI 沒有回傳物件辨識結果。',
    );

  let draft: any;
  let modelUsed: string = GEMINI_CANDIDATE_MODELS[0];
  try {
    let response = await callModel(false);
    draft = response.value;
    modelUsed = response.model;
    if (!validateObjectDraft(draft)) {
      response = await callModel(true);
      draft = response.value;
      modelUsed = response.model;
    }
    if (!validateObjectDraft(draft)) {
      throw new Error('模型輸出不符合物件辨識格式。');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知錯誤';
    if (message.includes('Gemini API 呼叫失敗') || message.includes('API Key')) {
      throw error;
    }

    return {
      meal_id: mealId,
      status: 'needs_user_input',
      model: modelUsed,
      objects: [],
      errors: [
        {
          code: 'MODEL_OUTPUT_INVALID',
          message: '無法取得有效的影像物件辨識結果。',
          recoverable: true,
          suggested_action: '請重新辨識；若持續失敗，請更換照片。',
        },
      ],
    };
  }

  return {
    meal_id: mealId,
    status:
      draft.status === 'needs_user_input'
        ? 'needs_user_input'
        : 'needs_user_confirmation',
    model: modelUsed,
    objects: draft.objects.map(
      (item: DetectedFoodObject, index: number) => ({
        ...item,
        object_id: item.object_id || `${mealId}_object_${index + 1}`,
      }),
    ),
    errors: draft.errors,
  };
}

export async function analyzeFoodImage(
  options: AnalyzeOptions,
): Promise<CompositionResult> {
  const {
    mealId,
    base64Image,
    mimeType = 'image/jpeg',
    userText,
    existingComposition,
    editRequest,
  } = options;
  
  if (!mealId.trim()) {
    throw new Error('缺少餐點 ID，無法建立辨識紀錄。');
  }

  if (!base64Image) {
    throw new Error('沒有取得照片資料，請重新選取照片。');
  }

  const estimatedBytes = Math.floor(
    (base64Image.length * 3) / 4,
  );

  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error(
      'IMAGE_TOO_LARGE：照片超過目前設定的 15 MB 上限，請先縮小或壓縮照片。',
    );
  }

  const apiKey = await getStoredApiKey();

  if (!apiKey) {
    throw new Error(
      '請先到設定頁輸入並儲存 Gemini API Key。',
    );
  }

  const callModel = (retry: boolean) =>
    requestGeminiJson(
      apiKey,
      base64Image,
      mimeType,
      buildPrompt(
        {
          ...options,
          userText,
          existingComposition,
          editRequest,
        },
        retry,
      ),
      'AI 沒有回傳辨識結果。',
    );

  let draft: any;
  let modelUsed: string = GEMINI_CANDIDATE_MODELS[0];

  try {
    let response = await callModel(false);
    draft = response.value;
    modelUsed = response.model;

    if (!validateDraft(draft)) {
      response = await callModel(true);
      draft = response.value;
      modelUsed = response.model;
    }

    if (!validateDraft(draft)) {
      throw new Error('模型輸出不符合預期格式。');
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '未知錯誤';

    if (
      message.includes('Gemini API 呼叫失敗') ||
      message.includes('API Key')
    ) {
      throw error;
    }

    return {
      schema_version: '1.0.0',
      stage: 'composition',
      meal_id: mealId,
      status: 'needs_user_input',
      locale: 'zh-TW',
      created_at: new Date().toISOString(),
      ...(userText ? { user_text: userText } : {}),
      items: [],
      needs_confirmation: draft.needs_confirmation ?? [],
      source_candidates: draft.source_candidates ?? [],
      errors: [
        makeError(
          'MODEL_OUTPUT_INVALID',
          '無法取得有效的食物辨識結果。',
          '請重新辨識；若持續失敗，請更換照片。',
        ),
      ],
      metadata: {
        model: modelUsed,
        prompt_version: PROMPT_VERSION,
        image_count: 1,
      },
    };
  }

  const items: CompositionItem[] = draft.items.map(
    (item: CompositionItem, index: number) => ({
      ...item,
      item_id:
        item.item_id ||
        `${mealId}_item_${index + 1}`,
    }),
  );

  // 正常辨識結果一律停在使用者確認關卡。
  // 不在這裡查營養資料，也不計算營養總量。
  return {
    schema_version: '1.0.0',
    stage: 'composition',
    meal_id: mealId,
    status:
      draft.status === 'needs_user_input'
        ? 'needs_user_input'
        : 'needs_user_confirmation',
    locale: 'zh-TW',
    created_at: new Date().toISOString(),
    ...(userText ? { user_text: userText } : {}),
    items,
    needs_confirmation: draft.needs_confirmation,
    source_candidates: draft.source_candidates,
    errors: draft.errors,
    metadata: {
      model: modelUsed,
      prompt_version: PROMPT_VERSION,
      image_count: 1,
    },
  };
}
