import { IsString, IsNotEmpty, Matches, Length } from 'class-validator';

export class ProvisionWhatsAppDto {
  /**
   * Country code WITHOUT leading +  e.g. "56" for Chile, "92" for Pakistan
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,4}$/, { message: 'cc must be 1-4 digits, no + sign' })
  cc: string;

  /**
   * Local phone number WITHOUT country code or spaces e.g. "912345678"
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{7,15}$/, { message: 'phone_number must be 7-15 digits only' })
  phone_number: string;

  /**
   * Display name that will appear on WhatsApp — must match Meta Business verification.
   */
  @IsString()
  @IsNotEmpty()
  @Length(3, 100)
  verified_name: string;

  /**
   * OTP delivery method.  SMS is default; VOICE as fallback.
   */
  @IsString()
  @Matches(/^(SMS|VOICE)$/, { message: 'code_method must be SMS or VOICE' })
  code_method: 'SMS' | 'VOICE' = 'SMS';
}
