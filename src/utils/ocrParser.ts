import { createWorker } from 'tesseract.js';

/**
 * レシート・スクショ OCR & パース解析エンジン
 */

export interface ParsedReceiptData {
  shopName?: string;
  branchName?: string; // 支店名（〇〇店）
  date?: string;
  amount?: number;
  phone?: string;
  address?: string;
  detectedType: 'receipt' | 'paypay' | 'amazon' | 'unknown';
  confidence: number;
  rawText?: string;
  amountCandidates?: number[]; // 金額の候補リスト（UIでタップ選択可能）
  itemName?: string; // 代表商品名
  detectedItems?: string[]; // レシートから検出された商品名リスト
  items?: { name: string; price: number }[]; // 商品名と金額の明細ペアリスト
}

export function parseReceiptText(text: string): ParsedReceiptData {
  // 全角数字・記号を半角に正規化
  const normalizedText = text
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[￥]/g, '¥')
    .replace(/[ー—－]/g, '-');

  const lines = normalizedText.split('\n').map(l => l.trim()).filter(Boolean);
  let shopName: string | undefined;
  let branchName: string | undefined;
  let date: string | undefined;
  let amount: number | undefined;
  let phone: string | undefined;
  let phoneLineIndex = -1;
  let address: string | undefined;
  let detectedType: 'receipt' | 'paypay' | 'amazon' | 'unknown' = 'receipt';

  // 1. PayPay等の電子決済判定
  if (normalizedText.includes('PayPay') || normalizedText.includes('支払い完了') || normalizedText.includes('PayPay残高')) {
    detectedType = 'paypay';
  } else if (normalizedText.includes('Amazon') || normalizedText.includes('注文確定') || normalizedText.includes('領収書／購入明細書')) {
    detectedType = 'amazon';
  }

  // 2. 電話番号抽出
  const phoneRegex = /(0\d{1,4}[-]\d{1,4}[-]\d{3,4}|0\d{9,10})/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(phoneRegex);
    if (match) {
      phone = match[0];
      phoneLineIndex = i;
      break;
    }
  }

  // 3. 日付抽出
  const dateRegex = /(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/;
  for (const line of lines) {
    const match = line.match(dateRegex);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      date = `${year}-${month}-${day}`;
      break;
    }
  }
  if (!date) {
    date = new Date().toISOString().split('T')[0];
  }

  // 4. 【金額抽出ロジック（バーコード・承認番号の誤認識を完全排除）】
  // レシートの日常金額上限は30万円。7桁以上やバーコード・会員番号・カード番号は絶対に除外！
  const isValidAmount = (val: number): boolean => {
    // 10円 〜 300,000円の範囲。西暦(2020〜2035)は除外
    if (val < 10 || val > 300000) return false;
    if (val >= 2020 && val <= 2035) return false;
    return true;
  };

  interface ExtractedAmount {
    val: number;
    hasYenSymbol: boolean; // ¥または円が付いているか（信頼度高）
    isTotalLine: boolean;  // 合計・税込行か
    isSubtotalLine: boolean; // 小計行か
    line: string;
  }

  const allAmounts: ExtractedAmount[] = [];

  for (const line of lines) {
    // バーコード・伝票番号・会員番号・TEL・時刻の行はスキップ
    if (
      line.includes('TEL') ||
      line.includes('バーコード') ||
      line.includes('No') ||
      line.includes('番号') ||
      line.includes('ポイント') ||
      line.includes('会員') ||
      line.includes('レジ') ||
      line.includes('お釣') ||
      line.includes('カード番号')
    ) {
      continue;
    }

    const isSubtotal = line.includes('小計') || line.includes('税抜') || line.includes('本体');
    const isTotal =
      line.includes('税込') ||
      line.includes('合計') ||
      line.includes('お支払') ||
      line.includes('支払計') ||
      line.includes('総額') ||
      line.includes('お買上計') ||
      line.includes('現計') ||
      line.includes('請求');

    // 税率内訳行（例: 10%標準対象 100）は合計ではない
    if (line.includes('税率') || line.includes('内税') || (line.includes('消費税') && !line.includes('合計'))) {
      continue;
    }

    // ¥または円付きの数値を優先マッチ
    const matchesWithSymbol = line.matchAll(/[¥￥]\s*([0-9]{1,3}(,[0-9]{3})+|[0-9]{2,6})\s*|([0-9]{1,3}(,[0-9]{3})+|[0-9]{2,6})\s*円/g);
    for (const m of matchesWithSymbol) {
      const numStr = (m[1] || m[3] || '').replace(/,/g, '');
      const val = parseInt(numStr, 10);
      if (isValidAmount(val)) {
        allAmounts.push({ val, hasYenSymbol: true, isTotalLine: isTotal, isSubtotalLine: isSubtotal, line });
      }
    }

    // 記号なしでも「合計」「小計」の行にある数値をマッチ
    if (isTotal || isSubtotal) {
      const matchesRaw = line.matchAll(/([0-9]{1,3}(,[0-9]{3})+|[0-9]{2,6})/g);
      for (const m of matchesRaw) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (isValidAmount(val)) {
          allAmounts.push({ val, hasYenSymbol: false, isTotalLine: isTotal, isSubtotalLine: isSubtotal, line });
        }
      }
    }
  }

  // 小計（税抜）と合計（税込）の特定
  const subtotalEntries = allAmounts.filter(a => a.isSubtotalLine);
  const totalEntries = allAmounts.filter(a => a.isTotalLine);

  let detectedSubtotal = subtotalEntries.length > 0 ? Math.max(...subtotalEntries.map(e => e.val)) : undefined;

  // 1. 「合計・税込」行から探す
  if (totalEntries.length > 0) {
    // もし小計がわかっている場合、小計の1.05倍〜1.15倍の範囲（消費税8%〜10%）の金額があればそれが確実に税込合計！
    if (detectedSubtotal) {
      const taxMatched = totalEntries.find(e => e.val >= Math.floor(detectedSubtotal! * 1.05) && e.val <= Math.ceil(detectedSubtotal! * 1.15));
      if (taxMatched) {
        amount = taxMatched.val;
      }
    }

    // 見つからなければ、合計行の中で ¥記号付きを優先、または最大値
    if (!amount) {
      const withSymbol = totalEntries.filter(e => e.hasYenSymbol);
      if (withSymbol.length > 0) {
        amount = Math.max(...withSymbol.map(e => e.val));
      } else {
        amount = Math.max(...totalEntries.map(e => e.val));
      }
    }
  }

  // 2. 合計行で見つからない場合：全候補から最も妥当な金額を探す
  if (!amount && allAmounts.length > 0) {
    // ¥記号付きを優先
    const withSymbol = allAmounts.filter(a => a.hasYenSymbol && !a.isSubtotalLine);
    if (withSymbol.length > 0) {
      amount = Math.max(...withSymbol.map(e => e.val));
    } else {
      // 候補の中の最大値（ただし小計があればそれ以上）
      const validCandidates = allAmounts.filter(a => !a.isSubtotalLine);
      if (validCandidates.length > 0) {
        amount = Math.max(...validCandidates.map(e => e.val));
      } else if (detectedSubtotal) {
        // 最悪、小計しかなければ小計に10%足すか小計そのものを採用
        amount = detectedSubtotal;
      }
    }
  }

  // 金額候補リストの生成（重複排除・降順）
  const uniqueCandidateValues = Array.from(new Set(allAmounts.map(a => a.val)))
    .filter(v => v !== amount)
    .sort((a, b) => b - a)
    .slice(0, 5); // 上位5個まで

  // 5. 住所抽出（電話番号の周辺行を優先スキャン）
  const addressKeywords = ['都', '道', '府', '県', '市', '区', '町', '村', '丁目', '番地', '号', '番'];

  if (phoneLineIndex > 0) {
    const prevLine1 = lines[phoneLineIndex - 1];
    if (prevLine1 && addressKeywords.some(kw => prevLine1.includes(kw)) && prevLine1.length >= 4) {
      address = prevLine1;
    }
    if (!address && phoneLineIndex > 1) {
      const prevLine2 = lines[phoneLineIndex - 2];
      if (prevLine2 && addressKeywords.some(kw => prevLine2.includes(kw)) && prevLine2.length >= 4 && !prevLine2.includes('レシート')) {
        address = prevLine2;
      }
    }
    if (!address && phoneLineIndex + 1 < lines.length) {
      const nextLine = lines[phoneLineIndex + 1];
      if (nextLine && addressKeywords.some(kw => nextLine.includes(kw)) && nextLine.length >= 4) {
        address = nextLine;
      }
    }
  }

  if (!address) {
    for (const line of lines) {
      if (line.length >= 5 && !line.includes('TEL') && !line.includes('http') && !line.includes('担当') && !line.includes('レジ')) {
        const hasCityOrPref = /(東京都|北海道|大阪府|京都府|[一-龠]{2,3}県|[一-龠]{1,6}[市区町村])/.test(line);
        const hasNumberOrChome = /[\d０-９一二三四五六七八九十]+(丁目|番地|号|番|-)/.test(line);
        if (hasCityOrPref || (addressKeywords.some(kw => line.includes(kw)) && hasNumberOrChome)) {
          address = line;
          break;
        }
      }
    }
  }

  // 6. 店名・支店名抽出
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const line = lines[i];
    if (
      !line.match(dateRegex) &&
      !line.match(phoneRegex) &&
      !line.includes('領収書') &&
      !line.includes('レシート') &&
      !line.includes('お買上') &&
      !line.includes('TEL') &&
      line !== address &&
      line.length >= 2 &&
      line.length <= 40
    ) {
      // パターン1: スペース区切り (例: "セブン-イレブン 新宿東口店", "業務スーパー 渋谷店")
      const spaceMatch = line.match(/^(.+?)[\s　]+([^\s　]+?(?:店|支店|出張所|営業所))$/);
      if (spaceMatch) {
        shopName = spaceMatch[1].trim();
        branchName = spaceMatch[2].trim();
        break;
      }

      // パターン2: カッコ付き (例: "セブン-イレブン(渋谷店)", "イオン(幕張新都心店)")
      const parenMatch = line.match(/^(.+?)[(（](.+?(?:店|支店|出張所|営業所))[)）]$/);
      if (parenMatch) {
        shopName = parenMatch[1].trim();
        branchName = parenMatch[2].trim();
        break;
      }

      // パターン3: 末尾に「〇〇店」が付いている（例: "セブンイレブン新宿店", "ローソン渋谷二丁目店"）
      const suffixMatch = line.match(/^(.{2,15}?)([\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff0-9A-Za-z]+?(?:店|支店))$/);
      if (suffixMatch && suffixMatch[1].length >= 2) {
        shopName = suffixMatch[1].trim();
        branchName = suffixMatch[2].trim();
        break;
      }

      // パターン4: 次行が「〇〇店」の場合
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (/^[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff0-9A-Za-z]+?(?:店|支店)$/.test(nextLine) && nextLine.length <= 15) {
          shopName = line;
          branchName = nextLine;
          break;
        }
      }

      shopName = line;
      break;
    }
  }

  // 7. 購入商品・品目名の自動抽出
  const nonItemKeywords = [
    '合計', '小計', '消費税', '税', 'お支払', '支払', 'お預り', '預り', 'お釣', '釣',
    'クレジット', '現計', 'ポイント', '会員', 'レジ', '担当', 'No', 'TEL', '電話',
    '領収書', 'レシート', 'お買上', 'バーコード', '登録番号', '対象', '内税', '外税',
    'コード', '番号', '感謝', 'またお越し', '発行', '〒', '株式会社', '有限会社'
  ];

  const detectedItems: string[] = [];
  const itemsList: { name: string; price: number }[] = [];

  for (const line of lines) {
    if (line === shopName || line === address || line === phone) continue;
    if (nonItemKeywords.some(kw => line.includes(kw))) continue;
    if (line.match(dateRegex)) continue;

    // 金額（単価・価格）を抽出
    let itemPrice = 0;
    const priceMatch = line.match(/[¥￥]?\s*([0-9]{1,3}(,[0-9]{3})+|[0-9]{2,6})\s*円?/);
    if (priceMatch) {
      const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(p) && p > 0 && p < 100000 && p !== 2024 && p !== 2025 && p !== 2026) {
        itemPrice = p;
      }
    }

    // 金額や数量表記を除去して商品名を純化
    const cleanItemName = line
      .replace(/[¥￥]?\s*([0-9]{1,3}(,[0-9]{3})+|[0-9]{2,6})\s*円?/g, '')
      .replace(/[x×*]\s*[0-9]+/g, '')
      .replace(/[*#※■●◆]/g, '')
      .trim();

    if (
      cleanItemName.length >= 2 &&
      cleanItemName.length <= 25 &&
      /[ぁ-んァ-ヶー一-龠A-Za-z]/.test(cleanItemName)
    ) {
      if (!detectedItems.includes(cleanItemName)) {
        detectedItems.push(cleanItemName);
        itemsList.push({ name: cleanItemName, price: itemPrice });
      }
    }
  }

  const primaryItemName = detectedItems.length > 0 ? detectedItems[0] : undefined;

  return {
    shopName,
    branchName,
    date,
    amount: amount || 0,
    phone,
    address,
    detectedType,
    confidence: amount ? 0.9 : 0.4,
    rawText: normalizedText,
    amountCandidates: uniqueCandidateValues,
    itemName: primaryItemName,
    detectedItems,
    items: itemsList
  };
}

