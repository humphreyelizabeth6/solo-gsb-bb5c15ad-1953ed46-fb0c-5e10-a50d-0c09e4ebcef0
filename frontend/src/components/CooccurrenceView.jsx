import { useEffect, useMemo, useState } from 'react'

/**
 * 编码共现视图：按当前文档展示编码两两关系矩阵。
 *
 * 矩阵数据来自后端 GET /api/documents/{id}/cooccurrence：每个编码先各自
 * 合并重叠/相邻区间，再对编码对求交集，因此字符数不会重复计数。
 *  - metric=chars：共现覆盖字符数；metric=segments：共现片段数
 *  - 单元格按当前指标的最大值深浅着色
 *  - 点击非零的非对角单元格，列出交集片段及原文摘录
 *  - 点击片段经 onLocateSegment 切回正文并定位高亮
 * 对角线为该编码自身合并后的覆盖情况（灰色、不可点），仅作参考。
 */
export default function CooccurrenceView({ stats, loading, error, onLocateSegment }) {
  const [metric, setMetric] = useState('chars')
  const [selectedKey, setSelectedKey] = useState(null)

  const codes = stats?.codes ?? []
  const pairMap = useMemo(() => {
    const m = new Map()
    for (const p of stats?.pairs ?? []) {
      m.set(pairKey(p.code_a_id, p.code_b_id), p)
    }
    return m
  }, [stats])

  // 文档 / 筛选切换后统计数据变化：若选中的编码对已不存在则清空明细
  useEffect(() => {
    if (selectedKey && !pairMap.has(selectedKey)) setSelectedKey(null)
  }, [pairMap, selectedKey])

  const valueField = metric === 'chars' ? 'char_count' : 'segment_count'

  const maxValue = useMemo(() => {
    let m = 0
    for (const p of stats?.pairs ?? []) {
      if (!p.diagonal && p[valueField] > m) m = p[valueField]
    }
    return m
  }, [stats, valueField])

  const codeName = (id) => codes.find((c) => c.id === id)?.name ?? `#${id}`
  const codeColor = (id) => codes.find((c) => c.id === id)?.color ?? '#999'

  const selected = selectedKey ? pairMap.get(selectedKey) : null

  function cellBg(pair) {
    if (pair.diagonal) return '#f3f4f6'
    const v = pair[valueField]
    if (v === 0 || maxValue === 0) return '#fff'
    const alpha = 0.14 + 0.78 * (v / maxValue)
    return `rgba(37, 99, 235, ${alpha.toFixed(3)})`
  }

  return (
    <div className="cooc-panel">
      <div className="cooc-toolbar">
        <div className="metric-toggle" role="group" aria-label="共现指标">
          <button
            className={metric === 'chars' ? 'active' : ''}
            onClick={() => setMetric('chars')}
          >
            共现覆盖字符数
          </button>
          <button
            className={metric === 'segments' ? 'active' : ''}
            onClick={() => setMetric('segments')}
          >
            共现片段数
          </button>
        </div>
        <p className="hint">
          口径：先分别合并同一编码重叠/相邻的区间，再对编码对求交集，共享字符不重复计数；
          颜色越深共现越多（对角线为该编码自身覆盖，不可点）。
        </p>
      </div>

      {loading && <div className="cooc-status">共现统计加载中…</div>}
      {!loading && error && <div className="cooc-status error">{error}</div>}

      {!loading && !error && codes.length === 0 && (
        <div className="cooc-status">当前筛选条件下没有可选编码，请在侧栏勾选编码。</div>
      )}
      {!loading && !error && codes.length === 1 && (
        <div className="cooc-status">
          当前筛选下只有「{codes[0].name}」一个编码，至少勾选两个编码才能看到两两共现。
        </div>
      )}
      {!loading && !error && codes.length >= 2 && maxValue === 0 && (
        <div className="cooc-status">
          当前筛选的 {codes.length} 个编码之间暂无共现（没有相互重叠的标注片段）。
        </div>
      )}

      {!loading && !error && codes.length > 0 && (
        <div className="cooc-matrix-wrap">
          <table className="cooc-matrix">
            <thead>
              <tr>
                <th className="corner" aria-label="编码两两关系矩阵" />
                {codes.map((c) => (
                  <th key={c.id} title={c.name}>
                    <span className="dot" style={{ background: c.color }} />
                    <span className="th-name">{c.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((rowCode) => (
                <tr key={rowCode.id}>
                  <th scope="row" title={rowCode.name}>
                    <span className="dot" style={{ background: rowCode.color }} />
                    <span className="th-name">{rowCode.name}</span>
                  </th>
                  {codes.map((colCode) => {
                    const pair = pairMap.get(pairKey(rowCode.id, colCode.id))
                    const v = pair ? pair[valueField] : 0
                    const clickable = pair && !pair.diagonal && v > 0
                    const isSelected =
                      selectedKey === pairKey(rowCode.id, colCode.id)
                    return (
                      <td key={colCode.id} className="cooc-cell-td">
                        <button
                          type="button"
                          disabled={!clickable}
                          className={[
                            'cooc-cell',
                            clickable ? 'clickable' : '',
                            isSelected ? 'selected' : '',
                            pair?.diagonal ? 'diagonal' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={{ background: cellBg(pair) }}
                          title={cellTitle(pair, rowCode, colCode, metric)}
                          onClick={() =>
                            clickable &&
                            setSelectedKey(pairKey(rowCode.id, colCode.id))
                          }
                        >
                          {v}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="cooc-detail" aria-live="polite">
        {!selected && !loading && !error && codes.length > 0 && (
          <div className="cooc-status subtle">点击非零单元格查看共现片段与原文摘录。</div>
        )}
        {selected && (
          <>
            <div className="cooc-detail-head">
              <span className="dot" style={{ background: codeColor(selected.code_a_id) }} />
              <strong>{codeName(selected.code_a_id)}</strong>
              <span className="cooc-x">×</span>
              <span className="dot" style={{ background: codeColor(selected.code_b_id) }} />
              <strong>{codeName(selected.code_b_id)}</strong>
              <span className="cooc-stat">
                {selected.char_count} 个共享字符 · {selected.segment_count} 个共现片段
              </span>
              <button className="link-btn" onClick={() => setSelectedKey(null)}>
                清除选择
              </button>
            </div>
            {selected.segments.length === 0 ? (
              <div className="cooc-status subtle">该编码对暂无共现片段。</div>
            ) : (
              <ul className="cooc-segment-list">
                {selected.segments.map((seg) => (
                  <li key={`${seg.start}-${seg.end}`}>
                    <button
                      type="button"
                      className="cooc-segment"
                      title="点击切回正文并定位"
                      onClick={() => onLocateSegment(seg)}
                    >
                      <code>[{seg.start}, {seg.end})</code>
                      <span className="cooc-seg-text">
                        「{seg.text}」
                      </span>
                      <em>{seg.end - seg.start} 字 · 点击定位</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function pairKey(a, b) {
  return a <= b ? `${a}-${b}` : `${b}-${a}`
}

function cellTitle(pair, rowCode, colCode, metric) {
  if (!pair) return ''
  if (pair.diagonal) {
    return `${rowCode.name} 自身合并覆盖 ${pair.char_count} 字符 / ${pair.segment_count} 段`
  }
  const label = metric === 'chars' ? `${pair.char_count} 字符` : `${pair.segment_count} 段`
  return `${rowCode.name} × ${colCode.name}：${label}`
}
