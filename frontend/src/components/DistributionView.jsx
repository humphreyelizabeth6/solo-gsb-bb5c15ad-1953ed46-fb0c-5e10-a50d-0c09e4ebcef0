import { useEffect, useMemo, useState } from 'react'

const pct = (r) => `${(r * 100).toFixed(1)}%`

/**
 * 跨文档编码分布对比视图：同一编码在各文档的并列表。
 *
 * 数据来自 GET /api/code-distribution（后端单一快照计算）：每个编码在每篇
 * 文档内先合并重叠/相邻区间，再汇总字符数、段数与占文档长度比例。
 *  - 行 = 编码（随侧栏编码筛选变化），列 = 文档（按标题稳定排序）；
 *  - 单元格按行内最高占比深浅着色，并显示相对行内最高值的差异百分比；
 *  - 顶部文档筛选复选框控制列显示；
 *  - 点击非零单元格经 onLocateCell(documentId, segment) 切到该文档正文并
 *    定位首个对应片段；
 *  - 后端返回的缺失编码（全部文档均无标注）与空文档（没有所选编码标注）
 *    以提示条展示。
 */
export default function DistributionView({ stats, loading, error, onLocateCell }) {
  const [hiddenDocs, setHiddenDocs] = useState(new Set()) // 被隐藏的文档 id

  const codes = stats?.codes ?? []
  const documents = stats?.documents ?? []
  const rows = stats?.rows ?? []
  const missing = stats?.missing_codes ?? []
  const emptyDocs = stats?.empty_documents ?? []

  const rowByCode = useMemo(() => new Map(rows.map((r) => [r.code_id, r])), [rows])
  const cellOf = (codeId, docId) =>
    rowByCode.get(codeId)?.cells.find((c) => c.document_id === docId) ?? null

  // 文档集合变化（新建/删除文档）后，清掉已不存在文档的隐藏状态
  useEffect(() => {
    setHiddenDocs((cur) => {
      const ids = new Set(documents.map((d) => d.id))
      const next = new Set([...cur].filter((id) => ids.has(id)))
      return next.size === cur.size ? cur : next
    })
  }, [documents])

  const visibleDocs = useMemo(
    () => documents.filter((d) => !hiddenDocs.has(d.id)),
    [documents, hiddenDocs]
  )

  function toggleDoc(id) {
    setHiddenDocs((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasData = codes.length > 0 && visibleDocs.length > 0

  return (
    <div className="dist-panel">
      <div className="dist-toolbar">
        {documents.length > 0 && (
          <div className="speaker-filter">
            <span className="filter-label">文档筛选：</span>
            {documents.map((d) => (
              <label
                key={d.id}
                className={hiddenDocs.has(d.id) ? 'dimmed' : ''}
                title={d.title}
              >
                <input
                  type="checkbox"
                  checked={!hiddenDocs.has(d.id)}
                  onChange={() => toggleDoc(d.id)}
                />
                <span className="dist-doc-name">{d.title}</span>
              </label>
            ))}
            <button className="link-btn" onClick={() => setHiddenDocs(new Set())}>
              全选
            </button>
            <button
              className="link-btn"
              onClick={() => setHiddenDocs(new Set(documents.map((d) => d.id)))}
            >
              全不选
            </button>
          </div>
        )}
        {stats && (
          <p className="speaker-summary">
            共 {documents.length} 篇文档 · {codes.length} 个编码参与统计
          </p>
        )}
        {documents.length > 0 && missing.length > 0 && (
          <p className="dist-notice">
            缺失编码：{missing.map((c) => `「${c.name}」`).join('、')}
            在全部文档中均无标注。
          </p>
        )}
        {documents.length > 0 && codes.length > 0 && emptyDocs.length > 0 && (
          <p className="dist-notice">
            空文档：{emptyDocs.map((d) => `「${d.title}」`).join('、')}
            没有所选编码的标注。
          </p>
        )}
        <p className="hint">
          口径：同一编码在每篇文档内先合并重叠/相邻区间再统计，共享字符不重复计数；
          占比 = 标注字符数 ÷ 文档长度；差异百分比以行内最高占比为基准；
          点击非零单元格切换到该文档正文并定位首个对应片段。
        </p>
      </div>

      {loading && <div className="cooc-status">分布统计加载中…</div>}
      {!loading && error && <div className="cooc-status error">{error}</div>}
      {!loading && !error && stats && documents.length === 0 && (
        <div className="cooc-status">暂无文档，请先在顶栏新建文档。</div>
      )}
      {!loading && !error && documents.length > 0 && codes.length === 0 && (
        <div className="cooc-status">
          当前没有参与统计的编码，请在侧栏勾选或创建编码。
        </div>
      )}
      {!loading && !error && codes.length > 0 && visibleDocs.length === 0 && (
        <div className="cooc-status">全部文档均被隐藏，请在上方勾选要显示的文档。</div>
      )}

      {!loading && !error && hasData && (
        <div className="speaker-table-wrap">
          <table className="speaker-table dist-table">
            <thead>
              <tr>
                <th className="speaker-col">编码 \ 文档</th>
                {visibleDocs.map((d) => (
                  <th key={d.id} title={`${d.title}（全文 ${d.length} 字）`}>
                    <span className="th-name">{d.title}</span>
                    <small className="dist-doc-len">{d.length} 字</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => {
                const row = rowByCode.get(code.id)
                const maxRate = row?.max_coverage_rate ?? 0
                return (
                  <tr key={code.id}>
                    <th scope="row" title={code.name}>
                      <span className="dot" style={{ background: code.color }} />
                      <span className="th-name">{code.name}</span>
                    </th>
                    {visibleDocs.map((d) => {
                      const cell = cellOf(code.id, d.id)
                      const chars = cell?.char_count ?? 0
                      const disabled = chars === 0
                      const alpha =
                        !disabled && maxRate > 0
                          ? 0.14 + 0.78 * (cell.coverage_rate / maxRate)
                          : 0
                      return (
                        <td key={d.id} className="stat-td">
                          <button
                            type="button"
                            className="stat-cell dist-cell"
                            disabled={disabled}
                            style={
                              disabled
                                ? undefined
                                : {
                                    background: `rgba(37, 99, 235, ${alpha.toFixed(3)})`,
                                  }
                            }
                            title={
                              disabled
                                ? '该文档无此编码标注'
                                : `点击切换到「${d.title}」并定位首个「${code.name}」片段`
                            }
                            onClick={() =>
                              cell?.first_segment &&
                              onLocateCell(d.id, cell.first_segment)
                            }
                          >
                            {disabled ? (
                              <strong>0 字</strong>
                            ) : (
                              <>
                                <strong>
                                  {cell.char_count} 字 · {cell.segment_count} 段
                                </strong>
                                <small>
                                  占比 {pct(cell.coverage_rate)}
                                  {cell.diff_pct > 0
                                    ? ` · 较最高 −${pct(cell.diff_pct)}`
                                    : ' · 行内最高'}
                                </small>
                              </>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
