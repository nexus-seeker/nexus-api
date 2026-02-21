import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const apiKey = request.headers['x-api-key'];
        const expectedKey = process.env.API_KEY || 'nexus-hackathon-key';

        if (!apiKey || apiKey !== expectedKey) {
            throw new UnauthorizedException('Invalid or missing API key');
        }

        return true;
    }
}
