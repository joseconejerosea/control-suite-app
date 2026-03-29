import { IsEmail, IsString, MinLength, IsInt } from 'class-validator';

export class CreateUserDto {
  @IsString()
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsInt()
  client_id!: number;
}