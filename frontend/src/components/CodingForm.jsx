import { useEffect, useMemo, useState } from 'react'

const NEW_CODE = '__new__'

/**
 * 编码表单：拖选或手动输入区间，选择既有编码或新建编码。
 * editing 非空时为编辑模式。
 */
export default function CodingForm({ codes, content, selection, editing, onSubmit, onCancelEdit }) {
  const [codeChoice, setCodeChoice] = useState('')
  const [newCodeName, setNewCodeName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  // 拖选同步到输入框（编辑模式下不覆盖）
  useEffect(() => {
    if (selection && !editing) {
      setStart(String(selection.start))
      setEnd(String(selection.end))
    }
  }, [selection, editing])

  // 进入编辑模式时回填
  useEffect(() => {
    if (editing) {
      setCodeChoice(String(editing.code_id))
      setNewCodeName('')
      setStart(String(editing.start))
      setEnd(String(editing.end))
    }
  }, [editing])

  const snippet = useMemo(() => {
    const s = Number(start)
    const e = Number(end)
    if (!content || Number.isNaN(s) || Number.isNaN(e) || e <= s || s < 0 || e > content.length) {
      return null
    }
    return content.slice(s, e)
  }, [content, start, end])

  const valid =
    snippet !== null &&
    (codeChoice === NEW_CODE ? newCodeName.trim().length > 0 : codeChoice !== '')

  function handleSubmit(ev) {
    ev.preventDefault()
    if (!valid) return
    onSubmit({
      codeId: codeChoice === NEW_CODE ? null : Number(codeChoice),
      newCodeName: codeChoice === NEW_CODE ? newCodeName.trim() : null,
      start: Number(start),
      end: Number(end),
      editing,
    })
    if (!editing) {
      setStart('')
      setEnd('')
      setNewCodeName('')
    }
  }

  return (
    <form className={`coding-form ${editing ? 'editing' : ''}`} onSubmit={handleSubmit}>
      <div className="form-title">
        {editing ? `编辑编码标注 #${editing.id}` : '新建编码标注'}
        {editing && (
          <button type="button" className="link-btn" onClick={onCancelEdit}>
            取消编辑
          </button>
        )}
      </div>

      <label className="field">
        <span>编码</span>
        <select value={codeChoice} onChange={(e) => setCodeChoice(e.target.value)}>
          <option value="" disabled>
            选择编码…
          </option>
          {codes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_CODE}>＋ 新建编码…</option>
        </select>
      </label>

      {codeChoice === NEW_CODE && (
        <label className="field">
          <span>新编码名</span>
          <input
            value={newCodeName}
            onChange={(e) => setNewCodeName(e.target.value)}
            placeholder="例如：情绪体验"
            maxLength={100}
          />
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span>起始</span>
          <input
            type="number"
            min="0"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="拖选或输入"
          />
        </label>
        <label className="field">
          <span>结束</span>
          <input
            type="number"
            min="0"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder="半开区间"
          />
        </label>
      </div>

      {snippet !== null && (
        <div className="snippet-preview" title={snippet}>
          「{snippet.length > 80 ? snippet.slice(0, 80) + '…' : snippet}」
          <em>{snippet.length} 字</em>
        </div>
      )}

      <button type="submit" className="primary-btn" disabled={!valid}>
        {editing ? '保存修改' : '添加编码'}
      </button>
      <p className="hint">提示：在左侧文本上拖选可自动填入区间；区间为半开区间 [起始, 结束)。</p>
    </form>
  )
}
