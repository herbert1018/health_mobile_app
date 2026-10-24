
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { router } from 'expo-router';
import {
  getStoredApiKey,
  setStoredApiKey,
  deleteStoredApiKey,
} from '../services/gemini';
import {
  DEFAULT_DAILY_TARGETS,
  getDailyTargets,
  saveDailyTargets,
  type DailyTargets,
} from "../services/nutrition-targets";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_KEY_STORAGE = 'nutritrack_gemini_api_key';
const AUTO_CLEAR_KEY = "@NutriTrack/auto_clear_on_new_day_v1";

export default function SettingsScreen() {
  const [apiKey, setApiKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] =
  useState<DailyTargets>(DEFAULT_DAILY_TARGETS);
  const [autoClearRecords, setAutoClearRecords] = useState(false);
  const [autoClearSaving, setAutoClearSaving] = useState(false);

  const [targetInputs, setTargetInputs] = useState({
    calories: String(DEFAULT_DAILY_TARGETS.calories),
    protein: String(DEFAULT_DAILY_TARGETS.protein),
    carbs: String(DEFAULT_DAILY_TARGETS.carbs),
    fat: String(DEFAULT_DAILY_TARGETS.fat),
  });

  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetsSaving, setTargetsSaving] = useState(false);

  useEffect(() => {
    async function loadSettings() {
        try {
        const [savedKey, savedTargets, savedAutoClear] = await Promise.all([
          getStoredApiKey(),
          getDailyTargets(),
          AsyncStorage.getItem(AUTO_CLEAR_KEY),
        ]);

        setAutoClearRecords(savedAutoClear === "true");

        setHasSavedKey(Boolean(savedKey));
        setTargets(savedTargets);

        setTargetInputs({
            calories: String(savedTargets.calories),
            protein: String(savedTargets.protein),
            carbs: String(savedTargets.carbs),
            fat: String(savedTargets.fat),
        });
        } catch (error) {
        console.error("載入設定失敗：", error);
        Alert.alert("讀取失敗", "無法讀取設定資料，請稍後再試。");
        } finally {
        setLoading(false);
        setTargetsLoading(false);
        }
    }

    loadSettings();
    }, []);

  async function saveKey() {
    const value = apiKey.trim();

    if (!value) {
      Alert.alert('尚未輸入', '請先輸入 Gemini API Key。');
      return;
    }

    setSaving(true);

    try {
      await setStoredApiKey(value);
      setHasSavedKey(true);
      setApiKey('');
      setShowKey(false);

      Alert.alert('儲存成功', 'API Key 已安全儲存在此裝置。');
    } catch {
      Alert.alert('儲存失敗', '無法安全儲存 API Key，請稍後再試。');
    } finally {
      setSaving(false);
    }
  }
  async function saveTargets() {
    const values = {
        calories: Number(targetInputs.calories.trim()),
        protein: Number(targetInputs.protein.trim()),
        carbs: Number(targetInputs.carbs.trim()),
        fat: Number(targetInputs.fat.trim()),
    };

    const rawValues = [
        targetInputs.calories,
        targetInputs.protein,
        targetInputs.carbs,
        targetInputs.fat,
    ];

    if (
        rawValues.some((value) => value.trim() === "") ||
        Object.values(values).some(
        (value) => !Number.isFinite(value) || value <= 0
        )
    ) {
        Alert.alert(
        "目標數值不正確",
        "請將四項目標都填寫為大於 0 的有效數字。"
        );
        return;
    }

    setTargetsSaving(true);

    try {
        await saveDailyTargets(values);

        setTargets(values);
        setTargetInputs({
        calories: String(values.calories),
        protein: String(values.protein),
        carbs: String(values.carbs),
        fat: String(values.fat),
        });

        Alert.alert("儲存成功", "每日營養目標已更新。");
    } catch (error) {
        console.error("儲存每日營養目標失敗：", error);
        Alert.alert("儲存失敗", "無法儲存每日營養目標，請稍後再試。");
    } finally {
        setTargetsSaving(false);
    }
    }

  async function deleteKey() {
    Alert.alert(
      '刪除 API Key',
      '刪除後，使用 AI 辨識前需要重新輸入金鑰。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStoredApiKey();
              setApiKey('');
              setHasSavedKey(false);
              setShowKey(false);
              Alert.alert('已刪除', '本機儲存的 API Key 已刪除。');
            } catch {
              Alert.alert('刪除失敗', '請稍後再試。');
            }
          },
        },
      ],
    );
  }
  async function toggleAutoClearRecords(enabled: boolean) {
    setAutoClearSaving(true);

    try {
      await AsyncStorage.setItem(
        AUTO_CLEAR_KEY,
        enabled ? "true" : "false"
      );

      setAutoClearRecords(enabled);
    } catch (error) {
      console.error("儲存自動清除設定失敗：", error);

      Alert.alert(
        "設定失敗",
        "無法儲存自動清除設定，請稍後再試。"
      );
    } finally {
      setAutoClearSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'AI 與 API 設定' }} />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
        {/* 頂部留白 */}
        <View style={{ height: 40 }} />
          
        <View style={styles.titleRow}>
        <Text style={styles.title}>Gemini API 設定</Text>

        <Pressable
            onPress={() => router.replace('/')}
            style={styles.backButton}
        >
            <Text style={styles.backButtonText}>← 返回首頁</Text>
        </Pressable>
        </View>

          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>目前狀態</Text>
            <Text style={styles.statusValue}>
              {loading
                ? '讀取中…'
                : hasSavedKey
                  ? '已儲存 API Key'
                  : '尚未設定 API Key'}
            </Text>
          </View>

          <Text style={styles.label}>API Key</Text>

          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={
              hasSavedKey
                ? '輸入新金鑰以取代現有金鑰'
                : '貼上你的 Gemini API Key'
            }
            placeholderTextColor="#8A8F98"
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.input}
            editable={!loading && !saving}
          />

          <Pressable
            style={styles.secondaryButton}
            onPress={() => setShowKey((previous) => !previous)}
          >
            <Text style={styles.secondaryButtonText}>
              {showKey ? '隱藏金鑰' : '顯示金鑰'}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.primaryButton,
              (loading || saving) && styles.disabledButton,
            ]}
            disabled={loading || saving}
            onPress={saveKey}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? '儲存中…' : '儲存 API Key'}
            </Text>
          </Pressable>

          {hasSavedKey && (
            <Pressable
              style={styles.deleteButton}
              onPress={deleteKey}
            >
              <Text style={styles.deleteButtonText}>
                刪除已儲存的 API Key
              </Text>
            </Pressable>
          )}

            <View style={styles.targetCard}>
            <View style={styles.autoClearCard}>
              <View style={styles.autoClearHeader}>
                <View style={styles.autoClearTextContainer}>
                  <Text style={styles.targetTitle}>換日自動清除紀錄</Text>

                  <Text style={styles.targetDescription}>
                    開啟後，當日期改變且下次開啟時，
                    會自動清除舊日期的所有飲食紀錄。
                  </Text>
                </View>

                <Switch
                  value={autoClearRecords}
                  onValueChange={toggleAutoClearRecords}
                  disabled={loading || autoClearSaving}
                  trackColor={{
                    false: "#D8DDE5",
                    true: "#A6D4B5",
                  }}
                  thumbColor={autoClearRecords ? "#28764A" : "#F4F4F4"}
                />
              </View>

              <Text style={styles.autoClearWarning}>
                注意：舊日期的紀錄也會被刪除，但不會清除 API Key 或每日營養目標。
              </Text>

              {autoClearSaving && (
                <Text style={styles.autoClearSavingText}>正在儲存設定…</Text>
              )}
            </View>
            <View style={{ height: 40 }} />
            <Text style={styles.targetTitle}>每日營養目標</Text>

            <Text style={styles.targetDescription}>
                自訂儲存後會套用到首頁與 AI 營養報告。
            </Text>

            {targetsLoading ? (
                <ActivityIndicator color="#347A61" />
            ) : (
                <>
                {([
                    ["calories", "每日熱量", "kcal"],
                    ["protein", "蛋白質", "g"],
                    ["carbs", "碳水化合物", "g"],
                    ["fat", "脂肪", "g"],
                ] as const).map(([key, label, unit]) => (
                    <View key={key} style={styles.targetRow}>
                    <Text style={styles.targetLabel}>{label}</Text>

                    <View style={styles.targetInputWrapper}>
                        <TextInput
                        style={styles.targetInput}
                        value={targetInputs[key]}
                        onChangeText={(value) =>
                            setTargetInputs((previous) => ({
                            ...previous,
                            [key]: value,
                            }))
                        }
                        keyboardType="decimal-pad"
                        placeholder="輸入目標"
                        selectTextOnFocus
                        />

                        <Text style={styles.targetUnit}>{unit}</Text>
                    </View>
                    </View>
                ))}

                <Pressable
                    style={[
                    styles.primaryButton,
                    targetsSaving && styles.disabledButton,
                    ]}
                    disabled={targetsSaving}
                    onPress={saveTargets}
                >
                    <Text style={styles.primaryButtonText}>
                    {targetsSaving ? "儲存中…" : "儲存營養目標"}
                    </Text>
                </Pressable>
                </>
            )}
            </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
    
    titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    },
    backButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#E8F3EC',
    },
    backButtonText: {
    color: '#246B45',
    fontSize: 13,
    fontWeight: '600',
    },

  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },
  content: {
    padding: 22,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#20252D',
    marginBottom: 10,
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    color: '#626B78',
    marginBottom: 24,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E8ED',
  },
  statusLabel: {
    fontSize: 13,
    color: '#737B87',
    marginBottom: 6,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#246B50',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#303743',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8DDE5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#20252D',
  },
  secondaryButton: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: '#536C9A',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#347A61',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.55,
  },
  deleteButton: {
    alignItems: 'center',
    padding: 15,
    marginTop: 8,
  },
  deleteButtonText: {
    color: '#B42318',
    fontSize: 14,
  },
  notice: {
    backgroundColor: '#EEF2F6',
    borderRadius: 10,
    padding: 14,
    marginTop: 24,
  },
  noticeTitle: {
    fontWeight: '600',
    fontSize: 14,
    color: '#303743',
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#626B78',
  },
  targetCard: {
  backgroundColor: "#FFFFFF",
  borderRadius: 12,
  padding: 16,
  marginTop: 24,
  borderWidth: 1,
  borderColor: "#E5E8ED",
    },
    targetTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#20252D",
    },
    targetDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: "#626B78",
    marginTop: 6,
    marginBottom: 16,
    },
    targetRow: {
    marginBottom: 14,
    },
    targetLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#303743",
    marginBottom: 7,
    },
    targetInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    },
    targetInput: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8DDE5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#20252D",
    },
    targetUnit: {
    width: 48,
    marginLeft: 10,
    fontSize: 14,
    color: "#626B78",
    },
    autoClearCard: {
      backgroundColor: "#FFFFFF",
      borderRadius: 12,
      padding: 16,
      marginTop: 24,
      borderWidth: 1,
      borderColor: "#E5E8ED",
    },

    autoClearHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    autoClearTextContainer: {
      flex: 1,
    },

    autoClearWarning: {
      fontSize: 12,
      lineHeight: 18,
      color: "#B42318",
      marginTop: 12,
    },

    autoClearSavingText: {
      fontSize: 12,
      color: "#626B78",
      marginTop: 8,
    },
});
