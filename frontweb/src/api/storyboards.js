import request from '@/utils/request'

export const storyboardsAPI = {
  get(id) {
    return request.get(`/storyboards/${id}`)
  },
  create(data) {
    return request.post('/storyboards', data)
  },
  update(id, data) {
    return request.put(`/storyboards/${id}`, data)
  },
  delete(id) {
    return request.delete(`/storyboards/${id}`)
  },
  generateFramePrompt(id, data) {
    return request.post(`/storyboards/${id}/frame-prompt`, data)
  },
  polishPrompt(id) {
    return request.post(`/storyboards/${id}/polish-prompt`, {})
  },
  /** 全能模式：根据分镜内容 AI 生成片段描述；可选 body.duration 为当前分镜秒数（与界面预设一致） */
  generateUniversalSegmentPrompt(id, body = {}) {
    return request.post(`/storyboards/${id}/universal-segment-prompt`, body)
  },
  insertBefore(id) {
    return request.post(`/storyboards/${id}/insert-before`, {})
  },
  batchInferParams(episodeId, overwrite = false) {
    return request.post('/storyboards/batch-infer-params', { episode_id: episodeId, overwrite })
  },
  upscale(id) {
    return request.post(`/storyboards/${id}/upscale`, {})
  }
}
