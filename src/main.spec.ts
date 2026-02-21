import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));

jest.mock('@nestjs/swagger', () => ({
  SwaggerModule: {
    createDocument: jest.fn(() => ({})),
    setup: jest.fn(),
  },
  DocumentBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setVersion: jest.fn().mockReturnThis(),
    addTag: jest.fn().mockReturnThis(),
    build: jest.fn(() => ({})),
  })),
}));

jest.mock('./app.module', () => ({
  AppModule: class AppModule {},
}));

describe('main bootstrap', () => {
  it('registers RpcErrorFilter globally', async () => {
    const app = {
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
      useGlobalFilters: jest.fn(),
      setGlobalPrefix: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
    };

    (NestFactory.create as jest.Mock).mockResolvedValue(app);

    jest.isolateModules(() => {
      require('./main');
    });

    await Promise.resolve();
    await Promise.resolve();

    const [registeredFilter] = app.useGlobalFilters.mock.calls[0];
    expect(registeredFilter.constructor.name).toBe('RpcErrorFilter');
    expect(SwaggerModule.setup).toHaveBeenCalled();
  });
});
