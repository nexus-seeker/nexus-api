import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class RpcErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(RpcErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message || message;
    } else if (exception instanceof Error) {
      // Detect common Solana RPC errors
      const msg = exception.message;

      if (msg.includes('blockhash') || msg.includes('slot')) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message =
          'Solana RPC error: blockhash expired or slot too old. Please retry.';
      } else if (msg.includes('simulation')) {
        status = HttpStatus.BAD_REQUEST;
        message = `Transaction simulation failed: ${msg}`;
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        status = HttpStatus.TOO_MANY_REQUESTS;
        message = 'RPC rate limit reached. Please wait and retry.';
      } else {
        message = msg;
      }

      this.logger.error(`RPC Error: ${msg}`, exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
