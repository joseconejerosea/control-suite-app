/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { assertEmailNotPlatform } from './assert-email-not-platform';

describe('assertEmailNotPlatform', () => {
  it('throws when a platform user (client_id NULL) owns the email', async () => {
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'sa', email: 'super@x.com', client_id: null }),
    } as any;

    await expect(assertEmailNotPlatform(userRepo, 'super@x.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Debe consultar SOLO filas platform-level (client_id IS NULL)
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'super@x.com', client_id: IsNull() },
    });
  });

  it('passes when no platform user owns the email', async () => {
    const userRepo = { findOne: jest.fn().mockResolvedValue(null) } as any;
    await expect(assertEmailNotPlatform(userRepo, 'nuevo@x.com')).resolves.toBeUndefined();
  });
});
