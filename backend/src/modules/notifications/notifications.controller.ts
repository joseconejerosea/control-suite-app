import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

/**
 * In-app notifications endpoints for the authenticated user.
 *
 * Guard stack matches promoters/activations: AuthGuard → ClientIsolationGuard →
 * ClientActiveGuard. The global TenantInterceptor opens the tenant tx before
 * any of these run, so ds.query() inside the service is already tenant-scoped.
 *
 * Caller identity: @CurrentUser() → JwtPayload where:
 *   user.sub       = user.id (UUID)
 *   user.client_id = tenant UUID
 */
@Controller('notifications')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications?unread=true
   * Returns { data: Notification[], unreadCount: number }
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.listForUser(
      user.client_id,
      user.sub,
      query.unread ?? false,
    );
  }

  /**
   * PATCH /notifications/:id/read
   * Sets read_at on the notification. Own-only — service throws NotFoundException
   * (mapped to 404) when the row doesn't belong to the authenticated user.
   */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.markRead(user.client_id, user.sub, id);
    return { success: true };
  }

  /**
   * POST /notifications/read-all
   * Marks all unread notifications as read for the caller. Idempotent.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: JwtPayload) {
    await this.notificationsService.markAllRead(user.client_id, user.sub);
    return { success: true };
  }
}
