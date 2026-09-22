import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import TextView from './components/TextView'
import CodingForm from './components/CodingForm'
import ConflictDialog from './components/ConflictDialog'
import Sidebar from './components/Sidebar'
import CooccurrenceView from './components/CooccurrenceView'
import SpeakerView from './components/SpeakerView'
import DistributionView from './components/DistributionView'
import GapView from './components/GapView'
import TransitionView from './components/TransitionView'
import SearchBatchPanel from './components/SearchBatchPanel'

export default function App() {
  const [docs, setDocs] = useState([])
  const [docId, setDocId] = useState(null)
  const [docData, setDocData] = useState(null) // {document, codes, codings}
  const [codebook, setCodebook] = useState([]) // 带 usage_count
  const [filters, setFilters] = useState(null) // null=全部；否则 Set(codeId)
  const [selection, setSelection] = useState(null)
  const [editing, setEditing] = useState(null)
  const [conflict, setConflict] = useState(null) // {preview, payload}
  const [flashRange, setFlashRange] = useState(null)
  const [error, setError] = useState(null)
  const [showNewDoc, setShowNewDoc] = useState(false)
  const [newDoc, setNewDoc] = useState({ title: '', content: '' })
  const [view, setView] = useState('text') // text | cooccurrence | speakers | distribution | gaps | transitions
  const [coocStats, setCoocStats] = useState(null)
  const [coocLoading, setCoocLoading] = useState(false)
  const [coocError, setCoocError] = useState(null)
  const [speakerStats, setSpeakerStats] = useState(null)
  const [speakerLoading, setSpeakerLoading] = useState(false)
  const [speakerError, setSpeakerError] = useState(null)
  const [distStats, setDistStats] = useState(null)
  const [distLoading, setDistLoading] = useState(false)
  const [distError, setDistError] = useState(null)
  const [gapStats, setGapStats] = useState(null)
  const [gapLoading, setGapLoading] = useState(false)
  const [gapError, setGapError] = useState(null)
  const [transStats, setTransStats] = useState(null)
  const [transLoading, setTransLoading] = useState(false)
  const [transError, setTransError] = useState(null)
  const [gapMinLen, setGapMinLen] = useState(1) // 最小缺口长度筛选
  const [gapCursor, setGapCursor] = useState(-1) // 上一处/下一处导航位置
  const [pendingLocate, setPendingLocate] = useState(null)

  const showError = useCallback((e) => {
    setError(e.message || String(e))
    setTimeout(() => setError(null), 5000)
  }, [])

  const loadCodes = useCallback(async () => {
    try {
      setCodebook(await api.listCodes())
    } catch (e) {
      showError(e)
    }
  }, [showError])

  const loadDocument = useCallback(
    async (id) => {
      try {
        setDocData(await api.getDocument(id))
      } catch (e) {
        showError(e)
      }
    },
    [showError]
  )

  useEffect(() => {
    ;(async () => {
      try {
        const list = await api.listDocuments()
        setDocs(list)
        if (list.length > 0) setDocId((cur) => cur ?? list[0].id)
      } catch (e) {
        showError(e)
      }
    })()
    loadCodes()
  }, [loadCodes, showError])

  useEffect(() => {
    if (docId != null) {
      setEditing(null)
      setSelection(null)
      // 跨文档定位的待定位片段指向新文档本身，需保留；其余情况清除
      setPendingLocate((cur) => (cur && cur.docId === docId ? cur : null))
      loadDocument(docId)
    }
  }, [docId, loadDocument])

  const refresh = useCallback(async () => {
    await Promise.all([loadDocument(docId), loadCodes()])
  }, [docId, loadDocument, loadCodes])

  // ---------- 编码共现统计（随当前文档与编码筛选同步） ----------

  const filteredCodeIds = useMemo(() => {
    if (filters === null) return null
    return codebook.map((c) => c.id).filter((id) => filters.has(id))
  }, [filters, codebook])

  const loadCooccurrence = useCallback(async () => {
    if (docId == null) return
    // 全部编码被取消勾选：直接给空结果，不请求后端
    if (filteredCodeIds && filteredCodeIds.length === 0) {
      setCoocStats({ document_id: docId, codes: [], pairs: [] })
      setCoocError(null)
      setCoocLoading(false)
      return
    }
    setCoocLoading(true)
    setCoocError(null)
    try {
      setCoocStats(await api.getCooccurrence(docId, filteredCodeIds))
    } catch (e) {
      setCoocStats(null)
      setCoocError(e.message || String(e))
    } finally {
      setCoocLoading(false)
    }
    // docData 变化（新建/编辑/删除标注后 refresh）也要重新统计
  }, [docId, filteredCodeIds, docData])

  useEffect(() => {
    loadCooccurrence()
  }, [loadCooccurrence])

  // ---------- 说话人分析（随当前文档与编码筛选同步） ----------

  const loadSpeakers = useCallback(async () => {
    if (docId == null) return
    // 编码全部取消勾选时传空数组：后端仅返回文本长度统计，不带编码列
    setSpeakerLoading(true)
    setSpeakerError(null)
    try {
      setSpeakerStats(await api.getSpeakerStats(docId, filteredCodeIds))
    } catch (e) {
      setSpeakerStats(null)
      setSpeakerError(e.message || String(e))
    } finally {
      setSpeakerLoading(false)
    }
    // docData 变化（新建/编辑/删除标注后 refresh）也要重新统计
  }, [docId, filteredCodeIds, docData])

  useEffect(() => {
    loadSpeakers()
  }, [loadSpeakers])

  // ---------- 跨文档编码分布对比（随编码筛选与标注变化同步） ----------

  const loadDistribution = useCallback(async () => {
    // 与说话人分析一致：编码全部取消勾选时传空数组，后端仅返回文档列表
    setDistLoading(true)
    setDistError(null)
    try {
      setDistStats(await api.getCodeDistribution(filteredCodeIds))
    } catch (e) {
      setDistStats(null)
      setDistError(e.message || String(e))
    } finally {
      setDistLoading(false)
    }
    // docData 变化（新建/编辑/删除标注后 refresh）也要重新统计
  }, [filteredCodeIds, docData])

  useEffect(() => {
    loadDistribution()
  }, [loadDistribution])

  // ---------- 覆盖缺口（随当前文档与编码筛选同步） ----------

  const loadGaps = useCallback(async () => {
    if (docId == null) return
    // 与说话人分析一致：编码全部取消勾选时传空数组，全文即一个缺口
    setGapLoading(true)
    setGapError(null)
    try {
      setGapStats(await api.getGaps(docId, filteredCodeIds))
    } catch (e) {
      setGapStats(null)
      setGapError(e.message || String(e))
    } finally {
      setGapLoading(false)
    }
    // docData 变化（新建/编辑/删除标注后 refresh）也要重新统计
  }, [docId, filteredCodeIds, docData])

  useEffect(() => {
    loadGaps()
  }, [loadGaps])

  // ---------- 编码流转（随当前文档与编码筛选同步） ----------

  const loadTransitions = useCallback(async () => {
    if (docId == null) return
    // 与说话人分析一致：编码全部取消勾选时传空数组，无状态区间与转移
    setTransLoading(true)
    setTransError(null)
    try {
      setTransStats(await api.getTransitions(docId, filteredCodeIds))
    } catch (e) {
      setTransStats(null)
      setTransError(e.message || String(e))
    } finally {
      setTransLoading(false)
    }
    // docData 变化（新建/编辑/删除标注后 refresh）也要重新统计
  }, [docId, filteredCodeIds, docData])

  useEffect(() => {
    loadTransitions()
  }, [loadTransitions])

  // 最小缺口长度筛选在前端进行，避免每次调整都重新请求
  const visibleGaps = useMemo(
    () => (gapStats?.gaps ?? []).filter((g) => g.length >= gapMinLen),
    [gapStats, gapMinLen]
  )

  // 缺口数据或筛选变化后，导航游标回到未定位状态
  useEffect(() => {
    setGapCursor(-1)
  }, [visibleGaps])

  // ---------- 编码创建 / 编辑（含冲突检测） ----------

  async function doSubmit(payload, resolution) {
    const { codeId, start, end, editing: editTarget } = payload
    if (editTarget) {
      await api.updateCoding(editTarget.id, {
        code_id: codeId,
        start,
        end,
        resolution,
      })
    } else {
      await api.createCoding({
        document_id: docId,
        code_id: codeId,
        start,
        end,
        resolution,
      })
    }
    setEditing(null)
    setSelection(null)
    setConflict(null)
    await refresh()
  }

  async function handleSubmit({ codeId, newCodeName, start, end, editing: editTarget }) {
    try {
      let finalCodeId = codeId
      if (newCodeName) {
        const created = await api.createCode(newCodeName)
        finalCodeId = created.id
      }
      const payload = { codeId: finalCodeId, start, end, editing: editTarget }
      const preview = await api.previewCoding({
        document_id: docId,
        code_id: finalCodeId,
        start,
        end,
        exclude_id: editTarget ? editTarget.id : null,
      })
      if (preview.has_conflicts) {
        setConflict({ preview, payload })
      } else {
        await doSubmit(payload, 'keep')
      }
    } catch (e) {
      showError(e)
    }
  }

  async function handleResolve(resolution) {
    try {
      await doSubmit(conflict.payload, resolution)
    } catch (e) {
      showError(e)
      setConflict(null)
    }
  }

  // ---------- 侧栏操作 ----------

  async function handleDeleteCoding(cg) {
    if (!window.confirm(`删除编码标注 #${cg.id}（${cg.code_name}）？`)) return
    try {
      await api.deleteCoding(cg.id)
      await refresh()
    } catch (e) {
      showError(e)
    }
  }

  async function handleRenameCode(code) {
    const name = window.prompt('新的编码名：', code.name)
    if (!name || name.trim() === code.name) return
    try {
      await api.updateCode(code.id, { name: name.trim() })
      await refresh()
    } catch (e) {
      showError(e)
    }
  }

  async function handleDeleteCode(code) {
    if (!window.confirm(`删除编码「${code.name}」及其全部标注？`)) return
    try {
      await api.deleteCode(code.id)
      await refresh()
    } catch (e) {
      showError(e)
    }
  }

  function scrollToRange(range) {
    const spans = document.querySelectorAll('.text-view [data-s]')
    for (const span of spans) {
      const s = Number(span.dataset.s)
      const e = Number(span.dataset.e)
      if (s < range.end && e > range.start) {
        span.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
    }
  }

  function handleLocate(cg) {
    const range = { start: cg.start, end: cg.end }
    setFlashRange(range)
    scrollToRange(range)
    setTimeout(() => setFlashRange(null), 1800)
  }

  // 共现矩阵 / 说话人分析片段 → 切回正文并定位高亮
  function handleLocateSegment(seg) {
    setView('text')
    setPendingLocate({ docId, start: seg.start, end: seg.end })
  }

  // 分布对比单元格 → 切到目标文档正文并定位首个对应片段
  function handleLocateCell(documentId, seg) {
    setDocId(documentId)
    setView('text')
    setPendingLocate({ docId: documentId, start: seg.start, end: seg.end })
  }

  // 覆盖缺口：上一处/下一处导航，循环移动并切回正文闪烁定位
  function handleGapNavigate(dir) {
    if (visibleGaps.length === 0) return
    const next =
      gapCursor < 0
        ? dir > 0
          ? 0
          : visibleGaps.length - 1
        : (gapCursor + dir + visibleGaps.length) % visibleGaps.length
    setGapCursor(next)
    handleLocateSegment(visibleGaps[next])
  }

  // 覆盖缺口：点击某条缺口 → 记住位置并切回正文定位
  function handleGapLocate(gap, index) {
    setGapCursor(index)
    handleLocateSegment(gap)
  }

  // 覆盖缺口：把整段缺口区间带入编码表单（复用拖选填表，提交仍走冲突预览）
  function handleGapToForm(gap) {
    setEditing(null)
    setSelection({ start: gap.start, end: gap.end })
    setView('text')
    setPendingLocate({ docId, start: gap.start, end: gap.end })
  }

  // 正文渲染完成后处理来自统计视图的待定位片段
  useEffect(() => {
    if (view !== 'text' || !pendingLocate) return
    // 跨文档定位需等目标文档加载完成，避免滚动到旧文档的同名区间
    if (!docData || docData.document.id !== pendingLocate.docId) return
    const range = pendingLocate
    setFlashRange(range)
    // 等视图切换后的 DOM 渲染完成再滚动
    const t = setTimeout(() => scrollToRange(range), 60)
    const clear = setTimeout(() => {
      setFlashRange(null)
      setPendingLocate(null)
    }, 2200)
    return () => {
      clearTimeout(t)
      clearTimeout(clear)
    }
  }, [view, pendingLocate, docData])

  function toggleFilter(id) {
    setFilters((cur) => {
      const next = new Set(cur === null ? codebook.map((c) => c.id) : cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next.size === codebook.length ? null : next
    })
  }

  // ---------- 文档 ----------

  async function handleCreateDocument(ev) {
    ev.preventDefault()
    if (!newDoc.title.trim() || !newDoc.content.trim()) return
    try {
      const created = await api.createDocument(newDoc.title.trim(), newDoc.content)
      const list = await api.listDocuments()
      setDocs(list)
      setDocId(created.id)
      setShowNewDoc(false)
      setNewDoc({ title: '', content: '' })
    } catch (e) {
      showError(e)
    }
  }

  // ---------- 派生数据 ----------

  const visibleCodings = useMemo(() => {
    if (!docData) return []
    if (filters === null) return docData.codings
    return docData.codings.filter((c) => filters.has(c.code_id))
  }, [docData, filters])

  const sidebarCodings = useMemo(() => {
    if (!docData) return []
    const content = docData.document.content
    return visibleCodings.map((c) => ({
      ...c,
      text: content.slice(c.start, c.end),
    }))
  }, [docData, visibleCodings])

  if (!docData) {
    return <div className="loading">加载中…</div>
  }

  const { document: doc, codings } = docData

  return (
    <div className="app">
      <header className="topbar">
        <h1>访谈转录质性分析工作台</h1>
        <div className="doc-switcher">
          <select value={docId ?? ''} onChange={(e) => setDocId(Number(e.target.value))}>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}（{d.coding_count} 条标注）
              </option>
            ))}
          </select>
          <button onClick={() => setShowNewDoc((v) => !v)}>
            {showNewDoc ? '收起' : '＋ 新建文档'}
          </button>
          <a className="btn" href={api.exportUrl(docId)} download>
            导出 JSON
          </a>
        </div>
      </header>

      {showNewDoc && (
        <form className="new-doc" onSubmit={handleCreateDocument}>
          <input
            placeholder="文档标题，如：访谈记录 A-02"
            value={newDoc.title}
            onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
          />
          <textarea
            placeholder="粘贴访谈转录全文…"
            rows={5}
            value={newDoc.content}
            onChange={(e) => setNewDoc({ ...newDoc, content: e.target.value })}
          />
          <button type="submit" className="primary-btn">
            创建文档
          </button>
        </form>
      )}

      {error && <div className="error-banner">{error}</div>}

      <main className="layout">
        <section className="text-panel">
          <div className="doc-meta">
            <strong>{doc.title}</strong>
            <span>
              全文 {doc.content.length} 字 · {codings.length} 条编码标注
              {filters !== null && `（筛选后 ${visibleCodings.length} 条）`}
            </span>
          </div>
          <div className="view-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={view === 'text'}
              className={view === 'text' ? 'active' : ''}
              onClick={() => setView('text')}
            >
              正文标注
            </button>
            <button
              role="tab"
              aria-selected={view === 'cooccurrence'}
              className={view === 'cooccurrence' ? 'active' : ''}
              onClick={() => setView('cooccurrence')}
            >
              编码共现
            </button>
            <button
              role="tab"
              aria-selected={view === 'speakers'}
              className={view === 'speakers' ? 'active' : ''}
              onClick={() => setView('speakers')}
            >
              说话人分析
            </button>
            <button
              role="tab"
              aria-selected={view === 'distribution'}
              className={view === 'distribution' ? 'active' : ''}
              onClick={() => setView('distribution')}
            >
              分布对比
            </button>
            <button
              role="tab"
              aria-selected={view === 'gaps'}
              className={view === 'gaps' ? 'active' : ''}
              onClick={() => setView('gaps')}
            >
              覆盖缺口
            </button>
            <button
              role="tab"
              aria-selected={view === 'transitions'}
              className={view === 'transitions' ? 'active' : ''}
              onClick={() => setView('transitions')}
            >
              编码流转
            </button>
          </div>
          {view === 'text' ? (
            <TextView
              content={doc.content}
              codings={visibleCodings}
              selection={selection}
              flashRange={flashRange}
              onSelect={(range) => {
                setSelection(range)
                if (editing) setEditing(null)
              }}
            />
          ) : view === 'cooccurrence' ? (
            <CooccurrenceView
              stats={coocStats}
              loading={coocLoading}
              error={coocError}
              onLocateSegment={handleLocateSegment}
            />
          ) : view === 'speakers' ? (
            <SpeakerView
              stats={speakerStats}
              loading={speakerLoading}
              error={speakerError}
              onLocateSegment={handleLocateSegment}
            />
          ) : view === 'gaps' ? (
            <GapView
              stats={gapStats}
              loading={gapLoading}
              error={gapError}
              gaps={visibleGaps}
              minLen={gapMinLen}
              onMinLenChange={setGapMinLen}
              cursor={gapCursor}
              onNavigate={handleGapNavigate}
              onLocate={handleGapLocate}
              onBringToForm={handleGapToForm}
            />
          ) : view === 'transitions' ? (
            <TransitionView
              stats={transStats}
              loading={transLoading}
              error={transError}
              onLocateInstance={handleLocateSegment}
            />
          ) : (
            <DistributionView
              stats={distStats}
              loading={distLoading}
              error={distError}
              onLocateCell={handleLocateCell}
            />
          )}
        </section>

        <div className="right-panel">
          <CodingForm
            codes={codebook}
            content={doc.content}
            selection={selection}
            editing={editing}
            onSubmit={handleSubmit}
            onCancelEdit={() => setEditing(null)}
          />
          <SearchBatchPanel
            docId={docId}
            codes={codebook}
            onApplied={refresh}
            onError={showError}
          />
          <Sidebar
            codes={codebook}
            codings={sidebarCodings}
            filters={filters}
            onToggleFilter={toggleFilter}
            onClearFilters={() => setFilters(null)}
            onRenameCode={handleRenameCode}
            onDeleteCode={handleDeleteCode}
            onLocateCoding={handleLocate}
            onEditCoding={(cg) => {
              setEditing(cg)
              setSelection(null)
            }}
            onDeleteCoding={handleDeleteCoding}
          />
        </div>
      </main>

      {conflict && (
        <ConflictDialog
          preview={conflict.preview}
          content={doc.content}
          onResolve={handleResolve}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  )
}
