export async function selectedMedia(page) {
  const result = await page.evaluate(() => {
    const picked = new Set([...document.querySelectorAll('tr')].filter(row => row.querySelector('input[type=checkbox]:checked,.layui-form-checked')))
    return [...picked].flatMap(row => {
      const table = row.closest('.layui-table-view') || row.closest('table')
      const headers = [...(table?.querySelectorAll('thead th') || [])].map(cell => cell.textContent.trim())
      const cells = [...row.querySelectorAll('td')]
      if (!cells.length) return []
      const nameIndex = headers.findIndex(text => /^(媒体名称|资源名称|媒体|资源)$/.test(text))
      if (nameIndex < 0) return []
      const priceIndex = headers.findIndex(text => /会员价|售价|媒体价格|资源价格|^价格$|^单价$|^报价$/.test(text))
      const categoryIndex = headers.findIndex(text => /行业|分类|类型/.test(text))
      const checkbox = row.querySelector('input[type=checkbox]')
      const id = row.getAttribute('data-id') || (checkbox?.value !== 'on' ? checkbox?.value : '') || row.querySelector('td[data-field="id"]')?.textContent.trim()
      const name = cells[nameIndex]?.textContent.trim()
      const price = cells[priceIndex]?.textContent.trim().replace(/[¥￥元\s,]/g, '')
      return [{ id: id || '', name: name || '', category: cells[categoryIndex]?.textContent.trim() || '', priceFen: /^\d+(?:\.\d{1,2})?$/.test(price || '') ? Math.round(Number(price) * 100) : null }]
    })
  })
  if (!result.length) throw Object.assign(new Error('没有读取到已选媒体。请先在新闻平台媒体表格中勾选媒体；若已经勾选，该页面结构仍需适配。'), { status: 409 })
  if (result.length > 200 || result.some(row => !row.id || !row.name || row.id.length > 128 || row.name.length > 300)) throw Object.assign(new Error('平台未提供可核验的媒体编号，暂不能自动匹配，请保留当前页面供适配'), { status: 409 })
  return [...new Map(result.map(row => [row.id, row])).values()]
}
