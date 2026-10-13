import { randomUUID } from 'node:crypto'
const registries = new WeakMap()
export async function visibleFields(page) {
  const prefix = randomUUID().replaceAll('-', '')
  const fields = await page.evaluate(prefix => {
    const supported = new Set(['text', 'password', 'email', 'search', 'tel', 'url', 'number'])
    return [...document.querySelectorAll('input,textarea')].flatMap((node, index) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      if (node.disabled || node.readOnly || style.visibility === 'hidden' || style.display === 'none' || rect.width < 5 || rect.height < 5 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return []
      const type = node.tagName === 'TEXTAREA' ? 'textarea' : node.type
      if (type !== 'textarea' && !supported.has(type)) return []
      let id = node.getAttribute('data-core-news-field')
      if (!id || !/^f_[a-f0-9]{32}_\d+$/.test(id)) { id = `f_${prefix}_${index}`; node.setAttribute('data-core-news-field', id) }
      return [{ id, type, label: node.placeholder || node.getAttribute('aria-label') || node.name || (type === 'password' ? '密码' : '输入内容'), filled: Boolean(node.value), value: type === 'password' ? undefined : node.value, x: rect.x, y: rect.y, width: rect.width, height: rect.height }]
    }).slice(0, 80)
  }, prefix)
  registries.set(page, { url: page.url(), ids: new Set(fields.map(field => field.id)) })
  return fields
}
export async function updateField(page, { id, text, focusOnly = false }) {
  const registry = registries.get(page)
  if (!registry || registry.url !== page.url() || !registry.ids.has(id)) throw Object.assign(new Error('输入框已变化，请等待画面刷新后重试'), { status: 409 })
  const field = page.locator(`[data-core-news-field="${id}"]`)
  if (await field.count() !== 1 || !await field.isEditable()) throw Object.assign(new Error('输入框不可编辑'), { status: 409 })
  if (focusOnly) return field.focus()
  if (typeof text !== 'string' || text.length > 4000) throw Object.assign(new Error('输入内容过长'), { status: 400 })
  await field.fill(text)
}
