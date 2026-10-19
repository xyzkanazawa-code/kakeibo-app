import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Store, MapPin, Phone, Calendar, ExternalLink, ChevronRight, ArrowLeft } from 'lucide-react';

export function ShopHistoryView() {
  const [selectedShopName, setSelectedShopName] = useState<string | null>(null);
  const shops = useLiveQuery(() => db.shops.toArray());
  const transactions = useLiveQuery(() => db.transactions.toArray());

  // 選択された店舗での過去の取引一覧
  const shopTransactions = (transactions || []).filter(
    t => t.shopName === selectedShopName
  ).sort((a, b) => (b.date > a.date ? 1 : -1));

  const totalSpentAtShop = shopTransactions.reduce((acc, t) => acc + (t.type === 'expense' ? t.amount : 0), 0);

  return (
    <div className="space-y-4 pb-20">
      {/* 画面ヘッダー */}
      {!selectedShopName ? (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-4 text-white shadow-md">
          <div className="flex items-center gap-2 mb-1">
            <Store size={20} className="text-blue-200" />
            <h2 className="font-bold text-base">店舗メモリー＆購入履歴</h2>
          </div>
          <p className="text-xs text-blue-100">
            自動記憶された店舗の住所・電話番号と、過去に買った全商品履歴を確認できます。
          </p>
        </div>
      ) : (
        <button
          onClick={() => setSelectedShopName(null)}
          className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-2 rounded-xl"
        >
          <ArrowLeft size={16} /> 店舗一覧へ戻る
        </button>
      )}

      {/* 店舗一覧 */}
      {!selectedShopName ? (
        <div className="space-y-3">
          {(!shops || shops.length === 0) ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 p-6">
              <Store size={36} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-600">記録された店舗がまだありません</p>
              <p className="text-xs text-gray-400 mt-1">レシートや支出を登録すると、店舗情報が自動学習されます！</p>
            </div>
          ) : (
            shops.map(shop => {
              const count = (transactions || []).filter(t => t.shopName === shop.name).length;
              return (
                <div
                  key={shop.id}
                  onClick={() => setSelectedShopName(shop.name)}
                  className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-blue-300 shadow-sm cursor-pointer transition-all flex items-center justify-between"
                >
                  <div className="space-y-1.5 max-w-[80%]">
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 flex-wrap">
                      <Store size={15} className="text-blue-600" />
                      <span>{shop.name}</span>
                      {shop.branchName && (
                        <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
                          {shop.branchName}
                        </span>
                      )}
                    </h3>

                    {shop.address && (
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 truncate">
                        <MapPin size={11} className="text-gray-400 shrink-0" />
                        <span>{shop.address}</span>
                      </p>
                    )}

                    {shop.phone && (
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 font-mono">
                        <Phone size={11} className="text-gray-400 shrink-0" />
                        <span>{shop.phone}</span>
                      </p>
                    )}

                    <div className="flex gap-2 text-[10px] text-gray-400 pt-1">
                      <span>利用回数: {count}回</span>
                      {shop.lastVisited && <span>最終利用: {shop.lastVisited}</span>}
                    </div>
                  </div>

                  <ChevronRight size={18} className="text-gray-400" />
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* 店舗詳細画面 */
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-black text-gray-800">{selectedShopName}</h2>
                <p className="text-xs text-gray-500">これまでの総利用額: ¥{totalSpentAtShop.toLocaleString()}</p>
              </div>
              {shopTransactions[0]?.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedShopName + ' ' + shopTransactions[0].address)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-blue-100"
                >
                  <ExternalLink size={12} /> Googleマップ
                </a>
              )}
            </div>

            {shopTransactions[0]?.address && (
              <p className="text-xs text-gray-600 flex items-center gap-1">
                <MapPin size={13} className="text-gray-400" /> {shopTransactions[0].address}
              </p>
            )}
            {shopTransactions[0]?.phone && (
              <p className="text-xs text-gray-600 flex items-center gap-1 font-mono">
                <Phone size={13} className="text-gray-400" /> {shopTransactions[0].phone}
              </p>
            )}
          </div>

          <h3 className="font-bold text-gray-700 text-sm px-1">過去にこの店で買った商品・レシート</h3>

          <div className="space-y-3">
            {shopTransactions.map(t => (
              <div key={t.id} className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-sm flex justify-between items-center">
                <div className="space-y-1">
                  <p className="font-bold text-xs text-gray-800">
                    {t.itemName ? `🛒 ${t.itemName}` : `🏷️ ${t.category}`}
                  </p>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Calendar size={10} /> {t.date}
                  </p>
                  {t.memo && (
                    <p className="text-[10px] text-gray-600 bg-gray-50 px-2 py-0.5 rounded inline-block">
                      💬 {t.memo}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {t.productImage && (
                    <img src={t.productImage} alt="商品" className="w-10 h-10 object-cover rounded-lg border border-gray-100" />
                  )}
                  {t.receiptImage && !t.productImage && (
                    <img src={t.receiptImage} alt="レシート" className="w-10 h-10 object-contain rounded-lg border border-gray-100 bg-gray-900" />
                  )}
                  <div className="text-right">
                    <span className="font-black text-sm text-red-500">¥{t.amount.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
