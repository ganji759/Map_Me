/**
 * Client-side image preparation for encrypted image messages: downscale to at
 * most 1280px (longest edge), re-encode as JPEG, and step quality/size down
 * until the *encrypted base64* payload fits the server's 400KB ciphertext cap.
 * Plaintext bytes never leave the device — the caller encrypts the result.
 */
import { MAX_CIPHERTEXT_B64 } from '@/lib/communityClient'

export const MAX_IMAGE_DIM = 1280

/** Attempts, largest/highest first. */
const ATTEMPTS: Array<{ maxDim: number; quality: number }> = [
  { maxDim: 1280, quality: 0.82 },
  { maxDim: 1280, quality: 0.6 },
  { maxDim: 960, quality: 0.6 },
  { maxDim: 720, quality: 0.5 },
  { maxDim: 560, quality: 0.45 },
]

/** Base64 length of n bytes plus the 16-byte AES-GCM tag — pre-flight estimate. */
function estimateCiphertextB64(bytes: number): number {
  return Math.ceil((bytes + 16) / 3) * 4
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image file.'))
    img.src = url
  })
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Downscale + re-encode `file` so its encrypted payload fits under the 400KB
 * base64 cap. Returns the JPEG bytes ready for encryptBytes(). Throws with a
 * human-readable message when even the smallest attempt is too large or the
 * file is not a decodable image.
 */
export async function prepareImageForSending(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image processing is unavailable in this browser.')

    for (const { maxDim, quality } of ATTEMPTS) {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const blob = await toJpegBlob(canvas, quality)
      if (estimateCiphertextB64(blob.size) <= MAX_CIPHERTEXT_B64) {
        return new Uint8Array(await blob.arrayBuffer())
      }
    }
    throw new Error('Image too large. Try a smaller one.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
