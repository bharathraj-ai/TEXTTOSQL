// ============================================
// Encryption Utility — AES-256-GCM
// ============================================
// Encrypts and decrypts sensitive database connection strings
// stored in the database_connections table.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Get 32-byte encryption key buffer from environment variable
 */
function getKey() {
  const rawKey = process.env.ENCRYPTION_KEY || 'e8b2c4d6f1a35790b8e4c2d1a6f83579e8b2c4d6f1a35790b8e4c2d1a6f83579';
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  // Fallback: SHA-256 hash of whatever string is provided to ensure 32 bytes
  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * Encrypt plain text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} iv:authTag:encryptedContent in hex format
 */
function encrypt(text) {
  if (!text) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt cipher text using AES-256-GCM
 * @param {string} encryptedString - iv:authTag:encryptedContent
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedString) {
  if (!encryptedString) return '';
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedDataHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};
