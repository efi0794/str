const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return bytesToBase64Url(bytes);
}

export async function hashPassword(password, saltValue = null) {
  const salt = saltValue ? base64UrlToBytes(saltValue) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 120000
    },
    material,
    256
  );
  return {
    hash: bytesToBase64Url(new Uint8Array(bits)),
    salt: bytesToBase64Url(salt)
  };
}

export async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  const a = encoder.encode(hash);
  const b = encoder.encode(expectedHash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function importMasterKey(masterKey) {
  if (!masterKey) throw new Error("MASTER_KEY is not configured");
  const raw = base64UrlToBytes(masterKey.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""));
  if (raw.length !== 32) throw new Error("MASTER_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plainText, masterKey) {
  if (plainText == null || plainText === "") return null;
  const key = await importMasterKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(String(plainText))
  );
  return bytesToBase64Url(iv) + "." + bytesToBase64Url(new Uint8Array(encrypted));
}

export async function decryptSecret(packed, masterKey) {
  if (!packed) return null;
  const [ivText, cipherText] = String(packed).split(".");
  if (!ivText || !cipherText) throw new Error("Encrypted secret is malformed");
  const key = await importMasterKey(masterKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivText) },
    key,
    base64UrlToBytes(cipherText)
  );
  return decoder.decode(decrypted);
}
