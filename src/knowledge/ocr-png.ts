import { crc32, deflateSync } from 'node:zlib'
/** Lossless low-latency encoding for the isolated RGB OCR renderer. */
export function encodeOcrRgb(width: number, height: number, stride: number, pixels: Uint8ClampedArray): Buffer {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(stride) || stride < width * 3 || pixels.length < stride * height) throw Error('Invalid RGB raster')
  const rowBytes = width * 3
  const raw = Buffer.allocUnsafe((rowBytes + 1) * height)
  const source = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  for (let y = 0; y < height; y++) {
    const out = y * (rowBytes + 1)
    raw[out] = 0
    source.copy(raw, out + 1, y * stride, y * stride + rowBytes)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 2
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))])
}
