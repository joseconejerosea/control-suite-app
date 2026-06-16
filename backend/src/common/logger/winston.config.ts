import * as winston from 'winston';
import { WinstonModule, utilities as nestWinstonUtils } from 'nest-winston';

const isProduction = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        )
      : winston.format.combine(
          winston.format.timestamp(),
          nestWinstonUtils.format.nestLike('ControlSuite', {
            prettyPrint: true,
            colors: true,
          }),
        ),
  }),
];

export const winstonLogger = WinstonModule.createLogger({
  level: isProduction ? 'info' : 'debug',
  transports,
});
