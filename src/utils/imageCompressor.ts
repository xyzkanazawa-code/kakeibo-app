/**
 * 超圧縮（Ultra-Compression）画像処理パイプライン ＆ 自動・手動レシート余白トリミング
 */

export interface CropBoxPct {
  top: number;    // 上端からのカット割合 (0〜45%)
  bottom: number; // 下端からのカット割合 (0〜45%)
  left: number;   // 左端からのカット割合 (0〜45%)
  right: number;  // 右端からのカット割合 (0〜45%)
}

export interface CompressionResult {
  dataUrl: string;
  rawUrl?: string;      // トリミング前の元画像（手動で切り取り範囲を広げたい時にも使える）
  cropBox?: CropBoxPct; // 現在のトリミング位置（%）
  originalSize: number;
  compressedSize: number;
  compressionRatio: number; // 例: 96 (96%削減)
}

/**
 * 画像からレシートの白い紙面領域（高輝度・低彩度）を検出し、背景の机などの余白を自動検出する
 */
function autoCropReceipt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number; boxPct: CropBoxPct } {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // レシート紙面は「明るく（高輝度）」「色味が少ない（低彩度：白〜明るいグレー）」特徴を持つ
  const rowPaperCount: number[] = new Array(height).fill(0);
  const colPaperCount: number[] = new Array(width).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC - minC;

      // 木目の机や色付きの背景を除外するため、彩度が低く明るいピクセルを紙面としてカウント
      if (luma > 150 && saturation < 42) {
        rowPaperCount[y]++;
        colPaperCount[x]++;
      }
    }
  }

  // レシート紙面が存在する行・列の閾値
  const thresholdRow = width * 0.18;
  const thresholdCol = height * 0.18;

  let minY = 0;
  while (minY < height && rowPaperCount[minY] < thresholdRow) minY++;

  let maxY = height - 1;
  while (maxY > minY && rowPaperCount[maxY] < thresholdRow) maxY--;

  let minX = 0;
  while (minX < width && colPaperCount[minX] < thresholdCol) minX++;

  let maxX = width - 1;
  while (maxX > minX && colPaperCount[maxX] < thresholdCol) maxX--;

  // 文字切れを防ぐため余裕を持たせる安全マージン（4%）
  const padX = Math.round(width * 0.04);
  const padY = Math.round(height * 0.04);
  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropW = Math.min(width - cropX, (maxX - minX) + padX * 2);
  const cropH = Math.min(height - cropY, (maxY - minY) + padY * 2);

  // 縦長レシートでも横幅25%以上・高さ40%以上あれば有効なクロップとして採用
  if (cropW >= width * 0.25 && cropH >= height * 0.40 && (cropW < width * 0.96 || cropH < height * 0.96)) {
    const topPct = Math.min(45, Math.max(0, Math.round((cropY / height) * 100)));
    const bottomPct = Math.min(45, Math.max(0, Math.round(((height - (cropY + cropH)) / height) * 100)));
    const leftPct = Math.min(45, Math.max(0, Math.round((cropX / width) * 100)));
    const rightPct = Math.min(45, Math.max(0, Math.round(((width - (cropX + cropW)) / width) * 100)));
    return {
      x: cropX,
      y: cropY,
      w: cropW,
      h: cropH,
      boxPct: { top: topPct, bottom: bottomPct, left: leftPct, right: rightPct }
    };
  }

  return {
    x: 0,
    y: 0,
    w: width,
    h: height,
    boxPct: { top: 0, bottom: 0, left: 0, right: 0 }
  };
}

/**
 * Gemini 1.5 Flash（AI高精度OCR）向けに最適な高精細カラー画像を生成する
 */
