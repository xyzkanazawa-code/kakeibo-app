import { useState, useRef } from 'react';
import {
  X,
  Camera,
  Image as ImageIcon,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Edit3,
  Calculator,
  ZoomIn,
  Store,
  Calendar,
  Sparkles as SparklesIcon,
  Plus,
  Trash2,
  Layers,
  FilePlus2,
  ExternalLink,
  Code,
  Save,
  Check,
  Phone,
  MapPin,
  Crop
} from 'lucide-react';
import { db } from '../db';
import {
  compressReceiptImage,
  stitchReceiptImages,
  prepareImageForGeminiOcr,
  applyReceiptCropAndCompress,
  type CompressionResult,
  type CropBoxPct
} from '../utils/imageCompressor';
import {
  analyzeReceiptImage,
  matchAndCorrectShopName
} from '../utils/ocrParser';
import {
  analyzeReceiptWithGemini,
  splitStoreAndBranch,
  getGeminiErrorKind,
  type GeminiReceiptResult,
  type GeminiErrorKind
} from '../utils/geminiOcr';
import {
  getAppConfig,
  saveAppConfig
} from '../utils/configStorage';
import { CalcKeypad } from './CalcKeypad';
import { ReceiptCropModal } from './ReceiptCropModal';
import { useLiveQuery } from 'dexie-react-hooks';

interface LineItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  unitPrice?: number;
}

