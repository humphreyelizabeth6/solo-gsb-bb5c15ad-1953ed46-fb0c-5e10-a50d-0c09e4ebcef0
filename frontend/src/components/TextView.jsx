import { useMemo, useRef } from 'react'

/** 把文本按所有编码边界切成原子段，每段携带覆盖它的编码列表 */
export function buildSegments(content, codings) {
  const points = new Set([0, content.length])
  for (const c of codings) {
    points.add(Math.max(0, c.start))
    points.add(Math.min(content.length, c.end))
  }
  const sorted = [...points].sort((a, b) => a - b)
  const segments = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]
    const e = sorted[i + 1]
    if (e <= s) continue
    segments.push({
      start: s,
      end: e,
      text: content.slice(s, e),
      codings: codings.filter((c) => c.start <= s && c.end >= e),
    })
  }
  return segments
}

function hexToRgba(hex, alpha) {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((x) => x + x).join('') : m, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function segmentStyle(codings) {
  if (codings.length === 0) return undefined
  const colors = codings.map((c) => c.code_color || '#999')
  if (colors.length === 1) {
    return {
      background: hexToRgba(colors[0], 0.32),
      borderBottom: `2px solid ${colors[0]}`,
    }
  }
  // 多重叠加：均分渐变条带，直观呈现可重叠编码
  const stops = colors
    .map((col, i) => {
      const from = (i / colors.length) * 100
      const to = ((i + 1) / colors.length) * 100
      return `${hexToRgba(col, 0.42)} ${from}%, ${hexToRgba(col, 0.42)} ${to}%`
    })
    .join(', ')
  return {
    background: `linear-gradient(135deg, ${stops})`,
    borderBottom: `2px solid ${colors[colors.length - 1]}`,
  }
}

/**
 * 文本视图：渲染原子段并把鼠标拖选映射回字符区间。
 */
export default function TextView({ content, codings, selection, flashRange, onSelect }) {
  const ref = useRef(null)
  const segments = useMemo(() => buildSegments(content, codings), [content, codings])

  function locateOffset(node, offset) {
    const container = ref.current
    if (!container) return null
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
    const span = el && el.closest ? el.closest('[data-s]') : null
    if (!span || !container.contains(span)) return null
    try {
      const range = document.createRange()
      range.selectNodeContents(span)
      range.setEnd(node, offset)
      return Number(span.dataset.s) + range.toString().length
    } catch {
      return null
    }
  }

  function handleMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const start = locateOffset(sel.anchorNode, sel.anchorOffset)
    const end = locateOffset(sel.focusNode, sel.focusOffset)
    if (start == null || end == null) return
    const [s, e] = start <= end ? [start, end] : [end, start]
    if (e > s) onSelect({ start: s, end: e })
  }

  function inRange(seg, range) {
    return range && seg.start < range.end && seg.end > range.start
  }

  return (
    <div
      ref={ref}
      className="text-view"
      onMouseUp={handleMouseUp}
      data-testid="text-view"
    >
      {segments.map((seg) => {
        const classes = ['seg']
        if (seg.codings.length > 0) classes.push('coded')
        if (inRange(seg, selection)) classes.push('selected')
        if (inRange(seg, flashRange)) classes.push('flash')
        const title =
          seg.codings.length > 0
            ? seg.codings
                .map((c) => `${c.code_name} [${c.start}, ${c.end})`)
                .join('\n')
            : undefined
        return (
          <span
            key={seg.start}
            data-s={seg.start}
            data-e={seg.end}
            className={classes.join(' ')}
            style={segmentStyle(seg.codings)}
            title={title}
          >
            {seg.text}
          </span>
        )
      })}
    </div>
  )
}
