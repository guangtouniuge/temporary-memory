export function modelResponseFailure(data) {
  const choice = data?.choices?.[0]
  const reason = choice?.finish_reason
  if (reason === 'content_filter' || choice?.message?.refusal) {
    return { error: '模型接口拒绝生成当前内容，请检查资料后重试。', retryable: false }
  }
  if (reason === 'length') {
    return { error: '模型输出达到长度上限，当前工序未完整返回。', code: 'MODEL_OUTPUT_LENGTH', retryable: false }
  }
  if (typeof choice?.message?.content === 'string' && choice.message.content.trim()) return null
  return { error: '模型接口未返回有效正文', retryable: true }
}
