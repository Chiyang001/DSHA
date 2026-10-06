export function coordinatePoint(x, y, snapshot, space = 'image') {
  if (![x, y].every(Number.isFinite)) throw new Error('x and y must be finite numbers')
  if (!['image', 'device', 'normalized'].includes(space)) throw new Error('coordinate_space must be image, device, or normalized')
  const width = space === 'device' ? snapshot.width : space === 'normalized' ? 1000 : snapshot.imageWidth
  const height = space === 'device' ? snapshot.height : space === 'normalized' ? 1000 : snapshot.imageHeight
  if (x < 0 || y < 0 || (space === 'normalized' ? x > width || y > height : x >= width || y >= height)) {
    throw new Error(`Coordinates outside ${space} bounds ${width}x${height}. No input sent.`)
  }
  if (space === 'device') return { x: Math.min(snapshot.width - 1, Math.round(x)), y: Math.min(snapshot.height - 1, Math.round(y)) }
  const region = snapshot.crop ?? { left: 0, top: 0, width: snapshot.width, height: snapshot.height }
  return {
    x: Math.min(snapshot.width - 1, region.left + Math.min(region.width - 1, Math.round(x * region.width / width))),
    y: Math.min(snapshot.height - 1, region.top + Math.min(region.height - 1, Math.round(y * region.height / height))),
  }
}

export function observationText(snapshot) {
  const region = snapshot.crop
  return `snapshot_id=${snapshot.id}\ndisplay_id=${snapshot.displayId ?? 0}\nScreenshot: ${snapshot.annotatedPath}\n${snapshot.image ? 'Image is attached directly; do not call read_image again.' : snapshot.attachmentNote || 'Open this screenshot with read_image before choosing coordinates.'}\nImage coordinates: ${snapshot.imageWidth}x${snapshot.imageHeight}; device: ${snapshot.width}x${snapshot.height}.${region ? ` Crop in device pixels: (${region.left},${region.top},${region.width},${region.height}).` : ''}\nUse android_tap({x,y,snapshot_id:"${snapshot.id}"}) with coordinates measured on this image; mapping to device pixels is automatic. coordinate_space defaults to image. For a small target, call android_screenshot with crop_x,crop_y,crop_width,crop_height in device pixels to zoom. Verify the intended result after each action.`
}

export function observationContent(value) {
  const content = [{ type: 'text', text: value.text }]
  if (value.image) content.push({ type: 'image', attachment: value.image })
  return content
}
export const observationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    status: { type: 'string' },
    image: { type: 'object', additionalProperties: true, properties: {} },
  },
}
