import { IsOptional, IsString } from 'class-validator';

export class VerifyChannelDto {
  /** Optional test payload to simulate a webhook delivery. */
  @IsOptional()
  @IsString()
  test_payload?: string;


  /** Optional signature provided by caller: sha256=<hmac hex> */
  @IsOptional()
  @IsString()
  test_signature?: string;
}