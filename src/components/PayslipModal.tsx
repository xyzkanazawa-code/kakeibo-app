import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  X, Camera, ImagePlus, Loader2, Sparkles, Plus, Trash2, AlertTriangle, CheckCircle2, Save, FileText, PenLine
} from 'lucide-react';
import { db, type Payslip, type PayslipAmountRow, type PayslipValueRow, type PayslipExtraField } from '../db';
import { getAppConfig } from '../utils/configStorage';
import { prepareImageForGeminiOcr, compressProductImage } from '../utils/imageCompressor';
import { analyzePayslipWithGemini, checkPayslipConsistency, toNumber, type PayslipDraft } from '../utils/payslipOcr';

interface PayslipModalProps {
  isOpen: boolean;
  onClose: () => void;
  editing?: Payslip | null;
  onOpenSettings?: () => void;
}

const emptyDraft = (): PayslipDraft => {
  const today = new Date().toISOString().split('T')[0];
  return {
    payType: 'salary',
    title: '',
    yearMonth: today.slice(0, 7),
    payDate: today,
    companyName: '',
    employeeName: '',
    employeeCode: '',
    department: '',
    attendance: [],
    payments: [{ label: '基本給', amount: 0 }],
    deductions: [],
    others: [],
    totalPayment: 0,
    totalDeduction: 0,
    otherTotal: 0,
    netPay: 0,
    bankTransfer: 0,
    cashPayment: 0,
    inKindPayment: 0,
    taxTable: '',
    dependents: 0,
    notes: '',
    extraFields: []
  };
};

type Step = 'pick' | 'analyzing' | 'review';

