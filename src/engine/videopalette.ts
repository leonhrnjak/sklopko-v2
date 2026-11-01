import { VIDEO_H, VIDEO_W, type VideoState } from './components/video'

/** The video chip's 16 fixed colours, as 0xRRGGBB. */
export const VIDEO_PALETTE: readonly number[] = [
  0x000000, 0x1b2a6b, 0x3b3fc2, 0x1f8a4c, 0x3ecf5a, 0x7a2e1f, 0xd9552b, 0x8a1fa6, 0xe04fd0, 0x555555, 0x9a9a9a, 0xc9d6e8, 0xf2d32e, 0xff9a2e, 0x34c7d9, 0xffffff,
]

/**
 * The picture as RGBA pixels, row by row (what a canvas takes): the chip stores it column by column, 50 bytes a column, two pixels a
 * byte with the upper one in the high nibble, so this turns it on its side. `out` is reused when given.
 */
export function videoPixels(px: readonly number[], out = new Uint32Array(VIDEO_W * VIDEO_H)): Uint32Array {
  for (let x = 0; x < VIDEO_W; x++) {
    for (let j = 0; j < VIDEO_H / 2; j++) {
      const b = px[x * (VIDEO_H / 2) + j]
      out[2 * j * VIDEO_W + x] = rgba(VIDEO_PALETTE[b >> 4])
      out[(2 * j + 1) * VIDEO_W + x] = rgba(VIDEO_PALETTE[b & 15])
    }
  }
  return out
}

/** 0xRRGGBB as the little-endian 0xAABBGGRR word of an RGBA pixel. */
const rgba = (c: number) => (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | (c >> 16)) >>> 0

export type { VideoState }
