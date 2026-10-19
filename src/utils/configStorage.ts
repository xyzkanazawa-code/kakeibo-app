export interface HouseholdAppConfig {
  name: string;
  birthdate: string;
  userId: string;
  password: string;
  geminiApiKey: string;
  isBioAuthEnabled?: boolean;
  bioCredentialId?: string;
  pinCode?: string;
}

export const STORAGE_KEY_CONFIG = 'household_app_config';

/**
 * localStorageから設定を取得
 */
export function getAppConfig(): HouseholdAppConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        name: parsed.name || '',
        birthdate: parsed.birthdate || '',
        userId: parsed.userId || '',
        password: parsed.password || '',
        geminiApiKey: parsed.geminiApiKey || '',
        isBioAuthEnabled: Boolean(parsed.isBioAuthEnabled),
        bioCredentialId: parsed.bioCredentialId || undefined,
        pinCode: parsed.pinCode || undefined
      };
    }
  } catch (err) {
    console.error('設定の読み込みに失敗しました:', err);
  }
  return null;
}

/**
 * localStorageに設定を保存
 */
export function saveAppConfig(config: HouseholdAppConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
  } catch (err) {
    console.error('設定の保存に失敗しました:', err);
  }
}

/**
 * 初期設定が完了しているか判定
 */
export function isAppConfigured(): boolean {
  const config = getAppConfig();
  if (!config) return false;
  // 必須項目が存在するか確認
  return Boolean(config.name.trim() && config.userId.trim());
}
