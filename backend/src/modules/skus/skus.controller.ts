import { Controller, Get, Post, Patch, Delete, Param, Body, Request } from '@nestjs/common';
import { SkusService } from './skus.service';
import { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto';

@Controller('v1/app/skus')
export class SkusController {
  constructor(private readonly svc: SkusService) {}
  @Get() findAll(@Request() req: any) { return this.svc.findAll(req.user.client_id); }
  @Get('alertas-stock') alertas(@Request() req: any) { return this.svc.alertasStock(req.user.client_id); }
  @Get(':id') findOne(@Request() req: any, @Param('id') id: string) { return this.svc.findOne(req.user.client_id, id); }
  @Post() create(@Request() req: any, @Body() dto: CreateSkuDto) { return this.svc.create(req.user.client_id, dto); }
  @Patch(':id') update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateSkuDto) { return this.svc.update(req.user.client_id, id, dto); }
  @Delete(':id') deactivate(@Request() req: any, @Param('id') id: string) { return this.svc.deactivate(req.user.client_id, id); }
}
