import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateInvoiceDto {
  @IsEnum(['email', 'whatsapp', 'manual'])
  @IsOptional()
  source?: 'email' | 'whatsapp' | 'manual';

  @IsString()
  @IsOptional()
  @MaxLength(255)
  vendor_name?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  currency?: string;

  @IsDateString()
  @IsOptional()
  invoice_date?: string;

  @IsEnum(['sale', 'cost', 'expense'])
  category: 'sale' | 'cost' | 'expense';

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(['pending', 'confirmed', 'rejected'])
  @IsOptional()
  status?: 'pending' | 'confirmed' | 'rejected';

  @IsUUID()
  @IsOptional()
  project_id?: string;
}