/**
 * Tesseract.jsを使った本物の画像OCR文字認識
 */
export async function analyzeReceiptImage(
  imageSource: string | File,
  onProgress?: (percent: number, message: string) => void
): Promise<ParsedReceiptData> {
  let worker;
  try {
    if (onProgress) onProgress(10, 'OCRエンジンを準備中...');

    worker = await createWorker(['jpn', 'eng'], 1, {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          const pct = Math.min(99, Math.round(m.progress * 100));
          onProgress(pct, `文字を認識・解析中... (${pct}%)`);
        } else if (onProgress) {
          onProgress(20, '文字辞書モデルを準備中...');
        }
      }
    });

    if (onProgress) onProgress(50, 'レシート文字を解析中...');
    const result = await worker.recognize(imageSource);
    const rawText = result.data.text;

    if (onProgress) onProgress(95, '税込合計・住所・店名を特定中...');
    const parsed = parseReceiptText(rawText);

    return parsed;
  } catch (error) {
    console.error('Tesseract OCR実行エラー:', error);
    return {
      shopName: '',
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      detectedType: 'receipt',
      confidence: 0,
      rawText: '',
      amountCandidates: []
    };
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

/**
 * 日本の主要チェーン店・スーパー・コンビニ辞書（シード知識）
 */
export const KNOWN_CHAINS = [
  'セブン-イレブン', 'セブンイレブン', 'ローソン', 'ファミリーマート', 'ミニストップ', 'デイリーヤマザキ',
  'イオン', 'マックスバリュ', 'ダイエー', 'ライフ', '業務スーパー', 'イトーヨーカドー',
  '西友', 'まいばすけっと', 'サミット', '成城石井', 'コストコ', 'カルディ',
  'マツモトキヨシ', 'ウエルシア', 'スギ薬局', 'サンドラッグ', 'ツルハドラッグ', 'ココカラファイン',
  'ダイソー', 'セリア', 'キャンドゥ', 'ニトリ', '無印良品', 'ユニクロ', 'GU',
  'スターバックス', 'ドトール', 'コメダ珈琲店', 'マクドナルド', 'モスバーガー',
  '吉野家', 'すき家', '松屋', 'ガスト', 'サイゼリヤ', 'スシロー', 'くら寿司', 'はま寿司'
];

/**
 * 文字列の類似度（0.0 〜 1.0）をレーベンシュタイン距離で計算
 */
export function calculateSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);
  if (maxLen === 0) return 1.0;

  const dp: number[][] = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  const distance = dp[len1][len2];
  return 1.0 - distance / maxLen;
}

