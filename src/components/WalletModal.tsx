import { useState, useEffect, useRef } from 'react';
import { X, Wallet as WalletIcon, CheckCircle, Plus, Trash2, Save, CreditCard } from 'lucide-react';
import { db, type Wallet } from '../db';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallets: Wallet[];
  selectedWalletId?: number | null;
}

const WALLET_TYPE_LABELS: Record<Wallet['type'], { label: string; badgeClass: string; defaultColor: string }> = {
  cash: { label: '現金', badgeClass: 'bg-emerald-100 text-emerald-700', defaultColor: '#10B981' },
  pay: { label: 'スマホ決済・Pay', badgeClass: 'bg-red-100 text-red-700', defaultColor: '#EF4444' },
  bank: { label: '銀行口座', badgeClass: 'bg-blue-100 text-blue-700', defaultColor: '#3B82F6' },
  credit: { label: 'クレカ', badgeClass: 'bg-purple-100 text-purple-700', defaultColor: '#8B5CF6' }
};

export function WalletModal({ isOpen, onClose, wallets, selectedWalletId }: WalletModalProps) {
  const [editedWallets, setEditedWallets] = useState<{
    id: number;
    name: string;
    balanceStr: string;
    creditBalanceStr: string;
    type: Wallet['type'];
    color: string;
  }[]>([]);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newBalanceStr, setNewBalanceStr] = useState<string>('0');
  const [newCreditBalanceStr, setNewCreditBalanceStr] = useState<string>('0');
  const [newType, setNewType] = useState<Wallet['type']>('bank');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    if (isOpen && wallets) {
      setEditedWallets(
        wallets
          .filter((w): w is Wallet & { id: number } => typeof w.id === 'number')
          .map(w => ({
            id: w.id,
            name: w.name,
            balanceStr: String(w.balance),
            creditBalanceStr: String(Math.abs(w.creditBalance || 0)),
            type: w.type,
            color: w.color
          }))
      );
      setSavedMsg(null);
      setIsAdding(false);
    }
  }, [isOpen, wallets]);

  useEffect(() => {
    if (isOpen && selectedWalletId) {
      const timer = setTimeout(() => {
        const targetInput = inputRefs.current[selectedWalletId];
        if (targetInput) {
          targetInput.focus();
          targetInput.select();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, selectedWalletId]);

  if (!isOpen) return null;

  const handleBalanceChange = (id: number, value: string) => {
    setEditedWallets(prev =>
      prev.map(w => (w.id === id ? { ...w, balanceStr: value } : w))
    );
  };

  const handleCreditBalanceChange = (id: number, value: string) => {
    setEditedWallets(prev =>
      prev.map(w => (w.id === id ? { ...w, creditBalanceStr: value } : w))
    );
  };

  const handleNameChange = (id: number, value: string) => {
    setEditedWallets(prev =>
      prev.map(w => (w.id === id ? { ...w, name: value } : w))
    );
  };

  const handleAddWallet = async () => {
    if (!newName.trim()) {
      alert('口座・Payの名前を入力してください（例: 楽天銀行、PayPayなど）');
      return;
    }
    const parsedBalance = Number(newBalanceStr.replace(/,/g, '')) || 0;
    const parsedCredit = Math.abs(Number(newCreditBalanceStr.replace(/,/g, '')) || 0);
    const color = WALLET_TYPE_LABELS[newType].defaultColor;
    const id = await db.wallets.add({
      name: newName.trim(),
      balance: parsedBalance,
      creditBalance: newType === 'pay' ? parsedCredit : 0,
      type: newType,
      color
    });
    setEditedWallets(prev => [
      ...prev,
      {
        id: Number(id),
        name: newName.trim(),
        balanceStr: String(parsedBalance),
        creditBalanceStr: String(parsedCredit),
        type: newType,
        color
      }
    ]);
    setNewName('');
    setNewBalanceStr('0');
    setNewCreditBalanceStr('0');
    setIsAdding(false);
  };

  const handleDeleteWallet = async (id: number, name: string) => {
    if (editedWallets.length <= 1) {
      alert('最低1つの口座・ウォレットが必要です。');
      return;
    }
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await db.wallets.delete(id);
    setEditedWallets(prev => prev.filter(w => w.id !== id));
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    for (const w of editedWallets) {
      const parsedBalance = Number(w.balanceStr.replace(/,/g, ''));
      const parsedCredit = Math.abs(Number(w.creditBalanceStr.replace(/,/g, '')));
      await db.wallets.update(w.id, {
        name: w.name.trim() || '口座',
        balance: Number.isNaN(parsedBalance) ? 0 : parsedBalance,
        creditBalance: w.type === 'pay' ? (Number.isNaN(parsedCredit) ? 0 : parsedCredit) : 0
      });
    }
    setSavedMsg('銀行・Pay・クレジットの金額を更新しました！');
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const totalPreview = editedWallets.reduce((sum, w) => {
    const val = Number(w.balanceStr.replace(/,/g, ''));
    const creditVal = w.type === 'pay' ? Math.abs(Number(w.creditBalanceStr.replace(/,/g, '')) || 0) : 0;
    return sum + (Number.isNaN(val) ? 0 : val) - creditVal;
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        
        {/* ヘッダー */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <WalletIcon size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">口座・Pay残高の変更</h3>
              <p className="text-[10px] text-blue-100">銀行・PayPay（残高／クレジット）・現金・クレカを修正</p>
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

        {/* フォーム本体 */}
        <form onSubmit={handleSaveAll} className="p-4 space-y-3.5 overflow-y-auto flex-1">
          {savedMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              <span className="font-bold">{savedMsg}</span>
            </div>
          )}

          {/* 総資産プレビュー */}
          <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold text-blue-900 block">変更後の総資産（実質合計）</span>
              <span className="text-[10px] text-blue-600">※クレカ引落分を差し引いた残高</span>
            </div>
            <span className="text-lg font-black text-blue-700">¥{totalPreview.toLocaleString()}</span>
          </div>

          {/* 各口座の編集リスト */}
          <div className="space-y-2.5">
            {editedWallets.map(w => {
              const typeMeta = WALLET_TYPE_LABELS[w.type] || WALLET_TYPE_LABELS.bank;
              const isSelected = selectedWalletId === w.id;
              return (
                <div
                  key={w.id}
                  className={`p-3 rounded-2xl border transition-all space-y-2.5 ${
                    isSelected
                      ? 'bg-blue-50/40 border-blue-400 ring-2 ring-blue-500/20'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${typeMeta.badgeClass}`}>
                        {typeMeta.label}
                      </span>
                      <input
                        type="text"
                        value={w.name}
                        onChange={e => handleNameChange(w.id, e.target.value)}
                        className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 w-full outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="口座・Pay名"
                      />
                    </div>
                    {editedWallets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteWallet(w.id, w.name)}
                        className="text-gray-300 hover:text-red-500 p-1 transition-colors"
                        title="この口座を削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {/* 通常残高（チャージ残高・口座残高） */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-600 w-28 shrink-0">
                      {w.type === 'pay' ? '💰 チャージ残高:' : w.type === 'credit' ? '💳 クレカ残高:' : '現在残高:'}
                    </span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-gray-500">¥</span>
                      <input
                        ref={el => {
                          inputRefs.current[w.id] = el;
                        }}
                        type="number"
                        step="1"
                        value={w.balanceStr}
                        onChange={e => handleBalanceChange(w.id, e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-xl pl-7 pr-3 py-1.5 text-right text-base font-black text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* PayPay等の場合：クレジット（クレカから引く分）欄 */}
                  {w.type === 'pay' && (
                    <div className="pt-2 border-t border-red-100/80 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-purple-700 w-28 shrink-0 flex items-center gap-1">
                          <CreditCard size={13} className="shrink-0" />
                          <span>クレジット欄:</span>
                        </span>
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-purple-600">引落 ¥</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={w.creditBalanceStr}
                            onChange={e => handleCreditBalanceChange(w.id, e.target.value)}
                            placeholder="0"
                            className="w-full bg-purple-50/50 border border-purple-200 rounded-xl pl-12 pr-3 py-1.5 text-right text-base font-black text-purple-700 outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-purple-600/80 text-right">
                        ※PayPayクレジット（旧あと払い）やクレカから引き落とされる利用額
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 新規口座追加 */}
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="w-full py-2.5 border-2 border-dashed border-gray-300 hover:border-blue-400 text-gray-600 hover:text-blue-600 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus size={15} />
              <span>新しい銀行・Pay・クレカを追加する</span>
            </button>
          ) : (
            <div className="p-3.5 bg-indigo-50/60 border border-indigo-200 rounded-2xl space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-indigo-950">新規口座・Payの追加</span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="text-[11px] text-gray-500 hover:text-gray-700"
                >
                  キャンセル
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as Wallet['type'])}
                  className="bg-white border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold text-gray-800 outline-none"
                >
                  <option value="bank">銀行口座</option>
                  <option value="pay">スマホ決済・Pay</option>
                  <option value="cash">現金（財布）</option>
                  <option value="credit">クレジットカード</option>
                </select>
                <input
                  type="text"
                  placeholder="例: 楽天銀行 / PayPay"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-2.5 py-2 text-xs font-bold text-gray-800 outline-none"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500">初期残高 ¥</span>
                    <input
                      type="number"
                      value={newBalanceStr}
                      onChange={e => setNewBalanceStr(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl pl-20 pr-3 py-2 text-right text-sm font-black text-gray-900 outline-none"
                    />
                  </div>
                  {newType !== 'pay' && (
                    <button
                      type="button"
                      onClick={handleAddWallet}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shrink-0"
                    >
                      追加
                    </button>
                  )}
                </div>
                {newType === 'pay' && (
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-purple-600">クレジット引落 ¥</span>
                      <input
                        type="number"
                        value={newCreditBalanceStr}
                        onChange={e => setNewCreditBalanceStr(e.target.value)}
                        className="w-full bg-white border border-purple-200 rounded-xl pl-28 pr-3 py-2 text-right text-sm font-black text-purple-700 outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddWallet}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shrink-0"
                    >
                      追加
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 保存ボタン */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black rounded-2xl text-sm shadow-lg shadow-blue-200 flex items-center justify-center gap-2 active:scale-98 transition-all"
            >
              <Save size={18} />
              <span>残高の修正を保存する</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
