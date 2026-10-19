export interface GeminiReceiptItem {
  name: string;
  price: number; // その品目の合計金額
  quantity?: number; // 個数・数量（例: 1, 2, 3...）
  unitPrice?: number; // 1個あたりの単価（円）
}

export interface GeminiReceiptData {
  date: string; // 購入日 YYYY-MM-DD
  store_name: string; // 店舗ブランド名（例: "セブン-イレブン", "イオン", "ライフ"）
  branch_name?: string; // 支店名・店舗名（例: "渋谷店", "幕張新都心店"。記載がなければ空文字）
  phone?: string; // 電話番号（ハイフン付き。例: "03-1234-5678"）
  address?: string; // 店舗住所（所在地）
  items: GeminiReceiptItem[]; // 品目名の配列: name, price, quantity, unitPrice
  total_amount: number; // 支払総額（税込）
  tax_amount?: number; // 消費税等（円）
  subtotal?: number; // 小計・税抜合計（円）
  tax_included?: boolean; // 内税方式かどうか（true: 内税, false: 外税）
}

export interface GeminiReceiptResult extends GeminiReceiptData {
  branchName?: string;
  phone?: string;
  address?: string;
  shopName: string; // 互換用
  totalAmount: number; // 互換用
  taxAmount?: number; // 互換用
  rawResponse?: string;
}

/**
 * 店名からブランド名と支店名（〇〇店、〇〇支店）を自動分離するユーティリティ
 */
export function splitStoreAndBranch(
  rawStore: string,
  rawBranch?: string
): { storeName: string; branchName: string } {
  let store = (rawStore || '').trim();
  let branch = (rawBranch || '').trim();

  // すでにbranchが指定されている場合
  if (branch) {
    // もしstore側にも同じbranchが含まれている場合はstoreから除去
    if (store.endsWith(branch)) {
      store = store.slice(0, -branch.length).trim();
    }
    return { storeName: store, branchName: branch };
  }

  // 1. スペース区切りの場合: "セブン-イレブン 渋谷道玄坂店" や "イオン 幕張新都心店"
  const spaceMatch = store.match(/^(.+?)\s+([^\s]+(?:店|支店|営業所|出張所|マート|ストア))$/);
  if (spaceMatch) {
    return {
      storeName: spaceMatch[1].trim(),
      branchName: spaceMatch[2].trim()
    };
  }

  // 2. スペースなしで末尾が「〇〇店」「〇〇支店」などの場合: "ライフ溝口店" -> "ライフ", "溝口店"
  // "商店", "飯店" などブランド名そのものの場合は除外
  const branchSuffixMatch = store.match(/^(.+?)([\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ffA-Za-z0-9]+(?:店|支店))$/);
  if (branchSuffixMatch && branchSuffixMatch[1].length >= 2) {
    const candidateStore = branchSuffixMatch[1].trim();
    const candidateBranch = branchSuffixMatch[2].trim();
    if (!store.endsWith('商店') && !store.endsWith('飯店') && candidateBranch !== '本店') {
      return {
        storeName: candidateStore,
        branchName: candidateBranch
      };
    }
  }

  return { storeName: store, branchName: '' };
}

/**
 * Data URL (base64) から純粋なbase64文字列とMIMEタイプを抽出
 */
export function extractBase64AndMime(dataUrl: string): { mimeType: string; base64Data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      base64Data: match[2]
    };
  }
  return {
    mimeType: 'image/jpeg',
    base64Data: dataUrl
  };
}

/**
 * File オブジェクトを Base64 Data URL に変換
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('ファイルの読み込みに失敗しました'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 優先的に試すFlashモデル候補
const CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

let cachedActiveModel: string | null = null;

/**
 * APIキーで利用可能な最新のGemini Flashモデルを動的に探索・特定する
 */
