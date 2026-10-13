import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'htmlparser2';
import { findOne, textContent, getElementsByTagName } from 'domutils';

const ids = ['21440654','21549415','21549439','22684698','21387812','21442783','22005136','21387615','22684639','22004590','22372998','20175800','22516010','20466900','22515956'];
const urls = [...ids.map(id => `https://www.cnblogs.com/qlkkj/p/${id}`), 'https://www.sxqlk.cn/news/86.html'];
const directory = path.resolve('outputs/qilaike-alignment-20260912');
await fs.mkdir(directory, { recursive: true });
const records = [];
for (const url of urls) {
  const id = path.basename(new URL(url).pathname).replace('.html', '');
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const doc = parseDocument(html);
    const body = findOne(n => n.attribs?.id === 'cnblogs_post_body', doc.children, true);
    const title = textContent(getElementsByTagName('title', doc.children, true)[0] || {}).trim();
    if (!body) {
      records.push({ id, url, title, status: 'body-not-found' });
      continue;
    }
    const blocks = [];
    function visit(node) {
      if (['script', 'style'].includes(node.name)) return;
      if (/^h[1-6]$/.test(node.name || '') || ['p', 'li', 'tr'].includes(node.name)) {
        function render(n) {
          if (n.type === 'text') return n.data;
          if (n.name === 'br') return '\n';
          return (n.children || []).map(render).join('');
        }
        for (const line of render(node).split(/\n+/)) {
          const text = line.replace(/\s+/g, ' ').trim();
          if (text) blocks.push({ tag: node.name, text });
        }
      } else for (const child of node.children || []) visit(child);
    }
    visit(body);
    const content = blocks.map(b => /^h/.test(b.tag) ? `${'#'.repeat(Number(b.tag[1]))} ${b.text}` : b.text).join('\n\n');
    await fs.writeFile(path.join(directory, `${id}.md`), `Source: ${url}\nCollected: ${new Date().toISOString()}\nTitle: ${title}\n\n${content}`, 'utf8');
    const headings = blocks.filter(b => b.text.length < 100 && (/^h/.test(b.tag) || /^([一二三四五六七八九十]+[、：]|案例[一二三四]|核心结论|高频问题|常见误区|摘要|总结)/.test(b.text))).map(b => b.text);
    records.push({ id, url, title, status: 'saved', chineseCharacters: (content.match(/\p{Script=Han}/gu) || []).length, blocks: blocks.length, headings });
  } catch (error) { records.push({ id, url, status: 'error', error: String(error) }); }
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(records, null, 2), 'utf8');
}
console.log(JSON.stringify(records.map(({headings, ...record}) => record), null, 2));
