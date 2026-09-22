import { useMemo, useState } from 'react'

const TYPE_LABEL = {
  same_code: '同名重叠',
  nested_container: '嵌套（被外层包含）',
  nested_contained: '嵌套（包含内层）',
}

const RESOLUTION_META = {
  merge: {
    label: '合并',
    desc: '将同名且重叠/相邻的编码合并为一个连续区间',
  },
  split: {
    label: '拆分',
    desc: '沿新区间边界拆分外层编码；若新区间包含他者，则自身绕开拆分',
  },
  keep: {
    label: '保留边界',
    desc: '不做调整，允许重叠 / 嵌套共存',
  },
}

/**
 * 冲突决策对话框：展示同名 / 嵌套冲突，提供合并、拆分、保留边界三种决策。
 */
export default function ConflictDialog({ preview, content, onResolve, onCancel }) {
  const { conflicts } = preview
  const available = useMemo(() => {
    const set = new Set(['keep'])
    for (const c of conflicts) for (const a of c.actions) set.add(a)
    return set
  }, [conflicts])
  const [resolution, setResolution] = useState(
    available.has('merge') ? 'merge' : available.has('split') ? 'split' : 'keep'
  )

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>检测到 {conflicts.length} 处冲突</h3>
        <ul className="conflict-list">
          {conflicts.map((c, i) => {
            const cg = c.coding
            const text = content.slice(cg.start, cg.end)
            return (
              <li key={i}>
                <span className={`tag tag-${c.type}`}>{TYPE_LABEL[c.type]}</span>
                <span
                  className="dot"
                  style={{ background: cg.code_color || '#999' }}
                />
                <strong>{cg.code_name}</strong>
                <code>
                  [{cg.start}, {cg.end})
                </code>
                <span className="conflict-text">
                  「{text.length > 40 ? text.slice(0, 40) + '…' : text}」
                </span>
              </li>
            )
          })}
        </ul>

        <div className="resolution-group">
          {Object.entries(RESOLUTION_META).map(([key, meta]) => (
            <label
              key={key}
              className={`resolution-option ${available.has(key) ? '' : 'disabled'}`}
            >
              <input
                type="radio"
                name="resolution"
                value={key}
                disabled={!available.has(key)}
                checked={resolution === key}
                onChange={() => setResolution(key)}
              />
              <span>
                <strong>{meta.label}</strong>
                <small>{meta.desc}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button className="link-btn" onClick={onCancel}>
            取消
          </button>
          <button className="primary-btn" onClick={() => onResolve(resolution)}>
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
