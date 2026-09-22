import { useEffect, useMemo, useState } from 'react'

const UNATTRIBUTED_KEY = '__unattributed__'
const TURNS = 'turns' // 明细类型：发言段落
const ALL = 'all' // 明细类型：总覆盖（选中编码的并集）

const keyOf = (s) => (s.unattributed ? UNATTRIBUTED_KEY : s.name)
const nameOf = (s) => (s.unattributed ? '未标注说话人' : s.name)
const pct = (r) => `${(r * 100).toFixed(1)}%`

/** 列表摘录：压缩空白并截断，避免整段发言撑爆列表 */
function excerpt(text, max = 120) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * 说话人分析视图：按「说话人：」发言段落统计每位说话人的文本长度、
 * 各编码覆盖字符数与覆盖率；无法识别说话人的文本归入「未标注说话人」。
 *  - 顶部复选框按说话人筛选表格行；
 *  - 点击说话人名查看其发言段落，点击覆盖统计单元格查看覆盖片段；
 *  - 点击明细中的片段经 onLocateSegment 切回正文定位高亮。
 */
export default function SpeakerView({ stats, loading, error, onLocateSegment }) {
  const [hidden, setHidden] = useState(new Set()) // 被隐藏的说话人 key
  const [selected, setSelected] = useState(null) // {key, kind: 'turns'|'all'|codeId}

  const speakers = stats?.speakers ?? []
  const codes = stats?.codes ?? []
  const docId = stats?.document_id ?? null

  // 切换文档后重置说话人筛选与选中项
  useEffect(() => {
    setHidden(new Set())
    setSelected(null)
  }, [docId])

  // 编码筛选变化后，若选中的编码列已不在统计范围内则清除选中
  useEffect(() => {
    if (
      selected &&
      typeof selected.kind === 'number' &&
      !codes.some((c) => c.id === selected.kind)
    ) {
      setSelected(null)
    }
  }, [codes, selected])

  const visible = useMemo(
    () => speakers.filter((s) => !hidden.has(keyOf(s))),
    [speakers, hidden]
  )

  // 合计行：发言段落把文档切成互不相交的区间，各说话人直接相加即为并集
  const totals = useMemo(() => {
    const t = { turns: 0, chars: 0, coded: 0, perCode: new Map() }
    for (const s of visible) {
      t.turns += s.turn_count
      t.chars += s.char_count
      t.coded += s.coded_char_count
      for (const cs of s.codes) {
        t.perCode.set(cs.code_id, (t.perCode.get(cs.code_id) ?? 0) + cs.char_count)
      }
    }
    return t
  }, [visible])

  function toggleSpeaker(key) {
    setHidden((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (selected?.key === key) setSelected(null)
  }

  function select(key, kind) {
    setSelected((cur) => (cur && cur.key === key && cur.kind === kind ? null : { key, kind }))
  }

  const isSel = (key, kind) =>
    Boolean(selected && selected.key === key && selected.kind === kind)

  const selectedSpeaker = selected
    ? speakers.find((s) => keyOf(s) === selected.key)
    : null

  // 明细区：发言段落 / 总覆盖片段 / 某编码覆盖片段
  let detailTitle = null
  let detailSegments = null
  if (selectedSpeaker && selected) {
    if (selected.kind === TURNS) {
      detailTitle = `${nameOf(selectedSpeaker)} 的发言段落`
      detailSegments = selectedSpeaker.turns
    } else if (selected.kind === ALL) {
      detailTitle = `${nameOf(selectedSpeaker)} 的总覆盖（选中编码并集）`
      detailSegments = selectedSpeaker.coded_segments
    } else {
      const code = codes.find((c) => c.id === selected.kind)
      const cs = selectedSpeaker.codes.find((x) => x.code_id === selected.kind)
      if (code && cs) {
        detailTitle = `${nameOf(selectedSpeaker)} × ${code.name}`
        detailSegments = cs.segments
      }
    }
  }

  const namedCount = speakers.filter((s) => !s.unattributed).length
  const unattributed = speakers.find((s) => s.unattributed)

  return (
    <div className="speaker-panel">
      <div className="speaker-toolbar">
        {speakers.length > 0 && (
          <div className="speaker-filter">
            <span className="filter-label">说话人筛选：</span>
            {speakers.map((s) => {
              const key = keyOf(s)
              return (
                <label key={key} className={hidden.has(key) ? 'dimmed' : ''}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(key)}
                    onChange={() => toggleSpeaker(key)}
                  />
                  {nameOf(s)}
                </label>
              )
            })}
            <button className="link-btn" onClick={() => setHidden(new Set())}>
              全选
            </button>
            <button
              className="link-btn"
              onClick={() => {
                setHidden(new Set(speakers.map(keyOf)))
                setSelected(null)
              }}
            >
              全不选
            </button>
          </div>
        )}
        {stats && (
          <p className="speaker-summary">
            全文 {stats.document_length} 字 · 识别到 {namedCount} 位说话人
            {unattributed && ` · 未标注说话人 ${unattributed.char_count} 字`}
            {namedCount === 0 && ' · 未识别到「说话人：」格式的发言段落'}
          </p>
        )}
        <p className="hint">
          口径：行首「说话人：」（全角/半角冒号）开启一个发言段落，延伸至下一说话人行首；
          同一编码的重叠标注先合并再裁剪到发言段落，共享字符不重复计数；覆盖率 = 覆盖字符数 ÷ 文本长度。
        </p>
      </div>

      {loading && <div className="cooc-status">说话人统计加载中…</div>}
      {!loading && error && <div className="cooc-status error">{error}</div>}
      {!loading && !error && stats && speakers.length === 0 && (
        <div className="cooc-status">文档为空，无法统计。</div>
      )}
      {!loading && !error && speakers.length > 0 && visible.length === 0 && (
        <div className="cooc-status">全部说话人均被隐藏，请在上方勾选要显示的说话人。</div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="speaker-table-wrap">
          <table className="speaker-table">
            <thead>
              <tr>
                <th className="speaker-col">说话人</th>
                <th title="发言段落数">段落</th>
                <th title="发言段落字符数之和（含说话人标签）">文本长度</th>
                <th title="当前统计编码合并后的并集覆盖">总覆盖</th>
                {codes.map((c) => (
                  <th key={c.id} title={c.name}>
                    <span className="dot" style={{ background: c.color }} />
                    <span className="th-name">{c.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const key = keyOf(s)
                return (
                  <tr key={key}>
                    <th scope="row">
                      <button
                        type="button"
                        className={`speaker-name ${s.unattributed ? 'unattributed' : ''} ${
                          isSel(key, TURNS) ? 'selected' : ''
                        }`}
                        title="查看发言段落"
                        onClick={() => select(key, TURNS)}
                      >
                        {nameOf(s)}
                      </button>
                    </th>
                    <td className="num">{s.turn_count}</td>
                    <td className="num">{s.char_count} 字</td>
                    <StatCell
                      chars={s.coded_char_count}
                      rate={s.coverage_rate}
                      selected={isSel(key, ALL)}
                      onClick={() => select(key, ALL)}
                    />
                    {codes.map((c) => {
                      const cs = s.codes.find((x) => x.code_id === c.id)
                      return (
                        <StatCell
                          key={c.id}
                          chars={cs?.char_count ?? 0}
                          rate={cs?.coverage_rate ?? 0}
                          selected={isSel(key, c.id)}
                          onClick={() => select(key, c.id)}
                        />
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">合计（当前显示）</th>
                <td className="num">{totals.turns}</td>
                <td className="num">{totals.chars} 字</td>
                <td className="num">
                  {totals.coded} 字<small>{pct(totals.chars ? totals.coded / totals.chars : 0)}</small>
                </td>
                {codes.map((c) => {
                  const chars = totals.perCode.get(c.id) ?? 0
                  return (
                    <td key={c.id} className="num">
                      {chars} 字<small>{pct(totals.chars ? chars / totals.chars : 0)}</small>
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && !error && stats && codes.length === 0 && (
        <p className="hint">当前没有参与统计的编码，仅显示文本长度；在侧栏勾选或创建编码后可查看各编码覆盖。</p>
      )}

      <div className="cooc-detail" aria-live="polite">
        {!detailTitle && !loading && !error && visible.length > 0 && (
          <div className="cooc-status subtle">
            点击说话人名查看发言段落，点击覆盖统计单元格查看覆盖片段与原文摘录。
          </div>
        )}
        {detailTitle && detailSegments && (
          <>
            <div className="cooc-detail-head">
              <strong>{detailTitle}</strong>
              <span className="cooc-stat">{detailSegments.length} 段</span>
              <button className="link-btn" onClick={() => setSelected(null)}>
                清除选择
              </button>
            </div>
            {detailSegments.length === 0 ? (
              <div className="cooc-status subtle">暂无片段。</div>
            ) : (
              <ul className="cooc-segment-list">
                {detailSegments.map((seg) => (
                  <li key={`${seg.start}-${seg.end}`}>
                    <button
                      type="button"
                      className="cooc-segment"
                      title="点击切回正文并定位"
                      onClick={() => onLocateSegment(seg)}
                    >
                      <code>
                        [{seg.start}, {seg.end})
                      </code>
                      <span className="cooc-seg-text">「{excerpt(seg.text)}」</span>
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

/** 覆盖统计单元格：字符数 + 覆盖率，非零时可点击展开覆盖片段 */
function StatCell({ chars, rate, selected, onClick }) {
  const disabled = chars === 0
  return (
    <td className="stat-td">
      <button
        type="button"
        className={`stat-cell ${selected ? 'selected' : ''}`}
        disabled={disabled}
        title={disabled ? '无覆盖' : '查看覆盖片段'}
        onClick={onClick}
      >
        <strong>{chars} 字</strong>
        <small>{pct(rate)}</small>
      </button>
    </td>
  )
}
