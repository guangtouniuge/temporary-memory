import { runArticleAgents } from './agents-workflow.mjs'
import { verifyWritingRelease } from './writing-release.mjs'

export const writingRelease = verifyWritingRelease()

export async function runWritingEngine(payload, options) {
  try {
    const article = await runArticleAgents(payload, options)
    return {
      ok: true, ...article,
      production: { ...writingRelease, template: article.workflow.template, model: options.model, resolvedModel: article.resolvedModel, date: options.date, promptHash: article.promptHash, workflow: article.workflow },
    }
  } catch (error) {
    return { ok: false, error: error.message || '写作接口异常' }
  }
}