export async function prepareImageForGeminiOcr(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const MAX_OCR_SIZE = 1600;

        if (width > height) {
          if (width > MAX_OCR_SIZE) {
            height = Math.round((height * MAX_OCR_SIZE) / width);
            width = MAX_OCR_SIZE;
          }
        } else {
          if (height > MAX_OCR_SIZE) {
            width = Math.round((width * MAX_OCR_SIZE) / height);
            height = MAX_OCR_SIZE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/webp', 0.85);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 元画像DataURLと指定の切り取りボックス(%)・回転角度から、超圧縮レシート画像を生成する
 */
export async function applyReceiptCropAndCompress(
  rawUrl: string,
  cropBox: CropBoxPct,
  originalSize = 0,
  rotateDeg = 0,
  keepColor = false
): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 1. 回転が指定されている場合は先に回転用Canvasを作成
      const rot = ((rotateDeg % 360) + 360) % 360;
      const srcCanvas = document.createElement('canvas');
      if (rot === 90 || rot === 270) {
        srcCanvas.width = img.height;
        srcCanvas.height = img.width;
      } else {
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
      }
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) {
        reject(new Error('Canvas context error'));
        return;
      }
      srcCtx.save();
      srcCtx.translate(srcCanvas.width / 2, srcCanvas.height / 2);
      srcCtx.rotate((rot * Math.PI) / 180);
      srcCtx.drawImage(img, -img.width / 2, -img.height / 2);
      srcCtx.restore();

      const fullW = srcCanvas.width;
      const fullH = srcCanvas.height;

      // 2. パーセント指定から切り抜きピクセル座標を計算
      const cropX = Math.round((fullW * cropBox.left) / 100);
      const cropY = Math.round((fullH * cropBox.top) / 100);
      const cropW = Math.max(40, Math.round(fullW * (1 - (cropBox.left + cropBox.right) / 100)));
      const cropH = Math.max(40, Math.round(fullH * (1 - (cropBox.top + cropBox.bottom) / 100)));

      // 3. リサイズ計算（長辺最大1080px）
      const MAX_SIZE = 1080;
      let targetW = cropW;
      let targetH = cropH;

      if (targetW > targetH) {
        if (targetW > MAX_SIZE) {
          targetH = Math.round((targetH * MAX_SIZE) / targetW);
          targetW = MAX_SIZE;
        }
      } else {
        if (targetH > MAX_SIZE) {
          targetW = Math.round((targetW * MAX_SIZE) / targetH);
          targetH = MAX_SIZE;
        }
      }

      const outCanvas = document.createElement('canvas');
      outCanvas.width = targetW;
      outCanvas.height = targetH;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) {
        reject(new Error('Canvas context error'));
        return;
      }

      outCtx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

      // 4. グレースケール＋マイルドコントラスト（keepColor=false時）
      if (!keepColor) {
        const imgData = outCtx.getImageData(0, 0, targetW, targetH);
        const data = imgData.data;
        const contrast = 1.15;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const contrasted = Math.min(255, Math.max(0, factor * (gray - 128) + 128));
          data[i] = contrasted;
          data[i + 1] = contrasted;
          data[i + 2] = contrasted;
        }
        outCtx.putImageData(imgData, 0, 0);
      }

      const dataUrl = outCanvas.toDataURL('image/webp', 0.45);
      const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1);
      const compressedSize = Math.round((base64Length * 3) / 4);
      const baseOrig = originalSize > 0 ? originalSize : compressedSize * 10;
      const compressionRatio = Math.max(0, Math.round(((baseOrig - compressedSize) / baseOrig) * 100));

      // 回転した場合はrawUrl自体も回転後のものに更新
      const updatedRawUrl = rot !== 0 ? srcCanvas.toDataURL('image/webp', 0.82) : rawUrl;

      resolve({
        dataUrl,
        rawUrl: updatedRawUrl,
        cropBox,
        originalSize: baseOrig,
        compressedSize,
        compressionRatio
      });
    };
    img.onerror = reject;
    img.src = rawUrl;
  });
}

