// Required process secrets. No defaults and no generated keys.

function readRequiredSecret(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') {
    const error = new Error(`${name} is required. Refusing to start without it.`);
    error.code = 'MISSING_SECRET';
    throw error;
  }
  return String(value).trim();
}

function assertRequiredSecrets() {
  readRequiredSecret('JWT_SECRET');
  readRequiredSecret('ENCRYPTION_KEY');
}

function getJwtSecret() {
  return readRequiredSecret('JWT_SECRET');
}

module.exports = {
  assertRequiredSecrets,
  getJwtSecret,
  readRequiredSecret,
};
