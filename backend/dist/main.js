"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const helmet = require("@fastify/helmet");
const cors = require("@fastify/cors");
const rateLimit = require("@fastify/rate-limit");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter());
    await app.register(helmet);
    await app.register(cors, {
        origin: ['http://localhost:3000'],
        credentials: true,
    });
    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    await app.listen(3000, '0.0.0.0');
    console.log(' Server running');
}
bootstrap();
//# sourceMappingURL=main.js.map