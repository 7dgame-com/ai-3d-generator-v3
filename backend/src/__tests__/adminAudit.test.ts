import { redactDiagnosticValue } from '../services/adminAudit';

describe('admin diagnostic redaction', () => {
  it('redacts credentials, tokens, images, and request payloads recursively', () => {
    expect(redactDiagnosticValue({
      apiKey: 'secret',
      nested: { authorization: 'Bearer token', safe: 'visible' },
      imageBase64: 'image-data',
      request_payload: { prompt: 'private' },
    })).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]', safe: 'visible' },
      imageBase64: '[REDACTED]',
      request_payload: '[REDACTED]',
    });
  });
});
