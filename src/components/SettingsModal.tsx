import { useState, useEffect } from 'react';
import {
  X,
  User,
  Calendar,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  ExternalLink,
  CheckCircle,
  Fingerprint,
  Save
} from 'lucide-react';
import { db, type UserSettings } from '../db';
import { getAppConfig, saveAppConfig, type HouseholdAppConfig } from '../utils/configStorage';
import { registerBioAuth, verifyBioAuth, isBioAuthSupported } from '../utils/bioAuth';
import { testGeminiApiKey } from '../utils/geminiOcr';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings?: UserSettings | null;
  onLockScreen?: () => void;
  onSaved?: (config: HouseholdAppConfig) => void;
}

export function SettingsModal({ isOpen, onClose, settings, onLockScreen, onSaved }: SettingsModalProps) {
  // household_app_config 項目
  const [name, setName] = useState<string>('マサ');
  const [birthdate, setBirthdate] = useState<string>('1985-01-01');
  const [userId, setUserId] = useState<string>('masa_user');
  const [password, setPassword] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // 追加設定項目（家計簿用）
  const [closingDay, setClosingDay] = useState<number>(25);
  const [monthlyBudget, setMonthlyBudget] = useState<number>(150000);
  const [pinCode, setPinCode] = useState<string>('');
  const [isBioEnabled, setIsBioEnabled] = useState<boolean>(false);
  const [bioCredId, setBioCredId] = useState<string | undefined>(undefined);
  const [isBioSupported, setIsBioSupported] = useState<boolean>(true);
  const [isRegisteringBio, setIsRegisteringBio] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isTestingApiKey, setIsTestingApiKey] = useState<boolean>(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestApiKey = async () => {
    if (!geminiApiKey.trim()) {
      setApiKeyTestResult({ success: false, message: 'APIキーを入力してください。' });
      return;
    }
    setIsTestingApiKey(true);
    setApiKeyTestResult(null);
    try {
      const res = await testGeminiApiKey(geminiApiKey.trim());
      setApiKeyTestResult(res);
    } catch (err: any) {
      setApiKeyTestResult({ success: false, message: err?.message || 'テスト中にエラーが発生しました。' });
    } finally {
      setIsTestingApiKey(false);
    }
  };

  useEffect(() => {
    isBioAuthSupported().then(setIsBioSupported);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const config = getAppConfig();
      if (config) {
        setName(config.name || 'マサ');
        setBirthdate(config.birthdate || '1985-01-01');
        setUserId(config.userId || '');
        setPassword(config.password || '');
        setGeminiApiKey(config.geminiApiKey || '');
      } else if (settings?.userName) {
        setName(settings.userName);
        if (settings.birthDate) setBirthdate(settings.birthDate);
      }

      if (settings) {
        setClosingDay(settings.closingDay || 25);
        setMonthlyBudget(settings.monthlyBudget || 150000);
        setPinCode(settings.pinCode || '');
        setIsBioEnabled(!!settings.isBioAuthEnabled);
      }
      setSaveSuccessMsg(null);
      setStatusMsg(null);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  // 生体認証の登録・テスト
  const handleToggleBio = async () => {
    if (isBioEnabled) {
      setIsBioEnabled(false);
      setStatusMsg('生体認証を無効にしました');
      return;
    }

    setIsRegisteringBio(true);
    setStatusMsg(null);
    try {
      const res = await registerBioAuth(name || 'マサ');
      if (res.success && res.credentialId) {
        setIsBioEnabled(true);
        setBioCredId(res.credentialId);
        if (settings?.id) {
          await db.settings.update(settings.id, {
            isBioAuthEnabled: true,
            bioCredentialId: res.credentialId
          });
        }
        setStatusMsg('✅ 指紋・顔認証を登録しました！次回起動時から使用できます。');
      } else {
        setStatusMsg(res.error || '登録できませんでした');
      }
    } catch (e: any) {
      setStatusMsg(e.message || 'エラーが発生しました');
    } finally {
      setIsRegisteringBio(false);
    }
  };

  const handleTestBio = async () => {
    setStatusMsg('生体認証をテスト中...');
    const credToUse = bioCredId || settings?.bioCredentialId;
    const res = await verifyBioAuth(credToUse);
    if (res.success) {
      setStatusMsg('✅ 生体認証の照合に成功しました！');
    } else {
      setStatusMsg(`❌ 照合失敗: ${res.error}`);
    }
  };

  // 設定保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // ユーザーIDは半角英数字チェック
    const userIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (userId.trim() && !userIdRegex.test(userId.trim())) {
      alert('ユーザーIDは半角英数字（ハイフン、アンダースコア含む）で入力してください。');
      return;
    }

    const config: HouseholdAppConfig = {
      name: name.trim(),
      birthdate: birthdate.trim(),
      userId: userId.trim(),
      password: password,
      geminiApiKey: geminiApiKey.trim(),
      isBioAuthEnabled: isBioEnabled,
      bioCredentialId: bioCredId || settings?.bioCredentialId,
      pinCode: pinCode.trim()
    };

    // 1. localStorage に保存 (キー: household_app_config)
    saveAppConfig(config);

    // 2. Dexie の設定テーブルにも同期
    if (settings?.id) {
      await db.settings.update(settings.id, {
        userName: config.name,
        birthDate: config.birthdate,
        closingDay: Number(closingDay) || 25,
        monthlyBudget: Number(monthlyBudget) || 150000,
        isBioAuthEnabled: isBioEnabled,
        pinCode: pinCode.trim(),
        isInitialized: true
      });
    } else {
      await db.settings.add({
        userName: config.name,
        birthDate: config.birthdate,
        closingDay: Number(closingDay) || 25,
        monthlyBudget: Number(monthlyBudget) || 150000,
        isBioAuthEnabled: isBioEnabled,
        pinCode: pinCode.trim(),
        isInitialized: true
      });
    }

    if (onSaved) {
      onSaved(config);
    }

    setSaveSuccessMsg('設定をローカルに保存しました！');
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        
        {/* ヘッダー */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <User size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">初期設定・アプリ環境設定</h3>
              <p className="text-[10px] text-blue-200">localStorage (household_app_config) 完結</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* コンテンツ */}
        <form onSubmit={handleSave} className="p-4 space-y-4 overflow-y-auto flex-1 text-left pb-10">
          
          {saveSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              <span className="font-bold">{saveSuccessMsg}</span>
            </div>
          )}

          {/* セクションA: 基本ユーザー設定 */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <User size={14} className="text-blue-600" /> ユーザー基本情報
              </span>
              <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-700 font-semibold rounded-md">端末ローカル保存</span>
            </div>

            {/* 1. 氏名 */}
            <div>
              <label className="text-[11px] font-bold text-gray-700 mb-1 flex items-center justify-between">
                <span>氏名 <span className="text-red-500">*</span></span>
                <span className="text-[10px] text-gray-400">表示名・ニックネーム</span>
              </label>
              <input
                type="text"
                required
                placeholder="例: マサ"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            {/* 2. 生年月日 */}
            <div>
              <label className="text-[11px] font-bold text-gray-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Calendar size={12} className="text-gray-500" /> 生年月日 <span className="text-red-500">*</span>
                </span>
                <span className="text-[10px] text-gray-400">YYYY-MM-DD</span>
              </label>
              <input
                type="date"
                required
                value={birthdate}
                onChange={e => setBirthdate(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            {/* 3. ユーザーID */}
            <div>
              <label className="text-[11px] font-bold text-gray-700 mb-1 flex items-center justify-between">
                <span>ユーザーID <span className="text-red-500">*</span></span>
                <span className="text-[10px] text-gray-400">半角英数字</span>
              </label>
              <input
                type="text"
                required
                pattern="[a-zA-Z0-9_-]+"
                placeholder="例: masa123"
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            {/* 4. パスワード (表示切替付き) */}
            <div>
              <label className="text-[11px] font-bold text-gray-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <KeyRound size={12} className="text-gray-500" /> パスワード
                </span>
                <span className="text-[10px] text-gray-400">ローカル保存用</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="パスワードを入力"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-3 pr-10 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1"
                  title={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* セクションB: Gemini APIキー設定 */}
          <div className="p-3.5 bg-gradient-to-br from-indigo-50/80 via-purple-50/60 to-blue-50/80 rounded-2xl border border-indigo-100 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Sparkles size={14} className="text-indigo-600" />
                <span>Gemini APIキー</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                  AQ... / AIza... 対応
                </span>
                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                  無料枠OK
                </span>
              </div>
            </div>

            <p className="text-[11px] text-gray-600 leading-relaxed">
              レシートのAI解析（購入日・店名・品目・合計の自動抽出）に使用します。Google AI Studioの最新キー（AQ...）と従来のキー（AIza...）のどちらにも完全対応しています。
            </p>

            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="AQ... または AIza..."
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                  className="flex-1 bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs font-mono font-medium text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
                <button
                  type="button"
                  onClick={handleTestApiKey}
                  disabled={isTestingApiKey || !geminiApiKey.trim()}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shrink-0 shadow-xs active:scale-95 transition-all"
                >
                  {isTestingApiKey ? 'テスト中...' : '接続テスト'}
                </button>
              </div>

              {apiKeyTestResult && (
                <div
                  className={`p-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 ${
                    apiKeyTestResult.success
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {apiKeyTestResult.success ? <CheckCircle size={13} className="shrink-0" /> : <X size={13} className="shrink-0" />}
                  <span>{apiKeyTestResult.message}</span>
                </div>
              )}
            </div>

            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline pt-0.5"
            >
              <span>Google AI Studio で無料APIキーを取得する</span>
              <ExternalLink size={12} />
            </a>
          </div>

          {/* セクションC: 家計簿設定（締め日・予算） */}
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <span className="text-xs font-bold text-gray-700 block">家計簿・予算設定</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-gray-600 mb-1 block">毎月の締め日</label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={closingDay}
                    onChange={e => setClosingDay(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none"
                  />
                  <span className="absolute right-3 top-2 text-xs text-gray-400">日</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-600 mb-1 block">毎月の予算目安</label>
                <div className="relative">
                  <input
                    type="number"
                    step="10000"
                    value={monthlyBudget}
                    onChange={e => setMonthlyBudget(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none"
                  />
                  <span className="absolute right-3 top-2 text-xs text-gray-400">円</span>
                </div>
              </div>
            </div>
          </div>

          {/* セクションD: 生体認証セキュリティ */}
          <div className="bg-gradient-to-br from-indigo-50/70 to-blue-50/70 p-3.5 rounded-2xl border border-indigo-200 space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                  <Fingerprint size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-bold text-gray-900">指紋認証 ＆ 顔認証</h4>
                    {isBioSupported ? (
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full">
                        スマホ対応
                      </span>
                    ) : (
                      <span className="text-[9px] bg-gray-200 text-gray-600 font-bold px-1.5 py-0.2 rounded-full">
                        非対応端末
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500">Touch ID / Face ID / 指紋センサー</p>
                </div>
              </div>

              <button
                type="button"
                disabled={isRegisteringBio || !isBioSupported}
                onClick={handleToggleBio}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isBioEnabled
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isBioSupported
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isBioEnabled ? '有効 (登録済)' : '登録する'}
              </button>
            </div>

            <p className="text-[10px] text-gray-500 leading-snug">
              スマホの指紋認証や顔認証を使ってアプリの起動ロックを解除できます。
            </p>

            {isBioEnabled && (
              <div className="flex gap-2 pt-1 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleTestBio}
                  className="flex-1 py-1.5 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition-all"
                >
                  生体認証テスト
                </button>
                {onLockScreen && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLockScreen();
                    }}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    <Lock size={12} />
                    <span>画面ロック</span>
                  </button>
                )}
              </div>
            )}

            {/* 予備PIN */}
            <div className="pt-1 border-t border-gray-200">
              <label className="text-[11px] font-bold text-gray-600 mb-1 flex items-center justify-between">
                <span>予備暗証番号 (4桁PIN)</span>
                <span className="text-[10px] text-gray-400">数字のみ</span>
              </label>
              <input
                type="password"
                maxLength={4}
                value={pinCode}
                onChange={e => setPinCode(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="4桁の数字"
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none font-mono tracking-widest"
              />
            </div>

            {statusMsg && (
              <div className="text-xs text-blue-900 bg-blue-50 p-2 rounded-xl border border-blue-200">
                {statusMsg}
              </div>
            )}
          </div>

          {/* 保存ボタン */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 text-sm active:scale-98 transition-all flex items-center justify-center gap-2"
            >
              <Save size={16} />
              <span>設定を保存する</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
