import Dexie, { type Table } from 'dexie';

export interface Transaction {
  id?: number;
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  category: string;
  shopName?: string;
  branchName?: string; // 支店名（〇〇店、〇〇支店など）
  address?: string;
  phone?: string;
  itemName?: string; // 代表商品名
  items?: { name: string; price: number; quantity?: number; unitPrice?: number }[]; // 複数商品・品目リスト（個数・単価対応）
  unitPrice?: number; // 単価（底値比較用）
  taxAmount?: number; // 消費税額（円）
  subtotal?: number; // 税抜小計（円）
  walletId?: number; // 出金元 or 入金先
  toWalletId?: number; // 振替の移動先
  payMethod?: 'balance' | 'credit'; // Pay決済時の内訳（残高から引く or クレジットから引く）
  memo?: string; // 一言メモ
  isFavorite?: boolean; // お気に入り
  receiptImage?: string; // 超圧縮WebP Base64（代表または結合画像）
  receiptImages?: string[]; // 長尺レシートの分割撮影画像配列
  productImage?: string; // 超圧縮WebP Base64
  origSize?: number; // 元画像サイズ (Bytes)
  compSize?: number; // 圧縮後サイズ (Bytes)
  createdAt: string;
}

export interface Wallet {
  id?: number;
  name: string;
  balance: number;
  creditBalance?: number; // PayPay等でクレジットカードから引く分の金額
  type: 'cash' | 'bank' | 'credit' | 'pay';
  color: string;
}

export interface ShopMaster {
  id?: number;
  name: string;
  branchName?: string; // 支店名（〇〇店）
  phone?: string;
  address?: string;
  defaultCategory?: string;
  defaultWalletId?: number;
  lastVisited: string;
  visitCount: number;
}

export interface UserSettings {
  id?: number;
  userName?: string; // お名前（例: マサ）
  birthDate?: string; // 生年月日（YYYY-MM-DD）
  closingDay: number; // 締め日 (例: 25)
  monthlyBudget: number; // 月予算
  isBioAuthEnabled: boolean; // 生体認証（指紋・顔認証）有効
  bioCredentialId?: string; // 生体認証のクレデンシャルID
  pinCode?: string; // 4桁PINコード（予備認証）
  isInitialized?: boolean; // 初期登録完了フラグ
}

/** 給与明細の1行（ラベル＋金額） */
export interface PayslipAmountRow {
  label: string;
  amount: number;
}

/** 給与明細の1行（ラベル＋値。日数・時間など） */
export interface PayslipValueRow {
  label: string;
  value: string;
}

/** 上記以外に記入されていた項目（セクション付き） */
export interface PayslipExtraField {
  section: string;
  label: string;
  value: string;
}

export interface Payslip {
  id?: number;
  payType: 'salary' | 'bonus'; // 給与 or 賞与
  title?: string; // 例: 令和8年8月分給与明細書
  yearMonth: string; // 対象年月 YYYY-MM（例: 2026-08）
  payDate: string; // 支給日 YYYY-MM-DD
  companyName?: string;
  employeeName?: string;
  employeeCode?: string; // 社員番号など（例: 7-7）
  department?: string; // 所属
  attendance: PayslipValueRow[]; // 勤怠（出勤日数・有休日数など）
  payments: PayslipAmountRow[]; // 支給（基本給・各種手当）
  deductions: PayslipAmountRow[]; // 控除（社会保険・税金）
  others: PayslipAmountRow[]; // その他欄
  totalPayment: number; // 支給合計（総支給額）
  totalDeduction: number; // 控除合計
  otherTotal?: number; // その他合計
  netPay: number; // 差引支給額（手取り）
  bankTransfer?: number; // 振込支給額
  cashPayment?: number; // 現金支給額
  inKindPayment?: number; // 現物支給額
  taxTable?: string; // 税額表（甲欄/乙欄）
  dependents?: number; // 扶養人数
  notes?: string; // 備考・メッセージ欄
  extraFields?: PayslipExtraField[];
  image?: string; // 圧縮済み明細画像
  transactionId?: number; // 連携した収入明細のID
  createdAt: string;
  updatedAt?: string;
}

export class KakeiboDatabase extends Dexie {
  transactions!: Table<Transaction>;
  wallets!: Table<Wallet>;
  shops!: Table<ShopMaster>;
  settings!: Table<UserSettings>;
  payslips!: Table<Payslip>;

  constructor() {
    super('KakeiboDatabase');
    this.version(1).stores({
      transactions: '++id, type, date, category, shopName, fromWallet, toWallet',
      wallets: '++id, name, type'
    });
    this.version(2).stores({
      transactions: '++id, type, date, category, shopName, itemName, walletId, toWalletId, isFavorite, createdAt',
      wallets: '++id, name, type',
      shops: '++id, &name, phone, address, lastVisited',
      settings: '++id'
    });
    this.version(3).stores({
      transactions: '++id, type, date, category, shopName, itemName, walletId, toWalletId, isFavorite, createdAt',
      wallets: '++id, name, type',
      shops: '++id, &name, phone, address, lastVisited',
      settings: '++id',
      payslips: '++id, yearMonth, payDate, payType, companyName, createdAt'
    });
  }
}

export const db = new KakeiboDatabase();

// Initial data
db.on('populate', async () => {
  await db.wallets.bulkAdd([
    { name: '現金（財布）', balance: 15000, type: 'cash', color: '#10B981' },
    { name: 'PayPay', balance: 8400, type: 'pay', color: '#EF4444' },
    { name: 'メイン銀行', balance: 250000, type: 'bank', color: '#3B82F6' },
    { name: 'クレジットカード', balance: -32000, type: 'credit', color: '#8B5CF6' }
  ]);

  await db.settings.add({
    closingDay: 25,
    monthlyBudget: 150000,
    isBioAuthEnabled: false
  });

  // サンプルデータ（初期表示がわかりやすいように）
  const today = new Date().toISOString().split('T')[0];
  await db.transactions.bulkAdd([
    {
      type: 'expense',
      amount: 2580,
      date: today,
      category: '食費',
      shopName: '業務スーパー 渋谷店',
      address: '東京都渋谷区道玄坂1-2-3',
      phone: '03-1234-5678',
      itemName: 'オーガニックコーヒー豆 500g',
      unitPrice: 580,
      walletId: 2, // PayPay
      memo: '大容量でコスパ最強！リピート決定',
      isFavorite: true,
      origSize: 2450000,
      compSize: 34500,
      createdAt: new Date().toISOString()
    },
    {
      type: 'income',
      amount: 35000,
      date: today,
      category: '副収入',
      shopName: 'クラウドワークス / 個人開発案件',
      walletId: 3, // メイン銀行
      memo: 'Webサイト修正の報酬入金',
      isFavorite: false,
      createdAt: new Date().toISOString()
    }
  ]);

  await db.shops.add({
    name: '業務スーパー 渋谷店',
    phone: '03-1234-5678',
    address: '東京都渋谷区道玄坂1-2-3',
    defaultCategory: '食費',
    defaultWalletId: 2,
    lastVisited: today,
    visitCount: 1
  });
});
