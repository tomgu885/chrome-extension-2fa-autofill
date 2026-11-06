import jsQR from 'jsqr';

export async function readQRImages(blob) {
  if (blob.size > 20_000_000) throw new Error('图片超过 20 MB，请裁剪二维码后再试。');
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const results = [];
    for (let i = 0; i < 30; i++) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
      if (!qr) break;
      results.push(qr.data);
      const points = [qr.location.topLeftCorner, qr.location.topRightCorner, qr.location.bottomLeftCorner, qr.location.bottomRightCorner];
      const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
      ctx.fillStyle = '#fff';
      ctx.fillRect(left - 3, top - 3, Math.max(...points.map(p => p.x)) - left + 6, Math.max(...points.map(p => p.y)) - top + 6);
    }
    const supported = [...new Set(results)].filter(value => /^otpauth(?:-migration)?:/i.test(value));
    if (!supported.length) throw new Error('未找到 TOTP 或 Google 迁移二维码，请使用完整、清晰的二维码图片。');
    return supported;
  } finally { bitmap.close(); }
}
