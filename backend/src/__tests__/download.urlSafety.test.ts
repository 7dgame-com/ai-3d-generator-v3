import dns from 'node:dns/promises';
import { isSafeDownloadUrl } from '../controllers/download';

jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn(),
  },
}));

describe('isSafeDownloadUrl', () => {
  const mockedLookup = dns.lookup as unknown as jest.Mock;

  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('rejects non-https URLs', async () => {
    await expect(isSafeDownloadUrl('http://example.com/model.glb')).resolves.toBe(false);
  });

  it('rejects private ip hosts', async () => {
    await expect(isSafeDownloadUrl('https://127.0.0.1/model.glb')).resolves.toBe(false);
    await expect(isSafeDownloadUrl('https://169.254.169.254/latest/meta-data')).resolves.toBe(false);
  });

  it('rejects domains that resolve to private addresses', async () => {
    mockedLookup.mockResolvedValue([{ address: '10.0.0.2', family: 4 }]);
    await expect(isSafeDownloadUrl('https://cdn.example.com/model.glb')).resolves.toBe(false);
  });

  it('accepts domains that resolve to public addresses', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(isSafeDownloadUrl('https://cdn.example.com/model.glb')).resolves.toBe(true);
  });
});
