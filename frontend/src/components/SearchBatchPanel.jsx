import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'

/**
 * 检索批量编码面板：输入字面关键词检索当前文档全部命中（含彼此重叠的命中），
 * 逐项勾选 / 全选后选择一个既有编码批量提交。后端在单事务中校验并写入，
 * 完全相同的既有标注会被跳过；提交成功后由 onApplied 触发全局刷新。
 */
export default function SearchBatchPanel({ docId, codes, onApplied, onError }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null) // null=尚未检索
  const [checked, setChecked] = useState(new Set())
  const [codeChoice, setCodeChoice] = useState('')
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState(null) // {created: [...], skipped: [...]}
  const selectAllRef = useRef(null)

  // 切换文档后清空检索状态
  useEffect(() => {
    setQuery('')
    setMatches(null)
    setChecked(new Set())
    setResult(null)
  }, [docId])

  const allChecked = matches !== null && matches.length > 0 && checked.size === matches.length
  const someChecked = checked.size > 0 && !allChecked

  // 全选框的半选（indeterminate）状态只能透过 DOM 属性设置
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked
  }, [someChecked])

  const selectedItems = useMemo(
    () => (matches ? matches.filter((_, i) => checked.has(i)) : []),
    [matches, checked]
  )

  async function handleSearch(ev) {
    ev.preventDefault()
    if (!query || searching) return
    setSearching(true)
    setResult(null)
    try {
      const data = await api.searchDocument(docId, query)
      setMatches(data.matches)
      // 默认全选，便于直接批量编码；可再逐项取消
      setChecked(new Set(data.matches.map((_, i) => i)))
    } catch (e) {
      onError(e)
    } finally {
      setSearching(false)
    }
  }

  function toggleAll() {
    if (!matches) return
    setChecked(allChecked ? new Set() : new Set(matches.map((_, i) => i)))
  }

  function toggleOne(index) {
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleApply() {
    if (!codeChoice || selectedItems.length === 0 || applying) return
    setApplying(true)
    try {
      const data = await api.batchCreateCodings({
        document_id: docId,
        code_id: Number(codeChoice),
        items: selectedItems.map((m) => ({ start: m.start, end: m.end })),
      })
      setResult(data)
      await onApplied()
    } catch (e) {
      // 任一非法项时后端整批回滚，这里只提示，无需本地清理
      onError(e)
    } finally {
      setApplying(false)
    }
  }

  return (
    <section className="search-panel">
      <div className="form-title">检索批量编码</div>

      <form className="search-bar" onSubmit={handleSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入字面关键词，如：焦虑"
          maxLength={200}
        />
        <button type="submit" className="primary-btn" disabled={!query || searching}>
          {searching ? '检索中…' : '检索'}
        </button>
      </form>

      {matches !== null && (
        <>
          <div className="match-head">
            <label>
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
              />
              全选
            </label>
            <span className="match-stat">
              「{query}」命中 {matches.length} 处，已选 {checked.size} 处
            </span>
          </div>

          {matches.length > 0 ? (
            <ul className="match-list">
              {matches.map((m, i) => (
                <li key={`${m.start}-${m.end}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked.has(i)}
                      onChange={() => toggleOne(i)}
                    />
                    <code>
                      [{m.start}, {m.end})
                    </code>
                    <span className="match-ctx">
                      …{m.before}
                      <mark>{m.text}</mark>
                      {m.after}…
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">未检索到命中</div>
          )}

          <div className="apply-row">
            <select value={codeChoice} onChange={(e) => setCodeChoice(e.target.value)}>
              <option value="" disabled>
                选择既有编码…
              </option>
              {codes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="primary-btn"
              onClick={handleApply}
              disabled={!codeChoice || selectedItems.length === 0 || applying}
            >
              {applying ? '提交中…' : `批量编码（${selectedItems.length}）`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="batch-result">
          新增 {result.created.length} 条，跳过 {result.skipped.length} 条
          {result.skipped.length > 0 && (
            <ul>
              {result.skipped.map((s) => (
                <li key={`${s.start}-${s.end}`}>
                  <code>
                    [{s.start}, {s.end})
                  </code>
                  与既有标注 #{s.existing_id} 完全相同，已跳过
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="hint">
        提示：按字面文本匹配（含彼此重叠的命中）；完全相同的既有标注自动跳过，其余按保留边界写入。
      </p>
    </section>
  )
}
