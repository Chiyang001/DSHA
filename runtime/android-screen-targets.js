import { boundsCenter, pruneNestedContainers, summarizeUi } from './android-ui-parse.js'

const GRID_COLS = 12
const GRID_ROWS = 24

function parseBounds(bounds) {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds ?? '')
  if (!match) return null
  const left = Number(match[1])
  const top = Number(match[2])
  const right = Number(match[3])
  const bottom = Number(match[4])
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function boundsArea(bounds) {
  return bounds.width * bounds.height
}

function overlapRatio(a, b) {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top) return 0
  const intersection = (right - left) * (bottom - top)
  return intersection / Math.min(boundsArea(a), boundsArea(b))
}

function normalizeText(value) {
  return (value ?? '').trim().toLowerCase()
}

function ocrMatchesAccessibility(ocr, accessibility) {
  const ocrBounds = ocr.boundsObj
  return accessibility.some((node) => {
    const bounds = parseBounds(node.bounds)
    if (!bounds) return false
    if (overlapRatio(ocrBounds, bounds) < 0.55) return false
    const a11yText = normalizeText(node.text || node.description)
    const ocrText = normalizeText(ocr.text)
    return a11yText.length === 0 || ocrText.length === 0 || a11yText.includes(ocrText) || ocrText.includes(a11yText)
  })
}

export function ocrToElements(lines) {
  const elements = []
  for (const line of lines) {
    const boundsObj = {
      left: line.left,
      top: line.top,
      right: line.right,
      bottom: line.bottom,
      width: line.right - line.left,
      height: line.bottom - line.top,
    }
    const tap = boundsCenter(boundsObj)
    elements.push({
      source: 'ocr',
      text: line.text,
      bounds: `[${boundsObj.left},${boundsObj.top}][${boundsObj.right},${boundsObj.bottom}]`,
      boundsObj,
      tapX: tap.x,
      tapY: tap.y,
      clickable: true,
      scrollable: false,
    })
  }
  return elements
}

function sortTargets(elements) {
  elements.sort((a, b) => {
    if (a.boundsObj.top !== b.boundsObj.top) return a.boundsObj.top - b.boundsObj.top
    return a.boundsObj.left - b.boundsObj.left
  })
  return elements.map((element, index) => ({ ...element, index }))
}

export function mergeScreenTargets(uiXml, ocrLines) {
  const accessibility = summarizeUi(uiXml).map((node) => ({
    ...node,
    source: 'accessibility',
    boundsObj: parseBounds(node.bounds),
  })).filter((node) => node.boundsObj)
  const ocr = ocrToElements(ocrLines).filter((node) => !ocrMatchesAccessibility(node, accessibility))
  const merged = pruneNestedContainers([...accessibility, ...ocr])
  return sortTargets(merged)
}

export function gridCellCenter(width, height, col, row) {
  if (!Number.isInteger(col) || !Number.isInteger(row)) throw new Error('col and row must be integers')
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) {
    throw new Error(`col must be 0-${GRID_COLS - 1} and row must be 0-${GRID_ROWS - 1}`)
  }
  const cellWidth = width / GRID_COLS
  const cellHeight = height / GRID_ROWS
  return {
    x: Math.round((col + 0.5) * cellWidth),
    y: Math.round((row + 0.5) * cellHeight),
  }
}

export function formatScreenSummary(elements, annotatedPath, width, height) {
  const lines = elements.map((node) => {
    const parts = [`#${node.index}`, `tap=(${node.tapX},${node.tapY})`, `source=${node.source}`]
    if (node.text) parts.push(`text="${node.text}"`)
    if (node.description) parts.push(`desc="${node.description}"`)
    if (node.resourceId) parts.push(`id="${node.resourceId}"`)
    parts.push(`bounds=${node.bounds}`)
    if (node.clickable) parts.push('[clickable]')
    if (node.scrollable) parts.push('[scrollable]')
    return parts.join(' ')
  })
  const header = [
    `Screen targets (${elements.length}). Pick an index only; never invent coordinates.`,
    `Annotated screenshot: ${annotatedPath}`,
    'Open the annotated image with read_image. Each red badge shows the index to pass to android_tap_element({ index }).',
    `If no target matches, use android_tap_cell({ col, row }) on the ${GRID_COLS}x${GRID_ROWS} blue grid overlay (col 0 = left, row 0 = top).`,
    `Screen size: ${width}x${height}.`,
    ...lines,
  ]
  return header.join('\n')
}

export { GRID_COLS, GRID_ROWS }
