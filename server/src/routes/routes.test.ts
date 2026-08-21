import { describe, expect, it } from 'vitest'
import { parseRoutes } from './parse.js'
import { quoteRoutes } from './quote.js'
import { renderRoutes } from './render.js'

/**
 * Every route this application answers on, asserted by name.
 *
 * POST /api/parse/llm went missing for a week: deleting the /reconcile route
 * next to it took it along, and nothing noticed because the button that calls
 * it is hidden whenever no API key is set — which it was. A route disappearing
 * should fail a test, not wait for someone to press the button.
 */
function routesOf(router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route!.methods).map((m) => `${m.toUpperCase()} ${layer.route!.path}`),
    )
    .sort()
}

describe('the API surface', () => {
  it('parse routes', () => {
    expect(routesOf(parseRoutes as never)).toEqual([
      'GET /capabilities',
      'POST /parse',
      'POST /parse/ai',
    ])
  })

  it('quote routes', () => {
    expect(routesOf(quoteRoutes as never)).toEqual([
      'DELETE /quotes/:id',
      'GET /customers',
      'GET /makes',
      'GET /next-ref',
      'GET /quotes',
      'GET /quotes/:id',
      'POST /draft-email',
      'POST /price-history',
      'POST /quote',
      'POST /quotes/:id/status',
      'PUT /quotes/:id',
    ])
  })

  it('render routes', () => {
    expect(routesOf(renderRoutes as never)).toEqual(['POST /render/docx', 'POST /render/pdf'])
  })
})
