import { describe, expect, it } from 'vitest'
import { crc32, inflateSync } from 'node:zlib'
import { encodeOcrRgb } from '../src/knowledge/ocr-png.js'
describe('lossless OCR raster encoding', () => {
  it('preserves every RGB sample across padded scanlines and writes valid PNG chunks', () => {
    const pixels = new Uint8ClampedArray([255,0,0,0,255,0,99,99, 0,0,255,127,128,129,88,88])
    const png = encodeOcrRgb(2, 2, 8, pixels)
    expect([...png.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10])
    const names: string[] = [], compressed: Buffer[] = []
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8)
      const body = png.subarray(at + 4, at + 8 + length)
      expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(body))
      names.push(type)
      if (type === 'IHDR') { expect(png.readUInt32BE(at + 8)).toBe(2); expect(png.readUInt32BE(at + 12)).toBe(2); expect(png[at + 17]).toBe(2) }
      if (type === 'IDAT') compressed.push(png.subarray(at + 8, at + 8 + length))
      at += length + 12
    }
    expect(names).toEqual(['IHDR','IDAT','IEND'])
    expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0,255,0,0,0,255,0, 0,0,0,255,127,128,129])
  })
  it('rejects invalid dimensions, short pixel data, and invalid strides', () => {
    for (const [w,h,stride] of [[0,1,3],[1.5,1,6],[2,2,5],[2,2,6],[1,1,NaN]]) {
      expect(() => encodeOcrRgb(w,h,stride,new Uint8ClampedArray(3))).toThrow('Invalid RGB raster')
    }
  })
})
