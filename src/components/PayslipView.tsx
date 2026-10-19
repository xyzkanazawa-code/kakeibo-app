import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FileText, Plus, ChevronLeft, ChevronRight, Trash2, Edit3, X, Download, Building2, Link2, TrendingUp, Image as ImageIcon
} from 'lucide-react';
import { db, type Payslip } from '../db';
import { saveOrShareFile } from '../utils/backup';

interface PayslipViewProps {
  onScan: () => void;
  onEdit: (p: Payslip) => void;
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const isTax = (label: string) => /所得税|住民税|市民税|県民税|都民税/.test(label);
const isSocial = (label: string) => /保険|年金|子育て|支援/.test(label);

export function PayslipView({ onScan, onEdit }: PayslipViewProps) {
  const payslips = useLiveQuery(() => db.payslips.orderBy('yearMonth').toArray());
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [detail, setDetail] = useState<Payslip | null>(null);
  const [showImage, setShowImage] = useState(false);

  const yearList = useMemo(() => (payslips || []).filter(p => p.yearMonth.startsWith(String(year))), [payslips, year]);

  const summary = useMemo(() => {
    let gross = 0, ded = 0, net = 0, tax = 0, social = 0, bonus = 0;
    const payItems = new Map<string, number>();
    const dedItems = new Map<string, number>();
    for (const p of yearList) {
      gross += p.totalPayment; ded += p.totalDeduction; net += p.netPay;
      if (p.payType === 'bonus') bonus += p.totalPayment;
      p.payments.forEach(r => payItems.set(r.label, (payItems.get(r.label) || 0) + r.amount));
      p.deductions.forEach(r => {
        dedItems.set(r.label, (dedItems.get(r.label) || 0) + r.amount);
        if (isTax(r.label)) tax += r.amount; else if (isSocial(r.label)) social += r.amount;
      });
    }
    return { gross, ded, net, tax, social, bonus, payItems, dedItems };
  }, [yearList]);

  const monthly = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      const list = yearList.filter(p => p.yearMonth === ym);
      return {
        month: i + 1,
        net: list.reduce((a, p) => a + p.netPay, 0),
        ded: list.reduce((a, p) => a + p.totalDeduction, 0),
        hasBonus: list.some(p => p.payType === 'bonus')
      };
    });
  }, [yearList, year]);
  const maxMonthly = Math.max(1, ...monthly.map(m => m.net + m.ded));

  const handleDelete = async (p: Payslip) => {
    if (!p.id || !confirm(`${p.yearMonth.replace('-', '年')}月分の明細を削除しますか？`)) return;
    if (p.transactionId) {
      const tx = await db.transactions.get(p.transactionId);
      if (tx && confirm('連携している収入明細も削除しますか？（口座残高も元に戻ります）')) {
        if (tx.walletId) {
          const w = await db.wallets.get(tx.walletId);
          if (w) await db.wallets.update(tx.walletId, { balance: w.balance - tx.amount });
        }
        await db.transactions.delete(p.transactionId);
      }
    }
    await db.payslips.delete(p.id);
    setDetail(null);
  };

  const exportCsv = async () => {
    const list = payslips || [];
    if (list.length === 0) return;
    const att = [...new Set(list.flatMap(p => p.attendance.map(r => r.label)))];
    const pay = [...new Set(list.flatMap(p => p.payments.map(r => r.label)))];
    const ded = [...new Set(list.flatMap(p => p.deductions.map(r => r.label)))];
    const oth = [...new Set(list.flatMap(p => p.others.map(r => r.label)))];
    const header = ['対象年月', '種別', '支給日', '会社名', '氏名', '社員番号', '所属',
      ...att.map(l => `[勤怠]${l}`), ...pay.map(l => `[支給]${l}`), ...ded.map(l => `[控除]${l}`), ...oth.map(l => `[その他]${l}`),
      '支給合計', '控除合計', '差引支給額', '振込支給額', '現金支給額', '現物支給額', '税額表', '扶養人数', '備考'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = list.map(p => [
      p.yearMonth, p.payType === 'bonus' ? '賞与' : '給与', p.payDate, p.companyName, p.employeeName, p.employeeCode, p.department,
      ...att.map(l => p.attendance.find(r => r.label === l)?.value ?? ''),
      ...pay.map(l => p.payments.filter(r => r.label === l).reduce((a, r) => a + r.amount, 0) || ''),
      ...ded.map(l => p.deductions.filter(r => r.label === l).reduce((a, r) => a + r.amount, 0) || ''),
      ...oth.map(l => p.others.filter(r => r.label === l).reduce((a, r) => a + r.amount, 0) || ''),
      p.totalPayment, p.totalDeduction, p.netPay, p.bankTransfer ?? '', p.cashPayment ?? '', p.inKindPayment ?? '', p.taxTable, p.dependents ?? '', p.notes
    ].map(esc).join(','));
    const blob = new Blob(['\uFEFF' + [header.map(esc).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    await saveOrShareFile(blob, `給与明細一覧_${new Date().toISOString().slice(0, 10)}.csv`, '給与明細一覧');
  };

  return (
    <section className="space-y-4 pb-16">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-1">
        <h2 className="font-black text-gray-800 text-sm flex items-center gap-1.5"><FileText size={16} className="text-emerald-600" /> 給与明細管理</h2>
        <button type="button" id="payslip-export-csv" onClick={exportCsv} disabled={!payslips?.length}
          className="text-[11px] font-bold text-gray-500 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-40">
          <Download size={13} /> CSV出力
        </button>
      </div>

      {/* 年間サマリー */}
      <div className="rounded-3xl p-5 text-white shadow-xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 relative overflow-hidden">
        <div className="absolute -right-6 -top-6 opacity-10"><TrendingUp size={140} /></div>
        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between">
            <button type="button" id="payslip-prev-year" onClick={() => setYear(y => y - 1)} className="p-1 rounded-full hover:bg-white/20"><ChevronLeft size={18} /></button>
            <span className="text-sm font-black">{year}年 年間累計（{yearList.length}件）</span>
            <button type="button" id="payslip-next-year" onClick={() => setYear(y => y + 1)} className="p-1 rounded-full hover:bg-white/20"><ChevronRight size={18} /></button>
          </div>
          <div>
            <span className="text-[11px] text-emerald-100">手取り合計</span>
            <p className="text-3xl font-black tracking-tight">{yen(summary.net)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="総支給額" value={yen(summary.gross)} />
            <Stat label="控除合計" value={yen(summary.ded)} />
            <Stat label="社会保険料" value={yen(summary.social)} />
            <Stat label="税金（所得税・住民税）" value={yen(summary.tax)} />
          </div>
          {summary.bonus > 0 && <p className="text-[10px] text-emerald-100">うち賞与 総支給 {yen(summary.bonus)}</p>}
        </div>
      </div>

      {/* 月別グラフ */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-2">
        <div className="flex items-center justify-between text-xs">
          <h3 className="font-bold text-gray-700">月別 手取り / 控除</h3>
          <div className="flex gap-2 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />手取り</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-rose-300 inline-block" />控除</span>
          </div>
        </div>
        <div className="flex items-end gap-1 h-32">
          {monthly.map(m => {
            const total = m.net + m.ded;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                <div className="w-full flex flex-col justify-end rounded-t-md overflow-hidden transition-all group-hover:opacity-80"
                  style={{ height: `${(total / maxMonthly) * 100}%` }} title={total ? `手取り${yen(m.net)} / 控除${yen(m.ded)}` : ''}>
                  <div className="bg-rose-300" style={{ height: total ? `${(m.ded / total) * 100}%` : 0 }} />
                  <div className="bg-gradient-to-t from-emerald-600 to-emerald-400 flex-1" />
                </div>
                <span className={`text-[9px] ${m.hasBonus ? 'text-amber-600 font-black' : 'text-gray-400'}`}>{m.month}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 読み取りボタン */}
      <button type="button" id="payslip-scan-btn" onClick={onScan}
        className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black text-sm shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all">
        <Plus size={18} /> 給与明細を読み取る
      </button>

      {/* 明細一覧 */}
      <div className="space-y-2">
        {yearList.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-6">{year}年の給与明細はまだありません</p>
        )}
        {yearList.slice().reverse().map(p => (
          <button type="button" key={p.id} id={`payslip-item-${p.id}`} onClick={() => { setDetail(p); setShowImage(false); }}
            className="w-full text-left bg-white p-3.5 rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 hover:bg-emerald-50/30 active:scale-[0.99] transition-all flex items-center justify-between">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold text-white ${p.payType === 'bonus' ? 'bg-amber-500' : 'bg-emerald-600'}`}>
                  {p.payType === 'bonus' ? '賞与' : '給与'}
                </span>
                <span className="font-black text-sm text-gray-800">{Number(p.yearMonth.slice(5))}月分</span>
                {p.transactionId && <Link2 size={12} className="text-blue-500" />}
              </div>
              <p className="text-[10px] text-gray-400 truncate">支給日 {p.payDate}{p.companyName ? ` · ${p.companyName}` : ''}</p>
              <p className="text-[10px] text-gray-500">総支給 {yen(p.totalPayment)} / 控除 {yen(p.totalDeduction)}</p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] text-gray-400 block">手取り</span>
              <span className="font-black text-emerald-600 text-base">{yen(p.netPay)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 項目別年間集計 */}
      {yearList.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-700 text-xs">{year}年 項目別累計</h3>
          <ItemTotals title="支給" items={summary.payItems} color="text-emerald-700" />
          <ItemTotals title="控除" items={summary.dedItems} color="text-rose-600" />
        </div>
      )}

      {/* 詳細モーダル */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-md max-h-[92vh] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-4 shrink-0">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[11px] text-emerald-100">{detail.title || `${detail.yearMonth} ${detail.payType === 'bonus' ? '賞与' : '給与'}明細`}</p>
                  <p className="text-2xl font-black">{yen(detail.netPay)}</p>
                  <p className="text-[10px] text-emerald-100">差引支給額 · 支給日 {detail.payDate}</p>
                </div>
                <button type="button" id="payslip-detail-close" onClick={() => setDetail(null)} className="p-1.5 rounded-full hover:bg-white/20"><X size={18} /></button>
              </div>
            </div>
            <div className="overflow-y-auto p-4 space-y-3 text-xs">
              {(detail.companyName || detail.employeeName) && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Building2 size={14} />
                  <span>{detail.companyName}</span>
                  {detail.employeeName && <span className="text-gray-400">/ {detail.employeeCode ? `(${detail.employeeCode}) ` : ''}{detail.employeeName}{detail.department ? `・${detail.department}` : ''}</span>}
                </div>
              )}
              {detail.image && (
                <div>
                  <button type="button" onClick={() => setShowImage(s => !s)} className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                    <ImageIcon size={13} /> {showImage ? '画像を閉じる' : '明細画像を表示'}
                  </button>
                  {showImage && <img src={detail.image} alt="給与明細" className="mt-2 w-full rounded-xl border" />}
                </div>
              )}
              <DetailBlock title="勤怠" rows={detail.attendance.map(r => [r.label, r.value])} tone="amber" />
              <DetailBlock title="支給" rows={detail.payments.map(r => [r.label, yen(r.amount)])} total={yen(detail.totalPayment)} tone="emerald" />
              <DetailBlock title="控除" rows={detail.deductions.map(r => [r.label, yen(r.amount)])} total={yen(detail.totalDeduction)} tone="rose" />
              {detail.others.length > 0 && <DetailBlock title="その他" rows={detail.others.map(r => [r.label, yen(r.amount)])} total={yen(detail.otherTotal || 0)} tone="slate" />}
              <DetailBlock title="支給方法" tone="teal" rows={[
                ['差引支給額', yen(detail.netPay)],
                ['振込支給額', yen(detail.bankTransfer || 0)],
                ['現金支給額', yen(detail.cashPayment || 0)],
                ['現物支給額', yen(detail.inKindPayment || 0)],
                ...(detail.taxTable ? [['税額表', detail.taxTable]] : []),
                ['扶養人数', `${detail.dependents ?? 0}人`]
              ] as [string, string][]} />
              {(detail.extraFields?.length || 0) > 0 && (
                <DetailBlock title="その他の記入項目" tone="slate" rows={detail.extraFields!.map(f => [`${f.section ? `[${f.section}] ` : ''}${f.label}`, f.value])} />
              )}
              {detail.notes && <p className="p-2 rounded-lg bg-gray-50 text-gray-600">📝 {detail.notes}</p>}
              {detail.transactionId && <p className="text-[10px] text-blue-600 flex items-center gap-1"><Link2 size={11} /> 家計簿の収入に登録済み</p>}
            </div>
            <div className="p-3 border-t grid grid-cols-2 gap-2 shrink-0">
              <button type="button" id="payslip-detail-edit" onClick={() => { const d = detail; setDetail(null); onEdit(d); }}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs"><Edit3 size={14} /> 編集</button>
              <button type="button" id="payslip-detail-delete" onClick={() => handleDelete(detail)}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-50 text-red-600 font-bold text-xs border border-red-200"><Trash2 size={14} /> 削除</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/10 rounded-xl p-2 backdrop-blur-sm">
      <span className="text-[10px] text-emerald-100 block">{label}</span>
      <span className="font-black text-sm">{value}</span>
    </div>
  );
}

function ItemTotals({ title, items, color }: { title: string; items: Map<string, number>; color: string }) {
  const list = [...items.entries()].sort((a, b) => b[1] - a[1]);
  if (list.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className={`text-[11px] font-black ${color}`}>{title}</p>
      {list.map(([label, amt]) => (
        <div key={label} className="flex justify-between text-[11px] text-gray-600 border-b border-dashed border-gray-100 py-0.5">
          <span>{label}</span><span className="font-bold text-gray-800">{yen(amt)}</span>
        </div>
      ))}
    </div>
  );
}

const toneMap: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  rose: 'bg-rose-50 text-rose-700 border-rose-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
  teal: 'bg-teal-50 text-teal-800 border-teal-100',
  slate: 'bg-gray-50 text-gray-700 border-gray-100'
};

function DetailBlock({ title, rows, total, tone }: { title: string; rows: [string, string][]; total?: string; tone: string }) {
  if (rows.length === 0 && !total) return null;
  return (
    <div className={`rounded-xl border overflow-hidden ${toneMap[tone]}`}>
      <div className="px-3 py-1.5 font-black text-[11px]">{title}</div>
      <div className="bg-white divide-y divide-gray-50">
        {rows.map(([l, v], i) => (
          <div key={i} className="flex justify-between px-3 py-1.5 text-gray-700"><span>{l}</span><span className="font-bold text-gray-900">{v}</span></div>
        ))}
        {total && <div className="flex justify-between px-3 py-1.5 font-black bg-gray-50/80 text-gray-900"><span>合計</span><span>{total}</span></div>}
      </div>
    </div>
  );
}
