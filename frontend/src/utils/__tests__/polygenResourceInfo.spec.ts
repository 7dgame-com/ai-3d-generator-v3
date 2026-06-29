import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLYGEN_RESOURCE_INFO,
  buildPolygenResourceInfo,
  buildPolygenResourceInfoJson,
} from '../polygenResourceInfo'

function createGlbBuffer(gltf: unknown) {
  const encoder = new TextEncoder()
  const json = encoder.encode(JSON.stringify(gltf))
  const padding = (4 - (json.length % 4)) % 4
  const jsonChunkLength = json.length + padding
  const totalLength = 12 + 8 + jsonChunkLength
  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, totalLength, true)
  view.setUint32(12, jsonChunkLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  bytes.fill(0x20, 20 + json.length, 20 + jsonChunkLength)

  return buffer
}

describe('polygenResourceInfo', () => {
  it('extracts bounds, face count, and animation length from a GLB JSON chunk', () => {
    const buffer = createGlbBuffer({
      asset: { version: '2.0' },
      accessors: [
        { min: [-1, 0, 2], max: [3, 4, 6], count: 12 },
        { count: 18 },
        { min: [0], max: [2.5], count: 2 },
      ],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0 },
              indices: 1,
            },
          ],
        },
      ],
      animations: [
        {
          name: 'Spin',
          samplers: [{ input: 2 }],
        },
      ],
    })

    expect(buildPolygenResourceInfo(buffer)).toEqual({
      size: { x: 4, y: 4, z: 4 },
      center: { x: 1, y: 2, z: 4 },
      anim: [{ name: 'Spin', length: 2.5 }],
      faces: 6,
    })
  })

  it('falls back to safe initialization info when model metadata is unavailable', () => {
    const info = buildPolygenResourceInfo(new ArrayBuffer(4))

    expect(info).toEqual(DEFAULT_POLYGEN_RESOURCE_INFO)
    expect(JSON.parse(buildPolygenResourceInfoJson(new ArrayBuffer(4)))).toEqual(
      DEFAULT_POLYGEN_RESOURCE_INFO
    )
  })
})
