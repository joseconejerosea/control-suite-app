import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query params for GET /notifications.
 *
 * `unread` arrives as a raw query string; the global ValidationPipe
 * (transform: true) runs this DTO, so we coerce 'true'/'1' → true and
 * 'false'/'0' → false here, then validate it is a boolean. Any other value
 * fails validation (400) instead of being silently treated as false.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return value; // leave invalid values untouched so @IsBoolean rejects them
  })
  @IsBoolean()
  unread?: boolean;
}
