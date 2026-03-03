import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { RpcErrorFilter } from './rpc-error.filter';

describe('RpcErrorFilter', () => {
  it.each(['blockhash not found', 'slot 123 is too old'])(
    'maps RPC message "%s" to 503',
    (rpcMessage) => {
      const filter = new RpcErrorFilter();
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status }),
        }),
      } as unknown as ArgumentsHost;

      filter.catch(new Error(rpcMessage), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message:
            'Solana RPC error: blockhash expired or slot too old. Please retry.',
        }),
      );
    },
  );
});
