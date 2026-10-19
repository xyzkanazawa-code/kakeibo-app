import { useState } from 'react';
import { X, Copy, Check, QrCode, Smartphone, ExternalLink } from 'lucide-react';

interface ShareAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShareAppModal({ isOpen, onClose }: ShareAppModalProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const appUrl = 'https://masa-kakeibo.surge.sh';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(appUrl)}&margin=10`;

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック
      const input = document.createElement('input');
      input.value = appUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        
        {/* 閉じるボタン */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full"
        >
          <X size={20} />
        </button>

        {/* ヘッダー */}
        <div className="text-center space-y-1 mb-4">
          <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
            <Smartphone size={24} />
          </div>
          <h3 className="font-bold text-gray-800 text-base">スマホ（Pixel 9）で開く</h3>
          <p className="text-xs text-gray-500">QRコード読み取り、またはURLをコピー</p>
        </div>

        {/* QRコード表示 */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex flex-col items-center justify-center mb-4">
          <img
            src={qrUrl}
            alt="スマホ用QRコード"
            className="w-44 h-44 rounded-xl shadow-sm border border-gray-100"
          />
          <span className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
            <QrCode size={12} /> スマホのカメラでかざすだけ！
          </span>
        </div>

        {/* URLコピーエリア */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 bg-gray-100 p-2 rounded-xl border border-gray-200">
            <input
              type="text"
              readOnly
              value={appUrl}
              className="bg-transparent text-xs text-gray-700 font-mono w-full outline-none px-1"
            />
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md ${
              copied
                ? 'bg-emerald-600 text-white shadow-emerald-200'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
            }`}
          >
            {copied ? (
              <>
                <Check size={16} /> URLをコピーしました！
              </>
            ) : (
              <>
                <Copy size={16} /> URLをコピーする
              </>
            )}
          </button>
        </div>

        {/* 開くリンク */}
        <div className="mt-3 text-center">
          <a
            href={appUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-600 font-bold hover:underline inline-flex items-center gap-1"
          >
            ブラウザで直接開く <ExternalLink size={11} />
          </a>
        </div>

      </div>
    </div>
  );
}
