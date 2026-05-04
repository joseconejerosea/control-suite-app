import { Controller, Get, Post, Patch, Param, Body, Request } from '@nestjs/common';
import { BodegasService } from './bodegas.service';
import { CreateBodegaDto, UpdateBodegaDto } from './dto/bodega.dto';

@Controller('v1/app/bodegas')
export class BodegasController {
  constructor(private readonly svc: BodegasService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.svc.findAll(req.user.client_id);
  }

  @Get('proyectos-live')
  proyectosLive(@Request() req: any) {
    return this.svc.proyectosLive(req.user.client_id);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.svc.findOne(req.user.client_id, id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateBodegaDto) {
    return this.svc.create(req.user.client_id, dto);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateBodegaDto) {
    return this.svc.update(req.user.client_id, id, dto);
  }
}
