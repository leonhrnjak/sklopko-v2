import { VIDEO_H, VIDEO_W, type VideoState } from './components/video'

/**
 * The video chip's 16 fixed colours, as 0xRRGGBB: a dark, dusty set (greys, browns, dull reds and greens) with a few bright accents (blood and
 * flame red, the exit's teal, the off-white of eyes and muzzle flash). Colour 0 is black, 1 the ceiling, 2 the floor, 3 and 11 the walls' two
 * sides, 5 and 13 the doors, 4 green, 6 red, 7 and 8 the chaser's flesh, 9 and 10 greys, 12 skin and gold, 14 the exit switch, 15 off-white.
 */
export const VIDEO_PALETTE: readonly number[] = [
  0x000000, 0x24242a, 0x3a3028, 0x77736a, 0x3f7f38, 0x5a3a1c, 0xc2301a, 0x7a3838, 0xa85a50, 0x4a4742, 0x8c8c88, 0x55524b, 0xd0a868, 0x8a5a2b, 0x35b8a8, 0xe8e4d8,
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
