import { Router } from 'express'
import { z } from 'zod'
import { validateBody, validated } from '../middleware/validate.js'
import { documentFilename, renderDocx } from '../lib/docx.js'
import { PdfUnavailableError, converterStatus, docxToPdf } from '../lib/pdf.js'
import { loadQuote } from './quote.js'

export const renderRoutes = Router()

const RenderRequestSchema = z.object({ quoteId: z.string().min(1) })

function send(res: import('express').Response, buffer: Buffer, filename: string, mime: string) {
  res.setHeader('Content-Type', mime)
  // RFC 5987 form as well, so a customer name with a non-ASCII character does
  // not arrive as a mangled filename.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  )
  res.send(buffer)
}

renderRoutes.post('/render/docx', validateBody(RenderRequestSchema), (req, res) => {
  const { quoteId } = validated(RenderRequestSchema, req)
  const quote = loadQuote(quoteId)
  if (!quote) {
    res.status(404).json({ error: `No quote with id ${quoteId}` })
    return
  }

  send(
    res,
    renderDocx(quote),
    documentFilename(quote, 'docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
})

renderRoutes.post('/render/pdf', validateBody(RenderRequestSchema), async (req, res) => {
  const { quoteId } = validated(RenderRequestSchema, req)
  const quote = loadQuote(quoteId)
  if (!quote) {
    res.status(404).json({ error: `No quote with id ${quoteId}` })
    return
  }

  try {
    const pdf = await docxToPdf(renderDocx(quote))
    send(res, pdf, documentFilename(quote, 'pdf'), 'application/pdf')
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      // Not a server fault — LibreOffice simply is not installed. Say so
      // plainly and point at the .docx, which is unaffected.
      res.status(503).json({
        error: `PDF export is unavailable. ${converterStatus().detail} The .docx download still works.`,
      })
      return
    }
    throw err
  }
})
