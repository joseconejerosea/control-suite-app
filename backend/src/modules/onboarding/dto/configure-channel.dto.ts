import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class ConfigureChannelDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsIn(['whatsapp', 'email', 'generic'])
  tipo: string;

  /**
   * Must include `webhook_secret` for channel verification (Step 3).
   * Example: { "webhook_secret": "my-secret-key", ... }
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