export async function resolveAvailableGeminiModel(apiKey: string, forceRefresh = false): Promise<string> {
  const trimmed = apiKey.trim();
  if (cachedActiveModel && !forceRefresh) {
    return cachedActiveModel;
  }

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}`;
    const res = await fetch(listUrl);
    if (res.ok) {
      const data = await res.json();
      const models: any[] = data.models || [];
      const supported = models
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      // 1. 候補順に利用可能なものを探索
      for (const cand of CANDIDATE_MODELS) {
        if (supported.includes(cand)) {
          cachedActiveModel = cand;
          return cand;
        }
      }

      // 2. 名前に "flash" を含むモデルを探索
      const flashModel = supported.find(m => m.toLowerCase().includes('flash'));
      if (flashModel) {
        cachedActiveModel = flashModel;
        return flashModel;
      }

      // 3. 最初に見つかったモデル
      if (supported.length > 0) {
        cachedActiveModel = supported[0];
        return supported[0];
      }
    }
  } catch (err) {
    console.warn('ListModels自動取得スキップ:', err);
  }

  // デフォルト候補（2026年最新）
  cachedActiveModel = 'gemini-3.8-flash';
  return cachedActiveModel;
}

/**
 * Gemini APIキーの疎通確認・検証テスト（利用可能モデルを自動特定してテスト）
 */
export async function testGeminiApiKey(apiKey: string): Promise<{ success: boolean; message: string; model?: string }> {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    return { success: false, message: 'APIキーが入力されていません。' };
  }

  const modelToTest = await resolveAvailableGeminiModel(trimmed, true);

  // 試行するモデル順（自動解決モデル -> 他の候補）
  const testQueue = [modelToTest, ...CANDIDATE_MODELS.filter(m => m !== modelToTest)];

  for (const model of testQueue) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      });

      if (res.ok) {
        cachedActiveModel = model;
        return {
          success: true,
          message: `接続成功！モデル「${model}」が正常に稼働しています。`,
          model
        };
      }

      let detail = '';
      try {
        const errJson = await res.json();
        detail = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        detail = await res.text();
      }

      // 404の場合は次のモデル候補を試す
      if (res.status === 404) {
        continue;
      }

      if (res.status === 400 && detail.includes('API_KEY_INVALID')) {
        return { success: false, message: 'APIキーが無効です。Google AI Studioからコピーしたキーをご確認ください。' };
      }
      if (res.status === 403) {
        return { success: false, message: `権限エラー (403): ${detail}` };
      }
      return { success: false, message: `API接続エラー (${res.status}): ${detail}` };
    } catch (e: any) {
      return { success: false, message: `ネットワーク接続エラー: ${e?.message || '通信できませんでした'}` };
    }
  }

  return { success: false, message: '利用可能なGeminiモデルが見つかりませんでした。Google AI Studioで有効なモデルをご確認ください。' };
}

/** Gemini APIエラーの種類（UIでAPIキー入力を出すかどうかの判定に使用） */
export type GeminiErrorKind = 'key' | 'busy' | 'network' | 'other';

export class GeminiApiError extends Error {
  kind: GeminiErrorKind;
  constructor(kind: GeminiErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'GeminiApiError';
  }
}

/** 任意のエラーから種類を取り出す */
export function getGeminiErrorKind(err: unknown): GeminiErrorKind {
  if (err instanceof GeminiApiError) return err.kind;
  const msg = String((err as any)?.message || '');
  if (/APIキー|API_KEY/.test(msg)) return 'key';
  if (/503|429|high demand|overloaded|混雑/.test(msg)) return 'busy';
  return 'other';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * 汎用: 画像＋プロンプト＋JSONスキーマでGeminiを呼び出し、JSON文字列を返す
 * - 混雑(503)・回数制限(429)・一時障害(5xx)は待機して再試行
 * - それでも失敗したら別のFlashモデルに自動で切り替え
 */
export async function callGeminiVisionJson(
  imageDataUrl: string,
  apiKey: string,
  prompt: string,
  responseSchema: Record<string, unknown>
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new GeminiApiError('key', 'Gemini APIキーが設定されていません。設定画面からAPIキーを入力してください。');
  }
  const { mimeType, base64Data } = extractBase64AndMime(imageDataUrl);
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64Data } }, { text: prompt }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: responseSchema,
      temperature: 0
    }
  });

  const activeModel = await resolveAvailableGeminiModel(apiKey);
  const modelsToTry = [activeModel, ...CANDIDATE_MODELS.filter(m => m !== activeModel)];
  let sawBusy = false;
  let sawNetwork = false;
  let lastDetail = '';

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    // 同じモデルで最大3回（初回＋再試行2回）
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      } catch (err: any) {
        sawNetwork = true;
        lastDetail = err?.message || '';
        if (attempt < 2) { await sleep(1200 * (attempt + 1)); continue; }
        break;
      }

      if (res.status === 404) break; // このモデルは使えない → 次のモデルへ

      if (res.ok) {
        const data = await res.json();
        const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textOutput) {
          lastDetail = '応答が空でした';
          if (attempt < 2) { await sleep(800); continue; }
          break;
        }
        cachedActiveModel = model;
        return textOutput;
      }

      let errorDetail = '';
      try {
        const errJson = await res.json();
        errorDetail = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errorDetail = await res.text().catch(() => '');
      }
      lastDetail = `${res.status}: ${errorDetail}`;

      if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(errorDetail)) {
        throw new GeminiApiError('key', 'Gemini APIキーが無効です。設定画面でAPIキーをご確認ください。');
      }
      if (res.status === 401 || res.status === 403) {
        throw new GeminiApiError('key', `APIキーに権限がありません (${res.status})。設定画面でAPIキーをご確認ください。`);
      }

      if (RETRYABLE.has(res.status)) {
        sawBusy = true;
        if (attempt < 2) {
          await sleep(1500 * Math.pow(2, attempt)); // 1.5秒 → 3秒
          continue;
        }
        break; // このモデルは混雑中 → 次のモデルへ
      }

      throw new GeminiApiError('other', `Gemini APIエラー (${res.status}): ${errorDetail}`);
    }
  }

  if (sawBusy) {
    throw new GeminiApiError('busy', 'Googleのサーバーが混雑しています（APIキーは正常です）。少し時間をおいて「再試行」を押してください。');
  }
  if (sawNetwork) {
    throw new GeminiApiError('network', `通信できませんでした。電波状況を確認して再試行してください。（${lastDetail}）`);
  }
  throw new GeminiApiError('other', `Gemini APIに接続できませんでした（${lastDetail || '利用可能なモデルが見つかりません'}）`);
}

/**
 * レシート画像をGeminiで高精度解析する（動的モデル対応）
 */
export async function analyzeReceiptWithGemini(
  imageDataUrl: string,
  apiKey: string
): Promise<GeminiReceiptResult> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Gemini APIキーが設定されていません。設定画面からAPIキーを入力してください。');
  }

  const { mimeType, base64Data } = extractBase64AndMime(imageDataUrl);
  const today = new Date().toISOString().split('T')[0];

  const prompt = `あなたは日本のレシート解析に特化した世界最高水準のOCRエキスパートです。
