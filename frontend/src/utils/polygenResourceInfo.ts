export interface Vector3Info {
  x: number
  y: number
  z: number
}

export interface PolygenAnimationInfo {
  name: string
  length: number
}

export interface PolygenResourceInfo {
  size: Vector3Info
  center: Vector3Info
  anim: PolygenAnimationInfo[]
  faces: number
}

type GltfAccessor = {
  count?: number
  min?: number[]
  max?: number[]
}

type GltfPrimitive = {
  attributes?: {
    POSITION?: number
  }
  indices?: number
  mode?: number
}

type GltfMesh = {
  primitives?: GltfPrimitive[]
}

type GltfAnimation = {
  name?: string
  samplers?: Array<{
    input?: number
  }>
}

type GltfJson = {
  accessors?: GltfAccessor[]
  meshes?: GltfMesh[]
  animations?: GltfAnimation[]
}

export const DEFAULT_POLYGEN_RESOURCE_INFO: PolygenResourceInfo = {
  size: { x: 1, y: 1, z: 1 },
  center: { x: 0, y: 0, z: 0 },
  anim: [],
  faces: 0,
}

export const DEFAULT_POLYGEN_RESOURCE_INFO_JSON = JSON.stringify(DEFAULT_POLYGEN_RESOURCE_INFO)

const createDefaultPolygenResourceInfo = (): PolygenResourceInfo => ({
  size: { ...DEFAULT_POLYGEN_RESOURCE_INFO.size },
  center: { ...DEFAULT_POLYGEN_RESOURCE_INFO.center },
  anim: [],
  faces: DEFAULT_POLYGEN_RESOURCE_INFO.faces,
})

const GLB_MAGIC = 0x46546c67
const GLB_VERSION_2 = 2
const GLB_JSON_CHUNK = 0x4e4f534a
const GLTF_TRIANGLES = 4
const GLTF_TRIANGLE_STRIP = 5
const GLTF_TRIANGLE_FAN = 6

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const round = (value: number) => Number(value.toFixed(5))

const toVector3Info = (values: number[]): Vector3Info => ({
  x: round(values[0] ?? 0),
  y: round(values[1] ?? 0),
  z: round(values[2] ?? 0),
})

const isValidVector3 = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(isFiniteNumber)

function parseGlbJson(buffer: ArrayBuffer): GltfJson | null {
  if (buffer.byteLength < 20) {
    return null
  }

  const view = new DataView(buffer)

  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION_2) {
    return null
  }

  const totalLength = view.getUint32(8, true)
  if (totalLength > buffer.byteLength) {
    return null
  }

  const decoder = new TextDecoder()
  let offset = 12

  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    offset += 8

    if (offset + chunkLength > totalLength) {
      return null
    }

    if (chunkType === GLB_JSON_CHUNK) {
      const jsonText = decoder
        .decode(buffer.slice(offset, offset + chunkLength))
        .replace(/\0+$/g, '')
        .trim()
      return JSON.parse(jsonText) as GltfJson
    }

    offset += chunkLength
  }

  return null
}

function extractBounds(gltf: GltfJson) {
  const accessors = gltf.accessors ?? []
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let hasBounds = false

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const positionAccessorIndex = primitive.attributes?.POSITION
      if (!isFiniteNumber(positionAccessorIndex)) {
        continue
      }

      const accessor = accessors[positionAccessorIndex]
      if (!isValidVector3(accessor?.min) || !isValidVector3(accessor?.max)) {
        continue
      }

      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis])
        max[axis] = Math.max(max[axis], accessor.max[axis])
      }
      hasBounds = true
    }
  }

  if (!hasBounds) {
    return null
  }

  return {
    size: toVector3Info(max.map((value, axis) => value - min[axis])),
    center: toVector3Info(max.map((value, axis) => (value + min[axis]) / 2)),
  }
}

function countPrimitiveFaces(primitive: GltfPrimitive, accessors: GltfAccessor[]) {
  const mode = primitive.mode ?? GLTF_TRIANGLES
  const countAccessorIndex = isFiniteNumber(primitive.indices)
    ? primitive.indices
    : primitive.attributes?.POSITION
  const count = isFiniteNumber(countAccessorIndex) ? accessors[countAccessorIndex]?.count : undefined

  if (!isFiniteNumber(count) || count <= 0) {
    return 0
  }

  if (mode === GLTF_TRIANGLES) {
    return count / 3
  }

  if (mode === GLTF_TRIANGLE_STRIP || mode === GLTF_TRIANGLE_FAN) {
    return Math.max(0, count - 2)
  }

  return 0
}

function countFaces(gltf: GltfJson) {
  const accessors = gltf.accessors ?? []
  let faces = 0

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      faces += countPrimitiveFaces(primitive, accessors)
    }
  }

  return Math.round(faces)
}

function extractAnimations(gltf: GltfJson): PolygenAnimationInfo[] {
  const accessors = gltf.accessors ?? []

  return (gltf.animations ?? []).map((animation, index) => {
    const length = Math.max(
      0,
      ...(animation.samplers ?? []).map((sampler) => {
        const inputAccessorIndex = sampler.input
        if (!isFiniteNumber(inputAccessorIndex)) {
          return 0
        }

        const max = accessors[inputAccessorIndex]?.max
        return isFiniteNumber(max?.[0]) ? max[0] : 0
      })
    )

    return {
      name: animation.name?.trim() || `Animation ${index + 1}`,
      length: round(length),
    }
  })
}

export function buildPolygenResourceInfo(buffer: ArrayBuffer): PolygenResourceInfo {
  try {
    const gltf = parseGlbJson(buffer)
    if (!gltf) {
      return createDefaultPolygenResourceInfo()
    }

    const bounds = extractBounds(gltf)
    const defaultInfo = createDefaultPolygenResourceInfo()

    return {
      size: bounds?.size ?? defaultInfo.size,
      center: bounds?.center ?? defaultInfo.center,
      anim: extractAnimations(gltf),
      faces: countFaces(gltf),
    }
  } catch {
    return createDefaultPolygenResourceInfo()
  }
}

export function buildPolygenResourceInfoJson(buffer: ArrayBuffer): string {
  return JSON.stringify(buildPolygenResourceInfo(buffer))
}
