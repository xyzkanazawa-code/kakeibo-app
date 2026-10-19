import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Search, Trophy, MapPin, Calendar, Star, Store, ExternalLink } from 'lucide-react';

interface FlatItemRecord {
  id: string;
  itemName: string;
  price: number;
  quantity: number;
  unitPrice: number;
  shopName?: string;
  address?: string;
  date: string;
  memo?: string;
  isFavorite?: boolean;
  productImage?: string;
}

export function PriceComparisonView() {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const transactions = useLiveQuery(() => db.transactions.toArray());

  // 支出明細から商品アイテムをフラットに展開（複数商品items対応）
  const allItemRecords: FlatItemRecord[] = [];

  (transactions || []).forEach(t => {
    if (t.type !== 'expense') return;

    if (t.items && t.items.length > 0) {
      // 複数商品が登録されている場合、各商品を個別に展開
      t.items.forEach((item, idx) => {
        if (!item.name) return;
        const q = Math.max(1, item.quantity || 1);
        const p = item.price > 0 ? item.price : t.amount;
        const u = item.unitPrice || (q > 0 ? Math.round(p / q) : p);
        allItemRecords.push({
          id: `${t.id}-${idx}`,
          itemName: item.name.trim(),
          price: p,
          quantity: q,
          unitPrice: u,
          shopName: t.shopName,
          address: t.address,
          date: t.date,
          memo: t.memo,
          isFavorite: t.isFavorite,
          productImage: t.productImage
        });
      });
    } else if (t.itemName || t.category) {
      // 単一商品またはカテゴリ
      const p = t.amount;
      const u = t.unitPrice || p;
      allItemRecords.push({
        id: `${t.id}-0`,
        itemName: (t.itemName || t.category).trim(),
        price: p,
        quantity: 1,
        unitPrice: u,
        shopName: t.shopName,
        address: t.address,
        date: t.date,
        memo: t.memo,
        isFavorite: t.isFavorite,
        productImage: t.productImage
      });
    }
  });

  // 商品名ごとにグルーピング
  const groupedByItem = allItemRecords.reduce<Record<string, FlatItemRecord[]>>((acc, rec) => {
    const key = rec.itemName;
    if (!acc[key]) acc[key] = [];
    acc[key].push(rec);
    return acc;
  }, {});

  // 検索フィルター
  const filteredItems = Object.keys(groupedByItem).filter(name =>
    name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-20">
      {/* 画面説明・タイトル */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-4 text-white shadow-md">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={20} className="text-yellow-200" />
          <h2 className="font-bold text-base">底値帳 ＆ 最安値比較</h2>
        </div>
        <p className="text-xs text-amber-100">
          レシートに載っていた個別商品ごとの購入店舗と最安値ランキングを自動集計！
        </p>
      </div>

      {/* 検索バー */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-3 text-gray-400" />
        <input
          type="text"
          placeholder="商品名で検索（例: 牛乳, パン, 卵, ビール）"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-none shadow-sm"
        />
      </div>

      {/* 商品ごとの最安値カード一覧 */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 p-6">
          <Store size={36} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-gray-600">商品記録がまだありません</p>
          <p className="text-xs text-gray-400 mt-1">レシート撮影時に複数商品を登録すると、ここに商品ごとの底値ランキングが自動作成されます！</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map(itemName => {
            const history = groupedByItem[itemName];
            // 単価が一番安い順にソート（何個でいくらかの単価で正確に比較）
            const sorted = [...history].sort((a, b) => a.unitPrice - b.unitPrice);
            const lowest = sorted[0];

            return (
              <div key={itemName} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {/* ヘッダー: 商品名 ＆ 最安値 */}
                <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                      <span>{itemName}</span>
                      {lowest.isFavorite && <Star size={13} className="text-amber-500 fill-amber-500" />}
                    </h3>
                    <span className="text-[10px] text-gray-400 font-medium">購入履歴: {history.length}回</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                      👑 底値 (1点あたり)
                    </span>
                    <span className="text-lg font-black text-emerald-600 block">
                      ¥{lowest.unitPrice.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* 購入店舗履歴一覧（安い順） */}
                <div className="divide-y divide-gray-100">
                  {sorted.map((record, index) => {
                    const isCheapest = index === 0;
                    return (
                      <div key={record.id} className={`p-3 text-xs flex items-center justify-between ${isCheapest ? 'bg-amber-50/30' : ''}`}>
                        <div className="space-y-1 max-w-[65%]">
                          <div className="flex items-center gap-1.5 font-bold text-gray-800">
                            {isCheapest && <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.2 rounded font-bold">1位</span>}
                            <span>{record.shopName || '店舗名なし'}</span>
                            {record.address && (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((record.shopName || '') + ' ' + record.address)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-500 hover:text-blue-700 ml-1 inline-flex items-center"
                                title="Googleマップで開く"
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-gray-400">
                            <span className="flex items-center gap-0.5"><Calendar size={10} /> {record.date}</span>
                            {record.address && <span className="flex items-center gap-0.5 truncate"><MapPin size={10} /> {record.address}</span>}
                          </div>

                          {record.memo && (
                            <p className="text-[10px] text-gray-600 bg-gray-50 px-2 py-0.5 rounded inline-block">
                              💬 {record.memo}
                            </p>
                          )}
                        </div>

                        {/* 価格 ＆ 写真サムネイル */}
                        <div className="flex items-center gap-2">
                          {record.productImage && (
                            <img
                              src={record.productImage}
                              alt="商品写真"
                              className="w-10 h-10 object-cover rounded-lg border border-gray-200"
                            />
                          )}
                          <div className="text-right">
                            <span className={`font-black text-sm ${isCheapest ? 'text-emerald-600' : 'text-gray-700'}`}>
                              ¥{record.unitPrice.toLocaleString()}
                              <span className="text-[10px] font-normal text-gray-500"> /点</span>
                            </span>
                            {record.quantity > 1 && (
                              <span className="text-[9px] text-gray-400 block">
                                (¥{record.price.toLocaleString()} / {record.quantity}点)
                              </span>
                            )}
                            {lowest.unitPrice < record.unitPrice && (
                              <span className="text-[10px] text-red-500 block">
                                +¥{(record.unitPrice - lowest.unitPrice).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
