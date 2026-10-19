import { useState, useRef, useEffect } from 'react';
import { X, Crop, RotateCw, RefreshCw, Sparkles, Check } from 'lucide-react';
import { applyReceiptCropAndCompress, type CropBoxPct, type CompressionResult } from '../utils/imageCompressor';

interface ReceiptCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceUrl: string;
  initialCropBox?: CropBoxPct;
  originalSize?: number;
  onApply: (result: CompressionResult, shouldReanalyze?: boolean) => void;
  showReanalyzeButton?: boolean;
}

type DragTarget = 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br' | null;

export function ReceiptCropModal({
  isOpen,
  onClose,
  sourceUrl,
  initialCropBox,
  originalSize = 0,
  onApply,
  showReanalyzeButton = false
}: ReceiptCropModalProps) {
  const [cropBox, setCropBox] = useState<CropBoxPct>({ top: 0, bottom: 0, left: 0, right: 0 });
  const [rotateDeg, setRotateDeg] = useState<number>(0);
  const [keepColor, setKeepColor] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setCropBox(initialCropBox || { top: 0, bottom: 0, left: 0, right: 0 });
      setRotateDeg(0);
      setKeepColor(false);
    }
  }, [isOpen, initialCropBox, sourceUrl]);

  if (!isOpen || !sourceUrl) return null;

  // ポインター位置からパーセント座標を計算して枠を更新
  const updateCropFromPointer = (clientX: number, clientY: number, target: DragTarget) => {
    const el = containerRef.current;
    if (!el || !target) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const relX = Math.max(0, Math.min(100, Math.round(((clientX - rect.left) / rect.width) * 100)));
    const relY = Math.max(0, Math.min(100, Math.round(((clientY - rect.top) / rect.height) * 100)));

    setCropBox(prev => {
      const next = { ...prev };
      const minGap = 15; // 最小15%の領域を残す

      if (target === 'top' || target === 'tl' || target === 'tr') {
        next.top = Math.min(Math.max(0, relY), 100 - prev.bottom - minGap);
      }
      if (target === 'bottom' || target === 'bl' || target === 'br') {
        next.bottom = Math.min(Math.max(0, 100 - relY), 100 - prev.top - minGap);
      }
      if (target === 'left' || target === 'tl' || target === 'bl') {
        next.left = Math.min(Math.max(0, relX), 100 - prev.right - minGap);
      }
      if (target === 'right' || target === 'tr' || target === 'br') {
        next.right = Math.min(Math.max(0, 100 - relX), 100 - prev.left - minGap);
      }
      return next;
    });
  };

  const handlePointerDown = (target: DragTarget) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragTarget(target);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragTarget) return;
    e.preventDefault();
    updateCropFromPointer(e.clientX, e.clientY, dragTarget);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragTarget) {
      e.preventDefault();
      setDragTarget(null);
    }
  };

  const handleConfirm = async (reanalyze: boolean) => {
    setIsApplying(true);
    try {
      const res = await applyReceiptCropAndCompress(
        sourceUrl,
        cropBox,
        originalSize,
        rotateDeg,
        keepColor
      );
      onApply(res, reanalyze);
      onClose();
    } catch (err) {
      console.error('手動トリミングエラー:', err);
      alert('画像の切り取りに失敗しました');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[95vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        
        {/* ヘッダー */}
        <div className="p-3.5 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-800 text-white">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-white/20 rounded-xl">
              <Crop size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm">レシート切り取り範囲の手動調整</h3>
              <p className="text-[10px] text-blue-200">青い枠を動かすかスライダーで上下左右を調整</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1">
          
          {/* ワンタップ・プリセット＆回転バー */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCropBox({ top: 0, bottom: 0, left: 0, right: 0 })}
                className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all"
              >
                <RefreshCw size={12} />
                <span>切り取りなし（全体）</span>
              </button>
              <button
                type="button"
                onClick={() => setCropBox({ top: 4, bottom: 4, left: 15, right: 15 })}
                className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-[11px] font-bold active:scale-95 transition-all"
              >
                🧾 縦長レシート枠
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setKeepColor(!keepColor)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                  keepColor
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-gray-100 border-gray-200 text-gray-600'
                }`}
              >
                {keepColor ? '🎨 カラー保持' : '📄 くっきり白黒'}
              </button>
              <button
                type="button"
                onClick={() => setRotateDeg((rotateDeg + 90) % 360)}
                className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all"
                title="写真を90度回転"
              >
                <RotateCw size={12} />
                <span>回転</span>
              </button>
            </div>
          </div>

          {/* ドラッグ操作対応プレビューキャンバス */}
          <div className="bg-gray-950 rounded-2xl p-3 flex items-center justify-center select-none overflow-hidden">
            <div
              ref={containerRef}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="relative inline-block max-h-[340px] touch-none"
            >
              <img
                src={sourceUrl}
                alt="切り取り元画像"
                draggable={false}
                style={{
                  transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined
                }}
                className="max-h-[340px] w-auto object-contain block pointer-events-none select-none transition-transform duration-200"
              />

              {/* 外側の暗いマスク（切り落とされる余白部分） */}
              <div
                className="absolute top-0 left-0 right-0 bg-black/65 pointer-events-none"
                style={{ height: `${cropBox.top}%` }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-black/65 pointer-events-none"
                style={{ height: `${cropBox.bottom}%` }}
              />
              <div
                className="absolute left-0 bg-black/65 pointer-events-none"
                style={{
                  top: `${cropBox.top}%`,
                  bottom: `${cropBox.bottom}%`,
                  width: `${cropBox.left}%`
                }}
              />
              <div
                className="absolute right-0 bg-black/65 pointer-events-none"
                style={{
                  top: `${cropBox.top}%`,
                  bottom: `${cropBox.bottom}%`,
                  width: `${cropBox.right}%`
                }}
              />

              {/* 切り取り枠とドラッグハンドル */}
              <div
                className="absolute border-2 border-blue-400 shadow-[0_0_0_1px_rgba(255,255,255,0.5)]"
                style={{
                  top: `${cropBox.top}%`,
                  bottom: `${cropBox.bottom}%`,
                  left: `${cropBox.left}%`,
                  right: `${cropBox.right}%`
                }}
              >
                {/* 3分割ガイドグリッド線 */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                  <div className="border-r border-b border-white/25" />
                  <div className="border-r border-b border-white/25" />
                  <div className="border-b border-white/25" />
                  <div className="border-r border-b border-white/25" />
                  <div className="border-r border-b border-white/25" />
                  <div className="border-b border-white/25" />
                  <div className="border-r border-white/25" />
                  <div className="border-r border-white/25" />
                  <div />
                </div>

                {/* 上辺ハンドル */}
                <div
                  onPointerDown={handlePointerDown('top')}
                  className="absolute -top-3 left-1/2 -translate-x-1/2 w-14 h-6 flex items-center justify-center cursor-ns-resize"
                >
                  <div className="w-10 h-2 bg-blue-500 border border-white rounded-full shadow" />
                </div>

                {/* 下辺ハンドル */}
                <div
                  onPointerDown={handlePointerDown('bottom')}
                  className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-14 h-6 flex items-center justify-center cursor-ns-resize"
                >
                  <div className="w-10 h-2 bg-blue-500 border border-white rounded-full shadow" />
                </div>

                {/* 左辺ハンドル */}
                <div
                  onPointerDown={handlePointerDown('left')}
                  className="absolute top-1/2 -left-3 -translate-y-1/2 w-6 h-14 flex items-center justify-center cursor-ew-resize"
                >
                  <div className="w-2 h-10 bg-blue-500 border border-white rounded-full shadow" />
                </div>

                {/* 右辺ハンドル */}
                <div
                  onPointerDown={handlePointerDown('right')}
                  className="absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-14 flex items-center justify-center cursor-ew-resize"
                >
                  <div className="w-2 h-10 bg-blue-500 border border-white rounded-full shadow" />
                </div>

                {/* 四隅ハンドル */}
                <div
                  onPointerDown={handlePointerDown('tl')}
                  className="absolute -top-2.5 -left-2.5 w-6 h-6 bg-blue-500 border-2 border-white rounded-full shadow cursor-nwse-resize"
                />
                <div
                  onPointerDown={handlePointerDown('tr')}
                  className="absolute -top-2.5 -right-2.5 w-6 h-6 bg-blue-500 border-2 border-white rounded-full shadow cursor-nesw-resize"
                />
                <div
                  onPointerDown={handlePointerDown('bl')}
                  className="absolute -bottom-2.5 -left-2.5 w-6 h-6 bg-blue-500 border-2 border-white rounded-full shadow cursor-nesw-resize"
                />
                <div
                  onPointerDown={handlePointerDown('br')}
                  className="absolute -bottom-2.5 -right-2.5 w-6 h-6 bg-blue-500 border-2 border-white rounded-full shadow cursor-nwse-resize"
                />
              </div>
            </div>
          </div>

          {/* 上下左右スライダーによる微調整 */}
          <div className="bg-gray-50 p-3 rounded-2xl border border-gray-200 space-y-2.5">
            <div className="flex justify-between items-center text-[11px] font-bold text-gray-600">
              <span>スライダーで細かく位置調整</span>
              <span className="text-[10px] text-gray-400">
                上:{cropBox.top}% / 下:{cropBox.bottom}% / 左:{cropBox.left}% / 右:{cropBox.right}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 w-7 shrink-0">上端</span>
                <input
                  type="range"
                  min="0"
                  max="45"
                  value={cropBox.top}
                  onChange={e => setCropBox({ ...cropBox, top: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 w-7 shrink-0">下端</span>
                <input
                  type="range"
                  min="0"
                  max="45"
                  value={cropBox.bottom}
                  onChange={e => setCropBox({ ...cropBox, bottom: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 w-7 shrink-0">左端</span>
                <input
                  type="range"
                  min="0"
                  max="45"
                  value={cropBox.left}
                  onChange={e => setCropBox({ ...cropBox, left: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 w-7 shrink-0">右端</span>
                <input
                  type="range"
                  min="0"
                  max="45"
                  value={cropBox.right}
                  onChange={e => setCropBox({ ...cropBox, right: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>
          </div>

          {/* 決定ボタン群 */}
          <div className={`grid gap-2 pt-1 ${showReanalyzeButton ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              disabled={isApplying}
              onClick={() => handleConfirm(false)}
              className="py-3 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black rounded-2xl text-xs shadow-md flex items-center justify-center gap-1.5 active:scale-98 transition-all"
            >
              <Check size={16} />
              <span>この範囲で切り取る</span>
            </button>

            {showReanalyzeButton && (
              <button
                type="button"
                disabled={isApplying}
                onClick={() => handleConfirm(true)}
                className="py-3 px-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white font-black rounded-2xl text-xs shadow-md flex items-center justify-center gap-1.5 active:scale-98 transition-all"
              >
                <Sparkles size={16} />
                <span>切り取ってAI再解析</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
