// Generate a secure 32-byte base64-encoded key for OURCALENDAR_ENC_KEY
console.log(require('crypto').randomBytes(32).toString('base64'))
