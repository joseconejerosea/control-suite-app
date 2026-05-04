import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
@Controller('v1/app/equivalencias')
export class EquivalenciasController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.ds.query(
      `SELECT * FROM equivalencias_ocr_cc WHERE client_id=$1 ORDER BY texto_ocr ASC`,
      [user.client_id],
    ).catch(() => []);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() body: any) {
    const res = await this.ds.query(
      `INSERT INTO equivalencias_ocr_cc (client_id, texto_ocr, proveedor_homologado, rut_proveedor, confianza_minima)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user.client_id, body.texto_ocr, body.proveedor_homologado, body.rut_proveedor ?? null, body.confianza_minima ?? 0.8],
    );
    return res[0];
  }

  @Patch(':id')
  async update(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const res = await this.ds.query(
      `UPDATE equivalencias_ocr_cc SET
        texto_ocr=COALESCE($1,texto_ocr),
        proveedor_homologado=COALESCE($2,proveedor_homologado),
        rut_proveedor=COALESCE($3,rut_proveedor),
        confianza_minima=COALESCE($4,confianza_minima)
       WHERE id=$5 AND client_id=$6 RETURNING *`,
      [body.texto_ocr, body.proveedor_homologado, body.rut_proveedor, body.confianza_minima, id, user.client_id],
    );
    return res[0];
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.ds.query(`DELETE FROM equivalencias_ocr_cc WHERE id=$1 AND client_id=$2`, [id, user.client_id]);
    return { deleted: true };
  }
}
