import fs from 'fs';
import path from 'path';

describe('backend CORS origins', () => {
  it('allows the hosted a23 plugin frontend to call the public backend origin', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf8');

    expect(source).toContain("'https://a23.plugins.xrugc.com'");
  });
});
