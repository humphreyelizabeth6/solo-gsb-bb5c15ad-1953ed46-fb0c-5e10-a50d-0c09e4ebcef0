import { useRef, useState } from 'react'
import { api } from '../api'

/**
 * 标注包导入对话框：
 *   input 阶段粘贴 / 选择「导出 JSON」→ 调预检接口；
 *   preview 阶段展示新增 / 跳过 / 未知编码 / 非法条目分类与冲突明细，
 *               有阻断项时禁止确认；
 *   done 阶段展示导入结果，新增项可逐条在正文中定位。
 * 确认导入在后端单事务中完成：任何校验失败都不落库。
 */
export default function ImportDialog({ docId, onClose, onImported, onLocate }) {
  const [rawText, setRawText] = useState('')
  const [phase, setPhase] = useState('input') // input | preview | busy | done
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  async function readPreview(pkg) {
    setPhase('busy')
    setError(null)
    try {
      const data = await api.previewImport(docId, pkg)
      setPreview(data)
      setPhase('preview')
    } catch (e) {
      setError(e.message || String(e))
      setPhase('input')
    }
  }

  function isPackage(pkg) {
    return (
      pkg &&
      typeof pkg === 'object' &&
      !Array.isArray(pkg) &&
      typeof pkg.document === 'object' &&
      Array.isArray(pkg.codings)
    )
  }

  async function handleParse(text) {
    setRawText(text)
    if (!text.trim()) return
    let pkg
    try {
      pkg = JSON.parse(text)
    } catch {
      // 粘贴 / 输入过程中的半截 JSON：静默等待补全，不逐条报红
      setError(null)
      setPhase('input')
      return
    }
    if (!isPackage(pkg)) {
      // JSON 合法但尚不像导出标注包（例如 {"document": …}）：继续等待，不打断输入
      setError(null)
      setPhase('input')
      return
    }
    await readPreview(pkg)
  }

  async function handleFile(ev) {
    const file = ev.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      setRawText(text)
      let pkg
      try {
        pkg = JSON.parse(text)
      } catch {
        setError('文件内容不是合法 JSON，请选择「导出 JSON」生成的文件')
        setPhase('input')
        return
      }
      if (!isPackage(pkg)) {
        setError('文件不是标注包：缺少 document / codings 字段，请选择「导出 JSON」生成的文件')
        setPhase('input')
        return
      }
      await readPreview(pkg)
    } finally {
      ev.target.value = ''
    }
  }

  async function handleConfirm() {
    let pkg
    try {
      pkg = JSON.parse(rawText)
    } catch {
      setError('JSON 解析失败，请重新粘贴 / 选择标注包')
      return
    }
    setPhase('busy')
    setError(null)
    try {
      const data = await api.confirmImport(docId, pkg)
      setResult(data)
      setPhase('done')
      await onImported()
    } catch (e) {
      // 预检后状态可能已变化（如编码本被删）：整批回滚，回到预检前状态
      setError(e.message || String(e))
      setPhase('preview')
    }
  }

  function reset() {
    setRawText('')
    setPreview(null)
    setResult(null)
    setError(null)
    setPhase('input')
  }

  function locate(item) {
    onLocate({ start: item.start, end: item.end })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>标注包导入</h3>

        {phase === 'done' && result && (
          <DonePanel result={result} onLocate={locate} onClose={onClose} />
        )}

        {phase !== 'done' && (
          <>
            {phase === 'input' && (
              <>
                <div className="import-source">
                  <button onClick={() => fileRef.current?.click()}>
                    选择导出的 JSON 文件…
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={handleFile}
                  />
                  <span className="hint">或直接粘贴 JSON 文本：</span>
                </div>
                <textarea
                  className="import-textarea"
                  rows={10}
                  placeholder='粘贴「导出 JSON」下载文件的全部内容，形如 {"document": …, "codes": …, "codings": […] }'
                  value={rawText}
                  onChange={(e) => handleParse(e.target.value)}
                />
                <p className="hint">
                  导入按编码<strong>名称</strong>映射当前编码本；将校验文档内容指纹、区间边界、
                  原文切片与重复项，确认后在单事务中写入，任何校验失败都不落库。
                </p>
              </>
            )}

            {phase === 'busy' && <div className="empty">校验中…</div>}

            {phase === 'preview' && preview && (
              <PreviewPanel preview={preview} />
            )}

            {error && <div className="error-banner import-error">{error}</div>}

            <div className="modal-actions">
              {phase === 'preview' && (
                <button className="link-btn" onClick={reset}>
                  更换标注包
                </button>
              )}
              <button className="link-btn" onClick={onClose}>
                {phase === 'input' ? '取消' : '关闭'}
              </button>
              {phase === 'preview' && (
                <button
                  className="primary-btn"
                  onClick={handleConfirm}
                  disabled={!preview.can_import || preview.summary.created === 0}
                  title={
                    preview.summary.created === 0
                      ? '没有需要新增的标注'
                      : !preview.can_import
                        ? '存在阻断项，请先处理'
                        : undefined
                  }
                >
                  确认导入（新增 {preview.summary.created} 条）
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FingerprintBadge({ check }) {
  const ok = check.match
  return (
    <span className={`fp-badge ${ok ? 'ok' : 'bad'}`}>
      {ok ? '✓' : '✕'} 内容指纹{check.mode === 'legacy' ? '（旧版兼容校验）' : ''}
      {ok ? '一致' : '不一致'}
    </span>
  )
}

function ItemRow({ item, kind, onLocate }) {
  const tag = ITEM_TAGS[kind]
  return (
    <li>
      <div className="import-item-head">
        <span className={`tag ${tag.cls}`}>{tag.label}</span>
        <span className="dot" style={{ background: item.color || '#c7ccd6' }} />
        <strong>{item.code_name}</strong>
        <code>
          [{item.start}, {item.end})
        </code>
        {onLocate && (
          <button className="link-btn" onClick={() => onLocate(item)}>
            定位
          </button>
        )}
      </div>
      {item.text && <div className="import-item-text">「{item.text}」</div>}
      {kind === 'skipped' && (
        <div className="import-item-detail">
          {item.reason === 'duplicate'
            ? '与标注包内另一条目完全相同'
            : `与既有标注 #${item.existing_id} 完全相同`}
          ，已跳过
        </div>
      )}
      {kind === 'invalid' && (
        <div className="import-item-detail bad">{item.detail}</div>
      )}
      {kind === 'created' && item.conflicts?.length > 0 && (
        <div className="import-item-detail">
          与 {item.conflicts.length} 条既有标注冲突（按保留边界导入）：
          {item.conflicts.slice(0, 3).map((c, i) => (
            <span key={i} className="import-conflict-chip">
              {c.type_label}·{c.code_name} [{c.start}, {c.end})
            </span>
          ))}
          {item.conflicts.length > 3 && <span>…</span>}
        </div>
      )}
    </li>
  )
}

const ITEM_TAGS = {
  created: { label: '新增', cls: 'tag-created' },
  skipped: { label: '跳过', cls: 'tag-skipped' },
  unknown: { label: '未知编码', cls: 'tag-unknown' },
  invalid: { label: '非法', cls: 'tag-invalid' },
}

function Section({ title, items, kind, onLocate }) {
  if (items.length === 0) return null
  return (
    <details open={kind !== 'skipped'} className="import-section">
      <summary>
        {title}（{items.length}）
      </summary>
      <ul className="import-item-list">
        {items.map((it) => (
          <ItemRow key={`${it.index}-${it.start}-${it.end}`} item={it} kind={kind} onLocate={onLocate} />
        ))}
      </ul>
    </details>
  )
}

function PreviewPanel({ preview }) {
  const { summary } = preview
  return (
    <div className="import-preview">
      <div className="import-meta">
        <FingerprintBadge check={preview.fingerprint_check} />
        {preview.source.title && (
          <span className="hint">来源文档：{preview.source.title}</span>
        )}
      </div>
      {preview.fingerprint_check.note && (
        <p className="hint">{preview.fingerprint_check.note}</p>
      )}

      <div className="import-stat-row">
        <span className="import-stat created">新增 {summary.created}</span>
        <span className="import-stat skipped">跳过 {summary.skipped}</span>
        <span className={`import-stat ${summary.unknown ? 'unknown' : ''}`}>
          未知编码 {summary.unknown}
        </span>
        <span className={`import-stat ${summary.invalid ? 'invalid' : ''}`}>
          非法 {summary.invalid}
        </span>
        <span className="import-stat">冲突新增 {summary.conflicts}</span>
        <span className="hint">共 {summary.total} 条</span>
      </div>

      {preview.unknown_codes.length > 0 && (
        <p className="import-block-hint">
          未知编码：{preview.unknown_codes.join('、')}。请取消导入并先在编码本中新建
          <strong>同名</strong>编码后重试。
        </p>
      )}

      {!preview.can_import && (
        <ul className="import-blockers">
          {preview.blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {preview.can_import && summary.created > 0 && (
        <p className="hint import-ok-hint">
          校验通过：新增标注将按保留边界（keep）写入，重叠 / 嵌套与既有标注共存；
          完全相同的标注自动跳过。
        </p>
      )}
      {summary.created === 0 && (
        <p className="hint">标注包中没有可新增的标注（全部跳过、未知或非法）。</p>
      )}

      <div className="import-sections">
        <Section title="新增" items={preview.created} kind="created" />
        <Section title="跳过（重复）" items={preview.skipped} kind="skipped" />
        <Section title="未知编码" items={preview.unknown} kind="unknown" />
        <Section title="非法条目" items={preview.invalid} kind="invalid" />
      </div>
    </div>
  )
}

function DonePanel({ result, onLocate, onClose }) {
  const { created, skipped } = result
  return (
    <div className="import-done">
      <div className="batch-result">
        导入完成：新增 {created.length} 条，跳过 {skipped.length} 条。
      </div>
      {created.length > 0 ? (
        <>
          <p className="hint">点击「定位」在正文中查看新增结果：</p>
          <ul className="import-item-list">
            {created.map((it) => (
              <ItemRow key={it.id} item={it} kind="created" onLocate={onLocate} />
            ))}
          </ul>
        </>
      ) : (
        <p className="hint">本次没有写入新标注。</p>
      )}
      <div className="modal-actions">
        {created.length > 0 && (
          <button className="primary-btn" onClick={() => onLocate(created[0])}>
            定位第一条新增
          </button>
        )}
        <button className="link-btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
