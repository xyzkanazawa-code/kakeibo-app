import { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Image as ImageIcon,
  Star,
  Calculator,
  Store,
  MapPin,
  Phone,
  ArrowRightLeft,
  Sparkles,
  Plus,
  Trash2,
  Edit3,
  Crop
} from 'lucide-react';
import { db, type Transaction } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalcKeypad } from './CalcKeypad';
import { ReceiptCropModal } from './ReceiptCropModal';
import { compressReceiptImage, compressProductImage, formatBytes, type CompressionResult } from '../utils/imageCompressor';

interface LineItem {
  id: string;
  name: string;
  price: number;
  quantity?: number;
  unitPrice?: number;
}

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTransaction?: Transaction | null;
  initialData?: Partial<Transaction>;
}

export function TransactionModal({ isOpen, onClose, editingTransaction, initialData }: TransactionModalProps) {
  const wallets = useLiveQuery(() => db.wallets.toArray());
  const shops = useLiveQuery(() => db.shops.toArray());

  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [amount, setAmount] = useState<number>(0);
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [subtotal, setSubtotal] = useState<number>(0);
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<string>('食費');
  const [walletId, setWalletId] = useState<number>(1);
  const [toWalletId, setToWalletId] = useState<number>(2);
  const [payMethod, setPayMethod] = useState<'balance' | 'credit'>('balance');
  const [shopName, setShopName] = useState<string>('');
  const [branchName, setBranchName] = useState<string>(''); // 支店名（〇〇店）
  const [address, setAddress] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [items, setItems] = useState<LineItem[]>([]);
  const [memo, setMemo] = useState<string>('');
  const [isFavorite, setIsFavorite] = useState<boolean>(false);

  // 画像圧縮状態
  const [receiptImage, setReceiptImage] = useState<string | undefined>();
  const [receiptStats, setReceiptStats] = useState<CompressionResult | null>(null);
  const [productImage, setProductImage] = useState<string | undefined>();
  const [productStats, setProductStats] = useState<CompressionResult | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState<boolean>(false);

  // 電卓テンキー表示
  const [showKeypad, setShowKeypad] = useState<boolean>(false);

  const receiptInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTransaction) {
      // 編集モード：既存データの復元
      setType(editingTransaction.type);
      setAmount(editingTransaction.amount);
      setDate(editingTransaction.date);
      setCategory(editingTransaction.category);
      if (editingTransaction.walletId) setWalletId(editingTransaction.walletId);
      if (editingTransaction.toWalletId) setToWalletId(editingTransaction.toWalletId);
      setPayMethod(editingTransaction.payMethod || 'balance');
      setShopName(editingTransaction.shopName || '');
      setBranchName(editingTransaction.branchName || '');
      setAddress(editingTransaction.address || '');
      setPhone(editingTransaction.phone || '');
      setMemo(editingTransaction.memo || '');
      setIsFavorite(!!editingTransaction.isFavorite);
      setTaxAmount(editingTransaction.taxAmount || 0);
      setSubtotal(editingTransaction.subtotal || 0);
      setReceiptImage(editingTransaction.receiptImage);
      setProductImage(editingTransaction.productImage);

      // 複数商品の復元
      if (editingTransaction.items && editingTransaction.items.length > 0) {
        setItems(editingTransaction.items.map((it, idx) => {
          const qty = it.quantity || 1;
          const price = it.price || 0;
          return {
            id: `edit-${idx}`,
            name: it.name,
            price: price,
            quantity: qty,
            unitPrice: it.unitPrice || (qty > 1 ? Math.round(price / qty) : price)
          };
        }));
      } else if (editingTransaction.itemName) {
        setItems([{ id: 'edit-0', name: editingTransaction.itemName, price: 0, quantity: 1, unitPrice: 0 }]);
      } else {
        setItems([]);
      }
    } else if (initialData) {
      if (initialData.type) setType(initialData.type);
      if (initialData.amount) setAmount(initialData.amount);
      if (initialData.taxAmount) setTaxAmount(initialData.taxAmount);
      if (initialData.subtotal) setSubtotal(initialData.subtotal);
      if (initialData.shopName) setShopName(initialData.shopName);
      if (initialData.branchName) setBranchName(initialData.branchName);
      if (initialData.address) setAddress(initialData.address);
      if (initialData.phone) setPhone(initialData.phone);
      if (initialData.date) setDate(initialData.date);
      if (initialData.category) setCategory(initialData.category);
      if (initialData.receiptImage) setReceiptImage(initialData.receiptImage);
      setPayMethod('balance');
      setItems([]);
    } else {
      // リセット
      setType('expense');
      setAmount(0);
      setTaxAmount(0);
      setSubtotal(0);
      setDate(new Date().toISOString().split('T')[0]);
      setCategory('食費');
      setPayMethod('balance');
      setShopName('');
      setBranchName('');
      setAddress('');
      setPhone('');
      setMemo('');
      setIsFavorite(false);
      setReceiptImage(undefined);
      setProductImage(undefined);
      setReceiptStats(null);
      setProductStats(null);
      setItems([]);
    }
  }, [editingTransaction, initialData, isOpen]);

  // 店舗名や電話番号入力時の履歴自動補完
  const handleShopNameChange = (name: string) => {
    setShopName(name);
    const matched = shops?.find(s => s.name === name);
    if (matched) {
      if (matched.branchName && !branchName) setBranchName(matched.branchName);
      if (matched.address && !address) setAddress(matched.address);
      if (matched.phone && !phone) setPhone(matched.phone);
      if (matched.defaultCategory) setCategory(matched.defaultCategory);
      if (matched.defaultWalletId) setWalletId(matched.defaultWalletId);
    }
  };

  const handlePhoneChange = (p: string) => {
    setPhone(p);
    const matched = shops?.find(s => s.phone === p);
    if (matched) {
      if (matched.name && !shopName) setShopName(matched.name);
      if (matched.branchName && !branchName) setBranchName(matched.branchName);
      if (matched.address && !address) setAddress(matched.address);
    }
  };

  // レシート画像選択＆超圧縮
  const handleReceiptFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const result = await compressReceiptImage(file);
        setReceiptImage(result.dataUrl);
        setReceiptStats(result);
      } catch (err) {
        console.error('レシート圧縮失敗', err);
      }
    }
  };

  // 商品写真選択＆超圧縮
  const handleProductFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const result = await compressProductImage(file);
        setProductImage(result.dataUrl);
        setProductStats(result);
      } catch (err) {
        console.error('商品写真圧縮失敗', err);
      }
    }
  };

  // 商品行の追加・変更・削除
  const handleAddItem = () => {
    setItems([...items, { id: `${Date.now()}-${Math.random()}`, name: '', price: 0, quantity: 1, unitPrice: 0 }]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(it => it.id !== id));
  };

  const handleUpdateItem = (id: string, field: 'name' | 'price' | 'quantity', value: string | number) => {
    setItems(items.map(it => {
      if (it.id === id) {
        const updated = { ...it, [field]: value };
        if (field === 'price' || field === 'quantity') {
          const p = field === 'price' ? Number(value) : (it.price || 0);
          const q = field === 'quantity' ? Math.max(1, Number(value)) : (it.quantity || 1);
          updated.unitPrice = q > 0 ? Math.round(p / q) : p;
        }
        return updated;
      }
      return it;
    }));
  };

  const itemsSum = items.reduce((acc, it) => acc + (it.price || 0), 0);

  // 保存（新規登録 または 既存更新）
  const handleSave = async () => {
    if (amount <= 0) {
      alert('金額を入力してください');
      return;
    }

    const validItems = items
      .filter(it => it.name.trim().length > 0)
      .map(it => {
        const q = Math.max(1, it.quantity || 1);
        const p = it.price || 0;
        const u = it.unitPrice || (q > 0 ? Math.round(p / q) : p);
        return {
          name: it.name.trim(),
          price: p,
          quantity: q,
          unitPrice: u
        };
      });

    if (editingTransaction && editingTransaction.id) {
      // === 既存明細の更新 ===
      // 1. 前回のウォレット残高をロールバック
      if (editingTransaction.type === 'expense' && editingTransaction.walletId) {
        const prevW = await db.wallets.get(editingTransaction.walletId);
        if (prevW) {
          if (prevW.type === 'pay' && editingTransaction.payMethod === 'credit') {
            await db.wallets.update(editingTransaction.walletId, {
              creditBalance: Math.max(0, Math.abs(prevW.creditBalance || 0) - editingTransaction.amount)
            });
          } else {
            await db.wallets.update(editingTransaction.walletId, { balance: prevW.balance + editingTransaction.amount });
          }
        }
      } else if (editingTransaction.type === 'income' && editingTransaction.walletId) {
        const prevW = await db.wallets.get(editingTransaction.walletId);
        if (prevW) await db.wallets.update(editingTransaction.walletId, { balance: prevW.balance - editingTransaction.amount });
      } else if (editingTransaction.type === 'transfer' && editingTransaction.walletId && editingTransaction.toWalletId) {
        const fromW = await db.wallets.get(editingTransaction.walletId);
        const toW = await db.wallets.get(editingTransaction.toWalletId);
        if (fromW) await db.wallets.update(editingTransaction.walletId, { balance: fromW.balance + editingTransaction.amount });
        if (toW) await db.wallets.update(editingTransaction.toWalletId, { balance: toW.balance - editingTransaction.amount });
      }

      // 2. 新しい残高を適用
      const targetWallet = await db.wallets.get(walletId);
      const effectivePayMethod = type === 'expense' && targetWallet?.type === 'pay' ? payMethod : 'balance';
      if (type === 'expense') {
        if (targetWallet) {
          if (targetWallet.type === 'pay' && effectivePayMethod === 'credit') {
            await db.wallets.update(walletId, {
              creditBalance: Math.abs(targetWallet.creditBalance || 0) + amount
            });
          } else {
            await db.wallets.update(walletId, { balance: targetWallet.balance - amount });
          }
        }
      } else if (type === 'income') {
        if (targetWallet) await db.wallets.update(walletId, { balance: targetWallet.balance + amount });
      } else if (type === 'transfer') {
        const fromW = await db.wallets.get(walletId);
        const toW = await db.wallets.get(toWalletId);
        if (fromW) await db.wallets.update(walletId, { balance: fromW.balance - amount });
        if (toW) await db.wallets.update(toWalletId, { balance: toW.balance + amount });
      }

      // 3. レコードの上書き更新
      await db.transactions.update(editingTransaction.id, {
        type,
        amount,
        date,
        category,
        shopName: shopName.trim(),
        branchName: branchName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        itemName: validItems[0]?.name || '',
        items: validItems,
        taxAmount: taxAmount || 0,
        subtotal: subtotal || 0,
        walletId,
        toWalletId: type === 'transfer' ? toWalletId : undefined,
        payMethod: effectivePayMethod,
        memo: memo.trim(),
        isFavorite,
        receiptImage: receiptImage || editingTransaction.receiptImage,
        productImage: productImage || editingTransaction.productImage
      });

    } else {
      // === 新規登録 ===
      const targetWallet = await db.wallets.get(walletId);
      const effectivePayMethod = type === 'expense' && targetWallet?.type === 'pay' ? payMethod : 'balance';

      await db.transactions.add({
        type,
        amount,
        date,
        category,
        shopName: shopName.trim(),
        branchName: branchName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        itemName: validItems[0]?.name || '',
        items: validItems,
        taxAmount: taxAmount || 0,
        subtotal: subtotal || 0,
        walletId,
        toWalletId: type === 'transfer' ? toWalletId : undefined,
        payMethod: effectivePayMethod,
        memo: memo.trim(),
        isFavorite,
        receiptImage,
        productImage,
        origSize: receiptStats?.originalSize,
        compSize: receiptStats?.compressedSize,
        createdAt: new Date().toISOString()
      });

      // 残高更新
      if (type === 'expense') {
        if (targetWallet) {
          if (targetWallet.type === 'pay' && effectivePayMethod === 'credit') {
            await db.wallets.update(walletId, {
              creditBalance: Math.abs(targetWallet.creditBalance || 0) + amount
            });
          } else {
            await db.wallets.update(walletId, { balance: targetWallet.balance - amount });
          }
        }
      } else if (type === 'income') {
        if (targetWallet) await db.wallets.update(walletId, { balance: targetWallet.balance + amount });
      } else if (type === 'transfer') {
        const fromW = await db.wallets.get(walletId);
        const toW = await db.wallets.get(toWalletId);
        if (fromW) await db.wallets.update(walletId, { balance: fromW.balance - amount });
        if (toW) await db.wallets.update(toWalletId, { balance: toW.balance + amount });
      }
    }

    // 店舗マスタの更新・記憶
    if (shopName.trim()) {
      const existing = await db.shops.where('name').equals(shopName.trim()).first();
      if (existing && existing.id) {
        await db.shops.update(existing.id, {
          branchName: branchName.trim() || existing.branchName,
          address: address.trim() || existing.address,
          phone: phone.trim() || existing.phone,
          lastVisited: date,
          visitCount: (existing.visitCount || 1) + 1,
          defaultWalletId: walletId,
          defaultCategory: category
        });
      } else {
        await db.shops.add({
          name: shopName.trim(),
          branchName: branchName.trim(),
          address: address.trim(),
          phone: phone.trim(),
          defaultCategory: category,
          defaultWalletId: walletId,
          lastVisited: date,
          visitCount: 1
        });
      }
    }

    onClose();
  };

  if (!isOpen) return null;

  const expenseCategories = ['食費', '日用品', '外食・カフェ', '光熱費', '住居費', '交通費', '趣味・娯楽', '交際費', '医療・健康', '衣服・美容', '通信費', 'その他'];
  const incomeCategories = ['給与', '賞与', '副収入', 'ポイント還元', 'お小遣い', '臨時収入', '配当・利息', 'その他'];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        
        {/* モーダルヘッダー */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
          <div className="flex items-center gap-2">
            {editingTransaction ? (
              <div className="flex items-center gap-1.5 text-blue-700 font-black text-sm">
                <Edit3 size={16} /> 明細の編集・手直し
              </div>
            ) : (
              <div className="flex gap-1 bg-gray-200 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => { setType('expense'); setCategory('食費'); }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${type === 'expense' ? 'bg-red-500 text-white shadow' : 'text-gray-600'}`}
                >
                  出金（支出）
                </button>
                <button
                  type="button"
                  onClick={() => { setType('income'); setCategory('副収入'); }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${type === 'income' ? 'bg-emerald-500 text-white shadow' : 'text-gray-600'}`}
                >
                  入金（収入）
                </button>
                <button
                  type="button"
                  onClick={() => { setType('transfer'); setCategory('チャージ'); }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${type === 'transfer' ? 'bg-blue-600 text-white shadow' : 'text-gray-600'}`}
                >
                  振替・Pay
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full">
            <X size={20} />
          </button>
        </div>

        {/* フォーム入力エリア */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 pb-24">
          
          {/* 金額入力（電卓キーパッド起動） */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-center cursor-pointer hover:border-blue-400 transition-colors" onClick={() => setShowKeypad(true)}>
            <div className="text-xs text-gray-400 font-medium mb-1 flex items-center justify-center gap-1">
              <Calculator size={14} /> 金額をタップして電卓入力
            </div>
            <div className={`text-4xl font-black ${type === 'expense' ? 'text-red-500' : type === 'income' ? 'text-emerald-500' : 'text-blue-600'}`}>
              ¥{amount.toLocaleString()}
            </div>
          </div>

          {/* 消費税等の入力（支出時） */}
          {type === 'expense' && (
            <div className="flex items-center justify-between bg-red-50/40 border border-red-100 rounded-xl px-3 py-2 text-xs">
              <span className="font-bold text-gray-600">うち消費税等:</span>
              <div className="flex items-center gap-1.5">
                <div className="relative w-24">
                  <span className="absolute left-2 top-1 text-[10px] text-gray-400">¥</span>
                  <input
                    type="number"
                    value={taxAmount || ''}
                    onChange={e => setTaxAmount(Number(e.target.value))}
                    placeholder="0"
                    className="w-full bg-white border border-gray-200 rounded-lg pl-4 pr-1.5 py-1 text-xs font-bold text-right outline-none focus:ring-1 focus:ring-red-400"
                  />
                </div>
                {taxAmount > 0 && (
                  <span className="text-[10px] text-gray-400 font-medium">
                    (税抜: ¥{Math.max(0, amount - taxAmount).toLocaleString()})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 日付 */}
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">日付</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* 出金・入金の場合のカテゴリ選択 */}
          {type !== 'transfer' && (
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">カテゴリ</label>
              <div className="flex flex-wrap gap-1.5">
                {(type === 'expense' ? expenseCategories : incomeCategories).map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      category === cat
                        ? type === 'income' && cat === '副収入'
                          ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-300'
                          : type === 'expense'
                          ? 'bg-red-500 text-white shadow-sm'
                          : 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat === '副収入' ? '✨ 副収入' : cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 口座・ウォレット選択 */}
          {type === 'transfer' ? (
            <div className="grid grid-cols-2 gap-3 bg-blue-50/60 p-3 rounded-2xl border border-blue-100">
              <div>
                <label className="text-xs font-bold text-blue-600 mb-1 block">出金元</label>
                <select
                  value={walletId}
                  onChange={e => setWalletId(Number(e.target.value))}
                  className="w-full bg-white border border-blue-200 rounded-xl px-2 py-2 text-xs font-bold outline-none"
                >
                  {wallets?.map(w => (
                    <option key={w.id} value={w.id}>{w.name} (残高: ¥{w.balance.toLocaleString()})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-blue-600 mb-1 block">入金先（Pay）</label>
                <select
                  value={toWalletId}
                  onChange={e => setToWalletId(Number(e.target.value))}
                  className="w-full bg-white border border-blue-200 rounded-xl px-2 py-2 text-xs font-bold outline-none"
                >
                  {wallets?.map(w => (
                    <option key={w.id} value={w.id}>{w.name} (残高: ¥{w.balance.toLocaleString()})</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 mb-1 block">
                {type === 'expense' ? '支払い口座・決済手段' : '入金先口座'}
              </label>
              <select
                value={walletId}
                onChange={e => setWalletId(Number(e.target.value))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium outline-none"
              >
                {wallets?.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name} (残高: ¥{w.balance.toLocaleString()}{w.type === 'pay' ? ` / クレジット: ¥${Math.abs(w.creditBalance || 0).toLocaleString()}` : ''})
                  </option>
                ))}
              </select>

              {/* Pay選択時の「残高から引く / クレジット（クレカ）から引く」切り替え */}
              {type === 'expense' && wallets?.find(w => w.id === walletId)?.type === 'pay' && (
                <div className="grid grid-cols-2 gap-2 p-2 bg-red-50/50 border border-red-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPayMethod('balance')}
                    className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
                      payMethod === 'balance'
                        ? 'bg-red-500 text-white shadow-xs'
                        : 'bg-white text-gray-600 border border-gray-200'
                    }`}
                  >
                    💰 Pay残高から引く
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('credit')}
                    className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
                      payMethod === 'credit'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'bg-white text-gray-600 border border-gray-200'
                    }`}
                  >
                    💳 クレジットから引く
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 店名・支店名（〇〇店） */}
          {type !== 'transfer' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1"><Store size={13} /> 店舗・店名</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例: セブン-イレブン"
                    value={shopName}
                    onChange={e => handleShopNameChange(e.target.value)}
                    list="shop-suggestions-modal"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <datalist id="shop-suggestions-modal">
                    {shops?.map(s => <option key={s.id} value={s.name} />)}
                  </datalist>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 flex items-center gap-1">
                    <span>🏬 支店名 (〇〇店)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例: 新宿東口店"
                    value={branchName}
                    onChange={e => setBranchName(e.target.value)}
                    list="branch-suggestions-modal"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <datalist id="branch-suggestions-modal">
                    {shops?.filter(s => s.branchName).map(s => <option key={s.id} value={s.branchName} />)}
                  </datalist>
                </div>
              </div>

              {/* 電話番号・住所 */}
              {type === 'expense' && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 mb-0.5 flex items-center gap-1"><Phone size={11} /> 電話番号</label>
                    <input
                      type="text"
                      placeholder="03-XXXX-XXXX"
                      value={phone}
                      onChange={e => handlePhoneChange(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 mb-0.5 flex items-center gap-1"><MapPin size={11} /> 住所・場所</label>
                    <input
                      type="text"
                      placeholder="東京都渋谷区..."
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                    />
                  </div>
                </div>
              )}

              {/* 複数商品明細リスト（底値帳連動） */}
              {type === 'expense' && (
                <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-200 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-800 flex items-center gap-1">
                      <Sparkles size={13} className="text-amber-500" /> 購入商品・品目リスト ({items.length}件)
                    </label>
                    <span className="text-[10px] text-amber-700 font-bold">底値帳に記録</span>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {items.map((it, idx) => {
                      const qty = it.quantity || 1;
                      const calcUnit = it.unitPrice || (qty > 1 ? Math.round((it.price || 0) / qty) : (it.price || 0));
                      return (
                        <div key={it.id} className="bg-white p-2 rounded-xl border border-gray-200 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400 w-4 text-center shrink-0">{idx + 1}</span>
                            <input
                              type="text"
                              value={it.name}
                              onChange={e => handleUpdateItem(it.id, 'name', e.target.value)}
                              placeholder="商品名 (例: 牛乳)"
                              className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            {/* 個数 */}
                            <div className="relative w-16 shrink-0" title="個数・点数">
                              <input
                                type="number"
                                min="1"
                                value={it.quantity || 1}
                                onChange={e => handleUpdateItem(it.id, 'quantity', Math.max(1, Number(e.target.value)))}
                                placeholder="1"
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-1.5 pr-4 py-1 text-xs font-bold text-gray-800 outline-none text-right focus:ring-1 focus:ring-amber-500"
                              />
                              <span className="absolute right-1 top-1 text-[10px] text-gray-400">点</span>
                            </div>
                            {/* 金額 */}
                            <div className="relative w-22 shrink-0" title="金額">
                              <span className="absolute left-1.5 top-1 text-[10px] text-gray-400">¥</span>
                              <input
                                type="number"
                                value={it.price || ''}
                                onChange={e => handleUpdateItem(it.id, 'price', Number(e.target.value))}
                                placeholder="0"
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-4 pr-1.5 py-1 text-xs font-bold text-right outline-none focus:ring-1 focus:ring-amber-500"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(it.id)}
                              className="p-1 text-gray-300 hover:text-red-500 rounded shrink-0"
                              title="削除"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          {qty > 1 && (it.price || 0) > 0 && (
                            <div className="flex justify-end items-center text-[10px] text-amber-700 font-medium pr-6">
                              <span className="bg-amber-100/90 text-amber-800 px-1.5 py-0.5 rounded text-[9px] font-bold">
                                単価: @¥{calcUnit.toLocaleString()} × {qty}点
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="px-3 py-1 bg-white hover:bg-gray-50 text-amber-700 text-xs font-bold rounded-lg border border-amber-300 shadow-2xs flex items-center gap-1 active:scale-95"
                    >
                      <Plus size={13} /> ＋商品を追加
                    </button>

                    {itemsSum > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(itemsSum)}
                        className="text-[10px] text-blue-600 font-bold bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg border border-blue-200"
                      >
                        商品の合計（¥{itemsSum.toLocaleString()}）を反映
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 一言メモ ＆ お気に入りフラグ */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-bold text-gray-500">一言メモ / レビュー</label>
              {type === 'expense' && (
                <button
                  type="button"
                  onClick={() => setIsFavorite(!isFavorite)}
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                    isFavorite ? 'bg-amber-50 border-amber-300 text-amber-600 font-bold' : 'border-gray-200 text-gray-400'
                  }`}
                >
                  <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} /> お気に入り
                </button>
              )}
            </div>
            <textarea
              placeholder="例: セールで安かった！次回もこれにする。"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          {/* レシート画像 ＆ 商品写真の添付 */}
          {type === 'expense' && (
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <div className="text-xs font-bold text-gray-600 flex items-center justify-between">
                <span>画像添付（超圧縮WebP自動変換）</span>
                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">Drive節約</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* レシート画像 */}
                <div
                  onClick={() => receiptInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-2xl p-2.5 flex flex-col items-center justify-center cursor-pointer bg-gray-50/50 min-h-[90px] relative overflow-hidden"
                >
                  {receiptImage ? (
                    <>
                      <img src={receiptImage} alt="Receipt" className="h-16 object-contain rounded" />
                      {receiptStats && (
                        <div className="absolute bottom-1 bg-black/75 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-mono">
                          {formatBytes(receiptStats.compressedSize)} ({receiptStats.compressionRatio}%減)
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <Camera size={20} className="text-gray-400 mb-1" />
                      <span className="text-[11px] font-bold text-gray-600">レシート添付</span>
                      <span className="text-[9px] text-gray-400">モノクロ超圧縮</span>
                    </>
                  )}
                  <input
                    ref={receiptInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleReceiptFile}
                  />
                </div>

                {/* 商品写真 */}
                <div
                  onClick={() => productInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 hover:border-emerald-400 rounded-2xl p-2.5 flex flex-col items-center justify-center cursor-pointer bg-gray-50/50 min-h-[90px] relative overflow-hidden"
                >
                  {productImage ? (
                    <>
                      <img src={productImage} alt="Product" className="h-16 object-contain rounded" />
                      {productStats && (
                        <div className="absolute bottom-1 bg-black/75 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-mono">
                          {formatBytes(productStats.compressedSize)} ({productStats.compressionRatio}%減)
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <ImageIcon size={20} className="text-gray-400 mb-1" />
                      <span className="text-[11px] font-bold text-gray-600">商品写真添付</span>
                      <span className="text-[9px] text-gray-400">実物・パッケージ</span>
                    </>
                  )}
                  <input
                    ref={productInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProductFile}
                  />
                </div>
              </div>

              {receiptImage && (
                <button
                  type="button"
                  onClick={() => setIsCropModalOpen(true)}
                  className="w-full py-2 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                >
                  <Crop size={14} />
                  <span>✂️ レシート画像の切り取り範囲を手動調整</span>
                </button>
              )}
            </div>
          )}

        </div>

        {/* 下部固定：登録・更新ボタン */}
        <div className="p-4 border-t border-gray-100 bg-white sticky bottom-0">
          <button
            type="button"
            onClick={handleSave}
            className={`w-full py-3.5 rounded-2xl text-white font-bold shadow-lg transition-transform active:scale-98 flex items-center justify-center gap-2 ${
              editingTransaction
                ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                : type === 'expense'
                ? 'bg-red-500 hover:bg-red-600 shadow-red-200'
                : type === 'income'
                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
            }`}
          >
            {editingTransaction ? <Edit3 size={18} /> : type === 'transfer' ? <ArrowRightLeft size={18} /> : null}
            {editingTransaction
              ? '変更を保存する'
              : type === 'expense'
              ? '支出を登録'
              : type === 'income'
              ? '収入を登録'
              : '振替を実行'}
          </button>
        </div>

      </div>

      {/* 電卓テンキーオーバーレイ */}
      {showKeypad && (
        <CalcKeypad
          value={amount}
          onChange={val => setAmount(val)}
          onClose={() => setShowKeypad(false)}
        />
      )}

      {/* 手動レシート切り取り調整モーダル */}
      <ReceiptCropModal
        isOpen={isCropModalOpen}
        onClose={() => setIsCropModalOpen(false)}
        sourceUrl={receiptStats?.rawUrl || receiptImage || ''}
        initialCropBox={receiptStats?.cropBox || { top: 0, bottom: 0, left: 0, right: 0 }}
        originalSize={receiptStats?.originalSize || 0}
        onApply={res => {
          setReceiptImage(res.dataUrl);
          setReceiptStats(res);
        }}
      />
    </div>
  );
}