提供されたレシート画像を詳細に読み取り、以下のキーを持つJSONオブジェクトのみを出力してください:
- date: 購入日（YYYY-MM-DD形式。和暦の場合は西暦に変換。不明な場合は「${today}」）
- store_name: 店舗ブランド名・チェーン名（最重要: 支店名は含めず、ブランド名や店舗本体の名前のみを抽出してください。例: "セブン-イレブン", "イオン", "ライフ", "ローソン", "マツモトキヨシ"）
- branch_name: 支店名（最重要: 「〇〇店」「〇〇支店」「〇〇出張所」などの支店名のみを抽出してください。例: "渋谷店", "幕張新都心店", "新宿東口店"。レシートに支店名が記載されていない場合は空文字 ""）
- phone: 電話番号（最重要: レシート上部や下部に印字されている電話番号・TELを抽出。市外局番を含むハイフン区切り。例: "03-1234-5678", "045-123-4567"。記載がなければ空文字 ""）
- address: 店舗の住所・所在地（最重要: レシートに記載されている店舗の都道府県・市区町村・番地などの住所テキストを抽出。例: "東京都渋谷区道玄坂1-2-3"。記載がなければ空文字 ""）
- items: 購入品目の配列。各要素は {"name": "品目名", "quantity": 個数数値, "price": その品目の合計金額数値, "unit_price": 単価数値}
  * 最重要: レシートに「2点」「×2」「2個」「@150」のように個数・数量が印字されている場合、quantity にその個数を設定してください（記載がない場合は 1）。
  * 単価が印字されている場合は unit_price に設定し、price にはその品目の合計支払金額（単価×数量など）を設定してください。
  * 割引や値引き（▲50円など）がある場合、値引き後の最終金額を price に反映してください。
  * 「外税」「内税」「小計」「お預かり」「お釣り」「合計」などの精算行は品目に含めないでください。
- total_amount: 支払総額（税込合計金額の数値）
  * 最も重要: 「お買上合計」「税込合計」「請求金額」「領収金額」「合計」の数値を必ず正確に設定してください。
  * 「お預かり」や「お釣り」と混同しないでください。
- tax_amount: 消費税額（数値。レシートに「消費税等」「内消費税等」「外税」などの記載があればその税額合計数値。記載がなければ0）
- subtotal: 小計または税抜合計金額（数値。記載があればその数値、記載がなければ0）
- tax_included: 内税方式かどうか（内税や税込表示なら true、外税表示なら false）

