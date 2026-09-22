/**
 * 侧栏：编码本（筛选 / 重命名 / 删除）+ 当前文档的编码标注列表。
 */
export default function Sidebar({
  codes,
  codings,
  filters,
  onToggleFilter,
  onClearFilters,
  onRenameCode,
  onDeleteCode,
  onLocateCoding,
  onEditCoding,
  onDeleteCoding,
}) {
  const isActive = (id) => filters === null || filters.has(id)

  return (
    <aside className="sidebar">
      <section>
        <div className="section-head">
          <h4>编码本</h4>
          {filters !== null && (
            <button className="link-btn" onClick={onClearFilters}>
              显示全部
            </button>
          )}
        </div>
        <ul className="code-list">
          {codes.map((c) => (
            <li key={c.id} className={isActive(c.id) ? '' : 'dimmed'}>
              <label>
                <input
                  type="checkbox"
                  checked={isActive(c.id)}
                  onChange={() => onToggleFilter(c.id)}
                />
                <span className="dot" style={{ background: c.color }} />
                <span className="code-name">{c.name}</span>
                <span className="count">{c.usage_count}</span>
              </label>
              <span className="row-actions">
                <button title="重命名" onClick={() => onRenameCode(c)}>
                  ✎
                </button>
                <button title="删除编码及其标注" onClick={() => onDeleteCode(c)}>
                  ×
                </button>
              </span>
            </li>
          ))}
          {codes.length === 0 && <li className="empty">暂无编码，请先在右侧创建</li>}
        </ul>
      </section>

      <section className="grow">
        <div className="section-head">
          <h4>编码标注（{codings.length}）</h4>
        </div>
        <ul className="coding-list">
          {codings.map((cg) => (
            <li key={cg.id}>
              <div className="coding-head">
                <span className="dot" style={{ background: cg.code_color }} />
                <strong>{cg.code_name}</strong>
                <code>
                  [{cg.start}, {cg.end})
                </code>
              </div>
              <div className="coding-text" title={cg.text}>
                {cg.text}
              </div>
              <div className="row-actions">
                <button onClick={() => onLocateCoding(cg)}>定位</button>
                <button onClick={() => onEditCoding(cg)}>编辑</button>
                <button onClick={() => onDeleteCoding(cg)}>删除</button>
              </div>
            </li>
          ))}
          {codings.length === 0 && <li className="empty">当前筛选条件下暂无标注</li>}
        </ul>
      </section>
    </aside>
  )
}
