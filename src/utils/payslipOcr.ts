import type { Payslip, PayslipAmountRow, PayslipValueRow, PayslipExtraField } from '../db';
import { callGeminiVisionJson } from './geminiOcr';

/** Payslip から DB 管理用フィールドを除いた解析結果 */
export type PayslipDraft = Omit<Payslip, 'id' | 'createdAt' | 'updatedAt' | 'transactionId'>;

/** 金額文字列 → 数値（"22,792" "¥1,000" "▲500" "-500" などに対応） */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[，,¥円\s]/g, '').replace(/^[▲△]/, '-');
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 和暦（令和/平成）を含む日付文字列を西暦 YYYY-MM-DD / YYYY-MM に変換 */
export function warekiToSeireki(text: string): { ym?: string; ymd?: string } {
  const src = (text || '').replace(/\s/g, '');
  const eras: Record<string, number> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988 };
  const m = src.match(/(令和|平成|R|H)(元|\d{1,2})年(\d{1,2})月(?:(\d{1,2})日)?/);
  if (m) {
    const y = eras[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
    const mm = String(Number(m[3])).padStart(2, '0');
    const ym = `${y}-${mm}`;
    return { ym, ymd: m[4] ? `${ym}-${String(Number(m[4])).padStart(2, '0')}` : undefined };
  }
  const s = src.match(/(\d{4})[年\/-](\d{1,2})[月\/-]?(?:(\d{1,2}))?/);
  if (s) {
    const ym = `${s[1]}-${String(Number(s[2])).padStart(2, '0')}`;
    return { ym, ymd: s[3] ? `${ym}-${String(Number(s[3])).padStart(2, '0')}` : undefined };
  }
  return {};
}

const amountRowSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      label: { type: 'STRING', description: '項目名（明細に印字された通り）' },
      amount: { type: 'NUMBER', description: '金額（円）' }
    },
    required: ['label', 'amount']
  }
};

const PAYSLIP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pay_type: { type: 'STRING', description: 'salary（給与）または bonus（賞与）' },
    title: { type: 'STRING', description: '明細のタイトル（例: 令和8年8月分給与明細書）' },
    year_month_raw: { type: 'STRING', description: 'タイトルにある対象年月の原文（例: 令和8年8月）' },
    year_month: { type: 'STRING', description: '対象年月を西暦 YYYY-MM に変換したもの' },
    pay_date_raw: { type: 'STRING', description: '支給日の原文（例: 令和8年9月10日）' },
    pay_date: { type: 'STRING', description: '支給日を西暦 YYYY-MM-DD に変換したもの' },
    company_name: { type: 'STRING' },
    employee_name: { type: 'STRING', description: '氏名（「様」は除く）' },
    employee_code: { type: 'STRING', description: '氏名の前後にある社員番号・コード（例: 7-7）' },
    department: { type: 'STRING', description: '所属（空欄なら空文字）' },
    attendance: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'STRING', description: '数値は印字どおり（例: 21.00）' }
        },
        required: ['label', 'value']
      }
    },
    payments: amountRowSchema,
    deductions: amountRowSchema,
    others: amountRowSchema,
    total_payment: { type: 'NUMBER', description: '支給合計' },
    total_deduction: { type: 'NUMBER', description: '控除合計' },
    other_total: { type: 'NUMBER', description: 'その他合計' },
    net_pay: { type: 'NUMBER', description: '差引支給額' },
    bank_transfer: { type: 'NUMBER', description: '振込支給額の合計' },
    cash_payment: { type: 'NUMBER', description: '現金支給額' },
    in_kind_payment: { type: 'NUMBER', description: '現物支給額' },
    tax_table: { type: 'STRING', description: '税額表（甲欄/乙欄など）' },
    dependents: { type: 'NUMBER', description: '扶養人数' },
    notes: { type: 'STRING', description: '備考・通信欄の文章（空なら空文字）' },
    extra_fields: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          section: { type: 'STRING' },
          label: { type: 'STRING' },
          value: { type: 'STRING' }
        },
        required: ['section', 'label', 'value']
      }
    }
  },
  required: ['year_month', 'payments', 'deductions', 'total_payment', 'total_deduction', 'net_pay']
};

const PAYSLIP_PROMPT = `あなたは日本の給与明細書・賞与明細書の読み取りに特化したOCRエキスパートです。
画像の明細書に「記入・印字されている項目をすべて」漏れなく抽出し、指定スキーマのJSONのみを返してください。

【抽出ルール】
- 値が記入されている欄はすべて抽出する。項目名だけで値が空欄の行は出力しない。値が「0」と印字されている場合は 0 として出力する。
- 項目名（label）は明細に印字されている表記をそのまま使う（例: 「健康保険料」「(子育て支援)」「非課税通勤費」「無事故手当」）。
- 括弧付きの行（例:「(子育て支援)」）も独立した1行として出力する。
- attendance: 「勤怠」欄の全項目（出勤日数、有休日数、出勤基礎日数、有休残日数、残業時間など）。value は印字どおりの文字列。
- payments: 「支給」欄の全項目（基本給、各種手当、通勤費など）。「合計」行は含めず total_payment に入れる。
- deductions: 「控除」欄の全項目（健康保険料、厚生年金保険、介護保険料、雇用保険料、所得税、住民税など）。「合計」行は含めず total_deduction に入れる。
- others: 「その他」欄の個別項目（合計行は other_total へ）。
- net_pay: 差引支給額（手取り）。bank_transfer: 振込支給額の合計。cash_payment: 現金支給額。in_kind_payment: 現物支給額。
- tax_table: 税額表（甲欄/乙欄）。dependents: 扶養人数。
- 和暦は西暦に変換する（令和N年 = 2018+N年。例: 令和8年 = 2026年）。year_month は「◯月分」の対象年月、pay_date は支給日。
- 上記に当てはまらない記入項目（受領印、メッセージ、口座名など）があれば extra_fields に section/label/value で入れる。
- 賞与明細なら pay_type を "bonus"、それ以外は "salary"。
- 金額のカンマは除去して数値にする。読み取れない欄を推測で埋めない。`;

