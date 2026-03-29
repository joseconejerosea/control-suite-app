import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    //  No token
    if (!authHeader) {
      throw new UnauthorizedException('No token provided');
    }

    // Bearer token extract
    const token = authHeader.split(' ')[1];

    try {
      //  Verify token
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);

      //  VERY IMPORTANT (Milestone 2 key)
      request.user = decoded;

      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}