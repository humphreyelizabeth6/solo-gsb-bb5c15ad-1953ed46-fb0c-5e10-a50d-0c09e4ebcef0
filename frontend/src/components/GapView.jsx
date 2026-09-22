import { useEffect, useRef } from 'react'

const pct = (r) => `${(r * 100).toFixed(1)}%`

/** 列表摘录：压缩空白并截断，避免整段缺口撑爆列表 */
function excerpt(text, max = 120) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * 覆盖缺口视图：列出未被所选编码覆盖的连续文本区间。
 *
 * 数据来自 GET /api/documents/{id}/gaps：后端先合并所选编码重叠/相邻的
 * 标注区间，再对全文求补集（文首、文尾与零标注场景均保留）。
 *  - 顶部可设置最小缺口长度，并提供上一处/下一处导航（切回正文闪烁定位）；
 *  - 点击缺口项同样切回正文并闪烁定位；
 *  - 「带入编码表单」把整段缺口区间填入右侧编码表单，提交仍走原有冲突预览流程；
 *  - 所选编码并集覆盖全文时给出「已全覆盖」空状态。
 */
export default function GapView({
  stats,
  loading,
  error,
  gaps,
  minLen,
  onMinLenChange,
  cursor,
  onNavigate,
  onLocate,
  onBringToForm,
}) {
  const listRef = useRef(null)

  // 上一处/下一处导航后，让当前缺口在列表中滚入可视区域
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return
    const el = listRef.current.children[cursor]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const total = stats?.gaps.length ?? 0
  const uncovered = stats ? stats.document_length - stats.covered_char_count : 0

  return (
    <div className="gap-panel">
      <div className="gap-toolbar">
        <label className="gap-minlen">
          最小缺口长度
          <input
            type="number"
            min="1"
            value={minLen}
            onChange={(e) =>
              onMinLenChange(Math.max(1, Number(e.target.value) || 1))
            }
          />
          字
        </label>
        <div className="gap-nav">
          <button
            disabled={gaps.length === 0}
            onClick={() => onNavigate(-1)}
            title="定位上一处缺口"
          >
            ← 上一处
          </button>
          <span className="gap-pos">
            {cursor >= 0 && gaps.length > 0
              ? `第 ${cursor + 1} / ${gaps.length} 处`
              : `共 ${gaps.length} 处`}
          </span>
          <button
            disabled={gaps.length === 0}
            onClick={() => onNavigate(1)}
            title="定位下一处缺口"
          >
            下一处 →
          </button>
        </div>
      </div>

      {stats && (
        <p className="speaker-summary">
          全文 {stats.document_length} 字 · 已覆盖 {stats.covered_char_count} 字（
          {pct(stats.coverage_rate)}） · 未覆盖 {uncovered} 字 · 缺口 {total} 处
          {minLen > 1 && `（其中 ≥ ${minLen} 字的 ${gaps.length} 处）`}
        </p>
      )}

      {loading && <div className="cooc-status">缺口统计加载中…</div>}
      {!loading && error && <div className="cooc-status error">{error}</div>}

      {!loading && !error && stats && total === 0 && (
        <div className="gap-full">
          ✓ 已全覆盖：当前筛选编码的标注并集覆盖全文 {stats.document_length}{' '}
          字，没有未覆盖的文本区间。
        </div>
      )}
      {!loading && !error && stats && total > 0 && gaps.length === 0 && (
        <div className="cooc-status">
          没有长度 ≥ {minLen} 字的缺口，可降低最小缺口长度后重试。
        </div>
      )}
      {!loading && !error && stats && stats.codes.length === 0 && (
        <p className="hint">
          当前没有参与统计的编码，全文视为未覆盖；在侧栏勾选编码后缺口将随之变化。
        </p>
      )}

      {!loading && !error && gaps.length > 0 && (
        <ul className="cooc-segment-list gap-list" ref={listRef}>
          {gaps.map((g, i) => (
            <li
              key={`${g.start}-${g.end}`}
              className={i === cursor ? 'gap-current' : ''}
            >
              <button
                type="button"
                className="cooc-segment"
                title="点击切回正文并定位"
                onClick={() => onLocate(g, i)}
              >
                <code>
                  [{g.start}, {g.end})
                </code>
                <span className="cooc-seg-text">「{excerpt(g.text)}」</span>
                <em>{g.length} 字 · 点击定位</em>
              </button>
              <button
                type="button"
                className="gap-to-form"
                title="把整段缺口区间填入编码表单，提交仍走冲突预览流程"
                onClick={() => onBringToForm(g)}
              >
                带入编码表单
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        口径：先合并所选编码重叠/相邻的标注区间，再对全文求补集；文首、文尾与零标注
        （全文即一个缺口）场景均会保留。编码筛选或标注变化后结果自动刷新。
      </p>
    </div>
  )
}