必ず指定のJSONスキーマに従い、余分な解説やマークダウン記法を含めず有効なJSON文字列のみを返してください。`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING", description: "購入日 YYYY-MM-DD" },
          store_name: { type: "STRING", description: "店舗ブランド名・チェーン名（支店名は含めない。例: セブン-イレブン, イオン）" },
          branch_name: { type: "STRING", description: "支店名（〇〇店、〇〇支店など。記載がなければ空文字）" },
          phone: { type: "STRING", description: "電話番号（例: 03-1234-5678。記載がなければ空文字）" },
          address: { type: "STRING", description: "店舗住所・所在地（記載がなければ空文字）" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "品目名" },
                quantity: { type: "NUMBER", description: "個数・数量（1以上の整数。記載がなければ1）" },
                price: { type: "NUMBER", description: "その品目の合計金額" },
                unit_price: { type: "NUMBER", description: "1個あたりの単価（記載がある場合）" }
              },
              required: ["name", "price"]
            }
          },
          total_amount: { type: "NUMBER", description: "税込合計金額" },
          tax_amount: { type: "NUMBER", description: "消費税等の合計金額（記載がなければ0）" },
          subtotal: { type: "NUMBER", description: "小計または税抜金額（記載がなければ0）" },
          tax_included: { type: "BOOLEAN", description: "内税方式ならtrue、外税方式ならfalse" }
        },
        required: ["date", "store_name", "items", "total_amount"]
      }
    }
  };

  // 混雑時の再試行・別モデルへの自動切替は callGeminiVisionJson が担当
  const textOutput = await callGeminiVisionJson(imageDataUrl, apiKey, prompt, requestBody.generationConfig.response_schema);

  try {
    const parsed = JSON.parse(textOutput);

    // store_name, branch_name
    const rawStoreName = String(parsed.store_name || parsed.shopName || '').trim();
    const rawBranchName = String(parsed.branch_name || parsed.branchName || '').trim();
    const splitResult = splitStoreAndBranch(rawStoreName, rawBranchName);
    const store_name = splitResult.storeName;
    const branch_name = splitResult.branchName;

    // phone, address
    const phone = String(parsed.phone || '').trim();
    const address = String(parsed.address || '').trim();

    // total_amount または totalAmount
    const rawTotal = parsed.total_amount !== undefined ? parsed.total_amount : parsed.totalAmount;
    const total_amount = typeof rawTotal === 'number'
      ? rawTotal
      : Number(String(rawTotal || '0').replace(/[^0-9.-]/g, '')) || 0;

    // date
    const date = parsed.date || today;

    // items
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: GeminiReceiptItem[] = rawItems.map((it: any) => {
      const name = String(it.name || '').trim();
      const rawPrice = it.price !== undefined ? it.price : 0;
      const price = typeof rawPrice === 'number'
        ? rawPrice
        : Number(String(rawPrice || '0').replace(/[^0-9.-]/g, '')) || 0;

      const rawQty = it.quantity !== undefined ? it.quantity : 1;
      const quantity = Math.max(1, typeof rawQty === 'number'
        ? Math.round(rawQty)
        : Math.round(Number(String(rawQty || '1').replace(/[^0-9.-]/g, '')) || 1));

      const rawUnit = it.unit_price !== undefined ? it.unit_price : it.unitPrice;
      const unitPrice = typeof rawUnit === 'number' && rawUnit > 0
        ? rawUnit
        : (quantity > 1 ? Math.round(price / quantity) : price);

      return {
        name,
        price,
        quantity,
        unitPrice
      };
    }).filter((it: GeminiReceiptItem) => it.name.length > 0 || it.price > 0);

    // tax_amount
    const rawTax = parsed.tax_amount !== undefined ? parsed.tax_amount : parsed.taxAmount;
    const tax_amount = typeof rawTax === 'number'
      ? rawTax
      : Number(String(rawTax || '0').replace(/[^0-9.-]/g, '')) || 0;

    // subtotal
    const rawSubtotal = parsed.subtotal;
    const subtotal = typeof rawSubtotal === 'number'
      ? rawSubtotal
      : Number(String(rawSubtotal || '0').replace(/[^0-9.-]/g, '')) || 0;

    // tax_included
    const tax_included = parsed.tax_included !== undefined ? Boolean(parsed.tax_included) : true;

    return {
      date,
      store_name,
      branch_name,
      phone,
      address,
      items,
      total_amount,
      tax_amount,
      taxAmount: tax_amount,
      subtotal,
      tax_included,
      shopName: store_name,
      branchName: branch_name,
      totalAmount: total_amount,
      rawResponse: textOutput
    };
  } catch (parseErr) {
    console.error('JSONパース失敗:', textOutput, parseErr);
    throw new Error('Geminiからの解析結果JSONのパースに失敗しました。');
  }
}
