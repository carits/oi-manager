export const fileFixtures = {
  png: {
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  },
  pdf: {
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
      'ascii',
    ),
  },
  text: {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('OI Manager isolated E2E attachment\n', 'utf8'),
  },
  zip: {
    name: 'tests.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(
      'UEsDBAoAAAAAAKRSvFwAAAAAAAAAAAAAAAAFAAAAZW1wdHlQSwECHgMKAAAAAACkUrxYAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAAAAAAAAZW1wdHlQSwUGAAAAAAEAAQAzAAAAIwAAAAAA',
      'base64',
    ),
  },
}
