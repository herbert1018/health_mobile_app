import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Pressable,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { router } from 'expo-router';
import * as FileSystem from "expo-file-system/legacy";
import {
  analyzeFoodImage,
  analyzeFoodText,
  type DetectedFoodObject,
  type CompositionItem,
} from "../services/gemini";
import {
  verifyNutritionSources,
  type NutritionVerificationResult,
  type NutritionValue,
  type VerificationEvidenceStatus,
} from "../services/nutrition-verification";
import {
  generateNutritionReport,
  type NutritionReport,
} from "../services/nutrition-report";
import { useFocusEffect } from "expo-router";
import {
  DEFAULT_DAILY_TARGETS,
  getDailyTargets,
  type DailyTargets,
} from "../services/nutrition-targets";

type MealType = "早餐" | "午餐" | "晚餐" | "點心";
type EntryStep = "closed" | "choose" | "details";
type InputMode = "photo" | "text" | "ai_text";

type MealRecord = {
  id: string;
  date: string;
  meal: MealType;
  name: string;
  serving: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  nutritionStatus?: "pending_verification" | "complete" | "partial";
  nutritionEdited?: boolean;
  confirmedObjects?: DetectedFoodObject[];
  compositionItems?: SavedCompositionItem[];
  nutritionVerification?: NutritionVerificationResult;
  nutritionReport?: NutritionReport;
};

type SavedCompositionItem = {
  item_id: string;
  name: string;
  ingredients: string[];
  candidate_names: string[];
  estimated_weight_g: number | null;
  confirmed_weight_g: number | null;
  portion_description: string | null;
  identification_confidence: number;
  uncertainty: "low" | "medium" | "high";
  weight_status: "user_confirmed" | "ai_estimated" | "unknown";
  evidence_status?: VerificationEvidenceStatus;
  source_ids?: string[];
  nutrients_edited?: boolean;
  nutrients: {
    energy_kcal: number | null;
    protein_g: number | null;
    carbohydrate_g: number | null;
    fat_g: number | null;
  };
};

type ItemNutrientKey = "energy_kcal" | "protein_g" | "carbohydrate_g" | "fat_g";
type ItemNutrientDraft = Record<ItemNutrientKey, string>;

const ITEM_NUTRIENT_FIELDS: { key: ItemNutrientKey; label: string }[] = [
  { key: "energy_kcal", label: "熱量（kcal）" },
  { key: "protein_g", label: "蛋白質（g）" },
  { key: "carbohydrate_g", label: "碳水化合物（g）" },
  { key: "fat_g", label: "脂肪（g）" },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

type DetectedFood = {
  item_id: string;
  name: string;
  ingredients?: string[];
  candidate_names?: string[];
  portion_description?: string | null;
  estimated_weight_g?: number | null;
  confirmed_weight_g?: number | null;
  identification_confidence: number;
  uncertainty: "low" | "medium" | "high";
};

type CompositionInputDraft = {
  name: string;
  ingredients: string;
  candidate_names: string;
  confirmed_weight_g: string;
};

type RecordEditDraft = {
  id: string;
  date: string;
  meal: MealType;
  name: string;
  serving: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  nutritionStatus?: MealRecord["nutritionStatus"];
  nutritionEdited?: boolean;
  confirmedObjects?: DetectedFoodObject[];
  compositionItems?: SavedCompositionItem[];
  nutritionVerification?: NutritionVerificationResult;
  nutritionReport?: NutritionReport;
  itemNutrients: Record<string, ItemNutrientDraft>;
};

const STORAGE_KEY = "@NutriTrack/meal_records_v1";
const AUTO_CLEAR_KEY = "@NutriTrack/auto_clear_on_new_day_v1";
const LAST_CHECKED_DATE_KEY = "@NutriTrack/last_checked_date_v1";

const DAILY_TARGETS = {
  calories: 2000,
  protein: 60,
  carbs: 250,
  fat: 65,
};

const MEALS: MealType[] = ["早餐", "午餐", "晚餐", "點心"];
const REPORT_NUTRIENTS = [
  { key: "energy", label: "熱量", target: DAILY_TARGETS.calories, unit: "kcal", color: "#D9674F" },
  { key: "protein", label: "蛋白質", target: DAILY_TARGETS.protein, unit: "g", color: "#3478C7" },
  { key: "carbohydrate", label: "碳水化合物", target: DAILY_TARGETS.carbs, unit: "g", color: "#D99035" },
  { key: "fat", label: "脂肪", target: DAILY_TARGETS.fat, unit: "g", color: "#8C69C6" },
] as const;
const SECONDARY_REPORT_NUTRIENTS = [
  { key: "total_sugars", label: "糖" },
  { key: "saturated_fat", label: "飽和脂肪" },
  { key: "fiber", label: "纖維" },
  { key: "sodium", label: "鈉" },
  { key: "cholesterol", label: "膽固醇" },
] as const;

const getToday = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const sum = (
  records: MealRecord[],
  field: "calories" | "protein" | "carbs" | "fat"
) =>
  records.reduce(
    (total, item) =>
      total + (typeof item[field] === "number" ? item[field] : 0),
    0
  );

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const formatNutritionValue = (value?: NutritionValue) =>
  value?.value == null
    ? "未知"
    : `${formatNumber(value.value)} ${value.unit}`;

const evidenceStatusLabel = (status: VerificationEvidenceStatus) => {
  switch (status) {
    case "official_verified":
      return "官方查證";
    case "database_matched":
      return "資料庫匹配";
    case "estimated":
      return "AI估算（無外部查證）";
    default:
      return "未解決（營養值未知）";
  }
};

const parseIngredientList = (value: string) =>
  value
    .split(/[\n,，、]/)
    .map((ingredient) => ingredient.trim())
    .filter(Boolean);

const createCompositionDrafts = (foods: DetectedFood[]) =>
  Object.fromEntries(
    foods.map((food) => [
      food.item_id,
      {
        name: food.name,
        ingredients: food.ingredients?.join("\n") ?? "",
        candidate_names: food.candidate_names?.join("、") ?? "",
        confirmed_weight_g:
          food.confirmed_weight_g == null
            ? ""
            : String(food.confirmed_weight_g),
      } satisfies CompositionInputDraft,
    ])
  ) as Record<string, CompositionInputDraft>;

const readImageAsBase64 = async (imageUri: string) => {
  if (Platform.OS === "web") {
    const response = await fetch(imageUri);

    if (!response.ok) {
      throw new Error(`圖片讀取失敗：HTTP ${response.status}`);
    }

    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("圖片 Base64 轉換失敗"));
          return;
        }

        const result = reader.result.split(",");
        if (result.length < 2) {
          reject(new Error("無法取得圖片 Base64 資料"));
          return;
        }

        resolve(result[1]);
      };

      reader.onerror = () => {
        reject(reader.error ?? new Error("圖片讀取失敗"));
      };

      reader.readAsDataURL(blob);
    });
  }

  return FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
};

// ───────────── 月曆：每日達成狀況 ─────────────

type DayStatus = "achieved" | "logged" | "none";