export async function compressReceiptImage(file: File, shouldAutoCrop = true): Promise<CompressionResult> {
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        try {
          let width = img.width;
          let height = img.height;

          // 手動再トリミング用の元画像（長辺最大1280pxのカラーWebP）を生成
          const MAX_RAW_SIZE = 1280;
          let rawW = width;
          let rawH = height;
          if (rawW > rawH && rawW > MAX_RAW_SIZE) {
            rawH = Math.round((rawH * MAX_RAW_SIZE) / rawW);
            rawW = MAX_RAW_SIZE;
          } else if (rawH >= rawW && rawH > MAX_RAW_SIZE) {
            rawW = Math.round((rawW * MAX_RAW_SIZE) / rawH);
            rawH = MAX_RAW_SIZE;
          }

          const rawCanvas = document.createElement('canvas');
          rawCanvas.width = rawW;
          rawCanvas.height = rawH;
          const rawCtx = rawCanvas.getContext('2d');
          if (!rawCtx) {
            reject(new Error('Canvas context not available'));
            return;
          }
          rawCtx.drawImage(img, 0, 0, rawW, rawH);
          const rawUrl = rawCanvas.toDataURL('image/webp', 0.82);

          // 自動余白トリミングの範囲を計算
          let boxPct: CropBoxPct = { top: 0, bottom: 0, left: 0, right: 0 };
          if (shouldAutoCrop) {
            const auto = autoCropReceipt(rawCtx, rawW, rawH);
            boxPct = auto.boxPct;
          }

          const result = await applyReceiptCropAndCompress(rawUrl, boxPct, originalSize, 0, false);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * ユーザーが手動で余白をトリミングする処理（上下左右のパーセントカット）
 */
export async function manualCropImage(
  dataUrl: string,
  topPct: number,
  bottomPct: number,
  leftPct: number,
  rightPct: number
): Promise<string> {
  const res = await applyReceiptCropAndCompress(dataUrl, {
    top: topPct,
    bottom: bottomPct,
    left: leftPct,
    right: rightPct
  });
  return res.dataUrl;
}

export async function compressProductImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_SIZE = 1080;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/webp', 0.50);

        const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1);
        const compressedSize = Math.round((base64Length * 3) / 4);
        const compressionRatio = Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100));

        resolve({
          dataUrl,
          originalSize,
          compressedSize,
          compressionRatio,
        });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * 複数のレシート画像（上部・下部などの長尺分割撮影）を縦方向に連結して1枚のパノラマ画像に合成
 */
export async function stitchReceiptImages(dataUrls: string[]): Promise<CompressionResult> {
  if (dataUrls.length === 0) throw new Error('No images to stitch');
  if (dataUrls.length === 1) {
    const base64Length = dataUrls[0].length - (dataUrls[0].indexOf(',') + 1);
    const size = Math.round((base64Length * 3) / 4);
    return {
      dataUrl: dataUrls[0],
      originalSize: size,
      compressedSize: size,
      compressionRatio: 0
    };
  }

  const loadedImages: HTMLImageElement[] = await Promise.all(
    dataUrls.map(url => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    }))
  );

  const targetWidth = Math.min(1080, Math.max(...loadedImages.map(img => img.width)));
  const scaledHeights = loadedImages.map(img => Math.round((img.height * targetWidth) / img.width));
  const totalHeight = scaledHeights.reduce((acc, h) => acc + h, 0);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, totalHeight);

  let currentY = 0;
  for (let i = 0; i < loadedImages.length; i++) {
    const img = loadedImages[i];
    const h = scaledHeights[i];
    ctx.drawImage(img, 0, currentY, targetWidth, h);
    currentY += h;
  }

  const stitchedDataUrl = canvas.toDataURL('image/webp', 0.40);
  const base64Length = stitchedDataUrl.length - (stitchedDataUrl.indexOf(',') + 1);
  const compressedSize = Math.round((base64Length * 3) / 4);

  return {
    dataUrl: stitchedDataUrl,
    originalSize: compressedSize * 2,
    compressedSize,
    compressionRatio: 50
  };
}
