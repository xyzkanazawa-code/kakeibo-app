import { useState, useEffect } from 'react';
import {
  Sparkles,
  User,
  Calendar,
  KeyRound,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldCheck,
  ArrowRight,
  Fingerprint
} from 'lucide-react';
import { db, type UserSettings } from '../db';
import { getAppConfig, saveAppConfig, type HouseholdAppConfig } from '../utils/configStorage';
import { isBioAuthSupported, registerBioAuth } from '../utils/bioAuth';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
  existingSettings?: UserSettings | null;
}

export function OnboardingModal({ isOpen, onComplete, existingSettings }: OnboardingModalProps) {
  const [name, setName] = useState<string>('マサ');
  const [birthdate, setBirthdate] = useState<string>('1990-01-01');
  const [userId, setUserId] = useState<string>('masa_user');
  const [password, setPassword] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // 生体認証ステート
  const [isBioSupported, setIsBioSupported] = useState<boolean>(false);
  const [isBioEnabled, setIsBioEnabled] = useState<boolean>(false);
  const [bioCredId, setBioCredId] = useState<string | undefined>(undefined);
  const [isRegisteringBio, setIsRegisteringBio] = useState<boolean>(false);
  const [bioMsg, setBioMsg] = useState<string | null>(null);

  // 家計簿初期設定
  const [closingDay, setClosingDay] = useState<number>(25);
  const [monthlyBudget, setMonthlyBudget] = useState<number>(150000);

  useEffect(() => {
    isBioAuthSupported().then(setIsBioSupported);
  }, []);

  useEffect(() => {
    const config = getAppConfig();
    if (config) {
      if (config.name) setName(config.name);
      if (config.birthdate) setBirthdate(config.birthdate);
      if (config.userId) setUserId(config.userId);
      if (config.password) setPassword(config.password);
      if (config.geminiApiKey) setGeminiApiKey(config.geminiApiKey);
    } else if (existingSettings?.userName) {
      setName(existingSettings.userName);
      if (existingSettings.birthDate) setBirthdate(existingSettings.birthDate);
    }
  }, [existingSettings]);

  if (!isOpen) return null;

  // 生体認証登録
  const handleRegisterBio = async () => {
    setIsRegisteringBio(true);
    setBioMsg(null);
    try {
      const res = await registerBioAuth(name || 'マサ');
      if (res.success && res.credentialId) {
        setIsBioEnabled(true);
        setBioCredId(res.credentialId);
        setBioMsg('✅ 指紋・顔認証を登録しました！起動時ロックが有効になります。');
      } else {
        setBioMsg(res.error || '登録できませんでした');
      }
    } catch (e: any) {
      setBioMsg(e.message || 'エラーが発生しました');
    } finally {
      setIsRegisteringBio(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('氏名を入力してください');
      return;
    }

    const userIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (!userId.trim() || !userIdRegex.test(userId.trim())) {
      alert('ユーザーIDは半角英数字で入力してください。');
      return;
    }

    // 1. localStorage (household_app_config) に保存
    const config: HouseholdAppConfig = {
      name: name.trim(),
      birthdate: birthdate.trim(),
      userId: userId.trim(),
      password: password,
      geminiApiKey: geminiApiKey.trim(),
      isBioAuthEnabled: isBioEnabled,
      bioCredentialId: bioCredId,
      pinCode: ''
    };
    saveAppConfig(config);

    // 2. Dexie DBに同期保存
    const settingsData: Partial<UserSettings> = {
      userName: config.name,
      birthDate: config.birthdate,
      closingDay: Number(closingDay) || 25,
      monthlyBudget: Number(monthlyBudget) || 150000,
      isBioAuthEnabled: isBioEnabled,
      bioCredentialId: bioCredId,
      pinCode: '',
      isInitialized: true
    };

    if (existingSettings?.id) {
      await db.settings.update(existingSettings.id, settingsData);
    } else {
      await db.settings.add(settingsData as UserSettings);
    }

    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-blue-900/90 via-indigo-950/95 to-slate-950 z-50 flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
        
        {/* ヘッダーバナー */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 text-white text-center relative overflow-hidden">
          <div className="relative z-10 space-y-1.5">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-2 backdrop-blur-md shadow-inner border border-white/30">
              <Sparkles size={28} className="text-yellow-300" />
            </div>
            <h2 className="text-xl font-black tracking-tight">初期設定（はじめに）</h2>
            <p className="text-xs text-blue-100 font-medium">
              端末ローカル（localStorage）で完結し、安全に保存されます
            </p>
          </div>
          {/* 背景の装飾光 */}
          <div className="absolute -top-10 -right-10 w-36 h-36 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-purple-400/20 rounded-full blur-xl pointer-events-none" />
        </div>

        {/* 登録フォーム */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-left">
          
          {/* 1. 氏名 */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
              <User size={14} className="text-blue-600" />
              <span>氏名・お名前</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="例: マサ"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>

          {/* 2. 生年月日 */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
              <Calendar size={14} className="text-blue-600" />
              <span>生年月日</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={birthdate}
              onChange={e => setBirthdate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>

          {/* 3. ユーザーID */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-blue-600" />
                <span>ユーザーID</span>
                <span className="text-red-500">*</span>
              </span>
              <span className="text-[10px] text-gray-400">半角英数字</span>
            </label>
            <input
              type="text"
              required
              pattern="[a-zA-Z0-9_-]+"
              placeholder="例: masa123"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>

          {/* 4. パスワード */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <KeyRound size={14} className="text-blue-600" />
                <span>パスワード</span>
              </span>
              <span className="text-[10px] text-gray-400">ローカル保存</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="パスワードを入力"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-3.5 pr-10 py-2.5 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1"
                title={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* 5. Gemini APIキー */}
          <div className="p-3.5 bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50 rounded-2xl border border-indigo-100 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Sparkles size={14} className="text-indigo-600" />
                <span>Gemini APIキー (無料枠対応)</span>
              </label>
              <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                AQ... / AIza... 対応
              </span>
            </div>

            <p className="text-[11px] text-gray-600 leading-snug">
              レシート画像を「gemini-1.5-flash」で高精度AI解析するために使用します（最新のAQから始まるキーにも対応しています）。
            </p>

            <input
              type="text"
              placeholder="AQ... または AIza..."
              value={geminiApiKey}
              onChange={e => setGeminiApiKey(e.target.value)}
              className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs font-mono font-medium text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />

            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline pt-0.5"
            >
              <span>Google AI Studio で無料APIキーを取得する</span>
              <ExternalLink size={12} />
            </a>
          </div>

          {/* 6. 指紋認証・顔認証セキュリティ（スマホ対応） */}
          <div className="p-3.5 bg-gradient-to-br from-indigo-50/80 via-blue-50/60 to-purple-50/80 rounded-2xl border border-indigo-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                  <Fingerprint size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-gray-900">指紋認証 ＆ 顔認証</span>
                    {isBioSupported ? (
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full">
                        スマホ対応
                      </span>
                    ) : (
                      <span className="text-[9px] bg-gray-200 text-gray-600 font-bold px-1.5 py-0.2 rounded-full">
                        非対応
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 block">Touch ID / Face ID / 指紋センサー</span>
                </div>
              </div>

              <button
                type="button"
                disabled={isRegisteringBio || !isBioSupported}
                onClick={handleRegisterBio}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isBioEnabled
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isBioSupported
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isBioEnabled ? '登録済 ✓' : '登録する'}
              </button>
            </div>

            <p className="text-[10px] text-gray-500 leading-relaxed">
              スマホの生体認証（指紋や顔）を使って、起動時に安全にアプリをロック解除できます（スキップして後から設定も可能です）。
            </p>

            {bioMsg && (
              <div className="text-[11px] p-2 bg-white rounded-xl border border-indigo-200 text-indigo-900 font-bold">
                {bioMsg}
              </div>
            )}
          </div>

          {/* 締め日・予算目安 */}
          <div className="grid grid-cols-2 gap-2 pt-1">
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
              <label className="text-[11px] font-bold text-gray-600 mb-1 block">月間予算目安</label>
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

          {/* 登録完了ボタン */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold rounded-2xl shadow-lg shadow-indigo-300 text-sm active:scale-98 transition-all flex items-center justify-center gap-2"
            >
              <span>設定を完了してアプリを始める</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
