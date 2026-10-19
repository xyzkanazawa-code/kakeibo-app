/**
 * WebAuthn (Passkeys / 生体認証: 指紋認証・顔認証・Touch ID・Face ID・Windows Hello) 連携ユーティリティ
 */

// ArrayBufferをBase64文字列に変換
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Base64文字列をUint8Arrayに変換
function base64ToBuffer(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 端末およびブラウザが生体認証（プラットフォーム認証器）に対応しているか判定
 */
export async function isBioAuthSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;

  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return available;
    }
    return true;
  } catch (e) {
    console.warn('生体認証サポート判定エラー:', e);
    return false;
  }
}

/**
 * 生体認証（指紋・顔認証）を新規登録
 */
export async function registerBioAuth(userName = 'マサ'): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    if (!window.PublicKeyCredential) {
      return { success: false, error: 'お使いのブラウザは生体認証に対応していません。' };
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: '超圧縮家計簿',
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: userName,
          displayName: userName
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },  // ES256
          { alg: -257, type: 'public-key' } // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // スマホ・PC内蔵の生体認証
          userVerification: 'required'
        },
        timeout: 60000
      }
    }) as PublicKeyCredential | null;

    if (!credential) {
      return { success: false, error: '認証器から応答がありませんでした。' };
    }

    const credId = bufferToBase64(credential.rawId);
    return { success: true, credentialId: credId };
  } catch (err: any) {
    console.error('生体認証登録エラー:', err);
    if (err.name === 'NotAllowedError') {
      return { success: false, error: '生体認証がキャンセルされたか、許可されませんでした。' };
    }
    return { success: false, error: err.message || '生体認証の登録に失敗しました。' };
  }
}

/**
 * 生体認証（指紋・顔認証）によるロック解除・本人確認
 */
export async function verifyBioAuth(credentialId?: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!window.PublicKeyCredential) {
      return { success: false, error: 'お使いのブラウザは生体認証に対応していません。' };
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const allowCredentials: PublicKeyCredentialDescriptor[] = [];
    if (credentialId) {
      try {
        allowCredentials.push({
          type: 'public-key',
          id: base64ToBuffer(credentialId) as any
        });
      } catch (e) {
        console.warn('クレデンシャルID復号エラー:', e);
      }
    }

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
        userVerification: 'required',
        timeout: 60000
      }
    });

    if (assertion) {
      return { success: true };
    }
    return { success: false, error: '認証に失敗しました。' };
  } catch (err: any) {
    console.error('生体認証照合エラー:', err);
    if (err.name === 'NotAllowedError') {
      return { success: false, error: '生体認証がキャンセルされました。' };
    }
    return { success: false, error: err.message || '認証に失敗しました。' };
  }
}