type DaySummary = {
  date: string;
  records: MealRecord[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  hasUnknown: boolean;
  status: DayStatus;
};

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const formatDateKey = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/**
 * 每日「達成」的判斷集中在這裡；想改規則只要改這個函式。
 * 目前沿用首頁的規則：當日有紀錄，且熱量已達每日目標 → 達成。
 * 有紀錄但熱量未達標 → 已紀錄；沒有紀錄 → 無。
 */
const summarizeDay = (
  allRecords: MealRecord[],
  date: string,
  targets: DailyTargets
): DaySummary => {
  const dayRecords = allRecords.filter((record) => record.date === date);
  const calories = sum(dayRecords, "calories");
  const status: DayStatus =
    dayRecords.length === 0
      ? "none"
      : calories >= targets.calories
        ? "achieved"
        : "logged";

  return {
    date,
    records: dayRecords,
    calories,
    protein: sum(dayRecords, "protein"),
    carbs: sum(dayRecords, "carbs"),
    fat: sum(dayRecords, "fat"),
    hasUnknown: dayRecords.some(
      (record) =>
        record.calories === null ||
        record.protein === null ||
        record.carbs === null ||
        record.fat === null
    ),
    status,
  };
};

const summarizeMonth = (
  allRecords: MealRecord[],
  year: number,
  month0: number,
  targets: DailyTargets
) => {
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const days: DaySummary[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(summarizeDay(allRecords, formatDateKey(new Date(year, month0, day)), targets));
  }
  return {
    days,
    achievedCount: days.filter((day) => day.status === "achieved").length,
    loggedCount: days.filter((day) => day.status !== "none").length,
  };
};

// 連續達成天數：今天還沒達成時，從昨天開始算，避免一早就歸零。
const computeStreak = (
  allRecords: MealRecord[],
  targets: DailyTargets,
  todayKey: string
) => {
  const cursor = new Date();
  if (summarizeDay(allRecords, todayKey, targets).status !== "achieved") {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < 366; i += 1) {
    if (summarizeDay(allRecords, formatDateKey(cursor), targets).status !== "achieved") {
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

export default function HomeScreen() {
  const compositionRevision = useRef(0);
  const verificationRequestId = useRef(0);
  const [records, setRecords] = useState<MealRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [recordEditDraft, setRecordEditDraft] = useState<RecordEditDraft | null>(null);
  const [entryStep, setEntryStep] = useState<EntryStep>("closed");
  const [inputMode, setInputMode] = useState<InputMode>("text");

  const [selectedMeal, setSelectedMeal] = useState<MealType>("午餐");
  const [foodName, setFoodName] = useState("");
  const [serving, setServing] = useState("1 份");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMealId, setAnalysisMealId] = useState<string | null>(null);
  const [aiAttempted, setAiAttempted] = useState(false);
  const [compositionConfirmed, setCompositionConfirmed] = useState(false);
  const [nutritionAnalysis, setNutritionAnalysis] = useState<{
    verification: NutritionVerificationResult;
    report: NutritionReport;
  } | null>(null);
  const [verifyingNutrition, setVerifyingNutrition] = useState(false);
  const [nutritionError, setNutritionError] = useState<string | null>(null);
  const [nutritionSaved, setNutritionSaved] = useState(false);
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);
  const [compositionDrafts, setCompositionDrafts] = useState<
    Record<string, CompositionInputDraft>
  >({});

  const [aiTextDescription, setAiTextDescription] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month0: now.getMonth() };
  });
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(getToday());

  const today = getToday();
  const todayRecords = records.filter((item) => item.date === today);

  const totalCalories = sum(todayRecords, "calories");
  const totalProtein = sum(todayRecords, "protein");
  const totalCarbs = sum(todayRecords, "carbs");
  const totalFat = sum(todayRecords, "fat");
  const unknownNutritionCount = todayRecords.filter(
    (record) =>
      record.calories === null ||
      record.protein === null ||
      record.carbs === null ||
      record.fat === null
  ).length;
  const [dailyTargets, setDailyTargets] =
  useState<DailyTargets>(DEFAULT_DAILY_TARGETS);

  const [targetsLoading, setTargetsLoading] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      async function loadTargets() {
        try {
          const savedTargets = await getDailyTargets();

          if (active) {
            setDailyTargets(savedTargets);
          }
        } catch (error) {
          console.error("載入每日營養目標失敗：", error);

          if (active) {
            Alert.alert(
              "目標載入失敗",
              "無法讀取每日營養目標，請重新進入首頁或檢查裝置儲存空間。"
            );
          }
        } finally {
          if (active) {
            setTargetsLoading(false);
          }
        }
      }

      setTargetsLoading(true);
      loadTargets();

      return () => {
        active = false;
      };
    }, [])
  );

  const reportNutrients = [
    {
      key: "energy",
      label: "熱量",
      target: dailyTargets.calories,
      unit: "kcal",
      color: "#D9674F",
    },
    {
      key: "protein",
      label: "蛋白質",
      target: dailyTargets.protein,
      unit: "g",
      color: "#3478C7",
    },
    {
      key: "carbohydrate",
      label: "碳水化合物",
      target: dailyTargets.carbs,
      unit: "g",
      color: "#D99035",
    },
    {
      key: "fat",
      label: "脂肪",
      target: dailyTargets.fat,
      unit: "g",
      color: "#8C69C6",
    },
  ] as const;

  const invalidateNutritionForCompositionEdit = () => {
    compositionRevision.current += 1;
    verificationRequestId.current += 1;
    setVerifyingNutrition(false);
    setCompositionConfirmed(false);
    setNutritionAnalysis(null);
    setNutritionError(null);
  };

  const updateCompositionDraft = (
    itemId: string,
    field: keyof CompositionInputDraft,
    value: string
  ) => {
    invalidateNutritionForCompositionEdit();
    setCompositionDrafts((previous) => ({
      ...previous,
      [itemId]: {
        ...(previous[itemId] ?? {
          name: "",
          ingredients: "",
          candidate_names: "",
          confirmed_weight_g: "",
        }),
        [field]: value,
      },
    }));
  };

  const commitCompositionDrafts = (foods = detectedFoods) => {
    const committedFoods = foods.map((food) => {
      const draft = compositionDrafts[food.item_id];
      const weightText = draft?.confirmed_weight_g ?? "";
      const weight = weightText.trim() === "" ? null : Number(weightText);

      return {
        ...food,
        name: draft?.name ?? food.name,
        ingredients: parseIngredientList(
          draft?.ingredients ?? food.ingredients?.join("\n") ?? ""
        ),
        candidate_names: parseIngredientList(
          draft?.candidate_names ?? food.candidate_names?.join("、") ?? ""
        ),
        confirmed_weight_g:
          weight != null && Number.isFinite(weight) && weight > 0
            ? weight
            : null,
      };
    });
    setDetectedFoods(committedFoods);
    return committedFoods;
  };

  useEffect(() => {
    let active = true;
    let checking = false;

    const checkAndLoadRecords = async () => {
      if (checking) return;
      checking = true;

      try {
        const [storedRecords, autoClearValue, lastCheckedDate] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEY),
            AsyncStorage.getItem(AUTO_CLEAR_KEY),
            AsyncStorage.getItem(LAST_CHECKED_DATE_KEY),
          ]);

        const currentDate = getToday();

        let parsedRecords: MealRecord[] = [];

        if (storedRecords) {
          const parsed = JSON.parse(storedRecords);

          if (Array.isArray(parsed)) {
            parsedRecords = parsed;
          }
        }

        // 只有啟用自動清除，且之前檢查過的日期與今天不同時，
        // 才清除舊日期的紀錄。
        if (
          autoClearValue === "true" &&
          lastCheckedDate !== null &&
          lastCheckedDate !== currentDate
        ) {
          parsedRecords = parsedRecords.filter(
            (record) => record.date === currentDate
          );

          await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(parsedRecords)
          );
        }

        // 記錄最後檢查日期，避免同一天重複清除。
        await AsyncStorage.setItem(
          LAST_CHECKED_DATE_KEY,
          currentDate
        );

        if (active) {
          setRecords(parsedRecords);
        }
      } catch (error) {
        console.error("載入或自動清除飲食紀錄失敗：", error);

        if (active) {
          Alert.alert(
            "載入失敗",
            "無法讀取或更新本地飲食紀錄，請稍後再試。"
          );
        }
      } finally {
        checking = false;

        if (active) {
          setLoading(false);
        }
      }
    };

    void checkAndLoadRecords();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void checkAndLoadRecords();
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const persistRecords = async (nextRecords: MealRecord[]) => {
    setRecords(nextRecords);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
    } catch (error) {
      console.error("儲存飲食紀錄失敗：", error);
      Alert.alert("儲存失敗", "資料未能完整寫入本地儲存空間。");
    }
  };

  const clearForm = () => {
    compositionRevision.current += 1;
    verificationRequestId.current += 1;
    setFoodName("");
    setServing("1 份");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setAiTextDescription("");
    setSelectedImage(null);
    setAnalysisMealId(null);
    setAiAttempted(false);
    setAnalyzing(false);
    setInputMode("text");
    setEntryStep("closed");
    setDetectedFoods([]);
    setCompositionDrafts({});
    setCompositionConfirmed(false);
    setNutritionAnalysis(null);
    setNutritionError(null);
    setNutritionSaved(false);
    setVerifyingNutrition(false);
  };

  const openEntry = () => {
    setEntryStep("choose");
  };

  const openTextEntry = () => {
    compositionRevision.current += 1;
    verificationRequestId.current += 1;
    setInputMode("text");
    setSelectedImage(null);
    setAnalysisMealId(null);
    setAiAttempted(false);
    setEntryStep("details");
    setDetectedFoods([]);
    setCompositionDrafts({});
    setCompositionConfirmed(false);
    setNutritionAnalysis(null);
    setNutritionError(null);
    setNutritionSaved(false);
    setVerifyingNutrition(false);
  };

  const openAiTextEntry = () => {
    compositionRevision.current += 1;
    verificationRequestId.current += 1;
    setInputMode("ai_text");
    setSelectedImage(null);
    setAiTextDescription("");
    setAnalysisMealId(null);
    setAiAttempted(false);
    setEntryStep("details");
    setDetectedFoods([]);
    setCompositionDrafts({});
    setCompositionConfirmed(false);
    setNutritionAnalysis(null);
    setNutritionError(null);
    setNutritionSaved(false);
    setVerifyingNutrition(false);
  };

  const analyzeFoodFromText = async () => {
    const description = aiTextDescription.trim();
    if (!description) {
      Alert.alert("尚未輸入內容", "請描述你吃了什麼，例如：雞腿便當，白飯、滷雞腿、青菜、滷蛋。");
      return;
    }

    compositionRevision.current += 1;
    verificationRequestId.current += 1;
    setNutritionAnalysis(null);
    setNutritionError(null);
    setNutritionSaved(false);
    setVerifyingNutrition(false);
    setAnalyzing(true);
    setAiAttempted(false);
    setDetectedFoods([]);
    setCompositionDrafts({});
    setCompositionConfirmed(false);

    try {
      const mealId = `meal-${Date.now()}`;
      setAnalysisMealId(mealId);

      const result = await analyzeFoodText({ mealId, description });

      if (result.status === "needs_user_input" || result.items.length === 0) {
        Alert.alert(
          "尚未解析出食物",
          result.errors[0]?.message || "請換個方式描述，例如列出每樣食物與份量。"
        );
        return;
      }

      const analyzedFoods: DetectedFood[] = result.items.map((item) => ({
        item_id: item.item_id,
        name: item.name,
        ingredients: item.ingredients ?? [],
        candidate_names: [],
        portion_description: item.portion_description,
        estimated_weight_g: item.estimated_weight_g,
        confirmed_weight_g: item.confirmed_weight_g,
        identification_confidence: item.identification_confidence,
        uncertainty: item.uncertainty,
      }));
      setDetectedFoods(analyzedFoods);
      setCompositionDrafts(createCompositionDrafts(analyzedFoods));
      setFoodName(analyzedFoods.map((item) => item.name).join("、"));
      setServing(`${analyzedFoods.length} 項食物`);
      setAiAttempted(true);
    } catch (error) {
      console.error("文字餐點解析失敗：", error);
      Alert.alert(
        "餐點解析失敗",
        error instanceof Error
          ? error.message
          : "無法完成解析，請檢查網路、API Key 與 Gemini API 設定。"
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const openCalendar = () => {
    const now = new Date();
    setCalendarCursor({ year: now.getFullYear(), month0: now.getMonth() });
    setSelectedCalendarDate(getToday());
    setCalendarOpen(true);
  };

  const shiftCalendarMonth = (delta: number) => {
    setCalendarCursor((previous) => {
      const next = new Date(previous.year, previous.month0 + delta, 1);
      return { year: next.getFullYear(), month0: next.getMonth() };
    });
  };

  const takeFoodPhoto = async () => {
    try {
      const permission =
        await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "需要相機權限",
          "請允許 NutriTrack 使用相機，才能拍攝餐點。"
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.5,
      });

      if (!result.canceled && result.assets.length > 0) {
        compositionRevision.current += 1;
        verificationRequestId.current += 1;
        setSelectedImage(result.assets[0].uri);
        setInputMode("photo");
        setAnalysisMealId(null);
        setAiAttempted(false);
        setDetectedFoods([]);
        setCompositionDrafts({});
        setCompositionConfirmed(false);
        setNutritionAnalysis(null);
        setNutritionError(null);
        setVerifyingNutrition(false);
        setEntryStep("details");
      }
    } catch (error) {
      console.error("拍攝照片失敗：", error);
      Alert.alert("無法開啟相機", "請稍後再試。");
    }
  };

  const chooseFoodPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.5,
      });

      if (!result.canceled && result.assets.length > 0) {
        compositionRevision.current += 1;
        verificationRequestId.current += 1;
        setSelectedImage(result.assets[0].uri);
        setInputMode("photo");
        setAnalysisMealId(null);
        setAiAttempted(false);
        setDetectedFoods([]);
        setCompositionDrafts({});
        setCompositionConfirmed(false);
        setNutritionAnalysis(null);
        setNutritionError(null);
        setVerifyingNutrition(false);
        setEntryStep("details");
      }
    } catch (error) {
      console.error("選取照片失敗：", error);
      Alert.alert("無法開啟相簿", "請稍後再試。");
    }
  };

  
  const analyzeFood = async () => {
    if (!selectedImage) {
      Alert.alert("尚未選擇照片", "請先拍攝餐點或從相簿選擇照片。");
      return;
    }

    compositionRevision.current += 1;
    verificationRequestId.current += 1;
    setNutritionAnalysis(null);
    setNutritionError(null);
    setNutritionSaved(false);
    setVerifyingNutrition(false);
    setAnalyzing(true);
    setAiAttempted(false);
    setDetectedFoods([]);
    setCompositionDrafts({});
    setCompositionConfirmed(false);

    try {
      const base64Image = await readImageAsBase64(selectedImage);
      const mealId = `meal-${Date.now()}`;
      setAnalysisMealId(mealId);

      const result = await analyzeFoodImage({
        mealId,
        base64Image,
        mimeType: "image/jpeg",
      });

      if (result.status === "needs_user_input" || result.items.length === 0) {
        Alert.alert(
          "尚未辨識出食物組成",
          result.errors[0]?.message || "請確認照片清晰、餐點完整，再重新嘗試。"
        );
        return;
      }

      const analyzedFoods: DetectedFood[] = result.items.map((item) => {
        const candidates = item.candidate_names ?? [];
        return {
          item_id: item.item_id,
          name: candidates.length > 0
            ? `${item.name}（候選：${candidates.join("、")}）`
            : item.name,
          ingredients: item.ingredients ?? [],
          candidate_names: [],
          portion_description: item.portion_description,
          estimated_weight_g: item.estimated_weight_g,
          confirmed_weight_g: item.confirmed_weight_g,
          identification_confidence: item.identification_confidence,
          uncertainty: item.uncertainty,
        };
      });
      setDetectedFoods(analyzedFoods);
      setCompositionDrafts(createCompositionDrafts(analyzedFoods));
      setFoodName(analyzedFoods.map((item) => item.name).join("、"));
      setServing(`${analyzedFoods.length} 項食物`);
      setAiAttempted(true);
    } catch (error) {
      console.error("Gemini 食物組成分析失敗：", error);

      Alert.alert(
        "食物組成分析失敗",
        error instanceof Error
          ? error.message
          : "無法完成辨識，請檢查網路、API Key 與 Gemini API 設定。"
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmCompositionAndAnalyze = async () => {
    if (!analysisMealId || detectedFoods.length === 0) {
      return;
    }

    const invalidWeight = detectedFoods.some((food) => {
      const weightText = compositionDrafts[food.item_id]?.confirmed_weight_g ?? "";
      if (weightText.trim() === "") {
        return false;
      }
      const weight = Number(weightText);
      return !Number.isFinite(weight) || weight <= 0;
    });
    const confirmedFoods = commitCompositionDrafts();

    if (confirmedFoods.some((food) => !food.name.trim()) || invalidWeight) {
      Alert.alert(
        "組成資料尚未完成",
        invalidWeight
          ? "重量請輸入大於 0 的數值，或留空表示未知。"
          : "請確認每項食物名稱。"
      );
      return;
    }

    setCompositionConfirmed(true);
    await verifyAndGenerateReport(confirmedFoods);
  };

  const persistNewRecord = async (
    newRecord: MealRecord,
    successMessage: string,
    options: { clearForm?: boolean; showAlert?: boolean } = {}
  ) => {
    setSaving(true);
    try {
      const nextRecords = [
        newRecord,
        ...records.filter((record) => record.id !== newRecord.id),
      ];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
      setRecords(nextRecords);
      if (options.clearForm !== false) {
        clearForm();
      }
      if (options.showAlert !== false) {
        Alert.alert("儲存成功", successMessage);
      }
      return true;
    } catch (error) {
      console.error("新增飲食紀錄失敗：", error);
      Alert.alert("儲存失敗", "請確認裝置儲存空間後再試一次。");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addRecord = async () => {
    if (inputMode === "photo") {
      Alert.alert("請先完成營養報告", "照片餐點只能在生成報告後選擇是否保存。");
      return;
    }

    if (!foodName.trim()) {
      Alert.alert("請輸入食物名稱", "例如：雞肉飯、茶葉蛋或蘋果。");
      return;
    }

    if (calories.trim() === "") {
      Alert.alert("請輸入熱量", "請輸入這份食物的熱量（kcal）。");
      return;
    }

    const numericCalories = Number(calories);
    const numericProtein = protein.trim() === "" ? null : Number(protein);
    const numericCarbs = carbs.trim() === "" ? null : Number(carbs);
    const numericFat = fat.trim() === "" ? null : Number(fat);

    const values = [
      numericCalories,
      numericProtein,
      numericCarbs,
      numericFat,
    ].filter((value): value is number => value !== null);

    if (
      values.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      Alert.alert(
        "營養數值不正確",
        "熱量、蛋白質、碳水化合物與脂肪必須是大於或等於 0 的數字。"
      );
      return;
    }

    const newRecord: MealRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: getToday(),
      meal: selectedMeal,
      name: foodName.trim(),
      serving: serving.trim() || "1 份",
      calories: numericCalories,
      protein: numericProtein,
      carbs: numericCarbs,
      fat: numericFat,
    };

    await persistNewRecord(newRecord, "這筆飲食紀錄已加入今日紀錄。");
  };

  const verifyAndGenerateReport = async (
    foodsToAnalyze: DetectedFood[] = detectedFoods
  ) => {
    if (!analysisMealId || foodsToAnalyze.length === 0) {
      Alert.alert("尚未確認食物組成", "請先確認每項食物與重量，再進行營養查證。");
      return;
    }

    const compositionItems: CompositionItem[] = foodsToAnalyze.map((item) => ({
      item_id: item.item_id,
      name: item.name.trim(),
      ingredients: item.ingredients ?? [],
      candidate_names: item.candidate_names ?? [],
      portion_description: item.portion_description,
      estimated_weight_g: item.estimated_weight_g,
      confirmed_weight_g: item.confirmed_weight_g,
      identification_confidence: item.identification_confidence,
      uncertainty: item.uncertainty,
    }));
    const requestId = verificationRequestId.current + 1;
    verificationRequestId.current = requestId;
    const revisionAtRequest = compositionRevision.current;

    setVerifyingNutrition(true);
    setNutritionError(null);
    setNutritionAnalysis(null);
    setNutritionSaved(false);
    try {
      const verification = await verifyNutritionSources({
        schema_version: "1.0.0",
        stage: "composition",
        meal_id: analysisMealId,
        status: "user_confirmed",
        items: compositionItems,
      });
      if (
        requestId !== verificationRequestId.current ||
        revisionAtRequest !== compositionRevision.current
      ) {
        return;
      }
      if (verification.status === "needs_user_input") {
        setNutritionError(
          verification.errors.map((item) => item.message).join("\n")
        );
        return;
      }
      const report = generateNutritionReport(
        analysisMealId,
        compositionItems,
        verification
      );
      if (
        requestId !== verificationRequestId.current ||
        revisionAtRequest !== compositionRevision.current
      ) {
        return;
      }
      setNutritionAnalysis({ verification, report });
      await saveNutritionReport(
        { verification, report },
        foodsToAnalyze,
        requestId,
        revisionAtRequest
      );
    } catch (error) {
      if (
        requestId !== verificationRequestId.current ||
        revisionAtRequest !== compositionRevision.current
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : "未知錯誤";
      console.error("營養查證或報告生成失敗：", error);
      setNutritionError(message);
    } finally {
      if (requestId === verificationRequestId.current) {
        setVerifyingNutrition(false);
      }
    }
  };

  const saveNutritionReport = async (
    analysis: {
      verification: NutritionVerificationResult;
      report: NutritionReport;
    } | null = nutritionAnalysis,
    foodsToSave: DetectedFood[] = detectedFoods,
    requestId?: number,
    revisionAtSave?: number
  ) => {
    if (!analysis || !analysisMealId) {
      return false;
    }

    const { verification, report } = analysis;
    const reportItemsById = new Map(
      report.item_reports.map((item) => [item.item_id, item])
    );
    const verifiedItemsById = new Map(
      verification.verified_items.map((item) => [item.item_id, item])
    );

    const savedCompositionItems: SavedCompositionItem[] = foodsToSave.map(
      (item) => {
        const itemReport = reportItemsById.get(item.item_id);
        const verifiedItem = verifiedItemsById.get(item.item_id);
        return {
          item_id: item.item_id,
          name: item.name.trim(),
          ingredients: item.ingredients ?? [],
          candidate_names: item.candidate_names ?? [],
          estimated_weight_g: item.estimated_weight_g ?? null,
          confirmed_weight_g: item.confirmed_weight_g ?? null,
          portion_description: item.portion_description ?? null,
          identification_confidence: item.identification_confidence,
          uncertainty: item.uncertainty,
          weight_status:
            item.confirmed_weight_g != null
              ? "user_confirmed"
              : item.estimated_weight_g != null
                ? "ai_estimated"
                : "unknown",
          evidence_status: verifiedItem?.evidence_status ?? "unresolved",
          source_ids: verifiedItem?.source_ids ?? [],
          nutrients: {
            energy_kcal: itemReport?.nutrients.energy?.value ?? null,
            protein_g: itemReport?.nutrients.protein?.value ?? null,
            carbohydrate_g: itemReport?.nutrients.carbohydrate?.value ?? null,
            fat_g: itemReport?.nutrients.fat?.value ?? null,
          },
        };
      }
    );

    const allItemsHaveValue = (key: "energy" | "protein" | "carbohydrate" | "fat") =>
      report.item_reports.length > 0 &&
      report.item_reports.every((item) => item.nutrients[key]?.value != null);

    const savedRecord: MealRecord = {
      id: analysisMealId,
      date: getToday(),
      meal: selectedMeal,
      name: savedCompositionItems.map((item) => item.name).join("、"),
      serving: `${savedCompositionItems.length} 項食物`,
      calories: allItemsHaveValue("energy")
        ? report.totals.energy?.value ?? null
        : null,
      protein: allItemsHaveValue("protein")
        ? report.totals.protein?.value ?? null
        : null,
      carbs: allItemsHaveValue("carbohydrate")
        ? report.totals.carbohydrate?.value ?? null
        : null,
      fat: allItemsHaveValue("fat")
        ? report.totals.fat?.value ?? null
        : null,
      nutritionStatus: report.status,
      compositionItems: savedCompositionItems,
      nutritionVerification: verification,
      nutritionReport: report,
    };

    if (
      (requestId != null && requestId !== verificationRequestId.current) ||
      (revisionAtSave != null && revisionAtSave !== compositionRevision.current)
    ) {
      return false;
    }

    const saved = await persistNewRecord(
      savedRecord,
      report.status === "complete"
        ? "營養報告與來源已儲存在本機。"
        : "部分營養報告與來源已儲存在本機；未知資料仍保留空值。",
      { clearForm: false, showAlert: false }
    );
    if (saved) {
      setNutritionSaved(true);
    }
    return saved;
  };

  const openNutritionSource = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("無法開啟來源", "請檢查裝置是否可開啟此來源網址。");
    }
  };

  const deleteRecord = (id: string) => {
    Alert.alert("刪除紀錄", "確定要刪除這筆飲食紀錄嗎？", [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: async () => {
          const nextRecords = records.filter((item) => item.id !== id);
          await persistRecords(nextRecords);
        },
      },
    ]);
  };

  const clearTodayRecords = () => {
    if (todayRecords.length === 0) {
      Alert.alert("沒有紀錄", "今天目前沒有可清除的飲食紀錄。");
      return;
    }

    Alert.alert(
      "清除今日紀錄",
      `確定要刪除今天的 ${todayRecords.length} 筆飲食紀錄嗎？此操作無法復原。`,
      [
        {
          text: "取消",
          style: "cancel",
        },
        {
          text: "全部清除",
          style: "destructive",
          onPress: async () => {
            const nextRecords = records.filter(
              (record) => record.date !== today
            );

            await persistRecords(nextRecords);
            setExpandedRecordId(null);
            setRecordEditDraft(null);

            Alert.alert("清除完成", "今日飲食紀錄已全部清除。");
          },
        },
      ]
    );
  };

  const beginRecordEdit = (record: MealRecord) => {
    const itemNutrients: Record<string, ItemNutrientDraft> = Object.fromEntries(
      (record.compositionItems ?? []).map((item) => [
        item.item_id,
        Object.fromEntries(
          ITEM_NUTRIENT_FIELDS.map(({ key }) => [
            key,
            item.nutrients[key] == null ? "" : String(round1(item.nutrients[key] as number)),
          ])
        ) as ItemNutrientDraft,
      ])
    );

    setExpandedRecordId(record.id);
    setRecordEditDraft({
      id: record.id,
      date: record.date,
      meal: record.meal,
      name: record.name,
      serving: record.serving,
      calories: record.calories == null ? "" : String(record.calories),
      protein: record.protein == null ? "" : String(record.protein),
      carbs: record.carbs == null ? "" : String(record.carbs),
      fat: record.fat == null ? "" : String(record.fat),
      nutritionStatus: record.nutritionStatus,
      nutritionEdited: record.nutritionEdited,
      confirmedObjects: record.confirmedObjects,
      compositionItems: record.compositionItems,
      nutritionVerification: record.nutritionVerification,
      nutritionReport: record.nutritionReport,
      itemNutrients,
    });
  };

  const updateRecordItemNutrient = (
    itemId: string,
    key: ItemNutrientKey,
    value: string
  ) => {
    setRecordEditDraft((previous) =>
      previous
        ? {
            ...previous,
            itemNutrients: {
              ...previous.itemNutrients,
              [itemId]: {
                ...(previous.itemNutrients[itemId] ?? {
                  energy_kcal: "",
                  protein_g: "",
                  carbohydrate_g: "",
                  fat_g: "",
                }),
                [key]: value,
              },
            },
          }
        : previous
    );
  };

  const saveRecordEdit = async () => {
    if (!recordEditDraft) {
      return;
    }

    const parseOptionalNumber = (value: string) => {
      if (value.trim() === "") {
        return null;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
    };

    let updatedRecord: MealRecord;

    if (recordEditDraft.compositionItems) {
      // 有細項的紀錄：只修改各項食物的營養數據，名稱、食材與重量不變。
      let invalidValue = false;
      let anyEdited = false;
      const updatedItems: SavedCompositionItem[] = recordEditDraft.compositionItems.map(
        (item) => {
          const input = recordEditDraft.itemNutrients[item.item_id];
          const nextNutrients = { ...item.nutrients };
          let itemChanged = false;

          for (const { key } of ITEM_NUTRIENT_FIELDS) {
            const parsed = parseOptionalNumber(input?.[key] ?? "");
            if (parsed !== null && Number.isNaN(parsed)) {
              invalidValue = true;
              continue;
            }
            const original = item.nutrients[key];
            const originalShown = original == null ? null : round1(original);
            // 沒有改動的欄位保留原始精確值，避免四捨五入造成誤判為已修改。
            if (parsed !== originalShown) {
              nextNutrients[key] = parsed;
              itemChanged = true;
            }
          }

          if (itemChanged) {
            anyEdited = true;
          }
          return itemChanged
            ? { ...item, nutrients: nextNutrients, nutrients_edited: true }
            : item;
        }
      );

      if (invalidValue) {
        Alert.alert("營養值不正確", "請輸入大於或等於 0 的數字，或留空表示未知。");
        return;
      }

      const totalFor = (key: ItemNutrientKey) =>
        updatedItems.length > 0 && updatedItems.every((item) => item.nutrients[key] != null)
          ? updatedItems.reduce((total, item) => total + (item.nutrients[key] as number), 0)
          : null;

      updatedRecord = {
        id: recordEditDraft.id,
        date: recordEditDraft.date,
        meal: recordEditDraft.meal,
        name: recordEditDraft.name,
        serving: recordEditDraft.serving,
        calories: totalFor("energy_kcal"),
        protein: totalFor("protein_g"),
        carbs: totalFor("carbohydrate_g"),
        fat: totalFor("fat_g"),
        nutritionStatus: recordEditDraft.nutritionStatus,
        nutritionEdited: recordEditDraft.nutritionEdited || anyEdited || undefined,
        confirmedObjects: recordEditDraft.confirmedObjects,
        compositionItems: updatedItems,
        nutritionVerification: recordEditDraft.nutritionVerification,
        nutritionReport: recordEditDraft.nutritionReport,
      };
    } else {
      // 手動紀錄（沒有細項）：維持原本的名稱、份量與四項營養值編輯。
      if (!recordEditDraft.name.trim()) {
        Alert.alert("請輸入食物名稱", "紀錄名稱不能留空。");
        return;
      }
      const caloriesValue = parseOptionalNumber(recordEditDraft.calories);
      const proteinValue = parseOptionalNumber(recordEditDraft.protein);
      const carbsValue = parseOptionalNumber(recordEditDraft.carbs);
      const fatValue = parseOptionalNumber(recordEditDraft.fat);

      if ([caloriesValue, proteinValue, carbsValue, fatValue].some(Number.isNaN)) {
        Alert.alert("營養值不正確", "請輸入非負數字，或留空表示未知。");
        return;
      }

      updatedRecord = {
        id: recordEditDraft.id,
        date: recordEditDraft.date,
        meal: recordEditDraft.meal,
        name: recordEditDraft.name.trim(),
        serving: recordEditDraft.serving.trim(),
        calories: caloriesValue,
        protein: proteinValue,
        carbs: carbsValue,
        fat: fatValue,
        nutritionStatus: recordEditDraft.nutritionStatus,
        nutritionEdited: recordEditDraft.nutritionEdited,
        confirmedObjects: recordEditDraft.confirmedObjects,
        compositionItems: recordEditDraft.compositionItems,
        nutritionVerification: recordEditDraft.nutritionVerification,
        nutritionReport: recordEditDraft.nutritionReport,
      };
    }

    const hadItems = Boolean(recordEditDraft.compositionItems);
    setSaving(true);
    try {
      const nextRecords = records.map((record) =>
        record.id === updatedRecord.id ? updatedRecord : record
      );
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
      setRecords(nextRecords);
      setRecordEditDraft(null);
      Alert.alert(
        "已更新紀錄",
        hadItems
          ? "各項營養數據已更新，整筆紀錄的總量已重新計算。"
          : "飲食紀錄已更新。"
      );
    } catch (error) {
      console.error("更新飲食紀錄失敗：", error);
      Alert.alert("更新失敗", "資料未能完整寫入本地儲存空間。");
    } finally {
      setSaving(false);
    }
  };

  const calorieProgress = Math.min(
    totalCalories / dailyTargets.calories,
    1
  );

  const nowForHeader = new Date();
  const headerMonth = summarizeMonth(
    records,
    nowForHeader.getFullYear(),
    nowForHeader.getMonth(),
    dailyTargets
  );
  const headerStreak = computeStreak(records, dailyTargets, today);

  const compositionSection = aiAttempted && (
                  <View style={{ marginTop: 14, gap: 12 }}>
                    <Text style={styles.noticeSuccess}>
                      已分析 {detectedFoods.length} 項食物，請確認名稱、食材與重量。
                    </Text>

                    {detectedFoods.map((item, index) => (
                      <View
                        key={item.item_id}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          backgroundColor: "#FFFFFF",
                          borderWidth: 1,
                          borderColor: "#E2E9E0",
                        }}
                      >
                        <Text style={{ fontWeight: "700", color: "#286B47" }}>
                          食物 {index + 1}
                        </Text>

                        <TextInput
                          style={[styles.input, { marginTop: 8 }]}
                          placeholderTextColor="#9AA49A"
                          value={compositionDrafts[item.item_id]?.name ?? item.name}
                          onChangeText={(value) =>
                            updateCompositionDraft(item.item_id, "name", value)
                          }
                          placeholder="食物名稱"
                          autoCorrect={false}
                          spellCheck={false}
                        />

                        <Text style={styles.previewDescription}>
                          份量描述：{item.portion_description || "待確認"}
                        </Text>

                        <Text style={styles.fieldLabel}>內部食材（可由照片確認）</Text>
                        <TextInput
                          style={[styles.input, { minHeight: 64, textAlignVertical: "top" }]}
                          placeholderTextColor="#9AA49A"
                          value={
                            compositionDrafts[item.item_id]?.ingredients ??
                            item.ingredients?.join("\n") ??
                            ""
                          }
                          onChangeText={(value) =>
                            updateCompositionDraft(item.item_id, "ingredients", value)
                          }
                          placeholder="複合料理請逐項列出照片可支持的食材；每行一項"
                          multiline
                        />

                        <Text style={styles.fieldLabel}>確認重量（g）</Text>

                        <TextInput
                          style={styles.input}
                          placeholderTextColor="#9AA49A"
                          value={
                            compositionDrafts[item.item_id]?.confirmed_weight_g ??
                            (item.confirmed_weight_g == null
                              ? ""
                              : String(item.confirmed_weight_g))
                          }
                          onChangeText={(value) =>
                            updateCompositionDraft(
                              item.item_id,
                              "confirmed_weight_g",
                              value
                            )
                          }
                          placeholder={
                            item.estimated_weight_g != null
                              ? `AI 估計 ${item.estimated_weight_g} g，請確認`
                              : "輸入確認後的重量"
                          }
                          keyboardType="decimal-pad"
                        />

                        <Text style={styles.previewDescription}>
                          辨識信心：{Math.round(item.identification_confidence * 100)}%
                          {" · "}
                          不確定性：{item.uncertainty}
                        </Text>

                        <TouchableOpacity
                          onPress={() => {
                            compositionRevision.current += 1;
                            verificationRequestId.current += 1;
                            setCompositionConfirmed(false);
                            setNutritionAnalysis(null);
                            setNutritionError(null);
                            setVerifyingNutrition(false);
                            setDetectedFoods((previous) =>
                              previous.filter(
                                (food) => food.item_id !== item.item_id
                              )
                            );
                            setCompositionDrafts((previous) => {
                              const next = { ...previous };
                              delete next[item.item_id];
                              return next;
                            });
                          }}
                          style={{ marginTop: 8, alignSelf: "flex-start" }}
                        >
                          <Text style={styles.removePhotoText}>移除此項食物</Text>
                        </TouchableOpacity>
                      </View>
                    ))}

                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => {
                        compositionRevision.current += 1;
                        verificationRequestId.current += 1;
                        setCompositionConfirmed(false);
                        setNutritionAnalysis(null);
                        setNutritionError(null);
                        setVerifyingNutrition(false);
                        const newFood: DetectedFood = {
                          item_id: `manual-${Date.now()}-${Math.random()}`,
                          name: "",
                          portion_description: "待確認",
                          ingredients: [],
                          candidate_names: [],
                          estimated_weight_g: null,
                          confirmed_weight_g: null,
                          identification_confidence: 1,
                          uncertainty: "high",
                        };
                        setDetectedFoods((previous) => [...previous, newFood]);
                        setCompositionDrafts((previous) => ({
                          ...previous,
                          ...createCompositionDrafts([newFood]),
                        }));
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>＋ 手動新增食物</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        { marginTop: 12, marginBottom: 0 },
                        ((compositionConfirmed && !nutritionError) || verifyingNutrition || detectedFoods.length === 0) && styles.disabledButton,
                      ]}
                      disabled={(compositionConfirmed && !nutritionError) || verifyingNutrition || detectedFoods.length === 0}
                      onPress={confirmCompositionAndAnalyze}
                    >
                      {verifyingNutrition ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.primaryButtonText}>
                          {nutritionError
                            ? "重試 AI 營養分析"
                            : nutritionSaved
                              ? "分析完成，已加入今日紀錄"
                              : nutritionAnalysis
                                ? "AI 分析完成"
                                : compositionConfirmed
                                  ? "組成已確認"
                                  : "確認並進行 AI 分析"}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {compositionConfirmed && (
                      <View style={{ gap: 12 }}>

                        {nutritionError && (
                          <Text style={styles.nutritionErrorText}>
                            {nutritionError}
                          </Text>
                        )}

                        {nutritionAnalysis && (
                          <View style={{ gap: 12 }}>
                            <View
                              style={{
                                padding: 12,
                                borderRadius: 10,
                                backgroundColor: "#F3F7F0",
                                borderWidth: 1,
                                borderColor: "#DCE8D8",
                              }}
                            >
                              <Text style={styles.panelTitle}>
                                整餐營養總量
                              </Text>
                              <Text style={styles.previewDescription}>
                                {nutritionAnalysis.report.status === "complete"
                                  ? "來源已查證"
                                  : "含 AI 估算或未知值 · 條圖相對 App 每日參考值"}
                              </Text>
                              <View style={{ gap: 12, marginTop: 10 }}>
                                {reportNutrients.map((nutrient) => {
                                  const value =
                                    nutritionAnalysis.report.totals[nutrient.key]?.value ?? null;
                                  const progress = value == null
                                    ? 0
                                    : Math.min(value / nutrient.target, 1);

                                  return (
                                    <View key={nutrient.key} style={{ gap: 5 }}>
                                      <View style={styles.reportNutrientHeader}>
                                        <Text style={styles.reportNutrientLabel}>
                                          {nutrient.label}
                                        </Text>
                                        <Text style={styles.reportNutrientValue}>
                                          {value == null
                                            ? "未知"
                                            : `${formatNumber(value)} / ${nutrient.target} ${nutrient.unit}`}
                                        </Text>
                                      </View>
                                      <View style={styles.reportBarTrack}>
                                        {value != null && (
                                          <View
                                            style={[
                                              styles.reportBarFill,
                                              {
                                                width: `${progress * 100}%`,
                                                backgroundColor: nutrient.color,
                                              },
                                            ]}
                                          />
                                        )}
                                      </View>
                                    </View>
                                  );
                                })}
                              </View>
                              <View style={{ marginTop: 10, gap: 3 }}>
                                {SECONDARY_REPORT_NUTRIENTS.map(({ key, label }) => (
                                  <Text key={key} style={styles.recordMacros}>
                                    {label}　{formatNutritionValue(nutritionAnalysis.report.totals[key])}
                                  </Text>
                                ))}
                              </View>
                            </View>

                            <Text style={styles.fieldLabel}>食物項目與來源</Text>
                            {nutritionAnalysis.report.item_reports.map((reportItem) => {
                              const food = detectedFoods.find(
                                (item) => item.item_id === reportItem.item_id
                              );
                              const itemSources = nutritionAnalysis.verification.sources.filter(
                                (source) =>
                                  reportItem.source_ids.includes(source.source_id) &&
                                  source.source_url != null
                              );
                              const verifiedItem = nutritionAnalysis.verification.verified_items.find(
                                (item) => item.item_id === reportItem.item_id
                              );

                              return (
                                <View
                                  key={reportItem.item_id}
                                  style={{
                                    padding: 12,
                                    borderRadius: 10,
                                    backgroundColor: "#FFFFFF",
                                    borderWidth: 1,
                                    borderColor: "#E2E9E0",
                                  }}
                                >
                                  <Text style={{ fontWeight: "700", color: "#286B47" }}>
                                    {reportItem.name}
                                  </Text>
                                  <Text style={styles.previewDescription}>
                                    {evidenceStatusLabel(reportItem.evidence_status)}
                                  </Text>
                                  <Text style={styles.previewDescription}>
                                    {reportItem.consumed_weight_g == null
                                      ? "重量未知"
                                      : `總重: ${formatNumber(reportItem.consumed_weight_g)} g `}
                                  </Text>
                                  <Text style={styles.recordMacros}>
                                    熱量 {formatNutritionValue(reportItem.nutrients.energy)} · 蛋白質 {formatNutritionValue(reportItem.nutrients.protein)}
                                  </Text>
                                  <Text style={styles.recordMacros}>
                                    碳水 {formatNutritionValue(reportItem.nutrients.carbohydrate)} · 脂肪 {formatNutritionValue(reportItem.nutrients.fat)}
                                  </Text>
                                  <Text style={styles.recordServing}>
                                    纖維 {formatNutritionValue(reportItem.nutrients.fiber)} · 鈉 {formatNutritionValue(reportItem.nutrients.sodium)} · 糖 {formatNutritionValue(reportItem.nutrients.total_sugars)}
                                  </Text>
                                  {itemSources.filter((source) => source.source_url).map((source) => (
                                    <TouchableOpacity
                                      key={source.source_id}
                                      onPress={() => openNutritionSource(source.source_url!)}
                                      style={{ marginTop: 6 }}
                                    >
                                      <Text style={styles.sourceLink}>
                                        查看來源：{source.source_name}
                                      </Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              );
                            })}

                            {nutritionSaved ? (
                              <View style={{ gap: 8 }}>
                                <Text style={styles.noticeSuccess}>
                                  已加入今日飲食；需要移除此餐可在今日紀錄編輯或刪除。
                                </Text>
                                <TouchableOpacity
                                  style={styles.secondaryButton}
                                  onPress={clearForm}
                                >
                                  <Text style={styles.secondaryButtonText}>
                                    完成並返回今日紀錄
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            ) : !verifyingNutrition && !saving ? (
                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() =>
                                  saveNutritionReport(nutritionAnalysis, detectedFoods)
                                }
                              >
                                <Text style={styles.primaryButtonText}>
                                  重試加入今日紀錄
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        )}
                      </View>
                    )}

                  </View>
                );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content"/>

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          {/* 左側：標題 */}
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>NutriTrack</Text>
            <Text style={styles.subtitle}>紀錄並分析每日飲食組成</Text>
          </View>

          {/* 中間：日期 */}
          <Pressable style={styles.dateBadge} onPress={openCalendar}>
            <Text style={styles.dateText}>📅 {today}</Text>
          </Pressable>

          {/* 右側：設定 */}
          <Pressable
            onPress={() => router.push('/settings')}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: 10,
              backgroundColor: '#246B45',
              marginLeft: 10,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
              ⚙️ 設定
            </Text>
          </Pressable>
        </View>

        <Pressable style={styles.monthStrip} onPress={openCalendar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.monthStripTitle}>
              本月達成 {headerMonth.achievedCount} 天
              {headerStreak > 0 ? ` · 連續 ${headerStreak} 天` : ""}
            </Text>
            <Text style={styles.monthStripHint}>點擊查看月曆與每日達成狀況</Text>
          </View>
          <View style={styles.monthDots}>
            {headerMonth.days.map((day) => (
              <View
                key={day.date}
                style={[
                  styles.monthDot,
                  day.status === "achieved" && styles.monthDotAchieved,
                  day.status === "logged" && styles.monthDotLogged,
                  day.date === today && styles.monthDotToday,
                ]}
              />
            ))}
          </View>
        </Pressable>

        <View style={styles.calorieCard}>
          <Text style={styles.cardEyebrow}>今日熱量攝取</Text>
          <View style={styles.calorieRow}>
            <Text style={styles.calorieNumber}>
              {formatNumber(totalCalories)}
            </Text>
            <Text style={styles.calorieUnit}>kcal</Text>
          </View>
          <Text style={styles.mutedText}>
            每日目標 {dailyTargets.calories} kcal
          </Text>
          {unknownNutritionCount > 0 && (
            <Text style={styles.pendingNutritionNotice}>
              {unknownNutritionCount} 筆含未知營養值；今日總量只加總已知數字
            </Text>
          )}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${calorieProgress * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {totalCalories >= dailyTargets.calories
              ? "已達成今日熱量目標"
              : `還可攝取 ${formatNumber(
                  dailyTargets.calories - totalCalories
                )} kcal`}
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>今日營養概況</Text>
          <Text style={styles.sectionHint}>目標值僅供參考</Text>
        </View>

        <View style={styles.nutrientGrid}>
          <NutrientCard
            label="蛋白質"
            value={totalProtein}
            target={dailyTargets.protein}
            unit="g"
            color="#3478C7"
          />

          <NutrientCard
            label="碳水化合物"
            value={totalCarbs}
            target={dailyTargets.carbs}
            unit="g"
            color="#D99035"
          />

          <NutrientCard
            label="脂肪"
            value={totalFat}
            target={dailyTargets.fat}
            unit="g"
            color="#8C69C6"
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>飲食紀錄</Text>
          <Text style={styles.sectionHint}>
            {todayRecords.length} 筆
          </Text>
        </View>

        {entryStep === "closed" && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={openEntry}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>＋ 新增食物紀錄</Text>
          </TouchableOpacity>
        )}

        {entryStep === "choose" && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>如何新增食物？</Text>
            <Text style={styles.panelDescription}>
              選擇一種方式開始建立飲食紀錄。
            </Text>

            <TouchableOpacity
              style={styles.optionButton}
              onPress={takeFoodPhoto}
            >
              <Text style={styles.optionIcon}>📷</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>拍攝餐點</Text>
                <Text style={styles.optionDescription}>
                  使用相機拍攝目前的餐點
                </Text>
              </View>
              <Text style={styles.optionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionButton}
              onPress={chooseFoodPhoto}
            >
              <Text style={styles.optionIcon}>🖼️</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>從相簿選擇照片</Text>
                <Text style={styles.optionDescription}>
                  選擇裝置中已拍攝的餐點照片
                </Text>
              </View>
              <Text style={styles.optionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionButton}
              onPress={openAiTextEntry}
            >
              <Text style={styles.optionIcon}>🤖</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>文字描述，交給 AI 辨識</Text>
                <Text style={styles.optionDescription}>
                  輸入食物與組成，由 AI 整理食材並查證營養
                </Text>
              </View>
              <Text style={styles.optionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionButton}
              onPress={openTextEntry}
            >
              <Text style={styles.optionIcon}>✍️</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>直接文字輸入</Text>
                <Text style={styles.optionDescription}>
                  不需要照片，自己輸入食物與營養數值
                </Text>
              </View>
              <Text style={styles.optionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setEntryStep("closed")}
            >
              <Text style={styles.cancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        )}

        {entryStep === "details" && (
          <View style={styles.panel}>
            <View style={styles.formHeader}>
              <Text style={styles.panelTitle}>編輯食物資料</Text>
              <TouchableOpacity onPress={clearForm}>
                <Text style={styles.cancelLink}>取消新增</Text>
              </TouchableOpacity>
            </View>

            {inputMode === "photo" && selectedImage && (
              <View style={styles.previewCard}>
                <Image
                  source={{ uri: selectedImage }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
                <View style={styles.previewInfo}>
                  <Text style={styles.previewTitle}>餐點照片已選取</Text>
                  <Text style={styles.previewDescription}>
                    請確認照片，並手動核對食物與營養資料。
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedImage(null)}
                  >
                    <Text style={styles.removePhotoText}>移除照片</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    analyzing && styles.disabledButton,
                  ]}
                  onPress={analyzeFood}
                  disabled={analyzing}
                >
                  {analyzing ? (
                    <ActivityIndicator color="#28764A" />
                  ) : (
                    <Text style={styles.secondaryButtonText}>
                      AI 辨識食物組成
                    </Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.noticeText}>
                  AI 會直接辨識照片中的食物、可見食材與估計重量。
                </Text>

                <Text style={styles.fieldLabel}>餐別</Text>
                <View style={styles.mealSelector}>
                  {MEALS.map((meal) => (
                    <TouchableOpacity
                      key={meal}
                      style={[
                        styles.mealChip,
                        selectedMeal === meal && styles.mealChipActive,
                      ]}
                      onPress={() => setSelectedMeal(meal)}
                    >
                      <Text
                        style={[
                          styles.mealChipText,
                          selectedMeal === meal && styles.mealChipTextActive,
                        ]}
                      >
                        {meal}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {compositionSection}

              </View>
            )}

            {inputMode === "ai_text" && (
              <View style={{ gap: 4 }}>
                <Text style={styles.fieldLabel}>餐別</Text>
                <View style={styles.mealSelector}>
                  {MEALS.map((meal) => (
                    <TouchableOpacity
                      key={meal}
                      style={[
                        styles.mealChip,
                        selectedMeal === meal && styles.mealChipActive,
                      ]}
                      onPress={() => setSelectedMeal(meal)}
                    >
                      <Text
                        style={[
                          styles.mealChipText,
                          selectedMeal === meal && styles.mealChipTextActive,
                        ]}
                      >
                        {meal}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>描述你吃的餐點與組成 *</Text>
                <TextInput
                  style={[styles.input, { minHeight: 110, textAlignVertical: "top" }]}
                  placeholder={"例如：雞腿便當，白飯約200g、滷雞腿一支、炒青菜、滷蛋一顆"}
                  placeholderTextColor="#9AA49A"
                  value={aiTextDescription}
                  onChangeText={setAiTextDescription}
                  multiline
                  maxLength={1000}
                />
                <Text style={styles.noticeText}>
                  可以寫食物、食材與重量；沒寫的重量 AI 會估計，下一步你可以再確認與修改。
                </Text>

                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    analyzing && styles.disabledButton,
                  ]}
                  onPress={analyzeFoodFromText}
                  disabled={analyzing}
                >
                  {analyzing ? (
                    <ActivityIndicator color="#28764A" />
                  ) : (
                    <Text style={styles.secondaryButtonText}>
                      AI 辨識食物組成
                    </Text>
                  )}
                </TouchableOpacity>

                {compositionSection}
              </View>
            )}

            {inputMode === "text" && (
              <>
            <Text style={styles.fieldLabel}>餐別</Text>
            <View style={styles.mealSelector}>
              {MEALS.map((meal) => (
                <TouchableOpacity
                  key={meal}
                  style={[
                    styles.mealChip,
                    selectedMeal === meal && styles.mealChipActive,
                  ]}
                  onPress={() => setSelectedMeal(meal)}
                >
                  <Text
                    style={[
                      styles.mealChipText,
                      selectedMeal === meal && styles.mealChipTextActive,
                    ]}
                  >
                    {meal}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>食物名稱 *</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：雞肉飯"
              placeholderTextColor="#9AA49A"
              value={foodName}
              onChangeText={setFoodName}
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>份量</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：1 碗、100 g"
              placeholderTextColor="#9AA49A"
              value={serving}
              onChangeText={setServing}
            />

            <Text style={styles.fieldLabel}>熱量（kcal）*</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：520"
              placeholderTextColor="#9AA49A"
              value={calories}
              onChangeText={setCalories}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>蛋白質（g）</Text>
            <TextInput
              style={styles.input}
              placeholder="不知道可先留空"
              placeholderTextColor="#9AA49A"
              value={protein}
              onChangeText={setProtein}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>碳水化合物（g）</Text>
            <TextInput
              style={styles.input}
              placeholder="不知道可先留空"
              placeholderTextColor="#9AA49A"
              value={carbs}
              onChangeText={setCarbs}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>脂肪（g）</Text>
            <TextInput
              style={styles.input}
              placeholder="不知道可先留空"
              placeholderTextColor="#9AA49A"
              value={fat}
              onChangeText={setFat}
              keyboardType="decimal-pad"
            />

            <Text style={styles.formHint}>
              * 為必填欄位。未填寫的營養素會保留為未知，不會當成 0。
            </Text>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                saving && styles.disabledButton,
              ]}
              onPress={addRecord}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>儲存飲食紀錄</Text>
              )}
            </TouchableOpacity>
              </>
            )}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>今日已記錄</Text>

          {todayRecords.length > 0 && (
            <TouchableOpacity
              onPress={clearTodayRecords}
              style={styles.clearTodayButton}
              activeOpacity={0.8}
            >
              <Text style={styles.clearTodayButtonText}>一鍵清除</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color="#28764A" />
            <Text style={styles.emptyText}>正在載入飲食紀錄…</Text>
          </View>
        ) : todayRecords.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🥗</Text>
            <Text style={styles.emptyTitle}>今天還沒有飲食紀錄</Text>
            <Text style={styles.emptyText}>
              新增第一筆紀錄，開始追蹤每日營養攝取。
            </Text>
          </View>
        ) : (
          todayRecords.map((record) => {
            const isExpanded = expandedRecordId === record.id;
            const isEditing = recordEditDraft?.id === record.id;
            const statusLabel = record.nutritionEdited
              ? "含手動修改"
              : record.nutritionStatus === "complete"
              ? "來源已查證"
              : record.nutritionStatus === "partial"
                ? "含估算/未知"
                : record.nutritionStatus === "pending_verification"
                  ? "未查證"
                  : "手動紀錄";

            return (
              <View key={record.id} style={styles.recordCard}>
                <View style={styles.recordTitleRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.recordName}>{record.name}</Text>
                    <Text style={styles.recordServing}>
                      {record.meal} · {record.compositionItems?.length
                        ? `${record.compositionItems.length} 項食物`
                        : record.serving}
                      {` · ${statusLabel}`}
                    </Text>
                  </View>
                  <View style={styles.recordMealBadge}>
                    <Text style={styles.recordMealText}>{record.meal}</Text>
                  </View>
                </View>

                {!isEditing && (
                  <View style={styles.recordSummaryRow}>
                    <View style={styles.recordNutritionSummary}>
                      <Text style={[styles.recordMacros, styles.recordNutritionValue]}>
                        熱量:{record.calories == null ? "未知" : `${formatNumber(record.calories)} kcal;    `}
                        蛋白質:{record.protein == null ? "未知" : `${formatNumber(record.protein)} g;\n`}
                        碳水:{record.carbs == null ? "未知" : `${formatNumber(record.carbs)} g;    `}
                        脂肪:{record.fat == null ? "未知" : `${formatNumber(record.fat)} g`}
                      </Text>
                    </View>
                    <View style={styles.recordActions}>
                      <TouchableOpacity
                        onPress={() =>
                          setExpandedRecordId(isExpanded ? null : record.id)
                        }
                      >
                        <Text style={styles.recordActionText}>
                          {isExpanded ? "收合" : "明細"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => beginRecordEdit(record)}>
                        <Text style={styles.recordActionText}>編輯</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteRecord(record.id)}>
                        <Text style={styles.deleteText}>刪除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {isEditing && recordEditDraft ? (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    {!recordEditDraft.compositionItems && (
                      <>
                        <Text style={styles.fieldLabel}>紀錄名稱</Text>
                        <TextInput
                          style={styles.input}
                          value={recordEditDraft.name}
                          onChangeText={(value) =>
                            setRecordEditDraft((previous) => previous
                              ? { ...previous, name: value }
                              : previous)
                          }
                        />
                      </>
                    )}
                    <Text style={styles.fieldLabel}>餐別</Text>
                    <View style={styles.mealSelector}>
                      {MEALS.map((meal) => (
                        <TouchableOpacity
                          key={meal}
                          style={[
                            styles.mealChip,
                            recordEditDraft.meal === meal && styles.mealChipActive,
                          ]}
                          onPress={() =>
                            setRecordEditDraft((previous) => previous
                              ? { ...previous, meal }
                              : previous)
                          }
                        >
                          <Text
                            style={[
                              styles.mealChipText,
                              recordEditDraft.meal === meal && styles.mealChipTextActive,
                            ]}
                          >
                            {meal}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {!recordEditDraft.compositionItems && (
                      <>
                        <Text style={styles.fieldLabel}>份量摘要</Text>
                        <TextInput
                          style={styles.input}
                          value={recordEditDraft.serving}
                          onChangeText={(value) =>
                            setRecordEditDraft((previous) => previous
                              ? { ...previous, serving: value }
                              : previous)
                          }
                        />
                      </>
                    )}

                    {recordEditDraft.compositionItems ? (
                      <View style={{ gap: 8 }}>
                        <Text style={styles.previewDescription}>
                          修改各項食物的營養數據；食物名稱、食材與重量不會改變。留空表示未知。
                        </Text>
                        {recordEditDraft.compositionItems.map((item) => {
                          const input = recordEditDraft.itemNutrients[item.item_id];
                          const weightLabel =
                            item.confirmed_weight_g != null
                              ? `${formatNumber(item.confirmed_weight_g)} g（已確認）`
                              : item.estimated_weight_g != null
                                ? `約 ${formatNumber(item.estimated_weight_g)} g（AI 估計）`
                                : "重量未知";
                          return (
                            <View key={item.item_id} style={styles.recordEditItem}>
                              <Text style={styles.recordMacros}>{item.name}</Text>
                              <Text style={styles.recordServing}>
                                {weightLabel}
                                {item.nutrients_edited
                                  ? " · 已手動修改"
                                  : item.evidence_status
                                    ? ` · ${evidenceStatusLabel(item.evidence_status)}`
                                    : ""}
                              </Text>
                              {ITEM_NUTRIENT_FIELDS.map(({ key, label }) => (
                                <View key={key}>
                                  <Text style={styles.fieldLabel}>{label}</Text>
                                  <TextInput
                                    style={styles.input}
                                    value={input?.[key] ?? ""}
                                    onChangeText={(value) =>
                                      updateRecordItemNutrient(item.item_id, key, value)
                                    }
                                    placeholder="留空表示未知"
                                    placeholderTextColor="#9AA49A"
                                    keyboardType="decimal-pad"
                                  />
                                </View>
                              ))}
                            </View>
                          );
                        })}
                        <Text style={styles.previewDescription}>
                          手動修改的數值不再視為來源查證值，會標示為「已手動修改」。
                        </Text>
                      </View>
                    ) : (
                      <View style={{ gap: 8 }}>
                        {([
                          ["熱量（kcal）", "calories"],
                          ["蛋白質（g）", "protein"],
                          ["碳水化合物（g）", "carbs"],
                          ["脂肪（g）", "fat"],
                        ] as const).map(([label, field]) => (
                          <View key={field}>
                            <Text style={styles.fieldLabel}>{label}</Text>
                            <TextInput
                              style={styles.input}
                              value={recordEditDraft[field]}
                              onChangeText={(value) =>
                                setRecordEditDraft((previous) => previous
                                  ? { ...previous, [field]: value }
                                  : previous)
                              }
                              placeholder="留空表示未知"
                              keyboardType="decimal-pad"
                            />
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={styles.recordActions}>
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => setRecordEditDraft(null)}
                        disabled={saving}
                      >
                        <Text style={styles.secondaryButtonText}>取消</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primaryButton, styles.recordSaveButton, saving && styles.disabledButton]}
                        onPress={saveRecordEdit}
                        disabled={saving}
                      >
                        <Text style={styles.primaryButtonText}>
                          {saving ? "儲存中…" : "儲存修改"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : isExpanded ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    <Text style={styles.recordServing}>包含 {record.serving}</Text>
                    {record.confirmedObjects && record.confirmedObjects.length > 0 && (
                      <Text style={styles.recordServing}>
                        物件：{record.confirmedObjects.map((item) => `${item.name} × ${item.quantity}`).join("、")}
                      </Text>
                    )}
                    {record.compositionItems?.map((item) => (
                      <View key={item.item_id} style={styles.recordDetailItem}>
                        <Text style={styles.recordMacros}>
                          {item.name}
                        </Text>
                        {(item.nutrients_edited || item.evidence_status) && (
                          <Text style={styles.recordServing}>
                            {item.nutrients_edited
                              ? "手動修改（非來源查證）"
                              : item.evidence_status === "estimated"
                                ? "AI估算（無外部查證）"
                                : item.evidence_status
                                  ? evidenceStatusLabel(item.evidence_status)
                                  : ""}
                          </Text>
                        )}
                        {item.ingredients.length > 0 && (
                          <Text style={styles.recordServing}>食材：{item.ingredients.join("、")}</Text>
                        )}
                        {item.candidate_names.length > 0 && (
                          <Text style={styles.recordServing}>待確認：{item.candidate_names.join("、")}</Text>
                        )}
                        {item.evidence_status && (
                          <Text style={styles.recordServing}>
                            熱量 {item.nutrients.energy_kcal == null ? "未知" : `${formatNumber(item.nutrients.energy_kcal)} kcal`}
                          , 蛋白質 {item.nutrients.protein_g == null ? "未知" : `${formatNumber(item.nutrients.protein_g)} g`}
                          , 碳水 {item.nutrients.carbohydrate_g == null ? "未知" : `${formatNumber(item.nutrients.carbohydrate_g)} g`}
                          , 脂肪 {item.nutrients.fat_g == null ? "未知" : `${formatNumber(item.nutrients.fat_g)} g`}
                          </Text>
                        )}
                      </View>
                    ))}
                    {record.nutritionReport && (
                      <View style={styles.recordDetailItem}>
                        {record.nutritionVerification?.sources
                          .filter((source) => source.source_url != null)
                          .map((source) => (
                            <TouchableOpacity
                              key={source.source_id}
                              onPress={() => openNutritionSource(source.source_url!)}
                            >
                              <Text style={styles.sourceLink}>{source.source_name}</Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                    )}
                  </View>
                ) : null}

                {!isEditing && (
                  <View style={styles.recordSide}>
                    <Text style={styles.recordCalories}>
                      {record.calories == null ? "未知" : formatNumber(record.calories)}
                      {record.calories != null && <Text style={styles.recordKcal}>  kcal</Text>}
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}

        <Text style={styles.footer}>
          NutriTrack · 紀錄僅供個人飲食追蹤參考
        </Text>
      </ScrollView>

      <Modal
        visible={calendarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarOpen(false)}
      >
        <Pressable
          style={styles.calendarBackdrop}
          onPress={() => setCalendarOpen(false)}
        >
          <Pressable style={styles.calendarCard} onPress={() => {}}>
            {(() => {
              const { year, month0 } = calendarCursor;
              const month = summarizeMonth(records, year, month0, dailyTargets);
              const firstWeekday = new Date(year, month0, 1).getDay();
              const cells: (DaySummary | null)[] = [
                ...Array.from({ length: firstWeekday }, () => null),
                ...month.days,
              ];
              const selected = summarizeDay(records, selectedCalendarDate, dailyTargets);
              const selectedNutrients = [
                { label: "熱量", value: selected.calories, target: dailyTargets.calories, unit: "kcal" },
                { label: "蛋白質", value: selected.protein, target: dailyTargets.protein, unit: "g" },
                { label: "碳水化合物", value: selected.carbs, target: dailyTargets.carbs, unit: "g" },
                { label: "脂肪", value: selected.fat, target: dailyTargets.fat, unit: "g" },
              ];

              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.calendarHeader}>
                    <TouchableOpacity onPress={() => shiftCalendarMonth(-1)} style={styles.calendarNav}>
                      <Text style={styles.calendarNavText}>‹</Text>
                    </TouchableOpacity>
                    <Text style={styles.calendarTitle}>
                      {year} 年 {month0 + 1} 月
                    </Text>
                    <TouchableOpacity onPress={() => shiftCalendarMonth(1)} style={styles.calendarNav}>
                      <Text style={styles.calendarNavText}>›</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.calendarSummary}>
                    本月達成 {month.achievedCount} 天 · 有紀錄 {month.loggedCount} 天
                  </Text>

                  <View style={styles.calendarRow}>
                    {WEEKDAY_LABELS.map((label) => (
                      <Text key={label} style={styles.calendarWeekday}>
                        {label}
                      </Text>
                    ))}
                  </View>

                  <View style={styles.calendarGrid}>
                    {cells.map((day, index) => {
                      if (!day) {
                        return <View key={`blank-${index}`} style={styles.calendarCell} />;
                      }
                      const dayNumber = Number(day.date.slice(8, 10));
                      const isSelected = day.date === selectedCalendarDate;
                      return (
                        <View key={day.date} style={styles.calendarCell}>
                          <Pressable
                            onPress={() => setSelectedCalendarDate(day.date)}
                            style={[
                              styles.calendarDay,
                              day.status === "achieved" && styles.calendarDayAchieved,
                              day.status === "logged" && styles.calendarDayLogged,
                              day.date === today && styles.calendarDayToday,
                              isSelected && styles.calendarDaySelected,
                              day.date > today && { opacity: 0.45 },
                            ]}
                          >
                            <Text
                              style={[
                                styles.calendarDayText,
                                day.status === "achieved" && { color: "#FFFFFF" },
                              ]}
                            >
                              {dayNumber}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>

                  <View style={styles.calendarLegend}>
                    <View style={[styles.legendSwatch, { backgroundColor: "#246B45" }]} />
                    <Text style={styles.legendText}>達成</Text>
                    <View style={[styles.legendSwatch, { backgroundColor: "#DCE8D8" }]} />
                    <Text style={styles.legendText}>已紀錄</Text>
                    <View style={[styles.legendSwatch, { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6DED3" }]} />
                    <Text style={styles.legendText}>無紀錄</Text>
                  </View>
                  <Text style={styles.calendarRule}>
                    「達成」＝ 當日熱量達到每日目標（與首頁判斷相同），以目前設定的目標計算。
                  </Text>

                  <View style={styles.calendarDetail}>
                    <Text style={styles.calendarDetailTitle}>
                      {selected.date}
                      {selected.status === "achieved"
                        ? " · 已達成"
                        : selected.status === "logged"
                          ? " · 已紀錄，未達標"
                          : " · 沒有紀錄"}
                    </Text>

                    {selected.records.length > 0 && (
                      <>
                        {selectedNutrients.map((nutrient) => {
                          const percent = Math.round((nutrient.value / nutrient.target) * 100);
                          return (
                            <View key={nutrient.label} style={styles.calendarNutrientRow}>
                              <Text style={styles.calendarNutrientLabel}>{nutrient.label}</Text>
                              <Text style={styles.calendarNutrientValue}>
                                {formatNumber(nutrient.value)} / {nutrient.target} {nutrient.unit}
                                {"  "}({percent}%)
                                {nutrient.value >= nutrient.target ? " ✓" : ""}
                              </Text>
                            </View>
                          );
                        })}
                        {selected.hasUnknown && (
                          <Text style={styles.calendarRule}>
                            部分紀錄含未知營養值，只加總已知數字。
                          </Text>
                        )}
                        {selected.records.map((record) => (
                          <Text key={record.id} style={styles.calendarRecordLine}>
                            {record.meal}・{record.name}
                            {record.calories == null ? "" : `（${formatNumber(record.calories)} kcal）`}
                          </Text>
                        ))}
                      </>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.cancelButton, { marginTop: 14 }]}
                    onPress={() => setCalendarOpen(false)}
                  >
                    <Text style={styles.cancelButtonText}>關閉</Text>
                  </TouchableOpacity>
                </ScrollView>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function NutrientCard({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: string;
}) {
  const progress = Math.min(value / target, 1);

  return (
    <View style={styles.nutrientCard}>
      <View style={[styles.nutrientDot, { backgroundColor: color }]} />
      <Text style={styles.nutrientLabel}>{label}</Text>
      <Text style={styles.nutrientValue}>
        {formatNumber(value)}
        <Text style={styles.nutrientUnit}> {unit}</Text>
      </Text>
      <View style={styles.nutrientTrack}>
        <View
          style={[
            styles.nutrientFill,
            { width: `${progress * 100}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.nutrientTarget}>目標 {target} {unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F8F4",
  },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  brand: {
    fontSize: 29,
    fontWeight: "800",
    color: "#246640",
    letterSpacing: -0.7,
  },
  subtitle: {
    color: "#788579",
    fontSize: 13,
    marginTop: 4,
  },
  dateBadge: {
    backgroundColor: "#E5EFE4",
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  dateText: {
    color: "#346747",
    fontSize: 12,
    fontWeight: "700",
  },
  calorieCard: {
    backgroundColor: "#286B47",
    borderRadius: 22,
    padding: 22,
    marginBottom: 25,
  },
  cardEyebrow: {
    color: "#D8E9D9",
    fontSize: 14,
    fontWeight: "600",
  },
  calorieRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 8,
  },
  calorieNumber: {
    color: "#FFFFFF",
    fontSize: 42,
    fontWeight: "800",
  },
  calorieUnit: {
    color: "#E1F0E2",
    fontSize: 15,
    marginLeft: 8,
  },
  mutedText: {
    color: "#D8E9D9",
    fontSize: 12,
    marginTop: 2,
  },
  pendingNutritionNotice: {
    color: "#F7E8B1",
    fontSize: 12,
    marginTop: 8,
  },
  nutritionErrorText: {
    color: "#A43D36",
    fontSize: 13,
  },
  reportNutrientHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reportNutrientLabel: {
    color: "#35443A",
    fontSize: 13,
    fontWeight: "600",
  },
  reportNutrientValue: {
    color: "#25372B",
    fontSize: 13,
    fontWeight: "700",
  },
  reportBarTrack: {
    width: "100%",
    height: 7,
    borderRadius: 4,
    backgroundColor: "#E9EEE7",
    overflow: "hidden",
  },
  reportBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  sourceLink: {
    color: "#246B45",
    fontSize: 12,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  sourceUrl: {
    color: "#68756A",
    fontSize: 10,
    marginTop: 2,
  },
  progressTrack: {
    height: 8,
    backgroundColor: "#578668",
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 18,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#E5F3C8",
    borderRadius: 10,
  },
  progressText: {
    color: "#F1F7E9",
    fontSize: 12,
    marginTop: 9,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 4,
  },
  sectionTitle: {
    color: "#25372B",
    fontSize: 18,
    fontWeight: "800",
  },
  sectionHint: {
    color: "#849084",
    fontSize: 12,
  },
  nutrientGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 26,
  },
  nutrientCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E9EEE7",
  },
  nutrientDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  nutrientLabel: {
    color: "#7C887D",
    fontSize: 11,
  },
  nutrientValue: {
    color: "#29392D",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 5,
  },
  nutrientUnit: {
    fontSize: 11,
    fontWeight: "500",
  },
  nutrientTrack: {
    height: 4,
    borderRadius: 5,
    backgroundColor: "#EDF0EB",
    overflow: "hidden",
    marginTop: 10,
  },
  nutrientFill: {
    height: "100%",
    borderRadius: 5,
  },
  nutrientTarget: {
    color: "#8B958A",
    fontSize: 10,
    marginTop: 7,
  },
  primaryButton: {
    backgroundColor: "#28764A",
    borderRadius: 14,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  panel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 17,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: "#E7ECE5",
  },
  panelTitle: {
    color: "#25372B",
    fontSize: 18,
    fontWeight: "800",
  },
  panelDescription: {
    color: "#829082",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: "#F7F9F6",
    borderWidth: 1,
    borderColor: "#EBEFE8",
    marginBottom: 9,
  },
  optionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    color: "#304334",
    fontSize: 14,
    fontWeight: "700",
  },
  optionDescription: {
    color: "#899389",
    fontSize: 11,
    marginTop: 4,
    lineHeight: 16,
  },
  optionArrow: {
    color: "#7E9380",
    fontSize: 25,
    marginLeft: 8,
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: "#7D887E",
    fontSize: 13,
    fontWeight: "600",
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cancelLink: {
    color: "#738274",
    fontSize: 12,
  },
  previewCard: {
    backgroundColor: "#F6F9F5",
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E7EEE5",
  },
  previewImage: {
    width: "100%",
    height: 190,
    borderRadius: 10,
    backgroundColor: "#E7ECE6",
  },
  previewInfo: {
    paddingTop: 10,
  },
  previewTitle: {
    color: "#354638",
    fontSize: 14,
    fontWeight: "700",
  },
  previewDescription: {
    color: "#7C897D",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  removePhotoText: {
    color: "#B45B4F",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 11,
    backgroundColor: "#E5F0E3",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#28764A",
    fontSize: 13,
    fontWeight: "800",
  },
  noticeText: {
    color: "#7C897D",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 8,
  },
  noticeSuccess: {
    color: "#28764A",
    fontSize: 12,
    marginTop: 6,
  },
  fieldLabel: {
    color: "#3D4A3E",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 13,
  },
  mealSelector: {
    flexDirection: "row",
    gap: 8,
  },
  mealChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F3F6F1",
    borderWidth: 1,
    borderColor: "#E5EBE2",
  },
  mealChipActive: {
    backgroundColor: "#E0F0E2",
    borderColor: "#70A77D",
  },
  mealChipText: {
    color: "#778378",
    fontSize: 12,
    fontWeight: "600",
  },
  mealChipTextActive: {
    color: "#286B47",
    fontWeight: "800",
  },
  input: {
    minHeight: 46,
    backgroundColor: "#FAFBF9",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E2E9E0",
    paddingHorizontal: 12,
    color: "#2D3B30",
    fontSize: 14,
  },
  formHint: {
    color: "#8A948A",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
    marginBottom: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 17,
    paddingHorizontal: 22,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: "#E9EEE7",
  },
  emptyEmoji: {
    fontSize: 32,
    marginBottom: 10,
  },
  emptyTitle: {
    color: "#394A3B",
    fontSize: 15,
    fontWeight: "700",
  },
  emptyText: {
    color: "#8A958A",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 7,
  },
  recordCard: {
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E9EEE7",
  },
  recordMain: {
    flex: 1,
    paddingRight: 10,
  },
  recordTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 7,
  },
  recordSummaryRow: {
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 6,
    marginTop: 8,
  },
  recordNutritionSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  recordNutritionValue: {
    width: "50%",
    minWidth: 0,
  },
  recordActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 14,
  },
  recordActionText: {
    color: "#246B45",
    fontSize: 12,
    fontWeight: "700",
    paddingVertical: 6,
  },
  recordDetailItem: {
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#E9EEE7",
  },
  recordEditItem: {
    gap: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: "#E2E9E0",
    borderRadius: 8,
  },
  multilineRecordInput: {
    minHeight: 52,
    textAlignVertical: "top",
  },
  recordSaveButton: {
    marginBottom: 0,
    minWidth: 110,
  },
  recordName: {
    color: "#2D3C30",
    fontSize: 15,
    fontWeight: "800",
    flexShrink: 1,
  },
  recordMealBadge: {
    backgroundColor: "#EAF2E7",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  recordMealText: {
    color: "#487451",
    fontSize: 10,
    fontWeight: "700",
  },
  recordServing: {
    color: "#899388",
    fontSize: 11,
    marginTop: 7,
  },
  recordMacros: {
    color: "#758176",
    fontSize: 10,
    lineHeight: 16,
    marginTop: 6,
  },
  recordSide: {
    alignItems: "flex-end",
  },
  recordCalories: {
    color: "#286B47",
    fontSize: 20,
    fontWeight: "800",
  },
  recordKcal: {
    color: "#929B91",
    fontSize: 10,
    marginTop: 1,
  },
  deleteButton: {
    marginTop: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  deleteText: {
    color: "#B65E53",
    fontSize: 11,
    fontWeight: "700",
  },
  footer: {
    textAlign: "center",
    color: "#A0A99F",
    fontSize: 11,
    marginTop: 28,
  },
  clearTodayButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "#FBE9E7",
    borderWidth: 1,
    borderColor: "#F2D0CB",
  },

  clearTodayButtonText: {
    color: "#B42318",
    fontSize: 12,
    fontWeight: "700",
  },
  monthStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E9E0",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
    gap: 10,
  },
  monthStripTitle: {
    color: "#286B47",
    fontSize: 14,
    fontWeight: "700",
  },
  monthStripHint: {
    color: "#8A978A",
    fontSize: 11,
    marginTop: 2,
  },
  monthDots: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 112,
    gap: 3,
    justifyContent: "flex-end",
  },
  monthDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
    backgroundColor: "#E7ECE5",
  },
  monthDotAchieved: { backgroundColor: "#246B45" },
  monthDotLogged: { backgroundColor: "#A9CDB4" },
  monthDotToday: { borderWidth: 1.5, borderColor: "#D99035" },
  calendarBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 30, 20, 0.45)",
    justifyContent: "center",
    padding: 16,
  },
  calendarCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    maxHeight: "90%",
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  calendarNav: { paddingHorizontal: 14, paddingVertical: 4 },
  calendarNavText: { fontSize: 26, color: "#246B45", fontWeight: "700" },
  calendarTitle: { fontSize: 17, fontWeight: "700", color: "#23332A" },
  calendarSummary: {
    textAlign: "center",
    color: "#5F7064",
    fontSize: 12,
    marginBottom: 10,
  },
  calendarRow: { flexDirection: "row", marginBottom: 4 },
  calendarWeekday: {
    width: "14.2857%",
    textAlign: "center",
    color: "#8A978A",
    fontSize: 12,
    fontWeight: "600",
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarCell: { width: "14.2857%", aspectRatio: 1, padding: 2 },
  calendarDay: {
    flex: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EEF2EC",
  },
  calendarDayAchieved: { backgroundColor: "#246B45", borderColor: "#246B45" },
  calendarDayLogged: { backgroundColor: "#DCE8D8", borderColor: "#DCE8D8" },
  calendarDayToday: { borderWidth: 2, borderColor: "#D99035" },
  calendarDaySelected: { borderWidth: 2, borderColor: "#3478C7" },
  calendarDayText: { fontSize: 14, color: "#334338", fontWeight: "600" },
  calendarLegend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  legendSwatch: { width: 12, height: 12, borderRadius: 4 },
  legendText: { fontSize: 12, color: "#5F7064", marginRight: 8 },
  calendarRule: {
    color: "#8A978A",
    fontSize: 11,
    textAlign: "center",
    marginTop: 6,
  },
  calendarDetail: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#F3F7F0",
    borderWidth: 1,
    borderColor: "#DCE8D8",
    gap: 6,
  },
  calendarDetailTitle: { fontSize: 14, fontWeight: "700", color: "#286B47" },
  calendarNutrientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  calendarNutrientLabel: { fontSize: 13, color: "#4A5A4E" },
  calendarNutrientValue: { fontSize: 13, color: "#23332A", fontWeight: "600" },
  calendarRecordLine: { fontSize: 12, color: "#5F7064" },
});