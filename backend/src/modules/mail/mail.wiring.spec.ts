/// <reference types="jest" />
/**
 * Build-verification only: forces ts-jest to typecheck the controller and module
 * (not covered by the behavior specs, which import the service/providers directly).
 * A plain import runs compilation but does NOT instantiate providers — no cron fires.
 */
import { MailController } from './mail.controller';
import { MailModule } from './mail.module';

it('mail wiring compiles', () => {
  expect(MailController).toBeDefined();
  expect(MailModule).toBeDefined();
});
