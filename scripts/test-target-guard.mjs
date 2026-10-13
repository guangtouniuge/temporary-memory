export function localTestTarget() {
  const base=process.env.GEO_TEST_BASE || 'http://127.0.0.1:8787'
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)||process.env.GEO_ISOLATED_TEST_RUN!=='1') {
    throw new Error('Writing tests require an explicitly isolated local run; production targets are forbidden')
  }
  return base
}
