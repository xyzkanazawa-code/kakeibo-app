import { useState } from 'react';
import { Delete, Check } from 'lucide-react';

interface CalcKeypadProps {
  value: number;
  onChange: (val: number) => void;
  onClose: () => void;
}

export function CalcKeypad({ value, onChange, onClose }: CalcKeypadProps) {
  const [expression, setExpression] = useState<string>(value > 0 ? value.toString() : '');

  const handlePress = (key: string) => {
    if (key === 'C') {
      setExpression('');
      onChange(0);
      return;
    }
    if (key === 'BS') {
      const next = expression.slice(0, -1);
      setExpression(next);
      tryEval(next);
      return;
    }
    if (key === 'TAX10') {
      const currentVal = evalSafe(expression) || 0;
      const taxed = Math.round(currentVal * 1.10);
      setExpression(taxed.toString());
      onChange(taxed);
      return;
    }
    if (key === 'TAX8') {
      const currentVal = evalSafe(expression) || 0;
      const taxed = Math.round(currentVal * 1.08);
      setExpression(taxed.toString());
      onChange(taxed);
      return;
    }

    const next = expression + key;
    setExpression(next);
    tryEval(next);
  };

  const tryEval = (exp: string) => {
    // 演算子で終わっていなければ計算
    if (!['+', '-', '*', '/'].includes(exp.slice(-1))) {
      const val = evalSafe(exp);
      if (!isNaN(val) && val >= 0) {
        onChange(val);
      }
    }
  };

  const evalSafe = (exp: string): number => {
    try {
      // 簡易評価
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return ${exp.replace(/×/g, '*').replace(/÷/g, '/') || 0}`);
      return Math.round(fn());
    } catch {
      return 0;
    }
  };

  const handleDone = () => {
    const finalVal = evalSafe(expression);
    onChange(finalVal);
    onClose();
  };

  return (
    <div className="bg-gray-900 text-white rounded-t-3xl p-4 shadow-2xl fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50 animate-in slide-in-from-bottom duration-200">
      {/* 画面上部：計算式と現在値 */}
      <div className="flex justify-between items-center mb-3 px-2">
        <span className="text-xs text-gray-400 font-medium">電卓付きテンキー</span>
        <div className="text-right">
          <div className="text-xs text-gray-400 h-4">{expression || '0'}</div>
          <div className="text-2xl font-bold text-emerald-400">¥{(evalSafe(expression) || 0).toLocaleString()}</div>
        </div>
      </div>

      {/* キーパッド配置 */}
      <div className="grid grid-cols-4 gap-2 text-lg font-semibold">
        <button type="button" onClick={() => handlePress('TAX10')} className="p-3 bg-gray-800 hover:bg-gray-700 text-amber-400 rounded-xl text-xs flex flex-col items-center justify-center">
          <span>税込</span><span className="text-[10px]">10%</span>
        </button>
        <button type="button" onClick={() => handlePress('TAX8')} className="p-3 bg-gray-800 hover:bg-gray-700 text-amber-400 rounded-xl text-xs flex flex-col items-center justify-center">
          <span>税込</span><span className="text-[10px]">8%</span>
        </button>
        <button type="button" onClick={() => handlePress('C')} className="p-3 bg-red-900/60 hover:bg-red-800 text-red-200 rounded-xl">C</button>
        <button type="button" onClick={() => handlePress('BS')} className="p-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl flex items-center justify-center">
          <Delete size={20} />
        </button>

        <button type="button" onClick={() => handlePress('7')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">7</button>
        <button type="button" onClick={() => handlePress('8')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">8</button>
        <button type="button" onClick={() => handlePress('9')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">9</button>
        <button type="button" onClick={() => handlePress('+')} className="p-3 bg-indigo-600/70 hover:bg-indigo-600 text-indigo-100 rounded-xl">＋</button>

        <button type="button" onClick={() => handlePress('4')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">4</button>
        <button type="button" onClick={() => handlePress('5')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">5</button>
        <button type="button" onClick={() => handlePress('6')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">6</button>
        <button type="button" onClick={() => handlePress('-')} className="p-3 bg-indigo-600/70 hover:bg-indigo-600 text-indigo-100 rounded-xl">－</button>

        <button type="button" onClick={() => handlePress('1')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">1</button>
        <button type="button" onClick={() => handlePress('2')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">2</button>
        <button type="button" onClick={() => handlePress('3')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">3</button>
        <button type="button" onClick={() => handlePress('*')} className="p-3 bg-indigo-600/70 hover:bg-indigo-600 text-indigo-100 rounded-xl">×</button>

        <button type="button" onClick={() => handlePress('0')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">0</button>
        <button type="button" onClick={() => handlePress('00')} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl">00</button>
        <button type="button" onClick={handleDone} className="col-span-2 p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center justify-center gap-1 font-bold">
          <Check size={20} /> 決定
        </button>
      </div>
    </div>
  );
}
