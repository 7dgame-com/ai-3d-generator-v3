import axios from 'axios';
import { Tripo3DAdapter } from '../adapters/Tripo3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Tripo3DAdapter balance parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads numeric balance payloads returned by /user/balance', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          balance: 100.5,
          frozen: 10,
        },
      },
    } as never);

    const adapter = new Tripo3DAdapter();
    const balance = await adapter.getBalance('api-key');

    expect(balance).toEqual({
      available: 100.5,
      frozen: 10,
    });
  });
});
