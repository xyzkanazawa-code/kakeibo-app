import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction, type Payslip } from './db';
import {
  Wallet,
  PlusCircle,
  History,
  Camera,
  Cloud,
  Trophy,
  Store,
  Star,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  Trash2,
  Calendar,
  QrCode,
  Edit3,
  User,
  Fingerprint,
  Lock,
  Settings,
  FileText
} from 'lucide-react';
import { TransactionModal } from './components/TransactionModal';
import { ScannerModal } from './components/ScannerModal';
import { DriveBackupModal } from './components/DriveBackupModal';
import { ShareAppModal } from './components/ShareAppModal';
import { PriceComparisonView } from './components/PriceComparisonView';
import { ShopHistoryView } from './components/ShopHistoryView';
import { OnboardingModal } from './components/OnboardingModal';
import { LockScreen } from './components/LockScreen';
import { SettingsModal } from './components/SettingsModal';
import { PayslipView } from './components/PayslipView';
import { PayslipModal } from './components/PayslipModal';
import { WalletModal } from './components/WalletModal';
import { useEffect } from 'react';
import { isAppConfigured, getAppConfig } from './utils/configStorage';

export function App() {
  const wallets = useLiveQuery(() => db.wallets.toArray());
  const transactions = useLiveQuery(() => db.transactions.toArray());
  const settings = useLiveQuery(() => db.settings.toCollection().first());

  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'prices' | 'shops' | 'payslips'>('home');
  const [isPayslipModalOpen, setIsPayslipModalOpen] = useState<boolean>(false);
  const [editingPayslip, setEditingPayslip] = useState<Payslip | null>(null);
  const [isTxModalOpen, setIsTxModalOpen] = useState<boolean>(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isScannerModalOpen, setIsScannerModalOpen] = useState<boolean>(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState<boolean>(false);
  const [selectedWalletId, setSelectedWalletId] = useState<number | null>(null);
  const [txInitialData, setTxInitialData] = useState<any>(undefined);

  // 初期登録・設定・生体認証ロックステート
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isLocked, setIsLocked] = useState<boolean>(false);

  // 初回起動時のチェック（localStorage: household_app_config）＆ 生体認証ロック
  useEffect(() => {
    const configured = isAppConfigured();
    const config = getAppConfig();
    const isBioActive = Boolean(config?.isBioAuthEnabled ?? settings?.isBioAuthEnabled);
    if (!configured) {
      setIsOnboardingOpen(true);
    } else if (isBioActive) {
      setIsLocked(true);
    }
  }, [settings?.isBioAuthEnabled]);

  // 締め日設定（デフォルト25日）
  const closingDay = settings?.closingDay || 25;
  const monthlyBudget = settings?.monthlyBudget || 150000;
  const userName = getAppConfig()?.name || settings?.userName || 'マサ';
  const isBioAuthActive = Boolean(getAppConfig()?.isBioAuthEnabled ?? settings?.isBioAuthEnabled);

  // 今月の集計（締め日基準の計算）
  const now = new Date();
  const currentDay = now.getDate();
  let periodStart = new Date(now.getFullYear(), now.getMonth(), closingDay);
  if (currentDay < closingDay) {
    periodStart = new Date(now.getFullYear(), now.getMonth() - 1, closingDay);
  }
  const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, closingDay - 1);

  const startStr = periodStart.toISOString().split('T')[0];
  const endStr = periodEnd.toISOString().split('T')[0];

  // 当期の取引
  const currentPeriodTx = (transactions || []).filter(t => t.date >= startStr && t.date <= endStr);
  const totalExpense = currentPeriodTx.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
  const totalIncome = currentPeriodTx.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
  const savings = totalIncome - totalExpense;

  // 総資産（全口座の合計残高 - Payのクレジット引落分）
  const totalBalance = (wallets || []).reduce(
    (acc, w) => acc + w.balance - (w.type === 'pay' ? Math.abs(w.creditBalance || 0) : 0),
    0
  );

  // 予算残高とペース計算
  const remainingBudget = Math.max(0, monthlyBudget - totalExpense);
  const diffTime = Math.max(1, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const dailyAllowance = Math.round(remainingBudget / diffTime);
  const budgetProgress = Math.min(100, Math.round((totalExpense / monthlyBudget) * 100));

  // 明細削除
  const handleDeleteTx = async (t: Transaction) => {
    if (!t.id || !confirm('この明細を削除しますか？残高も元に戻ります。')) return;

    // 残高ロールバック
    if (t.walletId) {
      const w = await db.wallets.get(t.walletId);
      if (w) {
        if (t.type === 'expense') {
          if (w.type === 'pay' && t.payMethod === 'credit') {
            await db.wallets.update(t.walletId, {
              creditBalance: Math.max(0, Math.abs(w.creditBalance || 0) - t.amount)
            });
          } else {
            await db.wallets.update(t.walletId, { balance: w.balance + t.amount });
          }
        }
        if (t.type === 'income') await db.wallets.update(t.walletId, { balance: w.balance - t.amount });
      }
    }
    if (t.type === 'transfer' && t.walletId && t.toWalletId) {
      const fromW = await db.wallets.get(t.walletId);
      const toW = await db.wallets.get(t.toWalletId);
      if (fromW) await db.wallets.update(t.walletId, { balance: fromW.balance + t.amount });
      if (toW) await db.wallets.update(t.toWalletId, { balance: toW.balance - t.amount });
    }

    await db.transactions.delete(t.id);
  };

  const handleOpenNewTx = () => {
    setEditingTransaction(null);
    setTxInitialData(undefined);
    setIsTxModalOpen(true);
  };

  const handleOpenEditTx = (t: Transaction) => {
    setEditingTransaction(t);
    setTxInitialData(undefined);
    setIsTxModalOpen(true);
  };

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen shadow-xl pb-24 relative flex flex-col font-sans">
      
      {/* アプリヘッダー */}
      <header className="bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 text-white p-3.5 sticky top-0 z-20 shadow-md flex justify-between items-center">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <h1 className="text-base font-black tracking-tight">超圧縮家計簿</h1>
            {/* ユーザープロフィール・生体認証設定ボタン */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1 text-[11px] bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded-full backdrop-blur-sm transition-all border border-white/25"
              title="プロフィール・生体認証設定"
            >
              <User size={11} />
              <span className="font-bold">{userName}</span>
              {isBioAuthActive && (
                <Fingerprint size={12} className="text-emerald-300 ml-0.5" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-blue-100 flex items-center gap-1">
            <Calendar size={10} /> 締め日: {closingDay}日 (期末: {periodEnd.getMonth() + 1}/{periodEnd.getDate()})
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {isBioAuthActive && (
            <button
              type="button"
              onClick={() => setIsLocked(true)}
              className="flex items-center gap-1 text-xs bg-white/15 hover:bg-white/25 p-1.5 rounded-xl backdrop-blur-sm transition-all border border-white/20"
              title="画面をロック（指紋・顔認証で解除）"
            >
              <Lock size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            className="flex items-center gap-1 text-xs bg-white/15 hover:bg-white/25 px-2.5 py-1.5 rounded-xl backdrop-blur-sm transition-all border border-white/20"
            title="スマホで開く（QRコード・URLコピー）"
          >
            <QrCode size={14} />
            <span className="font-bold text-[11px]">スマホ</span>
          </button>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1 text-xs bg-white/15 hover:bg-white/25 px-2 py-1.5 rounded-xl backdrop-blur-sm transition-all border border-white/20"
            title="設定（ユーザー情報・Gemini APIキー）"
          >
            <Settings size={14} />
            <span className="font-bold text-[11px]">設定</span>
          </button>
          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            className="flex items-center gap-1 text-xs bg-white/15 hover:bg-white/25 px-2.5 py-1.5 rounded-xl backdrop-blur-sm transition-all border border-white/20"
          >
            <Cloud size={14} />
            <span className="font-bold text-[11px]">Drive</span>
          </button>
        </div>
      </header>

      {/* メイン画面 */}
      <main className="p-4 space-y-4 flex-1">
        
        {/* === ホームタブ === */}
        {activeTab === 'home' && (
          <>
            {/* 総資産残高カード */}
            <section className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl p-5 text-white shadow-xl relative overflow-hidden">
              <div className="relative z-10 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-blue-200 text-xs font-medium">総資産（全口座）</span>
                    <h2 className="text-3xl font-black tracking-tight mt-0.5">¥{totalBalance.toLocaleString()}</h2>
                  </div>
                  <span className="text-[11px] bg-white/20 px-2.5 py-1 rounded-full backdrop-blur-sm font-bold">
                    {savings >= 0 ? `今月 ＋¥${savings.toLocaleString()}` : `今月 －¥${Math.abs(savings).toLocaleString()}`}
                  </span>
                </div>

                {/* 今月の収入・支出サマリー */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/15 text-xs">
                  <div className="bg-white/10 rounded-xl p-2 backdrop-blur-sm">
                    <span className="text-[10px] text-emerald-200 block">今期の総収入</span>
                    <span className="font-bold text-sm text-emerald-300">＋¥{totalIncome.toLocaleString()}</span>
                  </div>
                  <div className="bg-white/10 rounded-xl p-2 backdrop-blur-sm">
                    <span className="text-[10px] text-red-200 block">今期の総支出</span>
                    <span className="font-bold text-sm text-red-300">－¥{totalExpense.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="absolute right-[-20px] top-[-20px] opacity-10 pointer-events-none">
                <Wallet size={140} />
              </div>
            </section>

            {/* 予算・ペース配分メーター */}
            <section className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-gray-700">今月の残り予算</span>
                <span className="font-black text-gray-900 text-sm">¥{remainingBudget.toLocaleString()}</span>
              </div>
              
              {/* プログレスバー */}
              <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    budgetProgress > 90 ? 'bg-red-500' : budgetProgress > 70 ? 'bg-amber-500' : 'bg-blue-600'
                  }`}
                  style={{ width: `${budgetProgress}%` }}
                />
              </div>

              <div className="flex justify-between items-center text-[10px] text-gray-500">
                <span>1日あたりの使用可能目安: <strong className="text-emerald-600 font-bold text-xs">¥{dailyAllowance.toLocaleString()} /日</strong></span>
                <span>残り {diffTime} 日</span>
              </div>
            </section>

            {/* クイックアクションボタン群 */}
            <section className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsScannerModalOpen(true)}
                className="flex items-center justify-center gap-2.5 p-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-lg shadow-blue-200 active:scale-98 transition-all"
              >
                <div className="p-2 bg-white/20 rounded-xl">
                  <Camera size={20} />
                </div>
                <div className="text-left">
                  <span className="text-xs font-black block">レシート読取</span>
                  <span className="text-[9px] text-blue-100 block">超圧縮 ＆ OCR</span>
                </div>
              </button>

              <button
                type="button"
                onClick={handleOpenNewTx}
                className="flex items-center justify-center gap-2.5 p-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-2xl shadow-sm active:scale-98 transition-all"
              >
                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                  <PlusCircle size={20} />
                </div>
                <div className="text-left">
                  <span className="text-xs font-black block">手動入力</span>
                  <span className="text-[9px] text-gray-400 block">出金・入金・Pay振替</span>
                </div>
              </button>

              <button
                type="button"
                id="home-payslip-scan-btn"
                onClick={() => {
                  setEditingPayslip(null);
                  setIsPayslipModalOpen(true);
                }}
                className="col-span-2 flex items-center justify-center gap-2.5 p-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl shadow-lg shadow-emerald-200 active:scale-98 transition-all"
              >
                <div className="p-2 bg-white/20 rounded-xl">
                  <FileText size={20} />
                </div>
                <div className="text-left">
                  <span className="text-xs font-black block">給与明細読取</span>
                  <span className="text-[9px] text-emerald-100 block">支給・控除・勤怠を全項目AI抽出</span>
                </div>
              </button>
            </section>

            {/* 各口座・ウォレット残高 */}
            <section className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-700 text-xs flex items-center gap-1.5">
                  <Wallet size={15} /> 口座・Pay残高
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWalletId(null);
                    setIsWalletModalOpen(true);
                  }}
                  className="text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors"
                >
                  <Edit3 size={11} />
                  <span>残高を変更・追加</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {wallets?.map(w => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      setSelectedWalletId(w.id ?? null);
                      setIsWalletModalOpen(true);
                    }}
                    className="p-2.5 bg-gray-50 hover:bg-blue-50/60 rounded-xl border border-gray-100 hover:border-blue-300 flex flex-col justify-between text-left transition-all active:scale-98 group"
                    title="タップして残高・クレジット・名前を変更"
                  >
                    <div className="flex items-center justify-between w-full gap-1">
                      <span className="text-[11px] font-medium text-gray-600 truncate">{w.name}</span>
                      <Edit3 size={11} className="text-gray-300 group-hover:text-blue-600 shrink-0 transition-colors" />
                    </div>
                    <span className={`text-sm font-black mt-1 ${w.balance < 0 ? 'text-purple-600' : 'text-gray-900'}`}>
                      {w.type === 'pay' ? `残高 ¥${w.balance.toLocaleString()}` : `¥${w.balance.toLocaleString()}`}
                    </span>
                    {w.type === 'pay' && (
                      <span className="text-[11px] font-bold text-purple-600 mt-0.5 flex items-center justify-between w-full border-t border-gray-200/70 pt-1">
                        <span>💳 クレジット</span>
                        <span>¥{Math.abs(w.creditBalance || 0).toLocaleString()}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>

            {/* 最近の履歴（プレビュー） */}
            <section className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <h3 className="font-bold text-gray-700 text-xs flex items-center gap-1.5">
                  <History size={14} /> 最近の取引
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="text-[11px] text-blue-600 font-bold hover:underline"
                >
                  すべて見る
                </button>
              </div>

              <div className="space-y-2">
                {transactions?.slice(-4).reverse().map(t => (
                  <div
                    key={t.id}
                    onClick={() => handleOpenEditTx(t)}
                    className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/20 active:scale-[0.99] transition-all"
                  >
                    <div className="flex items-center gap-2.5 max-w-[65%]">
                      <div className={`p-2 rounded-xl text-white shrink-0 ${
                        t.type === 'expense' ? 'bg-red-500' : t.type === 'income' ? 'bg-emerald-500' : 'bg-blue-600'
                      }`}>
                        {t.type === 'expense' ? <ArrowDownLeft size={14} /> : t.type === 'income' ? <ArrowUpRight size={14} /> : <ArrowRightLeft size={14} />}
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-xs text-gray-800 truncate">
                            {t.shopName ? `${t.shopName}${t.branchName ? ` (${t.branchName})` : ''}` : t.itemName || t.category}
                          </span>
                          {t.isFavorite && <Star size={11} className="text-amber-500 fill-amber-500 shrink-0" />}
                        </div>
                        <p className="text-[10px] text-gray-400">{t.date} · {t.category}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`font-black text-xs ${
                        t.type === 'expense' ? 'text-red-500' : t.type === 'income' ? 'text-emerald-600' : 'text-blue-600'
                      }`}>
                        {t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}¥{t.amount.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditTx(t);
                        }}
                        className="text-gray-300 hover:text-blue-600 p-1 transition-colors"
                        title="編集"
                      >
                        <Edit3 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* === 履歴タブ === */}
        {activeTab === 'history' && (
          <section className="space-y-3 pb-16">
            <div className="flex justify-between items-center px-1">
              <h2 className="font-bold text-gray-800 text-sm">取引履歴一覧</h2>
              <span className="text-xs text-gray-400">{transactions?.length || 0}件</span>
            </div>

            <div className="space-y-2.5">
              {transactions?.slice().reverse().map(t => (
                <div
                  key={t.id}
                  onClick={() => handleOpenEditTx(t)}
                  className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-sm flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/20 active:scale-[0.99] transition-all"
                >
                  <div className="space-y-1 max-w-[62%]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold text-white shrink-0 ${
                        t.type === 'expense' ? 'bg-red-500' : t.type === 'income' ? 'bg-emerald-500' : 'bg-blue-600'
                      }`}>
                        {t.type === 'expense' ? '支出' : t.type === 'income' ? '収入' : '振替'}
                      </span>
                      <span className="font-bold text-xs text-gray-800 truncate">
                        {t.shopName ? `${t.shopName}${t.branchName ? ` (${t.branchName})` : ''}` : t.itemName || t.category}
                      </span>
                      {t.isFavorite && <Star size={11} className="text-amber-500 fill-amber-500 shrink-0" />}
                    </div>

                    {t.items && t.items.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {t.items.slice(0, 3).map((it, idx) => (
                          <span key={idx} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                            {it.name}{it.quantity && it.quantity > 1 ? ` ×${it.quantity}点` : ''}{it.price ? ` (¥${it.price})` : ''}
                          </span>
                        ))}
                        {t.items.length > 3 && (
                          <span className="text-[9px] text-gray-400 self-center">+{t.items.length - 3}品</span>
                        )}
                      </div>
                    ) : t.itemName ? (
                      <p className="text-[11px] text-gray-600 font-medium truncate">🛒 {t.itemName}</p>
                    ) : null}
                    
                    <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
                      <span>{t.date}</span>
                      <span>{t.category}</span>
                      {t.taxAmount && t.taxAmount > 0 ? (
                        <span className="text-gray-500 font-medium">税: ¥{t.taxAmount.toLocaleString()}</span>
                      ) : null}
                      {t.phone && <span>TEL: {t.phone}</span>}
                    </div>

                    {t.memo && <p className="text-[10px] text-gray-500 bg-gray-50 px-2 py-0.5 rounded inline-block">💬 {t.memo}</p>}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 画像サムネイル */}
                    {t.productImage && (
                      <img src={t.productImage} alt="商品" className="w-10 h-10 object-cover rounded-lg border border-gray-200 shrink-0" />
                    )}
                    {t.receiptImage && !t.productImage && (
                      <img src={t.receiptImage} alt="レシート" className="w-10 h-10 object-contain rounded-lg border border-gray-200 bg-gray-900 shrink-0" />
                    )}

                    <div className="text-right space-y-1">
                      <span className={`font-black text-sm block ${
                        t.type === 'expense' ? 'text-red-500' : t.type === 'income' ? 'text-emerald-600' : 'text-blue-600'
                      }`}>
                        {t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}¥{t.amount.toLocaleString()}
                      </span>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditTx(t);
                          }}
                          className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                          title="編集"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTx(t);
                          }}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1"
                          title="削除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* === 底値帳タブ === */}
        {activeTab === 'prices' && <PriceComparisonView />}

        {/* === 店舗タブ === */}
        {activeTab === 'shops' && <ShopHistoryView />}

        {/* === 給与明細タブ === */}
        {activeTab === 'payslips' && (
          <PayslipView
            onScan={() => {
              setEditingPayslip(null);
              setIsPayslipModalOpen(true);
            }}
            onEdit={(p) => {
              setEditingPayslip(p);
              setIsPayslipModalOpen(true);
            }}
          />
        )}

      </main>

      {/* 下部固定ナビゲーションバー */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-gray-200 flex justify-around p-2 z-30 pb-5 shadow-lg">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center p-1.5 transition-all ${activeTab === 'home' ? 'text-blue-600 font-bold scale-105' : 'text-gray-400'}`}
        >
          <Wallet size={20} />
          <span className="text-[10px] mt-0.5">ホーム</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center p-1.5 transition-all ${activeTab === 'history' ? 'text-blue-600 font-bold scale-105' : 'text-gray-400'}`}
        >
          <History size={20} />
          <span className="text-[10px] mt-0.5">履歴</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('prices')}
          className={`flex flex-col items-center p-1.5 transition-all ${activeTab === 'prices' ? 'text-amber-500 font-bold scale-105' : 'text-gray-400'}`}
        >
          <Trophy size={20} />
          <span className="text-[10px] mt-0.5">底値帳</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('shops')}
          className={`flex flex-col items-center p-1.5 transition-all ${activeTab === 'shops' ? 'text-indigo-600 font-bold scale-105' : 'text-gray-400'}`}
        >
          <Store size={20} />
          <span className="text-[10px] mt-0.5">店舗メモ</span>
        </button>

        <button
          type="button"
          id="nav-payslips"
          onClick={() => setActiveTab('payslips')}
          className={`flex flex-col items-center p-1.5 transition-all ${activeTab === 'payslips' ? 'text-emerald-600 font-bold scale-105' : 'text-gray-400'}`}
        >
          <FileText size={20} />
          <span className="text-[10px] mt-0.5">給与</span>
        </button>

        <button
          type="button"
          onClick={() => setIsBackupModalOpen(true)}
          className="flex flex-col items-center p-1.5 text-blue-600 transition-all hover:scale-105"
        >
          <Cloud size={20} />
          <span className="text-[10px] mt-0.5">Drive</span>
        </button>
      </nav>

      {/* モーダル群 */}
      <TransactionModal
        isOpen={isTxModalOpen}
        onClose={() => {
          setIsTxModalOpen(false);
          setEditingTransaction(null);
        }}
        editingTransaction={editingTransaction}
        initialData={txInitialData}
      />

      <ScannerModal
        isOpen={isScannerModalOpen}
        onClose={() => setIsScannerModalOpen(false)}
        onOpenSettings={() => {
          setIsScannerModalOpen(false);
          setIsSettingsOpen(true);
        }}
      />

      <DriveBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />

      <PayslipModal
        isOpen={isPayslipModalOpen}
        editing={editingPayslip}
        onClose={() => {
          setIsPayslipModalOpen(false);
          setEditingPayslip(null);
        }}
        onOpenSettings={() => {
          setIsPayslipModalOpen(false);
          setIsSettingsOpen(true);
        }}
      />

      <ShareAppModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
      />

      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => {
          setIsWalletModalOpen(false);
          setSelectedWalletId(null);
        }}
        wallets={wallets || []}
        selectedWalletId={selectedWalletId}
      />

      {/* 初期登録（オンボーディング）画面 */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onComplete={() => setIsOnboardingOpen(false)}
        existingSettings={settings}
      />

      {/* プロフィール・生体認証設定モーダル */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onLockScreen={() => setIsLocked(true)}
      />

      {/* セキュリティロック画面 */}
      {isLocked && (
        <LockScreen
          settings={{
            userName: userName,
            isBioAuthEnabled: isBioAuthActive,
            bioCredentialId: getAppConfig()?.bioCredentialId || settings?.bioCredentialId,
            pinCode: getAppConfig()?.pinCode || settings?.pinCode || '',
            closingDay: closingDay,
            monthlyBudget: monthlyBudget,
            isInitialized: true
          }}
          onUnlock={() => setIsLocked(false)}
        />
      )}

    </div>
  );
}

export default App;
