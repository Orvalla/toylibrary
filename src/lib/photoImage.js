// Downscale a picked photo to a ≤1024px JPEG data URL before it
// goes to the identify-items function: phone photos are several
// MB of mostly-irrelevant pixels, and the vision model reads a
// 1024px image just as well. Falls back to the raw file (as a
// data URL) when canvas decoding isn't available.

export async function fileToDataUrl(file, maxDim = 1024) {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}
