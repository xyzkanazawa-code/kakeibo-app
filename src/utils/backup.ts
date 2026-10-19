import JSZip from 'jszip';
import { db, type Transaction } from '../db';

/**
 * 月次明細CSVの生成（UTF-8 BOM付き）
 */
export function generateMonthlyCSV(transactions: Transaction[], _yearMonth?: string): Blob {
  const headers = [
    '日付',
    '種別',
    '金額',
    'カテゴリ',
    '店名・サービス名',
    '商品・品目名',
    '電話番号',
    '住所',
    '出金元/入金先ID',
    'メモ',
    'お気に入り',
    '元画像サイズ(B)',
    '圧縮後サイズ(B)'
  ];

  const typeLabels: Record<string, string> = {
    expense: '出金（支出）',
    income: '入金（収入）',
    transfer: '振替（チャージ）'
  };

  const rows = transactions.map(t => [
    `"${t.date || ''}"`,
    `"${typeLabels[t.type] || t.type}"`,
    t.amount,
    `"${t.category || ''}"`,
    `"${(t.shopName || '').replace(/"/g, '""')}"`,
    `"${(t.itemName || '').replace(/"/g, '""')}"`,
    `"${t.phone || ''}"`,
    `"${(t.address || '').replace(/"/g, '""')}"`,
    t.walletId || '',
    `"${(t.memo || '').replace(/"/g, '""')}"`,
    t.isFavorite ? '★' : '',
    t.origSize || '',
    t.compSize || ''
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
}

/**
 * 月次超圧縮画像のZIPアーカイブ生成
 */
export async function generateImagesZip(transactions: Transaction[], yearMonth: string): Promise<Blob> {
  const zip = new JSZip();
  let count = 0;

  for (const t of transactions) {
    if (t.receiptImage) {
      const base64Data = t.receiptImage.split(',')[1];
      if (base64Data) {
        const fileName = `${t.date}_${t.shopName || 'レシート'}_${t.id}_receipt.webp`;
        zip.file(fileName, base64Data, { base64: true });
        count++;
      }
    }
    if (t.productImage) {
      const base64Data = t.productImage.split(',')[1];
      if (base64Data) {
        const fileName = `${t.date}_${t.itemName || '商品'}_${t.id}_product.webp`;
        zip.file(fileName, base64Data, { base64: true });
        count++;
      }
    }
  }

  // READMEファイルもZIP内に同梱
  zip.file('README.txt', `超圧縮Google Driveバックアップ\n対象年月: ${yearMonth}\n画像枚数: ${count}枚\nWebP超圧縮フォーマット`);

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * 完全復元用バックアップJSONの生成
 */
export async function generateFullBackupJSON(): Promise<Blob> {
  const transactions = await db.transactions.toArray();
  const wallets = await db.wallets.toArray();
  const shops = await db.shops.toArray();
  const settings = await db.settings.toArray();
  const payslips = await db.payslips.toArray();

  const backupData = {
    version: 3,
    exportedAt: new Date().toISOString(),
    transactions,
    wallets,
    shops,
    settings,
    payslips
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  return new Blob([jsonStr], { type: 'application/json' });
}

/**
 * ファイルの保存（Web Share API または ブラウザダウンロード）
 */
export async function saveOrShareFile(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: blob.type });

  // Web Share API（Android Google Drive等への直接共有）
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: title,
        text: `家計簿アプリのバックアップデータ: ${filename}`
      });
      return true;
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        console.warn('Share failed, fallback to download', err);
      } else {
        return false;
      }
    }
  }

  // フォールバック: aタグによるダウンロード
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
