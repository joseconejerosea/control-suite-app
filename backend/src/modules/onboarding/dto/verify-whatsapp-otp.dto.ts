import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class VerifyWhatsAppOtpDto {
  /**
   * 6-digit OTP code sent by Meta to the phone number.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;
}