/** 給与明細画像を Gemini で解析し、全記入項目を抽出 */
export async function analyzePayslipWithGemini(imageDataUrl: string, apiKey: string): Promise<PayslipDraft> {
  const text = await callGeminiVisionJson(imageDataUrl, apiKey, PAYSLIP_PROMPT, PAYSLIP_SCHEMA);
  let p: any;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error('給与明細の解析結果を読み取れませんでした。もう一度お試しください。');
  }

  const amountRows = (arr: unknown): PayslipAmountRow[] =>
    (Array.isArray(arr) ? arr : [])
      .map((r: any) => ({ label: String(r?.label ?? '').trim(), amount: toNumber(r?.amount) }))
      .filter(r => r.label && !/^合\s*計$/.test(r.label));

  const valueRows = (arr: unknown): PayslipValueRow[] =>
    (Array.isArray(arr) ? arr : [])
      .map((r: any) => ({ label: String(r?.label ?? '').trim(), value: String(r?.value ?? '').trim() }))
      .filter(r => r.label && r.value);

  const extra: PayslipExtraField[] = (Array.isArray(p.extra_fields) ? p.extra_fields : [])
    .map((r: any) => ({
      section: String(r?.section ?? '').trim(),
      label: String(r?.label ?? '').trim(),
      value: String(r?.value ?? '').trim()
    }))
    .filter((r: PayslipExtraField) => r.label && r.value);

  // 和暦の原文があればローカルでも変換して検証（AIの西暦変換ミス対策）
  const ymLocal = warekiToSeireki(String(p.year_month_raw || p.title || '')).ym;
  const pdLocal = warekiToSeireki(String(p.pay_date_raw || '')).ymd;
  const today = new Date().toISOString().split('T')[0];
  const yearMonth = ymLocal || (/^\d{4}-\d{2}$/.test(p.year_month) ? p.year_month : today.slice(0, 7));
  const payDate = pdLocal || (/^\d{4}-\d{2}-\d{2}$/.test(p.pay_date) ? p.pay_date : today);

  const payments = amountRows(p.payments);
  const deductions = amountRows(p.deductions);
  const sum = (rows: PayslipAmountRow[]) => rows.reduce((a, r) => a + r.amount, 0);
  const totalPayment = toNumber(p.total_payment) || sum(payments);
  const totalDeduction = toNumber(p.total_deduction) || sum(deductions);

  return {
    payType: p.pay_type === 'bonus' ? 'bonus' : 'salary',
    title: String(p.title || '').trim(),
    yearMonth,
    payDate,
    companyName: String(p.company_name || '').trim(),
    employeeName: String(p.employee_name || '').replace(/様$/, '').trim(),
    employeeCode: String(p.employee_code || '').trim(),
    department: String(p.department || '').trim(),
    attendance: valueRows(p.attendance),
    payments,
    deductions,
    others: amountRows(p.others),
    totalPayment,
    totalDeduction,
    otherTotal: toNumber(p.other_total),
    netPay: toNumber(p.net_pay) || totalPayment - totalDeduction,
    bankTransfer: toNumber(p.bank_transfer),
    cashPayment: toNumber(p.cash_payment),
    inKindPayment: toNumber(p.in_kind_payment),
    taxTable: String(p.tax_table || '').trim(),
    dependents: toNumber(p.dependents),
    notes: String(p.notes || '').trim(),
    extraFields: extra
  };
}

/** 支給合計−控除合計 と 差引支給額 の整合チェック */
export function checkPayslipConsistency(d: Pick<Payslip, 'payments' | 'deductions' | 'totalPayment' | 'totalDeduction' | 'netPay'>): string[] {
  const warns: string[] = [];
  const sumPay = d.payments.reduce((a, r) => a + r.amount, 0);
  const sumDed = d.deductions.reduce((a, r) => a + r.amount, 0);
  if (sumPay !== d.totalPayment) warns.push(`支給項目の合計(¥${sumPay.toLocaleString()})が支給合計(¥${d.totalPayment.toLocaleString()})と一致しません`);
  if (sumDed !== d.totalDeduction) warns.push(`控除項目の合計(¥${sumDed.toLocaleString()})が控除合計(¥${d.totalDeduction.toLocaleString()})と一致しません`);
  if (d.totalPayment - d.totalDeduction !== d.netPay) warns.push(`支給合計−控除合計(¥${(d.totalPayment - d.totalDeduction).toLocaleString()})が差引支給額(¥${d.netPay.toLocaleString()})と一致しません`);
  return warns;
}