export function PayslipModal({ isOpen, onClose, editing, onOpenSettings }: PayslipModalProps) {
  const wallets = useLiveQuery(() => db.wallets.toArray());
  const [step, setStep] = useState<Step>('pick');
  const [draft, setDraft] = useState<PayslipDraft>(emptyDraft());
  const [image, setImage] = useState<string | undefined>();
  const [error, setError] = useState<string>('');
  const [linkIncome, setLinkIncome] = useState(true);
  const [walletId, setWalletId] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSaving(false);
    if (editing) {
      const { id: _id, createdAt: _c, updatedAt: _u, transactionId, image: img, ...rest } = editing;
      setDraft({ ...emptyDraft(), ...rest });
      setImage(img);
      setLinkIncome(Boolean(transactionId));
      setStep('review');
    } else {
      setDraft(emptyDraft());
      setImage(undefined);
      setLinkIncome(true);
      setStep('pick');
    }
  }, [isOpen, editing]);

  useEffect(() => {
    if (walletId || !wallets?.length) return;
    const bank = wallets.find(w => w.type === 'bank') || wallets[0];
    setWalletId(bank.id);
  }, [wallets, walletId]);

  useEffect(() => {
    if (!editing?.transactionId) return;
    db.transactions.get(editing.transactionId).then(t => t?.walletId && setWalletId(t.walletId));
  }, [editing]);

  if (!isOpen) return null;

  const handleFile = async (file?: File) => {
    if (!file) return;
    const apiKey = getAppConfig()?.geminiApiKey?.trim();
    setError('');
    try {
      const [ocrUrl, compressed] = await Promise.all([prepareImageForGeminiOcr(file), compressProductImage(file)]);
      setImage(compressed.dataUrl);
      if (!apiKey) {
        setError('Gemini APIキーが未設定のため自動読取できません。設定画面でAPIキーを登録するか、手入力してください。');
        setStep('review');
        return;
      }
      setStep('analyzing');
      const result = await analyzePayslipWithGemini(ocrUrl, apiKey);
      setDraft(result);
      setStep('review');
    } catch (e: any) {
      setError(e?.message || '読み取りに失敗しました');
      setStep('review');
    }
  };

  const set = <K extends keyof PayslipDraft>(key: K, value: PayslipDraft[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const recalcTotals = () => {
    setDraft(d => {
      const tp = d.payments.reduce((a, r) => a + r.amount, 0);
      const td = d.deductions.reduce((a, r) => a + r.amount, 0);
      return { ...d, totalPayment: tp, totalDeduction: td, netPay: tp - td, bankTransfer: d.bankTransfer ? tp - td - (d.cashPayment || 0) : d.bankTransfer };
    });
  };

  const warnings = checkPayslipConsistency(draft);

  const handleSave = async () => {
    if (!/^\d{4}-\d{2}$/.test(draft.yearMonth)) {
      setError('対象年月を正しく入力してください');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const label = draft.payType === 'bonus' ? '賞与' : '給与';
      const [y, m] = draft.yearMonth.split('-');

      if (!editing) {
        const dup = await db.payslips.where('yearMonth').equals(draft.yearMonth).filter(p => p.payType === draft.payType).first();
        if (dup && !confirm(`${Number(y)}年${Number(m)}月分の${label}明細は既に登録されています。別の明細として追加しますか？`)) {
          setSaving(false);
          return;
        }
      }

      let transactionId = editing?.transactionId;
      const memo = `${Number(y)}年${Number(m)}月分 ${label}明細（総支給¥${draft.totalPayment.toLocaleString()} / 控除¥${draft.totalDeduction.toLocaleString()}）`;

      // --- 収入明細との連携（残高も同期） ---
      if (linkIncome && walletId) {
        const existingTx = transactionId ? await db.transactions.get(transactionId) : undefined;
        if (existingTx) {
          if (existingTx.walletId) {
            const oldW = await db.wallets.get(existingTx.walletId);
            if (oldW) await db.wallets.update(existingTx.walletId, { balance: oldW.balance - existingTx.amount });
          }
          await db.transactions.update(existingTx.id!, {
            amount: draft.netPay, date: draft.payDate, category: label,
            shopName: draft.companyName || label, walletId, memo
          });
        } else {
          transactionId = await db.transactions.add({
            type: 'income', amount: draft.netPay, date: draft.payDate, category: label,
            shopName: draft.companyName || label, walletId, memo, createdAt: now
          }) as number;
        }
        const w = await db.wallets.get(walletId);
        if (w) await db.wallets.update(walletId, { balance: w.balance + draft.netPay });
      } else if (!linkIncome && transactionId) {
        const tx = await db.transactions.get(transactionId);
        if (tx && confirm('連携済みの収入明細も削除しますか？（口座残高も元に戻ります）')) {
          if (tx.walletId) {
            const w = await db.wallets.get(tx.walletId);
            if (w) await db.wallets.update(tx.walletId, { balance: w.balance - tx.amount });
          }
          await db.transactions.delete(transactionId);
        }
        transactionId = undefined;
      }

      const record: Payslip = { ...draft, image, transactionId, createdAt: editing?.createdAt || now, updatedAt: now };
      if (editing?.id) await db.payslips.put({ ...record, id: editing.id });
      else await db.payslips.add(record);
      onClose();
    } catch (e: any) {
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md max-h-[94vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-[slideUp_.25s_ease-out]">
        {/* ヘッダー */}
        <div className="bg-gradient-to-r from-teal-600 via-emerald-600 to-green-600 text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={18} />
            <h2 className="font-black text-sm">{editing ? '給与明細の編集' : '給与明細の読み取り'}</h2>
          </div>
          <button type="button" id="payslip-modal-close" onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {/* ===== 画像選択 ===== */}
          {step === 'pick' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 p-4 text-xs text-emerald-900 space-y-1">
                <p className="font-black flex items-center gap-1"><Sparkles size={14} /> AIが明細の記入欄をすべて抽出します</p>
                <p className="text-emerald-700">勤怠・支給・控除・その他・差引支給額・振込額・税額表・扶養人数まで項目ごとに保存します。</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" id="payslip-camera-btn" onClick={() => cameraRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-5 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-200 active:scale-95 transition-all">
                  <Camera size={26} />
                  <span className="text-xs font-black">カメラで撮影</span>
                </button>
                <button type="button" id="payslip-gallery-btn" onClick={() => galleryRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-5 rounded-2xl bg-white border-2 border-emerald-200 text-emerald-700 active:scale-95 transition-all hover:bg-emerald-50">
                  <ImagePlus size={26} />
                  <span className="text-xs font-black">写真を選択</span>
                </button>
              </div>
              <button type="button" id="payslip-manual-btn" onClick={() => setStep('review')}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 py-2 hover:text-gray-800">
                <PenLine size={13} /> 画像なしで手入力する
              </button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
              <input ref={galleryRef} type="file" accept="image/*" className="hidden"
                onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          )}

          {/* ===== 解析中 ===== */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center gap-3 py-10">
              {image && <img src={image} alt="給与明細" className="w-full max-h-48 object-contain rounded-xl border opacity-60" />}
              <Loader2 size={32} className="animate-spin text-emerald-600" />
              <p className="text-sm font-bold text-gray-700">AIが明細を読み取り中…</p>
              <p className="text-[11px] text-gray-400">全ての記入欄を抽出しています</p>
            </div>
          )}

          {/* ===== 確認・編集 ===== */}
          {step === 'review' && (
            <div className="space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-700 flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p>{error}</p>
                    {error.includes('APIキー') && onOpenSettings && (
                      <button type="button" onClick={onOpenSettings} className="font-bold underline">設定を開く</button>
                    )}
                  </div>
                </div>
              )}

              {image && <img src={image} alt="給与明細" className="w-full max-h-56 object-contain rounded-xl border border-gray-200 bg-gray-50" />}

              {/* 基本情報 */}
              <Section title="基本情報" color="slate">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="種別">
                    <select id="payslip-type" value={draft.payType} onChange={e => set('payType', e.target.value as 'salary' | 'bonus')} className={inputCls}>
                      <option value="salary">給与</option>
                      <option value="bonus">賞与</option>
                    </select>
                  </Field>
                  <Field label="対象年月">
                    <input id="payslip-year-month" type="month" value={draft.yearMonth} onChange={e => set('yearMonth', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="支給日">
                    <input id="payslip-pay-date" type="date" value={draft.payDate} onChange={e => set('payDate', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="会社名">
                    <input id="payslip-company" value={draft.companyName || ''} onChange={e => set('companyName', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="氏名">
                    <input id="payslip-employee" value={draft.employeeName || ''} onChange={e => set('employeeName', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="社員番号">
                    <input id="payslip-code" value={draft.employeeCode || ''} onChange={e => set('employeeCode', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="所属">
                    <input id="payslip-dept" value={draft.department || ''} onChange={e => set('department', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="税額表 / 扶養">
                    <div className="flex gap-1">
                      <input id="payslip-tax-table" value={draft.taxTable || ''} placeholder="甲欄" onChange={e => set('taxTable', e.target.value)} className={inputCls} />
                      <input id="payslip-dependents" type="number" value={draft.dependents ?? 0} onChange={e => set('dependents', toNumber(e.target.value))} className={`${inputCls} w-14`} />
                    </div>
                  </Field>
                </div>
              </Section>

              <ValueRowsEditor title="勤怠" rows={draft.attendance} onChange={r => set('attendance', r)} />
              <AmountRowsEditor title="支給" color="emerald" rows={draft.payments} onChange={r => set('payments', r)} idPrefix="pay" />
              <AmountRowsEditor title="控除" color="rose" rows={draft.deductions} onChange={r => set('deductions', r)} idPrefix="ded" />
              <AmountRowsEditor title="その他" color="slate" rows={draft.others} onChange={r => set('others', r)} idPrefix="oth" />

              {/* 合計 */}
              <Section title="合計・支給方法" color="teal" action={
                <button type="button" id="payslip-recalc" onClick={recalcTotals} className="text-[10px] font-bold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">項目から再計算</button>
              }>
                <div className="grid grid-cols-2 gap-2">
                  <MoneyField id="payslip-total-payment" label="支給合計" value={draft.totalPayment} onChange={v => set('totalPayment', v)} />
                  <MoneyField id="payslip-total-deduction" label="控除合計" value={draft.totalDeduction} onChange={v => set('totalDeduction', v)} />
                  <MoneyField id="payslip-net-pay" label="差引支給額（手取り）" value={draft.netPay} onChange={v => set('netPay', v)} highlight />
                  <MoneyField id="payslip-other-total" label="その他合計" value={draft.otherTotal || 0} onChange={v => set('otherTotal', v)} />
                  <MoneyField id="payslip-bank" label="振込支給額" value={draft.bankTransfer || 0} onChange={v => set('bankTransfer', v)} />
                  <MoneyField id="payslip-cash" label="現金支給額" value={draft.cashPayment || 0} onChange={v => set('cashPayment', v)} />
                  <MoneyField id="payslip-inkind" label="現物支給額" value={draft.inKindPayment || 0} onChange={v => set('inKindPayment', v)} />
                </div>
                {warnings.length > 0 ? (
                  <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[10px] text-amber-800 space-y-0.5">
                    {warnings.map(w => <p key={w} className="flex gap-1"><AlertTriangle size={11} className="shrink-0 mt-0.5" />{w}</p>)}
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-emerald-700 flex items-center gap-1"><CheckCircle2 size={12} /> 合計はすべて一致しています</p>
                )}
              </Section>

              <ExtraFieldsEditor rows={draft.extraFields || []} onChange={r => set('extraFields', r)} />

              <Section title="備考" color="slate">
                <textarea id="payslip-notes" value={draft.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="通信欄・メッセージなど" />
              </Section>

              {/* 家計簿連携 */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-blue-900 cursor-pointer">
                  <input id="payslip-link-income" type="checkbox" checked={linkIncome} onChange={e => setLinkIncome(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  手取り額を家計簿の「収入」に登録する
                </label>
                {linkIncome && (
                  <div className="flex items-center gap-2 text-[11px] text-blue-800">
                    <span className="shrink-0">入金先:</span>
                    <select id="payslip-wallet" value={walletId ?? ''} onChange={e => setWalletId(Number(e.target.value))} className={inputCls}>
                      {wallets?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {step === 'review' && (
          <div className="p-3 border-t border-gray-100 bg-white shrink-0">
            <button type="button" id="payslip-save-btn" disabled={saving} onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black text-sm shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {editing ? '変更を保存' : '給与明細を保存'}（手取り ¥{draft.netPay.toLocaleString()}）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- サブコンポーネント ---------------- */

const inputCls = 'w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400';

const colorMap: Record<string, string> = {
  emerald: 'border-emerald-200 bg-emerald-50/50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50/50 text-rose-800',
  slate: 'border-gray-200 bg-gray-50/60 text-gray-700',
  teal: 'border-teal-200 bg-teal-50/60 text-teal-800',
  amber: 'border-amber-200 bg-amber-50/60 text-amber-800'
};

function Section({ title, color, children, action }: { title: string; color: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border p-3 space-y-2 ${colorMap[color]}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black">{title}</h3>
        {action}
      </div>
      <div className="text-gray-800">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[10px] text-gray-500 font-bold">{label}</span>
      {children}
    </label>
  );
}

function MoneyField({ id, label, value, onChange, highlight }: { id: string; label: string; value: number; onChange: (v: number) => void; highlight?: boolean }) {
  return (
    <Field label={label}>
      <input id={id} inputMode="numeric" value={value ? value.toLocaleString() : '0'} onChange={e => onChange(toNumber(e.target.value))}
        className={`${inputCls} text-right font-bold ${highlight ? 'text-emerald-700 border-emerald-300 bg-emerald-50' : ''}`} />
    </Field>
  );
}

function AmountRowsEditor({ title, color, rows, onChange, idPrefix }: { title: string; color: string; rows: PayslipAmountRow[]; onChange: (r: PayslipAmountRow[]) => void; idPrefix: string }) {
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const update = (i: number, patch: Partial<PayslipAmountRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <Section title={`${title}（${rows.length}項目）`} color={color} action={<span className="text-[11px] font-black">¥{total.toLocaleString()}</span>}>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <input id={`${idPrefix}-label-${i}`} value={r.label} onChange={e => update(i, { label: e.target.value })} className={`${inputCls} flex-1`} placeholder="項目名" />
            <input id={`${idPrefix}-amount-${i}`} inputMode="numeric" value={r.amount.toLocaleString()} onChange={e => update(i, { amount: toNumber(e.target.value) })} className={`${inputCls} w-28 text-right font-bold`} />
            <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" id={`${idPrefix}-add`} onClick={() => onChange([...rows, { label: '', amount: 0 }])} className="text-[11px] font-bold flex items-center gap-1 opacity-80 hover:opacity-100">
          <Plus size={12} /> 項目を追加
        </button>
      </div>
    </Section>
  );
}

function ValueRowsEditor({ title, rows, onChange }: { title: string; rows: PayslipValueRow[]; onChange: (r: PayslipValueRow[]) => void }) {
  const update = (i: number, patch: Partial<PayslipValueRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <Section title={`${title}（${rows.length}項目）`} color="amber">
      <div className="grid grid-cols-1 gap-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <input id={`att-label-${i}`} value={r.label} onChange={e => update(i, { label: e.target.value })} className={`${inputCls} flex-1`} placeholder="項目名" />
            <input id={`att-value-${i}`} value={r.value} onChange={e => update(i, { value: e.target.value })} className={`${inputCls} w-24 text-right font-bold`} />
            <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" id="att-add" onClick={() => onChange([...rows, { label: '', value: '' }])} className="text-[11px] font-bold flex items-center gap-1 text-amber-800 opacity-80 hover:opacity-100">
          <Plus size={12} /> 項目を追加
        </button>
      </div>
    </Section>
  );
}

function ExtraFieldsEditor({ rows, onChange }: { rows: PayslipExtraField[]; onChange: (r: PayslipExtraField[]) => void }) {
  if (rows.length === 0) return null;
  const update = (i: number, patch: Partial<PayslipExtraField>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <Section title={`その他の記入項目（${rows.length}）`} color="slate">
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <input value={r.section} onChange={e => update(i, { section: e.target.value })} className={`${inputCls} w-16`} />
            <input value={r.label} onChange={e => update(i, { label: e.target.value })} className={`${inputCls} flex-1`} />
            <input value={r.value} onChange={e => update(i, { value: e.target.value })} className={`${inputCls} w-24`} />
            <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Section>
  );
}
