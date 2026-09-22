const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  listDocuments: () => request('/documents'),
  createDocument: (title, content) =>
    request('/documents', { method: 'POST', body: JSON.stringify({ title, content }) }),
  getDocument: (id) => request(`/documents/${id}`),
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
  searchDocument: (id, query) =>
    request(`/documents/${id}/search?query=${encodeURIComponent(query)}`),
  getCooccurrence: (id, codeIds = null) => {
    const qs = codeIds && codeIds.length ? `?${codeIds.map((c) => `codes=${c}`).join('&')}` : ''
    return request(`/documents/${id}/cooccurrence${qs}`)
  },
  // codeIds：null=全部编码；[]=不统计编码（仅文本长度）；否则逗号分隔
  getSpeakerStats: (id, codeIds = null) => {
    if (codeIds === null) return request(`/documents/${id}/speakers`)
    return request(`/documents/${id}/speakers?codes=${codeIds.join(',')}`)
  },
  // 跨文档编码分布对比；codeIds：null=全部编码；[]=不统计任何编码
  getCodeDistribution: (codeIds = null) => {
    if (codeIds === null) return request('/code-distribution')
    return request(`/code-distribution?codes=${codeIds.join(',')}`)
  },
  // 覆盖缺口；codeIds：null=全部编码；[]=不统计任何编码（全文即一个缺口）
  getGaps: (id, codeIds = null) => {
    if (codeIds === null) return request(`/documents/${id}/gaps`)
    return request(`/documents/${id}/gaps?codes=${codeIds.join(',')}`)
  },
  // 编码流转；codeIds：null=全部编码；[]=不统计任何编码（无状态区间与转移）
  getTransitions: (id, codeIds = null) => {
    if (codeIds === null) return request(`/documents/${id}/transitions`)
    return request(`/documents/${id}/transitions?codes=${codeIds.join(',')}`)
  },

  listCodes: () => request('/codes'),
  createCode: (name, color) =>
    request('/codes', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateCode: (id, patch) =>
    request(`/codes/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteCode: (id) => request(`/codes/${id}`, { method: 'DELETE' }),

  previewCoding: (payload) =>
    request('/codings/preview', { method: 'POST', body: JSON.stringify(payload) }),
  createCoding: (payload) =>
    request('/codings', { method: 'POST', body: JSON.stringify(payload) }),
  batchCreateCodings: (payload) =>
    request('/codings/batch', { method: 'POST', body: JSON.stringify(payload) }),
  updateCoding: (id, payload) =>
    request(`/codings/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCoding: (id) => request(`/codings/${id}`, { method: 'DELETE' }),

  exportUrl: (docId) => `${BASE}/documents/${docId}/export`,
}
