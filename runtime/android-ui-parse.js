const ATTR_RE = /(\w[\w-]*)="([^"]*)"/g

function parseAttributes(raw) {
  const attrs = {}
  for (const match of raw.matchAll(ATTR_RE)) attrs[match[1]] = match[2]
  return attrs
}

function parseBounds(bounds) {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds ?? '')
  if (!match) return null
  const left = Number(match[1])
  const top = Number(match[2])
  const right = Number(match[3])
  const bottom = Number(match[4])
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function nodeFromAttributes(attrs) {
  const bounds = parseBounds(attrs.bounds)
  if (!bounds) return null
  const text = attrs.text?.trim() ?? ''
  const contentDesc = attrs['content-desc']?.trim() ?? ''
  const resourceId = attrs['resource-id']?.trim() ?? ''
  const className = attrs.class?.trim() ?? ''
  const clickable = attrs.clickable === 'true'
  const longClickable = attrs.longclickable === 'true'
  const scrollable = attrs.scrollable === 'true'
  const enabled = attrs.enabled !== 'false'
  const focusable = attrs.focusable === 'true'
  const password = attrs.password === 'true'
  return {
    text,
    contentDesc,
    resourceId,
    className,
    bounds,
    clickable,
    longClickable,
    scrollable,
    enabled,
    focusable,
    password,
  }
}

export function parseUiNodes(xml) {
  const nodes = []
  for (const match of xml.matchAll(/<node\b([^>]*)\/?>/g)) {
    const node = nodeFromAttributes(parseAttributes(match[1]))
    if (node) nodes.push(node)
  }
  return nodes
}

export function screenBoundsFromXml(xml) {
  const root = parseUiNodes(xml)[0]
  if (!root) return null
  return `[${root.bounds.left},${root.bounds.top}][${root.bounds.right},${root.bounds.bottom}]`
}

function isActionable(node) {
  if (!node.enabled || node.password) return false
  if (node.clickable || node.longClickable || node.scrollable) return true
  return node.focusable && (node.text || node.contentDesc || node.resourceId)
}

function hasIdentity(node) {
  return Boolean(node.text || node.contentDesc || node.resourceId || node.className)
}

function boundsArea(bounds) {
  return bounds.width * bounds.height
}

function isStrictlyInside(inner, outer) {
  return inner.left >= outer.left && inner.top >= outer.top
    && inner.right <= outer.right && inner.bottom <= outer.bottom
    && boundsArea(inner) < boundsArea(outer)
}

export function pruneNestedContainers(candidates) {
  return candidates.filter((outer) => !candidates.some((inner) => inner !== outer && isStrictlyInside(inner.boundsObj, outer.boundsObj)))
}

export function boundsCenter(bounds) {
  const parsed = typeof bounds === 'string' ? parseBounds(bounds) : bounds
  if (!parsed) throw new Error(`Invalid bounds: ${bounds}`)
  return {
    x: Math.round((parsed.left + parsed.right) / 2),
    y: Math.round((parsed.top + parsed.bottom) / 2),
  }
}

export function summarizeUi(xml, { maxElements = 200 } = {}) {
  const candidates = []
  for (const node of parseUiNodes(xml)) {
    if (!isActionable(node) || !hasIdentity(node)) continue
    const tap = boundsCenter(node.bounds)
    candidates.push({
      text: node.text || undefined,
      description: node.contentDesc || undefined,
      resourceId: node.resourceId || undefined,
      className: node.className || undefined,
      bounds: `[${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}]`,
      tapX: tap.x,
      tapY: tap.y,
      clickable: node.clickable,
      scrollable: node.scrollable,
      boundsObj: node.bounds,
    })
  }
  const pruned = pruneNestedContainers(candidates)
  pruned.sort((a, b) => {
    if (a.boundsObj.top !== b.boundsObj.top) return a.boundsObj.top - b.boundsObj.top
    return a.boundsObj.left - b.boundsObj.left
  })
  return pruned.slice(0, maxElements).map((node, index) => ({
    index,
    text: node.text,
    description: node.description,
    resourceId: node.resourceId,
    className: node.className,
    bounds: node.bounds,
    tapX: node.tapX,
    tapY: node.tapY,
    clickable: node.clickable,
    scrollable: node.scrollable,
  }))
}

export function elementByIndex(elements, index) {
  if (!Number.isInteger(index)) throw new Error('index must be an integer from android_ui')
  const element = elements[index]
  if (!element) {
    throw new Error(`Invalid index ${index}. Call android_ui again and choose 0-${elements.length - 1}.`)
  }
  return element
}

function elementSummary(element) {
  const parts = []
  if (element.text) parts.push(`text="${element.text}"`)
  if (element.description) parts.push(`desc="${element.description}"`)
  if (element.resourceId) parts.push(`id="${element.resourceId}"`)
  if (parts.length === 0 && element.className) parts.push(`class="${element.className}"`)
  return parts.join(' ')
}

export function formatUiSummary(elements) {
  if (elements.length === 0) {
    return 'No actionable UI elements were found. Try android_scroll or android_key, then call android_ui again.'
  }
  const lines = elements.map((node) => {
    const flags = []
    if (node.clickable) flags.push('clickable')
    if (node.scrollable) flags.push('scrollable')
    const label = elementSummary(node)
    const details = label.length > 0 ? ` ${label}` : ''
    const flagText = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
    return `#${node.index} tap=(${node.tapX},${node.tapY}) bounds=${node.bounds}${details}${flagText}`
  })
  return [
    `UI element list (${elements.length} items). Pick an index only; do not invent coordinates.`,
    'Next step: android_screen, then android_tap_element({ index: N }) or android_scroll({ index: N, direction: "up"|"down"|"left"|"right" }).',
    ...lines,
  ].join('\n')
}

export function scrollGesture(bounds, direction) {
  const box = typeof bounds === 'string' ? parseBounds(bounds) : bounds
  if (!box) throw new Error(`Invalid bounds: ${bounds}`)
  const centerX = Math.round((box.left + box.right) / 2)
  const centerY = Math.round((box.top + box.bottom) / 2)
  const dx = Math.max(80, Math.round(box.width * 0.35))
  const dy = Math.max(80, Math.round(box.height * 0.35))
  switch (direction) {
    case 'up':
      return { x1: centerX, y1: centerY + dy, x2: centerX, y2: centerY - dy }
    case 'down':
      return { x1: centerX, y1: centerY - dy, x2: centerX, y2: centerY + dy }
    case 'left':
      return { x1: centerX + dx, y1: centerY, x2: centerX - dx, y2: centerY }
    case 'right':
      return { x1: centerX - dx, y1: centerY, x2: centerX + dx, y2: centerY }
    default:
      throw new Error(`Unsupported scroll direction: ${direction}`)
  }
}

export function scrollTarget(elements, index) {
  const scrollable = elements.filter((node) => node.scrollable)
  if (scrollable.length === 0) return null
  if (index === undefined) {
    scrollable.sort((a, b) => {
      const aBounds = parseBounds(a.bounds)
      const bBounds = parseBounds(b.bounds)
      return boundsArea(bBounds) - boundsArea(aBounds)
    })
    return scrollable[0]
  }
  const element = elementByIndex(elements, index)
  if (!element.scrollable) throw new Error(`Element #${index} is not scrollable. Pick a [scrollable] item from android_ui.`)
  return element
}
