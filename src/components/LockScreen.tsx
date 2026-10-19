import { useState, useEffect } from 'react';
import { Fingerprint, Lock, ShieldCheck, KeyRound, AlertCircle } from 'lucide-react';
import { verifyBioAuth } from '../utils/bioAuth';
import type { UserSettings } from '../db';

interface LockScreenProps {
  settings: UserSettings;
  onUnlock: () => void;
}

export function LockScreen({ settings, onUnlock }: LockScreenProps) {
  const [pinInput, setPinInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // 初回マウント時に自動で生体認証を呼び出す
  useEffect(() => {
    if (settings.isBioAuthEnabled) {
      handleBiometricUnlock();
    }
  }, []);

  const handleBiometricUnlock = async () => {
    setIsVerifying(true);
    setErrorMsg(null);
    try {
      const res = await verifyBioAuth(settings.bioCredentialId);
      if (res.success) {
        onUnlock();
      } else {
        setErrorMsg(res.error || '生体認証が一致しませんでした');
      }
    } catch (e: any) {
      setErrorMsg(e.message || '認証エラーが発生しました');
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.pinCode && pinInput === settings.pinCode) {
      onUnlock();
    } else if (!settings.pinCode && pinInput.length === 4) {
      // PIN未設定時のフォールバック
      onUnlock();
    } else {
      setErrorMsg('暗証番号（PIN）が正しくありません');
      setPinInput('');
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-950 z-50 flex items-center justify-center p-4 backdrop-blur-xl">
      <div className="bg-white/95 backdrop-blur-md w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-white/20 text-center space-y-5 animate-in zoom-in-95 duration-200">
        
        {/* アイコン */}
        <div className="relative mx-auto w-20 h-20">
          <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-3xl flex items-center justify-center shadow-lg shadow-blue-500/30 text-white">
            <Lock size={36} />
          </div>
          <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1 rounded-full border-2 border-white shadow-xs">
            <ShieldCheck size={14} />
          </div>
        </div>

        {/* タイトル */}
        <div className="space-y-1">
          <h2 className="text-lg font-black text-gray-900">
            {settings.userName ? `${settings.userName} さんの家計簿` : '超圧縮家計簿'}
          </h2>
          <p className="text-xs text-gray-500">セキュリティロックがかかっています</p>
        </div>

        {/* 生体認証解除ボタン */}
        {settings.isBioAuthEnabled && (
          <button
            type="button"
            disabled={isVerifying}
            onClick={handleBiometricUnlock}
            className="w-full py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-300 flex items-center justify-center gap-2.5 active:scale-98 transition-all disabled:opacity-50"
          >
            <Fingerprint size={22} className="animate-pulse" />
            <span className="text-sm">
              {isVerifying ? '認証中...' : '指紋 / 顔認証で解除'}
            </span>
          </button>
        )}

        {/* PINコード入力 */}
        {settings.pinCode && (
          <form onSubmit={handlePinSubmit} className="pt-3 border-t border-gray-100 space-y-3">
            <label className="text-[11px] font-bold text-gray-500 flex items-center justify-center gap-1">
              <KeyRound size={12} /> PINコードで解除
            </label>
            <div className="flex gap-2 justify-center">
              <input
                type="password"
                maxLength={4}
                value={pinInput}
                onChange={e => setPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="4桁の暗証番号"
                className="w-40 text-center tracking-widest font-mono text-base font-bold bg-gray-50 border border-gray-200 rounded-xl py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-gray-900 text-white font-bold rounded-xl text-xs active:scale-95"
              >
                解除
              </button>
            </div>
          </form>
        )}

        {errorMsg && (
          <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl flex items-center justify-center gap-1 border border-red-200">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

      </div>
    </div>
  );
}
