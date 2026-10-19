import { useState } from 'react';
import { X, Cloud, FileSpreadsheet, Archive, CheckCircle, RefreshCw, HardDrive, Share2 } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { generateMonthlyCSV, generateImagesZip, generateFullBackupJSON, saveOrShareFile } from '../utils/backup';

interface DriveBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DriveBackupModal({ isOpen, onClose }: DriveBackupModalProps) {
  const transactions = useLiveQuery(() => db.transactions.toArray());
  const now = new Date();
  const currentYM = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月`;
  const [selectedYM] = useState<string>(currentYM);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  // 当月の取引を抽出
  const monthlyTransactions = (transactions || []).filter(t => {
    if (!t.date) return false;
    const parts = t.date.split('-');
    const ym = `${parts[0]}年${parts[1]}月`;
    return ym === selectedYM;
  });

  // CSV保存
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const csvBlob = generateMonthlyCSV(monthlyTransactions, selectedYM);
      const filename = `家計簿_${selectedYM}_明細一覧.csv`;
      await saveOrShareFile(csvBlob, filename, `${selectedYM}の家計簿明細CSV`);
      setExportSuccess('CSV明細一覧を出力しました！');
    } catch (err) {
      console.error('CSV出力エラー', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 超圧縮ZIP保存
  const handleExportZIP = async () => {
    setIsExporting(true);
    try {
      const zipBlob = await generateImagesZip(monthlyTransactions, selectedYM);
      const filename = `家計簿_${selectedYM}_レシート超圧縮.zip`;
      await saveOrShareFile(zipBlob, filename, `${selectedYM}の超圧縮レシート画像ZIP`);
      setExportSuccess('超圧縮画像ZIPを出力しました！Google Driveへ保存してください');
    } catch (err) {
      console.error('ZIP出力エラー', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 完全バックアップJSON（機種変更・復元用）
  const handleExportFullJSON = async () => {
    setIsExporting(true);
    try {
      const jsonBlob = await generateFullBackupJSON();
      const filename = `家計簿_全データ完全復元バックアップ_${now.toISOString().split('T')[0]}.json`;
      await saveOrShareFile(jsonBlob, filename, '家計簿完全復元データ');
      setExportSuccess('完全バックアップJSONを出力しました！');
    } catch (err) {
      console.error('JSON出力エラー', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 画像を含む件数
  const imageCount = monthlyTransactions.filter(t => t.receiptImage || t.productImage).length;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        
        {/* ヘッダー */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
              <Cloud size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">Google Drive バックアップ</h3>
              <p className="text-[10px] text-gray-500">超圧縮WebP ＆ 明細CSV出力</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full">
            <X size={20} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 pb-16">
          
          {/* 説明バナー */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 space-y-1.5">
            <p className="font-bold flex items-center gap-1.5">
              <Share2 size={14} className="text-blue-600" />
              Driveの容量を圧迫しない超圧縮設計
            </p>
            <p className="text-blue-700 leading-relaxed">
              レシート画像を20〜50KBに極小化したZIPファイルと、確定申告やExcelで閲覧できるCSVを一括生成します。Pixel 9の共有メニューからGoogle Driveへ直接保存できます。
            </p>
          </div>

          {/* 対象年月の選択 */}
          <div className="bg-gray-50 rounded-2xl p-3 border border-gray-200 flex justify-between items-center">
            <span className="text-xs font-bold text-gray-600">対象年月</span>
            <span className="text-sm font-black text-blue-600 bg-white px-3 py-1 rounded-xl border border-gray-200 shadow-sm">
              {selectedYM}
            </span>
          </div>

          {/* 当月のデータサマリー */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
              <span className="text-[10px] text-gray-400 block font-medium">対象明細数</span>
              <span className="text-lg font-black text-gray-800">{monthlyTransactions.length} 件</span>
            </div>
            <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
              <span className="text-[10px] text-gray-400 block font-medium">超圧縮画像数</span>
              <span className="text-lg font-black text-emerald-600">{imageCount} 枚</span>
            </div>
          </div>

          {/* 成功メッセージ */}
          {exportSuccess && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-2xl p-3 text-xs flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              <span>{exportSuccess}</span>
            </div>
          )}

          {/* バックアップボタン群 */}
          <div className="space-y-3">
            {/* 1. CSV出力 */}
            <button
              type="button"
              disabled={isExporting}
              onClick={handleExportCSV}
              className="w-full p-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-between shadow-lg shadow-emerald-100 transition-all active:scale-98"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="p-2 bg-emerald-700/60 rounded-xl">
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold">① 明細一覧CSVを出力</div>
                  <div className="text-[10px] text-emerald-100 font-normal">Excel・確定申告対応（BOM付きUTF-8）</div>
                </div>
              </div>
              <span className="text-xs bg-emerald-500/80 px-2 py-1 rounded-lg">保存</span>
            </button>

            {/* 2. 画像ZIP出力 */}
            <button
              type="button"
              disabled={isExporting || imageCount === 0}
              onClick={handleExportZIP}
              className={`w-full p-4 rounded-2xl font-bold flex items-center justify-between shadow-lg transition-all active:scale-98 ${
                imageCount > 0
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-100'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
              }`}
            >
              <div className="flex items-center gap-3 text-left">
                <div className={`p-2 rounded-xl ${imageCount > 0 ? 'bg-blue-700/60 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  <Archive size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold">② 超圧縮レシートZIPを出力</div>
                  <div className={`text-[10px] font-normal ${imageCount > 0 ? 'text-blue-100' : 'text-gray-400'}`}>
                    {imageCount > 0 ? `画像${imageCount}枚を一括極小化バックアップ` : '対象画像がありません'}
                  </div>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-lg ${imageCount > 0 ? 'bg-blue-500/80' : 'bg-gray-200 text-gray-400'}`}>
                Driveへ
              </span>
            </button>

            {/* 3. 機種変更用完全バックアップJSON */}
            <button
              type="button"
              disabled={isExporting}
              onClick={handleExportFullJSON}
              className="w-full p-3.5 bg-gray-800 hover:bg-gray-900 text-white rounded-2xl font-bold flex items-center justify-between shadow-md transition-all active:scale-98"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="p-2 bg-gray-700 rounded-xl">
                  <HardDrive size={18} />
                </div>
                <div>
                  <div className="text-xs font-bold">③ 機種変更・完全復元用JSON</div>
                  <div className="text-[10px] text-gray-400 font-normal">端末紛失・移行時に一瞬で全データ復元</div>
                </div>
              </div>
              <span className="text-[11px] bg-gray-700 px-2 py-1 rounded-lg">エクスポート</span>
            </button>
          </div>

          {isExporting && (
            <div className="flex items-center justify-center gap-2 text-xs text-blue-600 font-bold py-2">
              <RefreshCw size={16} className="animate-spin" />
              ファイル生成中...
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