interface ReceiptPhoto {
  id: string;
  dataUrl: string;
  rawUrl?: string;
  cropBox?: CropBoxPct;
  label: string;
  originalSize: number;
  compressedSize: number;
}

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function ScannerModal({ isOpen, onClose, onOpenSettings }: ScannerModalProps) {
  const shops = useLiveQuery(() => db.shops.toArray());
  const wallets = useLiveQuery(() => db.wallets.toArray());

  // 複数枚レシート写真（長尺レシートの分割撮影対応）
  const [photos, setPhotos] = useState<ReceiptPhoto[]>([]);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number>(0);
  const [stitchedImage, setStitchedImage] = useState<string | null>(null);

  const [compressResult, setCompressResult] = useState<CompressionResult | null>(null);
  const [geminiResult, setGeminiResult] = useState<GeminiReceiptResult | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiErrorKind, setGeminiErrorKind] = useState<GeminiErrorKind | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [inlineApiKey, setInlineApiKey] = useState<string>('');
  const [rawOcrUrl, setRawOcrUrl] = useState<string>('');

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [ocrPercent, setOcrPercent] = useState<number>(0);
  const [ocrStatusText, setOcrStatusText] = useState<string>('準備中...');
  const [isDuplicate, setIsDuplicate] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // 写真拡大プレビュー ＆ 手動切り取りモーダル
  const [isImageZoomed, setIsImageZoomed] = useState<boolean>(false);
  const [isCropModalOpen, setIsCropModalOpen] = useState<boolean>(false);

  // 電卓テンキー
  const [showKeypad, setShowKeypad] = useState<boolean>(false);

  // 手直し用フォームステート
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editTaxAmount, setEditTaxAmount] = useState<number>(0);
  const [editSubtotal, setEditSubtotal] = useState<number>(0);
  const [isTaxIncluded, setIsTaxIncluded] = useState<boolean>(true);
  const [editShopName, setEditShopName] = useState<string>('');
  const [editBranchName, setEditBranchName] = useState<string>(''); // 支店名（〇〇店）
  const [editItems, setEditItems] = useState<LineItem[]>([]);
  const [editCategory, setEditCategory] = useState<string>('食費');
  const [editDate, setEditDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [editPhone, setEditPhone] = useState<string>('');
  const [editAddress, setEditAddress] = useState<string>('');
  const [editWalletId, setEditWalletId] = useState<number>(1);
  const [editPayMethod, setEditPayMethod] = useState<'balance' | 'credit'>('balance');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const appendCameraInputRef = useRef<HTMLInputElement>(null);
  const appendGalleryInputRef = useRef<HTMLInputElement>(null);

  // Gemini 1.5 Flash を実行するコア処理
  const executeGeminiOcr = async (imageUrl: string, explicitApiKey?: string): Promise<boolean> => {
    const config = getAppConfig();
    const apiKey = explicitApiKey?.trim() || config?.geminiApiKey?.trim();

    if (!apiKey) {
      setGeminiError('Gemini APIキーが未設定です。下の入力欄または設定画面からAPIキーを入力してください。');
      return false;
    }

    setIsProcessing(true);
    setOcrPercent(35);
    setOcrStatusText('Gemini AI（最新Flashモデル）にレシート画像を送信中...');
    setGeminiError(null);
    setGeminiErrorKind(null);

    try {
      setOcrPercent(60);
      setOcrStatusText('Gemini AI が購入日・店名・品目・合計を高精度解析中...');

      const result = await analyzeReceiptWithGemini(imageUrl, apiKey, (msg) => {
        setOcrStatusText(msg);
      });
      setOcrPercent(100);
      setGeminiResult(result);
      setGeminiError(null);
      setGeminiErrorKind(null);

      // 手直しステートに反映
      const amountVal = result.totalAmount || 0;
      setEditAmount(amountVal);
      setEditTaxAmount(result.tax_amount || result.taxAmount || 0);
      setEditSubtotal(result.subtotal || 0);
      setIsTaxIncluded(result.tax_included !== false);

      let resolvedShopName = result.store_name || result.shopName || '';
      let resolvedBranchName = result.branch_name || result.branchName || '';

      // もしbranchNameが空で店名に「〇〇店」が含まれていたら自動分離
      if (!resolvedBranchName && resolvedShopName) {
        const split = splitStoreAndBranch(resolvedShopName);
        resolvedShopName = split.storeName;
        resolvedBranchName = split.branchName;
      }

      // 学習補正との照合
      const learnedShopNames = (shops || []).map(s => s.name);
      const shopCorrection = matchAndCorrectShopName(resolvedShopName, learnedShopNames);
      if (shopCorrection.isCorrected) {
        resolvedShopName = shopCorrection.correctedName;
      }

      setEditShopName(resolvedShopName);
      setEditBranchName(resolvedBranchName);
      setEditDate(result.date || new Date().toISOString().split('T')[0]);

      // 電話番号 ＆ 住所の反映（既存店舗マスターからの補完も連動）
      let resolvedPhone = result.phone || '';
      let resolvedAddress = result.address || '';

      if (resolvedShopName) {
        const matchedShop = (shops || []).find(
          s => s.name === resolvedShopName && (!resolvedBranchName || s.branchName === resolvedBranchName)
        );
        if (matchedShop) {
          if (!resolvedPhone && matchedShop.phone) resolvedPhone = matchedShop.phone;
          if (!resolvedAddress && matchedShop.address) resolvedAddress = matchedShop.address;
        }
      }

      setEditPhone(resolvedPhone);
      setEditAddress(resolvedAddress);

      // 品目リストの反映
      if (result.items && result.items.length > 0) {
        setEditItems(
          result.items.map((it, idx) => {
            const qty = Math.max(1, it.quantity || 1);
            const price = it.price || 0;
            const unit = it.unitPrice || (qty > 1 ? Math.round(price / qty) : price);
            return {
              id: `gemini-${Date.now()}-${idx}`,
              name: it.name,
              price: price,
              quantity: qty,
              unitPrice: unit
            };
          })
        );
      } else {
        setEditItems([{ id: `gemini-${Date.now()}-0`, name: '', price: amountVal, quantity: 1, unitPrice: amountVal }]);
      }

      // 二重取り込みチェック
      if (amountVal > 0 && result.date) {
        const existing = await db.transactions
          .where('date')
          .equals(result.date)
          .filter(t => t.amount === amountVal && (t.shopName === resolvedShopName || !resolvedShopName))
          .first();

        if (existing) {
          setIsDuplicate(true);
        }
      }

      return true;
    } catch (err: any) {
      console.error('Gemini OCR解析エラー:', err);
      const kind = getGeminiErrorKind(err);
      setGeminiErrorKind(kind);
      setGeminiError(err.message || 'Gemini APIでの解析に失敗しました。');
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  // 画像選択時の処理
  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setIsProcessing(true);
    setOcrPercent(0);
    setOcrStatusText('レシート画像を圧縮中...');
    setIsDuplicate(false);
    setSavedSuccess(false);
    setGeminiResult(null);
    setGeminiError(null);

    try {
      // 1. 高精度AI解析用カラー画像（非破壊）と保存用超圧縮画像を並行生成
      const [highResOcrUrl, compressed] = await Promise.all([
        prepareImageForGeminiOcr(selectedFile),
        compressReceiptImage(selectedFile, true)
      ]);
      setRawOcrUrl(highResOcrUrl);
      setCompressResult(compressed);

      const firstPhoto: ReceiptPhoto = {
        id: `p-${Date.now()}`,
        dataUrl: compressed.dataUrl,
        rawUrl: compressed.rawUrl || highResOcrUrl,
        cropBox: compressed.cropBox || { top: 0, bottom: 0, left: 0, right: 0 },
        label: '1枚目 (上部)',
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize
      };
      setPhotos([firstPhoto]);
      setSelectedPhotoIdx(0);
      setStitchedImage(compressed.dataUrl);

      // 2. Gemini 1.5 Flash の実行を試行（高精細カラー画像を送信）
      const config = getAppConfig();
      const apiKey = config?.geminiApiKey?.trim();

      if (apiKey) {
        await executeGeminiOcr(highResOcrUrl, apiKey);
      } else {
        // APIキーがない場合はローカルTesseract OCRを実行しつつ、Gemini APIキー設定を促す
        setOcrStatusText('ローカル文字認識中... (Gemini APIキーを設定すると精度が大幅に向上します)');
        const analyzed = await analyzeReceiptImage(compressed.dataUrl, (pct, msg) => {
          setOcrPercent(pct);
          setOcrStatusText(msg);
        });

        const amountVal = analyzed.amount || 0;
        setEditAmount(amountVal);
        setEditShopName(analyzed.shopName || '');
        setEditBranchName(analyzed.branchName || '');
        setEditDate(analyzed.date || new Date().toISOString().split('T')[0]);
        setEditPhone(analyzed.phone || '');
        setEditAddress(analyzed.address || '');

        if (analyzed.items && analyzed.items.length > 0) {
          setEditItems(
            analyzed.items.map((it, idx) => ({
              id: `${Date.now()}-${idx}`,
              name: it.name,
              price: it.price || 0,
              quantity: 1,
              unitPrice: it.price || 0
            }))
          );
        } else {
          setEditItems([{ id: `${Date.now()}-0`, name: '', price: 0, quantity: 1, unitPrice: 0 }]);
        }

        setGeminiError('Gemini APIキーが未設定です。Google AI Studioで無料キーを取得すると、品目・合計・店名の自動抽出精度が劇的に上がります。');
      }
    } catch (err) {
      console.error('画像解析・OCRエラー', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 長尺レシートの続き・下部の追加撮影
  const handleAppendImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setIsProcessing(true);
    setOcrPercent(0);
    const photoNumber = photos.length + 1;
    setOcrStatusText(`${photoNumber}枚目（続き・下部）を圧縮中...`);

    try {
      const compressed = await compressReceiptImage(selectedFile, true);
      const newPhoto: ReceiptPhoto = {
        id: `p-${Date.now()}`,
        dataUrl: compressed.dataUrl,
        rawUrl: compressed.rawUrl || compressed.dataUrl,
        cropBox: compressed.cropBox || { top: 0, bottom: 0, left: 0, right: 0 },
        label: `${photoNumber}枚目 (下部・続き)`,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize
      };

      const nextPhotos = [...photos, newPhoto];
      setPhotos(nextPhotos);
      setSelectedPhotoIdx(nextPhotos.length - 1);

      // 複数画像を縦連結合成
      let currentCombinedUrl = compressed.dataUrl;
      try {
        const stitched = await stitchReceiptImages(nextPhotos.map(p => p.dataUrl));
        setStitchedImage(stitched.dataUrl);
        setCompressResult(stitched);
        currentCombinedUrl = stitched.dataUrl;
      } catch (e) {
        console.error('連結合成エラー', e);
      }

      // 連結全体をGeminiで再解析
      const config = getAppConfig();
      if (config?.geminiApiKey?.trim()) {
        await executeGeminiOcr(currentCombinedUrl, config.geminiApiKey);
      }
    } catch (err) {
      console.error('追加写真の処理エラー', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 手動切り取りの反映処理
  const handleApplyManualCrop = async (croppedResult: CompressionResult, shouldReanalyze?: boolean) => {
    const targetIdx = selectedPhotoIdx >= 0 ? selectedPhotoIdx : 0;
    const nextPhotos = photos.map((p, idx) =>
      idx === targetIdx
        ? {
            ...p,
            dataUrl: croppedResult.dataUrl,
            rawUrl: croppedResult.rawUrl || p.rawUrl,
            cropBox: croppedResult.cropBox,
            compressedSize: croppedResult.compressedSize
          }
        : p
    );
    setPhotos(nextPhotos);

    let combinedUrl = croppedResult.dataUrl;
    if (nextPhotos.length > 1) {
      try {
        const stitched = await stitchReceiptImages(nextPhotos.map(p => p.dataUrl));
        setStitchedImage(stitched.dataUrl);
        setCompressResult(stitched);
        combinedUrl = stitched.dataUrl;
      } catch (e) {
        console.error(e);
      }
    } else {
      setStitchedImage(croppedResult.dataUrl);
      setCompressResult(croppedResult);
    }

    if (shouldReanalyze) {
      const config = getAppConfig();
      if (config?.geminiApiKey?.trim()) {
        await executeGeminiOcr(combinedUrl, config.geminiApiKey);
      } else {
        setIsProcessing(true);
        try {
          const analyzed = await analyzeReceiptImage(combinedUrl, (pct, msg) => {
            setOcrPercent(pct);
            setOcrStatusText(msg);
          });
          if (analyzed.amount) setEditAmount(analyzed.amount);
          if (analyzed.shopName) setEditShopName(analyzed.shopName);
          if (analyzed.branchName) setEditBranchName(analyzed.branchName);
        } finally {
          setIsProcessing(false);
        }
      }
    }
  };

  // ワンタップで「切り取りなし（元画像全体）」に戻す
  const handleRestoreFullImage = async () => {
    const targetIdx = selectedPhotoIdx >= 0 ? selectedPhotoIdx : 0;
    const targetPhoto = photos[targetIdx];
    if (!targetPhoto) return;
    const srcUrl = targetPhoto.rawUrl || rawOcrUrl || targetPhoto.dataUrl;
    const res = await applyReceiptCropAndCompress(
      srcUrl,
      { top: 0, bottom: 0, left: 0, right: 0 },
      targetPhoto.originalSize,
      0,
      false
    );
    await handleApplyManualCrop(res, false);
  };

  // 分割写真の削除
  const handleRemovePhoto = async (indexToRemove: number) => {
    if (photos.length <= 1) {
      setPhotos([]);
      setStitchedImage(null);
      setCompressResult(null);
      setGeminiResult(null);
      setGeminiError(null);
      return;
    }

    const next = photos.filter((_, idx) => idx !== indexToRemove);
    setPhotos(next);
    setSelectedPhotoIdx(Math.max(0, indexToRemove - 1));

    try {
      const stitched = await stitchReceiptImages(next.map(p => p.dataUrl));
      setStitchedImage(stitched.dataUrl);
      setCompressResult(stitched);
    } catch (e) {
      console.error(e);
    }
  };

  // インラインでのAPIキー保存＆Gemini再実行
  const handleSaveInlineApiKeyAndRetry = async () => {
    if (!inlineApiKey.trim()) return;

    const currentConfig = getAppConfig() || {
      name: 'マサ',
      birthdate: '1985-01-01',
      userId: 'user',
      password: '',
      geminiApiKey: ''
    };

    currentConfig.geminiApiKey = inlineApiKey.trim();
    saveAppConfig(currentConfig);

    const targetUrl = rawOcrUrl || stitchedImage || photos[0]?.dataUrl;
    if (targetUrl) {
      await executeGeminiOcr(targetUrl, inlineApiKey.trim());
    }
  };

  // OCR待たずに即座に手直しに進む
  const handleSkipOcr = () => {
    setIsProcessing(false);
    if (!editDate) setEditDate(new Date().toISOString().split('T')[0]);
    if (editItems.length === 0) {
      setEditItems([{ id: `${Date.now()}-0`, name: '', price: 0, quantity: 1, unitPrice: 0 }]);
    }
  };

  // 商品明細の追加・変更・削除
  const handleAddItem = () => {
    setEditItems([...editItems, { id: `${Date.now()}-${Math.random()}`, name: '', price: 0, quantity: 1, unitPrice: 0 }]);
  };

  const handleRemoveItem = (id: string) => {
    setEditItems(editItems.filter(item => item.id !== id));
  };

  const handleUpdateItem = (id: string, field: 'name' | 'price' | 'quantity' | 'unitPrice', value: string | number) => {
    setEditItems(editItems.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'price' || field === 'quantity') {
          const p = field === 'price' ? Number(value) : item.price;
          const q = field === 'quantity' ? Math.max(1, Number(value)) : (item.quantity || 1);
          updated.unitPrice = q > 0 ? Math.round(p / q) : p;
        }
        return updated;
      }
      return item;
    }));
  };

  const itemsSum = editItems.reduce((acc, it) => acc + (it.price || 0), 0);

  // 保存処理
  const handleSave = async () => {
    if (editAmount <= 0) {
      alert('金額を入力してください（タップして電卓で入れられます）');
      return;
    }

    const today = editDate || new Date().toISOString().split('T')[0];
    const imageToSave = stitchedImage || photos[0]?.dataUrl;

    const validItems = editItems
      .filter(it => it.name.trim().length > 0 || it.price > 0)
      .map(it => {
        const q = Math.max(1, it.quantity || 1);
        const p = it.price || 0;
        const u = it.unitPrice || (q > 0 ? Math.round(p / q) : p);
        return {
          name: it.name.trim() || '品目',
          price: p,
          quantity: q,
          unitPrice: u
        };
      });

    const mainItemName = validItems.length > 0 ? validItems[0].name : '';
    const mainUnitPrice = validItems.length > 0 ? validItems[0].unitPrice || validItems[0].price : editAmount;

    const wallet = await db.wallets.get(editWalletId);
    const effectivePayMethod = wallet?.type === 'pay' ? editPayMethod : 'balance';

    // 1. 取引データ追加
    await db.transactions.add({
      type: 'expense',
      amount: editAmount,
      date: today,
      category: editCategory,
      shopName: editShopName.trim(),
      branchName: editBranchName.trim(),
      address: editAddress.trim(),
      phone: editPhone.trim(),
      itemName: mainItemName,
      items: validItems,
      unitPrice: mainUnitPrice,
      taxAmount: editTaxAmount,
      subtotal: editSubtotal,
      walletId: editWalletId,
      payMethod: effectivePayMethod,
      receiptImage: imageToSave,
      receiptImages: photos.map(p => p.dataUrl),
      origSize: compressResult?.originalSize,
      compSize: compressResult?.compressedSize,
      createdAt: new Date().toISOString()
    });

    // 2. 口座残高またはPayクレジット引落分を更新
    if (wallet) {
      if (wallet.type === 'pay' && effectivePayMethod === 'credit') {
        await db.wallets.update(editWalletId, {
          creditBalance: Math.abs(wallet.creditBalance || 0) + editAmount
        });
      } else {
        await db.wallets.update(editWalletId, {
          balance: wallet.balance - editAmount
        });
      }
    }

    // 3. 店舗マスターの登録・更新
    if (editShopName.trim()) {
      const shop = editShopName.trim();
      const branch = editBranchName.trim();
      const existingShop = await db.shops.where('name').equals(shop).first();

      if (existingShop && existingShop.id) {
        await db.shops.update(existingShop.id, {
          branchName: branch || existingShop.branchName,
          address: editAddress.trim() || existingShop.address,
          phone: editPhone.trim() || existingShop.phone,
          defaultCategory: editCategory,
          defaultWalletId: editWalletId,
          lastVisited: today,
          visitCount: (existingShop.visitCount || 1) + 1
        });
      } else {
        await db.shops.add({
          name: shop,
          branchName: branch,
          address: editAddress.trim(),
          phone: editPhone.trim(),
          defaultCategory: editCategory,
          defaultWalletId: editWalletId,
          lastVisited: today,
          visitCount: 1
        });
      }
    }

    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
      // リセット
      setPhotos([]);
      setStitchedImage(null);
      setCompressResult(null);
      setGeminiResult(null);
      setGeminiError(null);
      setEditAmount(0);
      setEditTaxAmount(0);
      setEditSubtotal(0);
      setEditShopName('');
      setEditBranchName('');
      setEditPhone('');
      setEditAddress('');
      setEditItems([]);
      setSavedSuccess(false);
    }, 800);
  };

  if (!isOpen) return null;

  const categories = ['食費', '日用品', '外食・カフェ', '光熱費', '住居費', '交通費', '趣味・娯楽', '交際費', '医療・健康', '衣服・美容', 'その他'];

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        
        {/* ヘッダー */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <Camera size={18} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm tracking-tight">レシートスキャン (Gemini 1.5 Flash)</h3>
                <span className="text-[9px] bg-yellow-400 text-yellow-950 font-black px-1.5 py-0.2 rounded-full">
                  AI OCR
                </span>
              </div>
              <p className="text-[10px] text-blue-200">購入日・店名・品目・合計を自動JSON解析</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/80 hover:text-white rounded-full">
            <X size={20} />
          </button>
        </div>

        {/* コンテンツエリア */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 pb-24 text-left">
          
          {/* 画像未選択時：選択ボタン群 */}
          {photos.length === 0 && !isProcessing && (
            <div className="space-y-4 py-6">
              
              {/* Gemini API案内バナー */}
              <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-600" />
                    Gemini 1.5 Flash レシート解析
                  </span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                    高精度・無料枠
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  レシートを撮影または画像選択すると、Googleの生成AIが「購入日」「店名」「全品目と金額」「合計」を瞬時に抽出します。
                </p>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-[11px] text-indigo-600 font-bold hover:underline flex items-center gap-1 pt-0.5"
                  >
                    <span>APIキーの変更・確認はこちら</span>
                    <ExternalLink size={11} />
                  </button>
                )}
              </div>

              <div
                onClick={() => cameraInputRef.current?.click()}
                className="p-6 border-2 border-dashed border-blue-400 rounded-3xl bg-blue-50/50 hover:bg-blue-50 flex flex-col items-center justify-center cursor-pointer transition-all active:scale-98"
              >
                <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-blue-200">
                  <Camera size={32} />
                </div>
                <h4 className="font-bold text-gray-800 text-base">レシートをカメラで撮影</h4>
                <p className="text-xs text-gray-500 mt-1">瞬時に超圧縮 ＆ Gemini 1.5 Flashで解析</p>
              </div>

              <div
                onClick={() => galleryInputRef.current?.click()}
                className="p-5 border border-gray-200 rounded-2xl bg-gray-50 hover:bg-gray-100 flex items-center gap-4 cursor-pointer transition-all active:scale-98"
              >
                <div className="w-12 h-12 bg-amber-500 text-white rounded-xl flex items-center justify-center shadow-md shadow-amber-200">
                  <ImageIcon size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-gray-800 text-sm">ギャラリー / スクショから取り込み</h4>
                  <p className="text-xs text-gray-500 mt-0.5">保存済みのレシート・電子決済スクショ</p>
                </div>
              </div>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleImageSelected}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelected}
              />
            </div>
          )}

          {/* 解析中ローディング（スキップボタン付き） */}
          {isProcessing && (
            <div className="py-8 flex flex-col items-center justify-center space-y-3 bg-gradient-to-b from-blue-50/50 to-indigo-50/50 rounded-2xl border border-blue-200 p-5">
              <RefreshCw size={36} className="text-indigo-600 animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-sm font-bold text-indigo-950">{ocrStatusText}</p>
                <p className="text-[11px] text-gray-500">gemini-1.5-flash (response_mime_type: application/json)</p>
              </div>

              <div className="w-52 bg-gray-200 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full transition-all duration-300"
                  style={{ width: `${Math.max(20, ocrPercent)}%` }}
                />
              </div>

              <button
                type="button"
                onClick={handleSkipOcr}
                className="text-xs text-blue-600 font-bold bg-white px-4 py-1.5 rounded-full border border-blue-200 shadow-xs hover:bg-blue-50 mt-2"
              >
                待たずに写真を見ながら手入力する ⏩
              </button>
            </div>
          )}

          {/* 写真が選ばれた後の「写真プレビュー ＆ 手直しフォーム」 */}
          {photos.length > 0 && !isProcessing && (
            <div className="space-y-4">
              
              {/* 二重取り込み警告 */}
              {isDuplicate && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3 flex items-start gap-2.5 text-amber-800">
                  <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-bold">二重登録の可能性があります！</p>
                    <p className="text-amber-700 mt-0.5">同一日・同金額の明細がすでに記録されています。</p>
                  </div>
                </div>
              )}

              {/* Gemini 1.5 Flash 解析完了バナー ＆ JSONデータ表示 */}
              {geminiResult ? (
                <div className="bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50 border border-indigo-200 rounded-2xl p-3.5 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                      <Sparkles size={16} className="text-indigo-600" />
                      <span>Gemini 1.5 Flash レシート解析完了</span>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Check size={11} /> JSONスキーマ構造化成功
                    </span>
                  </div>

                  {/* 抽出サマリーバッジ（date, store_name, total_amount, items） */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white/90 p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <span className="text-[10px] text-gray-500 block font-mono">store_name (店名)</span>
                      <span className="font-bold text-gray-800 truncate block mt-0.5">
                        {geminiResult.store_name || geminiResult.shopName || '未検出'}
                      </span>
                    </div>
                    <div className="bg-white/90 p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <span className="text-[10px] text-gray-500 block font-mono">total_amount (合計金額)</span>
                      <span className="font-black text-indigo-600 block mt-0.5 text-sm">
                        ¥{(geminiResult.total_amount ?? geminiResult.totalAmount ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-white/90 p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <span className="text-[10px] text-gray-500 block font-mono">date (購入日)</span>
                      <span className="font-bold text-gray-800 block mt-0.5">
                        {geminiResult.date}
                      </span>
                    </div>
                    <div className="bg-white/90 p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <span className="text-[10px] text-gray-500 block font-mono">items (品目数)</span>
                      <span className="font-bold text-amber-700 block mt-0.5">
                        {geminiResult.items?.length || 0} 件抽出
                      </span>
                    </div>
                  </div>

                  {/* JSONプレビュー切り替え */}
                  <div className="pt-1 border-t border-indigo-100">
                    <button
                      type="button"
                      onClick={() => setShowRawJson(!showRawJson)}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                    >
                      <Code size={12} />
                      <span>{showRawJson ? 'JSON構造化データを閉じる' : '返却されたJSONスキーマデータを確認する'}</span>
                    </button>
                    {showRawJson && (
                      <pre className="mt-2 p-2.5 bg-gray-900 text-emerald-400 font-mono text-[10px] rounded-xl overflow-x-auto max-h-48 leading-snug">
                        {JSON.stringify({
                          date: geminiResult.date,
                          store_name: geminiResult.store_name,
                          items: geminiResult.items,
                          total_amount: geminiResult.total_amount
                        }, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Gemini APIエラー案内 */}
              {geminiError && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 space-y-2.5 text-xs text-amber-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="font-bold block">
                        {geminiErrorKind === 'busy'
                          ? (geminiError.includes('429') ? 'Gemini API 利用制限 (429)' : 'Google サーバー一時混雑 (503)')
                          : 'Gemini AI 解析のご案内'}
                      </span>
                      <p className="text-[11px] text-amber-800 leading-relaxed">{geminiError}</p>
                    </div>
                  </div>

                  {/* 混雑または一時エラーの場合はキー入力欄を出さず「再試行」ボタンを大きく表示 */}
                  {geminiErrorKind === 'busy' || geminiErrorKind === 'network' ? (
                    <div className="pt-1 border-t border-amber-200 flex items-center justify-between">
                      <span className="text-[10px] text-emerald-800 font-bold flex items-center gap-1">
                        ✓ APIキーは保存されています（再入力不要）
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const targetUrl = rawOcrUrl || stitchedImage || photos[0]?.dataUrl;
                          if (targetUrl) executeGeminiOcr(targetUrl);
                        }}
                        className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-xs shadow-sm active:scale-95 transition-all"
                      >
                        もう一度試す（再試行）
                      </button>
                    </div>
                  ) : (
                    /* APIキー未設定・無効時のみキー入力欄を表示 */
                    <div className="space-y-1.5 pt-1 border-t border-amber-200">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-amber-900 block">
                          Gemini APIキーを入力して高精度解析を実行:
                        </label>
                        <span className="text-[9px] bg-amber-200/80 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                          AQ... / AIza... 両対応
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="AQ... または AIza..."
                          value={inlineApiKey}
                          onChange={e => setInlineApiKey(e.target.value)}
                          className="flex-1 bg-white border border-amber-300 rounded-xl px-2.5 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <button
                          type="button"
                          onClick={handleSaveInlineApiKeyAndRetry}
                          disabled={!inlineApiKey.trim()}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shrink-0 active:scale-95 transition-all"
                        >
                          Geminiで再解析
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-amber-800 font-medium">※一度保存すれば次回から自動で使用されます</span>
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-900 underline font-bold"
                        >
                          <span>無料キー取得</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 長尺レシート用：複数枚写真タブ ＆ 追加撮影コントロール */}
              <div className="bg-blue-50/70 p-3 rounded-2xl border border-blue-200 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-blue-900 flex items-center gap-1.5">
                    <Layers size={14} className="text-blue-600" />
                    長尺レシート分割撮影 ({photos.length}枚)
                  </span>
                  <span className="text-[10px] text-blue-600 font-medium">
                    長いレシートは分けて撮ると認識率UP
                  </span>
                </div>

                {/* 各写真の切替タブ ＆ サムネイル */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
                  {photos.map((p, idx) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPhotoIdx(idx)}
                      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 cursor-pointer transition-all ${
                        selectedPhotoIdx === idx
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span>{p.label}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePhoto(idx);
                        }}
                        className={`p-0.5 rounded-full hover:bg-black/20 ${selectedPhotoIdx === idx ? 'text-white' : 'text-gray-400'}`}
                        title="この写真を削除"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  {photos.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedPhotoIdx(-1)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 transition-all ${
                        selectedPhotoIdx === -1
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                      }`}
                    >
                      📜 全体連結
                    </button>
                  )}
                </div>

                {/* 続き・下部の追加撮影ボタン */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-blue-100">
                  <button
                    type="button"
                    onClick={() => appendCameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold shadow-2xs active:scale-98 transition-all"
                  >
                    <Camera size={14} />
                    <span>📸 続きをカメラで追加</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => appendGalleryInputRef.current?.click()}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold shadow-2xs active:scale-98 transition-all"
                  >
                    <FilePlus2 size={14} />
                    <span>🖼️ 続きを画像から追加</span>
                  </button>
                </div>

                <input
                  ref={appendCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleAppendImage}
                />
                <input
                  ref={appendGalleryInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAppendImage}
                />
              </div>

              {/* レシート画像プレビュー（タップで拡大 ＆ 手動切り取り調整ボタン） */}
              <div className="space-y-2">
                <div
                  onClick={() => setIsImageZoomed(!isImageZoomed)}
                  className={`relative rounded-2xl overflow-hidden border border-gray-300 bg-gray-950 flex items-center justify-center cursor-pointer transition-all ${
                    isImageZoomed ? 'max-h-[500px]' : 'max-h-48'
                  }`}
                  title="タップで写真サイズ拡大"
                >
                  <img
                    src={
                      selectedPhotoIdx === -1
                        ? stitchedImage || photos[0]?.dataUrl
                        : photos[selectedPhotoIdx]?.dataUrl || photos[0]?.dataUrl
                    }
                    alt="Receipt preview"
                    className={`object-contain transition-all duration-200 ${isImageZoomed ? 'max-h-[500px]' : 'max-h-48'}`}
                  />
                  <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1">
                    <ZoomIn size={11} />
                    {isImageZoomed ? 'タップで縮小' : 'タップで拡大'}
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded backdrop-blur-sm">
                    {selectedPhotoIdx === -1 ? '📜 全体連結画像' : photos[selectedPhotoIdx]?.label}
                  </div>
                </div>

                {/* 切り取り範囲の手動調整・全体復元ボタンバー */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCropModalOpen(true)}
                    className="py-2 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs active:scale-98 transition-all"
                  >
                    <Crop size={14} />
                    <span>✂️ 手動で切り取り調整</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreFullImage}
                    className="py-2 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-98 transition-all"
                  >
                    <RefreshCw size={13} />
                    <span>切り取りなし（全体）</span>
                  </button>
                </div>
              </div>

              {/* 手直しフォーム（レシートを見ながら入力・修正） */}
              <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm space-y-3.5">
                
                <div className="flex justify-between items-center text-xs border-b border-gray-100 pb-2">
                  <span className="font-bold text-gray-800 flex items-center gap-1">
                    <Edit3 size={14} className="text-blue-600" /> レシート手直し確認
                  </span>
                  {geminiResult ? (
                    <span className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                      <Sparkles size={11} className="text-indigo-600" /> Gemini AI 高精度解析済
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle size={11} className="text-amber-600" /> 簡易OCR（APIキー未接続）
                    </span>
                  )}
                </div>

                {/* 1. 金額入力（電卓キーパッド連動） */}
                <div className="bg-red-50/50 p-3 rounded-2xl border border-red-100">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-red-700">合計金額 (税込)</label>
                    <button
                      type="button"
                      onClick={() => setShowKeypad(true)}
                      className="text-[11px] text-red-600 font-bold flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-red-200 shadow-xs"
                    >
                      <Calculator size={12} /> 電卓で打つ
                    </button>
                  </div>
                  
                  <div
                    onClick={() => setShowKeypad(true)}
                    className="text-3xl font-black text-red-500 py-1 cursor-pointer hover:opacity-80"
                  >
                    ¥{(editAmount || 0).toLocaleString()}
                  </div>

                  {/* 消費税 ＆ 小計の内訳 */}
                  <div className="mt-2 pt-2 border-t border-red-100/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-gray-600">消費税等:</span>
                      <div className="relative w-20" title="消費税額">
                        <input
                          type="number"
                          value={editTaxAmount || ''}
                          onChange={e => setEditTaxAmount(Number(e.target.value))}
                          placeholder="0"
                          className="w-full bg-white border border-red-200 rounded-lg pl-1.5 pr-4 py-0.5 text-xs font-bold text-gray-800 text-right outline-none focus:ring-1 focus:ring-red-400"
                        />
                        <span className="absolute right-1 top-0.5 text-[10px] text-gray-400">円</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsTaxIncluded(!isTaxIncluded)}
                        className="text-[10px] bg-red-100/90 hover:bg-red-200 text-red-700 font-bold px-1.5 py-0.5 rounded transition-all"
                        title="タップで内税・外税を切替"
                      >
                        {isTaxIncluded ? '内税' : '外税'}
                      </button>
                    </div>

                    {editSubtotal > 0 ? (
                      <span className="text-[11px] text-gray-500 font-medium">
                        小計: ¥{editSubtotal.toLocaleString()}
                      </span>
                    ) : editTaxAmount > 0 && isTaxIncluded ? (
                      <span className="text-[11px] text-gray-500 font-medium">
                        税抜: ¥{Math.max(0, editAmount - editTaxAmount).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* 2. 店舗名 ＆ 支店名（〇〇店）枠 */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 flex items-center gap-1">
                      <Store size={13} /> 店舗・店名
                    </label>
                    <input
                      type="text"
                      value={editShopName}
                      onChange={e => {
                        const val = e.target.value;
                        setEditShopName(val);
                        // もし入力された店名が既存店舗にあれば電話番号や住所を自動補完
                        const matched = shops?.find(s => s.name === val.trim());
                        if (matched) {
                          if (matched.branchName && !editBranchName) setEditBranchName(matched.branchName);
                          if (matched.phone && !editPhone) setEditPhone(matched.phone);
                          if (matched.address && !editAddress) setEditAddress(matched.address);
                        }
                      }}
                      placeholder="例: セブン-イレブン"
                      list="scanner-shop-list"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="scanner-shop-list">
                      {shops?.map(s => <option key={s.id} value={s.name} />)}
                    </datalist>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 flex items-center gap-1">
                      <span>🏬 支店名 (〇〇店)</span>
                    </label>
                    <input
                      type="text"
                      value={editBranchName}
                      onChange={e => setEditBranchName(e.target.value)}
                      placeholder="例: 新宿東口店"
                      list="scanner-branch-list"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="scanner-branch-list">
                      {shops?.filter(s => s.branchName).map(s => <option key={s.id} value={s.branchName} />)}
                    </datalist>
                  </div>
                </div>

                {/* 2.5 電話番号 ＆ 店舗住所（レシート解析連動） */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 flex items-center gap-1">
                      <Phone size={13} className="text-emerald-600" /> 電話番号
                    </label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={e => setEditPhone(e.target.value)}
                      placeholder="例: 03-1234-5678"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 flex items-center gap-1">
                      <MapPin size={13} className="text-rose-500" /> 住所・所在地
                    </label>
                    <input
                      type="text"
                      value={editAddress}
                      onChange={e => setEditAddress(e.target.value)}
                      placeholder="例: 東京都渋谷区..."
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* 3. 購入日 */}
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 flex items-center gap-1">
                    <Calendar size={13} /> 購入日
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 4. 購入商品・品目明細リスト */}
                <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-200 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-800 flex items-center gap-1">
                      <SparklesIcon size={14} className="text-amber-500" /> 購入商品・品目リスト ({editItems.length}件)
                    </label>
                    <span className="text-[10px] text-amber-700 font-bold bg-amber-100 px-2 py-0.5 rounded-full">
                      品目合計: ¥{itemsSum.toLocaleString()}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {editItems.map((item, idx) => {
                      const qty = item.quantity || 1;
                      const calcUnit = item.unitPrice || (qty > 1 ? Math.round(item.price / qty) : item.price);
                      return (
                        <div key={item.id} className="bg-white p-2 rounded-xl border border-amber-100 shadow-2xs space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-400 font-mono w-4 text-center shrink-0">{idx + 1}</span>
                            <input
                              type="text"
                              value={item.name}
                              onChange={e => handleUpdateItem(item.id, 'name', e.target.value)}
                              placeholder="商品名・品目名"
                              className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            {/* 個数・数量 */}
                            <div className="relative w-16 shrink-0" title="個数・数量">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity || 1}
                                onChange={e => handleUpdateItem(item.id, 'quantity', Math.max(1, Number(e.target.value)))}
                                placeholder="1"
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-1.5 pr-4 py-1 text-xs font-bold text-gray-800 outline-none text-right focus:ring-1 focus:ring-amber-500"
                              />
                              <span className="absolute right-1 top-1 text-[10px] text-gray-400">点</span>
                            </div>
                            {/* 金額 */}
                            <div className="relative w-22 shrink-0" title="品目合計金額">
                              <input
                                type="number"
                                value={item.price || ''}
                                onChange={e => handleUpdateItem(item.id, 'price', Number(e.target.value))}
                                placeholder="0"
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-1.5 pr-4 py-1 text-xs font-bold text-gray-800 outline-none text-right focus:ring-1 focus:ring-amber-500"
                              />
                              <span className="absolute right-1 top-1 text-[10px] text-gray-400">円</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              className="text-gray-300 hover:text-red-500 p-1 shrink-0"
                              title="削除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          {qty > 1 && item.price > 0 && (
                            <div className="flex justify-end items-center text-[10px] text-amber-700 font-medium pr-6">
                              <span className="bg-amber-100/90 text-amber-800 px-1.5 py-0.5 rounded text-[9px] font-bold">
                                単価: @¥{calcUnit.toLocaleString()} × {qty}点
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="flex-1 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1 active:scale-98 transition-all"
                    >
                      <Plus size={13} /> 品目を追加
                    </button>
                    {itemsSum > 0 && itemsSum !== editAmount && (
                      <button
                        type="button"
                        onClick={() => setEditAmount(itemsSum)}
                        className="py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold active:scale-98 transition-all"
                      >
                        合計に反映 (¥{itemsSum.toLocaleString()})
                      </button>
                    )}
                  </div>
                </div>

                {/* 5. カテゴリ選択 */}
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1.5 block">カテゴリ</label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setEditCategory(cat)}
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                          editCategory === cat
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 6. 支払口座（ウォレット） */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-600 mb-1.5 block">支払口座・ウォレット</label>
                  <div className="grid grid-cols-2 gap-2">
                    {wallets?.map(w => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setEditWalletId(w.id!)}
                        className={`p-2 rounded-xl text-xs font-bold border text-left transition-all ${
                          editWalletId === w.id
                            ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-2xs'
                            : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <span className="block truncate">{w.name}</span>
                        <span className="text-[10px] text-gray-500 block font-normal">残高: ¥{w.balance.toLocaleString()}</span>
                        {w.type === 'pay' && (
                          <span className="text-[10px] text-purple-600 block font-bold">
                            💳 クレジット: ¥{Math.abs(w.creditBalance || 0).toLocaleString()}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Pay選択時の「残高から引く / クレジット（クレカ）から引く」切り替え */}
                  {wallets?.find(w => w.id === editWalletId)?.type === 'pay' && (
                    <div className="grid grid-cols-2 gap-2 p-2 bg-red-50/50 border border-red-100 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setEditPayMethod('balance')}
                        className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
                          editPayMethod === 'balance'
                            ? 'bg-red-500 text-white shadow-xs'
                            : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        💰 Pay残高から引く
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPayMethod('credit')}
                        className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all ${
                          editPayMethod === 'credit'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        💳 クレジットから引く
                      </button>
                    </div>
                  )}
                </div>

              </div>

              {/* 保存ボタン */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={savedSuccess}
                  className={`w-full py-4 text-white font-bold rounded-2xl shadow-lg text-base active:scale-98 transition-all flex items-center justify-center gap-2 ${
                    savedSuccess
                      ? 'bg-emerald-600 shadow-emerald-200'
                      : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-indigo-300'
                  }`}
                >
                  {savedSuccess ? (
                    <>
                      <CheckCircle size={20} />
                      <span>家計簿に記録しました！</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>この内容で家計簿に記録する (¥{(editAmount || 0).toLocaleString()})</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          )}

        </div>

      </div>

      {/* 電卓テンキーモーダル */}
      {showKeypad && (
        <CalcKeypad
          value={editAmount}
          onChange={(val: number) => {
            setEditAmount(val);
          }}
          onClose={() => setShowKeypad(false)}
        />
      )}

      {/* 手動レシート切り取り調整モーダル */}
      <ReceiptCropModal
        isOpen={isCropModalOpen}
        onClose={() => setIsCropModalOpen(false)}
        sourceUrl={
          (selectedPhotoIdx >= 0 ? photos[selectedPhotoIdx]?.rawUrl : photos[0]?.rawUrl) ||
          rawOcrUrl ||
          (selectedPhotoIdx >= 0 ? photos[selectedPhotoIdx]?.dataUrl : stitchedImage) ||
          ''
        }
        initialCropBox={
          (selectedPhotoIdx >= 0 ? photos[selectedPhotoIdx]?.cropBox : photos[0]?.cropBox) || {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
          }
        }
        originalSize={
          (selectedPhotoIdx >= 0 ? photos[selectedPhotoIdx]?.originalSize : photos[0]?.originalSize) || 0
        }
        onApply={handleApplyManualCrop}
        showReanalyzeButton={true}
      />

    </div>
  );
}