/**
 * 店舗名のあいまい照合 ＆ 自動補正（過去に保存した店舗履歴および大手チェーン辞書から学習補正）
 */
export function matchAndCorrectShopName(
  rawName: string,
  learnedShops: string[] = []
): { correctedName: string; isCorrected: boolean } {
  if (!rawName || rawName.trim().length === 0) return { correctedName: rawName, isCorrected: false };
  const clean = rawName.replace(/[\s　・-]/g, '').toLowerCase();

  // 1. 過去にマサさんが登録した店舗マスタから最優先マッチ
  for (const shop of learnedShops) {
    const shopClean = shop.replace(/[\s　・-]/g, '').toLowerCase();
    if (clean === shopClean) {
      return { correctedName: shop, isCorrected: false };
    }
    if (clean.includes(shopClean) || shopClean.includes(clean)) {
      return { correctedName: shop, isCorrected: true };
    }
    const sim = calculateSimilarity(clean, shopClean);
    if (sim >= 0.70) {
      return { correctedName: shop, isCorrected: true };
    }
  }

  // 2. 内蔵大手チェーン辞書から照合・自動補正
  for (const chain of KNOWN_CHAINS) {
    const chainClean = chain.replace(/[\s　・-]/g, '').toLowerCase();
    if (clean.includes(chainClean) || chainClean.includes(clean)) {
      return { correctedName: chain, isCorrected: true };
    }
    const sim = calculateSimilarity(clean, chainClean);
    if (sim >= 0.65) {
      return { correctedName: chain, isCorrected: true };
    }
  }

  return { correctedName: rawName, isCorrected: false };
}

/**
 * 商品名の自己学習補正（過去に登録した商品履歴と単価から類似商品を特定）
 */
export function matchAndCorrectItemName(
  rawItemName: string,
  itemPrice: number,
  knownItems: { name: string; price: number }[]
): { correctedName: string; isCorrected: boolean } {
  if (!rawItemName || rawItemName.trim().length === 0) return { correctedName: rawItemName, isCorrected: false };
  const clean = rawItemName.trim();

  // 過去の同単価・高類似度商品を探索
  for (const known of knownItems) {
    if (!known.name) continue;
    // 単価が同一で、名前が類似している場合
    if (itemPrice > 0 && known.price === itemPrice) {
      const sim = calculateSimilarity(clean, known.name);
      if (sim >= 0.55) {
        return { correctedName: known.name, isCorrected: true };
      }
    }
    // 単価に関わらず名前が75%以上一致している場合
    const sim = calculateSimilarity(clean, known.name);
    if (sim >= 0.75) {
      return { correctedName: known.name, isCorrected: true };
    }
  }

  return { correctedName: rawItemName, isCorrected: false };
}

