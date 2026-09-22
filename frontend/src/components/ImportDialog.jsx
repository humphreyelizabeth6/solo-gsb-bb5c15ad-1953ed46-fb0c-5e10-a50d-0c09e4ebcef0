import { useState } from 'react'
import { api } from '../api'

const TYPE_LABEL = {
  same_code: '同名重叠',
  nested_container: '嵌套（被外层包含）',
  nested_contained: '嵌套（包含内层）',
}

function excerpt(text, n = 40) {
  return text.length > n ? text.slice(0, n) + '…' : text
}

function ImportSection({ title, tone, children }) {
  return (
    <section className={`import-section${tone ? ` import-${tone}` : ''}`}>
      <h4>{title}</h4>
      <ul>{children}</ul>
    </section>
  )
}

/**
 * 标注包导入对话框：粘贴或选择「导出 JSON」得到的标注包，先校验预览
 * （文档内容指纹 / 区间边界 / 重复项 / 未知编码 / 冲突），确认后由后端
 * 在单事务中导入合法标注；任何硬校验失败都不落库。
 */
export default function ImportDialog({ docId, onImported, onCancel }) {
  const [raw, setRaw] = useState('')
  const [payload, setPayload] = useState(null) // 已通过预览的 JSON 对象
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)

  function handleRawChange(value) {
    setRaw(value)
    // 内容变化后旧预览失效，避免误确认过期结果
    setPreview(null)
    setPayload(null)
    setError(null)
  }

  function handleFile(ev) {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = '' // 允许重复选择同一文件
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => handleRawChange(String(reader.result || ''))
    reader.onerror = () => setError('文件读取失败')
    reader.readAsText(file)
  }

  async function handlePreview() {
    let data
    try {
      data = JSON.parse(raw)
    } catch (e) {
      setError(`JSON 解析失败：${e.message}`)
      return
    }
    setPreviewing(true)
    setError(null)
    try {
      const result = await api.previewImport(docId, data)
      setPayload(data)
      setPreview(result)
    } catch (e) {
      setPreview(null)
      setError(e.message || String(e))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleImport() {
    if (!preview || !payload || importing) return
    setImporting(true)
    setError(null)
    try {
      const result = await api.importPackage(docId, payload)
      onImported(result)
    } catch (e) {
      // 预览后数据可能已变化：提示并作废旧预览，需重新校验
      setError(e.message || String(e))
      setPreview(null)
      setPayload(null)
      setImporting(false)
    }
  }

  const canImport =
    preview !== null && preview.errors.length === 0 && preview.summary.to_create > 0

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>导入标注包</h3>

        <div className="import-input">
          <div className="import-file-row">
            <input type="file" accept=".json,application/json" onChange={handleFile} />
            <span className="hint">选择「导出 JSON」文件，或直接粘贴内容</span>
          </div>
          <textarea
            rows={7}
            placeholder='粘贴导出的 JSON（{"document": …, "codings": […]}）'
            value={raw}
            onChange={(e) => handleRawChange(e.target.value)}
          />
        </div>

        {error && <div className="import-error">{error}</div>}

        {preview && (
          <div className="import-preview">
            <div className={`import-fp ${preview.fingerprint.matched ? 'ok' : 'bad'}`}>
              {preview.fingerprint.matched
                ? '✓ 文档内容指纹匹配'
                : '✗ 文档内容指纹校验失败'}
            </div>

            {preview.errors.length > 0 && (
              <ul className="import-errors">
                {preview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}

            <div className="import-summary">
              共 {preview.summary.total} 条：新增 {preview.summary.to_create} · 跳过{' '}
              {preview.summary.to_skip} · 未知编码 {preview.summary.unknown} · 冲突{' '}
              {preview.summary.conflict}
              {preview.summary.invalid > 0 && ` · 非法区间 ${preview.summary.invalid}`}
            </div>

            {preview.invalid.length > 0 && (
              <ImportSection title={`非法区间（${preview.invalid.length}）`} tone="bad">
                {preview.invalid.map((it) => (
                  <li key={it.index}>
                    <code>
                      #{it.index} [{it.start}, {it.end})
                    </code>
                    <span className="import-reason">{it.reason}</span>
                  </li>
                ))}
              </ImportSection>
            )}

            {preview.to_create.length > 0 && (
              <ImportSection title={`新增（${preview.to_create.length}）`} tone="ok">
                {preview.to_create.map((it) => (
                  <li key={it.index}>
                    <strong>{it.code}</strong>
                    <code>
                      [{it.start}, {it.end})
                    </code>
                    <span className="import-text">「{excerpt(it.text)}」</span>
                  </li>
                ))}
              </ImportSection>
            )}

            {preview.to_skip.length > 0 && (
              <ImportSection title={`跳过（${preview.to_skip.length}）`}>
                {preview.to_skip.map((it) => (
                  <li key={it.index}>
                    <strong>{it.code}</strong>
                    <code>
                      [{it.start}, {it.end})
                    </code>
                    <span className="import-reason">
                      {it.existing_id != null
                        ? `与既有标注 #${it.existing_id} 完全相同`
                        : `与包内第 ${it.package_index} 条重复`}
                    </span>
                  </li>
                ))}
              </ImportSection>
            )}

            {preview.unknown_codes.length > 0 && (
              <ImportSection
                title={`未知编码（${preview.unknown_codes.length} 种，不导入）`}
                tone="warn"
              >
                {preview.unknown_codes.map((g) => (
                  <li key={g.name}>
                    <strong>{g.name}</strong>
                    <span className="import-reason">{g.count} 条</span>
                    <span className="import-text">
                      {g.items.map((it) => `[${it.start}, ${it.end})`).join('、')}
                    </span>
                  </li>
                ))}
              </ImportSection>
            )}

            {preview.conflicts.length > 0 && (
              <ImportSection title={`冲突（${preview.conflicts.length}，不导入）`} tone="warn">
                {preview.conflicts.map((it) => (
                  <li key={it.index}>
                    <div className="import-conflict-head">
                      <strong>{it.code}</strong>
                      <code>
                        [{it.start}, {it.end})
                      </code>
                      <span className="import-text">「{excerpt(it.text)}」</span>
                    </div>
                    <div className="import-conflict-with">
                      {it.with.map((f, i) => (
                        <span key={i} className="import-foe">
                          <span className={`tag tag-${f.type}`}>{TYPE_LABEL[f.type]}</span>
                          {f.coding.id != null
                            ? `既有 #${f.coding.id}`
                            : `包内第 ${f.coding.package_index} 条`}
                          （{f.coding.code_name} [{f.coding.start}, {f.coding.end})）
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ImportSection>
            )}

            {preview.errors.length === 0 && preview.summary.to_create === 0 && (
              <div className="empty">没有可导入的新增标注</div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="link-btn" onClick={onCancel}>
            取消
          </button>
          <button
            className="primary-btn"
            onClick={handlePreview}
            disabled={!raw.trim() || previewing || importing}
          >
            {previewing ? '校验中…' : '校验预览'}
          </button>
          <button
            className="primary-btn"
            onClick={handleImport}
            disabled={!canImport || importing}
          >
            {importing ? '导入中…' : `确认导入（${preview ? preview.summary.to_create : 0}）`}
          </button>
        </div>
      </div>
    </div>
  )
}
