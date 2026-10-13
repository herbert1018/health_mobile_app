import AsyncStorage from "@react-native-async-storage/async-storage";

export const DAILY_TARGETS_STORAGE_KEY =
  "@NutriTrack/daily_targets_v1";

export type DailyTargets = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export const DEFAULT_DAILY_TARGETS: DailyTargets = {
  calories: 2000,
  protein: 60,
  carbs: 250,
  fat: 65,
};

export async function getDailyTargets(): Promise<DailyTargets> {
  try {
    const stored = await AsyncStorage.getItem(
      DAILY_TARGETS_STORAGE_KEY
    );

    if (!stored) {
      return DEFAULT_DAILY_TARGETS;
    }

    const parsed: unknown = JSON.parse(stored);

    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_DAILY_TARGETS;
    }

    const data = parsed as Record<string, unknown>;

    const result: DailyTargets = {
      calories:
        typeof data.calories === "number" &&
        Number.isFinite(data.calories) &&
        data.calories > 0
          ? data.calories
          : DEFAULT_DAILY_TARGETS.calories,

      protein:
        typeof data.protein === "number" &&
        Number.isFinite(data.protein) &&
        data.protein > 0
          ? data.protein
          : DEFAULT_DAILY_TARGETS.protein,

      carbs:
        typeof data.carbs === "number" &&
        Number.isFinite(data.carbs) &&
        data.carbs > 0
          ? data.carbs
          : DEFAULT_DAILY_TARGETS.carbs,

      fat:
        typeof data.fat === "number" &&
        Number.isFinite(data.fat) &&
        data.fat > 0
          ? data.fat
          : DEFAULT_DAILY_TARGETS.fat,
    };

    return result;
  } catch (error) {
    console.error("讀取每日營養目標失敗：", error);
    throw error;
  }
}

export async function saveDailyTargets(
  targets: DailyTargets
): Promise<void> {
  const values = [
    targets.calories,
    targets.protein,
    targets.carbs,
    targets.fat,
  ];

  if (
    values.some(
      (value) =>
        !Number.isFinite(value) ||
        value <= 0
    )
  ) {
    throw new Error("每日營養目標必須是大於 0 的有限數值。");
  }

  await AsyncStorage.setItem(
    DAILY_TARGETS_STORAGE_KEY,
    JSON.stringify(targets)
  );
}