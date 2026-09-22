import { useEffect, useMemo, useState } from 'react'

/** 列表摘录：压缩空白并截断，避免整段状态区间撑爆列表 */
function excerpt(text, max = 60) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const transKey = (t) => `${t.from_code_ids.join('+')}→${t.to_code_ids.join('+')}`

/** 状态标签：覆盖编码集合（色点 + 编码名，多编码以 + 连接） */
function StateLabel({ codeIds, codeById }) {
  return (
    <span className="trans-state">
      {codeIds.map((id, i) => {
        const c = codeById.get(id)
        return (
          <span key={id} className="trans-code">
            {i > 0 && <span className="trans-plus">+</span>}
            <span className="dot" style={{ background: c?.color ?? '#9aa1ad' }} />
            {c?.name ?? `#${id}`}
          </span>
        )
      })}
    </span>
  )
}

/**
 * 编码流转视图：展示相邻编码状态的有向转移。
 *
 * 数据来自 GET /api/documents/{id}/transitions：后端把所选编码的全部标注
 * 边界切成原子区间，以覆盖编码集合表示状态，跳过无编码区间并合并相邻同
 * 状态区间，再按文档顺序统计相邻状态的有向转移。
 *  - 顶部支持最小次数与最大间距筛选（本地过滤，不重新请求）；
 *  - 展开条目查看每次转移的来源 / 目标原文上下文；
 *  - 点击实例经 onLocateInstance 切回正文，闪烁定位来源起点到目标终点的整个跨度；
 *  - 零标注（无状态区间）与无转移（仅一段状态区间）时给出明确空状态。
 */
export default function TransitionView({ stats, loading, error, onLocateInstance }) {
  const [minCount, setMinCount] = useState(1)
  const [maxDist, setMaxDist] = useState('') // '' = 不限
  const [expanded, setExpanded] = useState(null) // 展开的转移 key

  const codes = stats?.codes ?? []
  const transitions = stats?.transitions ?? []

  // 筛选或标注变化导致统计数据刷新后，收起展开项，避免展示过期实例
  useEffect(() => {
    setExpanded(null)
  }, [stats])

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes])

  // 本地筛选：先按最大间距过滤实例（次数随之重算），再按最小次数过滤条目
  const visible = useMemo(() => {
    const limit = maxDist === '' ? null : Math.max(0, Number(maxDist) || 0)
    return transitions
      .map((t) => {
        const instances =
          limit === null
            ? t.instances
            : t.instances.filter((i) => i.distance <= limit)
        const distances = instances.map((i) => i.distance)
        return {
          ...t,
          instances,
          count: instances.length,
          minD: distances.length ? Math.min(...distances) : 0,
          maxD: distances.length ? Math.max(...distances) : 0,
        }
      })
      .filter((t) => t.count >= minCount)
  }, [transitions, minCount, maxDist])

  const visibleCount = visible.reduce((n, t) => n + t.count, 0)
  const filtered = minCount > 1 || maxDist !== ''

  return (
    <div className="trans-panel">
      <div className="trans-toolbar">
        <label className="trans-filter">
          最小次数
          <input
            type="number"
            min="1"
            value={minCount}
            onChange={(e) =>
              setMinCount(Math.max(1, Number(e.target.value) || 1))
            }
          />
          次
        </label>
        <label className="trans-filter">
          最大间距
          <input
            type="number"
            min="0"
            placeholder="不限"
            value={maxDist}
            onChange={(e) => setMaxDist(e.target.value)}
          />
          字{maxDist === '' && '（不限）'}
        </label>
      </div>

      {stats && codes.length > 0 && (
        <p className="speaker-summary">
          全文 {stats.document_length} 字 · 状态区间 {stats.span_count} 段 · 转移{' '}
          {stats.transition_count} 次 / {transitions.length} 种
          {filtered &&
            `（筛选后 ${visibleCount} 次 / ${visible.length} 种）`}
        </p>
      )}

      {loading && <div className="cooc-status">转移统计加载中…</div>}
      {!loading && error && <div className="cooc-status error">{error}</div>}

      {!loading && !error && stats && codes.length === 0 && (
        <div className="cooc-status">
          当前筛选条件下没有参与统计的编码，请在侧栏勾选编码。
        </div>
      )}
      {!loading && !error && stats && codes.length > 0 && stats.span_count === 0 && (
        <div className="cooc-status">
          当前筛选的编码在该文档没有标注，没有可统计的状态区间。
        </div>
      )}
      {!loading && !error && stats && stats.span_count > 0 && transitions.length === 0 && (
        <div className="cooc-status">
          全文只有 {stats.span_count} 段状态区间，没有相邻的状态转移；再添加
          不同位置或不同编码的标注后即可看到流转。
        </div>
      )}
      {!loading && !error && transitions.length > 0 && visible.length === 0 && (
        <div className="cooc-status">
          没有满足条件的转移，可降低最小次数或放宽最大间距后重试。
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="trans-list">
          {visible.map((t) => {
            const key = transKey(t)
            const isOpen = expanded === key
            return (
              <li key={key} className={`trans-entry ${isOpen ? 'expanded' : ''}`}>
                <button
                  type="button"
                  className="trans-summary"
                  title={isOpen ? '收起实例明细' : '展开实例明细与原文上下文'}
                  onClick={() => setExpanded(isOpen ? null : key)}
                >
                  <span className="trans-states">
                    <StateLabel codeIds={t.from_code_ids} codeById={codeById} />
                    <span className="trans-arrow">→</span>
                    <StateLabel codeIds={t.to_code_ids} codeById={codeById} />
                  </span>
                  <span className="trans-meta">
                    <strong>×{t.count}</strong>
                    <small>
                      间距 {t.minD === t.maxD ? `${t.minD}` : `${t.minD}–${t.maxD}`} 字
                    </small>
                    <span className="trans-toggle">{isOpen ? '收起 ▴' : '展开 ▾'}</span>
                  </span>
                </button>
                {isOpen && (
                  <ul className="trans-instance-list">
                    {t.instances.map((inst) => (
                      <li key={`${inst.from.start}-${inst.to.end}`}>
                        <button
                          type="button"
                          className="cooc-segment"
                          title="点击切回正文并定位整个跨度"
                          onClick={() =>
                            onLocateInstance({
                              start: inst.from.start,
                              end: inst.to.end,
                            })
                          }
                        >
                          <code>
                            [{inst.from.start}, {inst.from.end}) → [{inst.to.start},{' '}
                            {inst.to.end})
                          </code>
                          <span className="cooc-seg-text">
                            「{excerpt(inst.from.text)}」 → 「{excerpt(inst.to.text)}」
                          </span>
                          <em>间距 {inst.distance} 字 · 点击定位</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="hint">
        口径：全部标注边界切成原子区间，以覆盖编码集合表示状态；跳过无编码区间、
        合并相邻同状态区间后，按文档顺序统计相邻状态的有向转移；间距 = 目标起点 −
        来源终点（0 表示首尾相接）。编码筛选或标注变化后结果自动刷新。
      </p>
    </div>
  )
}
