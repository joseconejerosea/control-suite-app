import {
  Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe,
  UseGuards, BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

// Valores del enum `destino_reporte` (migración F1Schema 019). El diccionario OCR le
// dice a la IA de clasificación: "si ves este keyword, es esta categoria y va a este
// destino" (ver classify.processor). confidence_boost es el empuje de confianza.
const DESTINOS = ['gastos', 'ventas', 'costos'] as const;
type Destino = (typeof DESTINOS)[number];

function assertDestino(value: unknown, required: boolean): Destino | null {
  if (value == null || value === '') {
    if (required) throw new BadRequestException(`destino es obligatorio (uno de: ${DESTINOS.join(', ')})`);
    return null;
  }
  if (!DESTINOS.includes(value as Destino)) {
    throw new BadRequestException(`destino inválido "${value}". Debe ser uno de: ${DESTINOS.join(', ')}`);
  }
  return value as Destino;
}

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
@Controller('v1/app/equivalencias')
export class EquivalenciasController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.ds
      .query(
        `SELECT id, keyword, categoria, destino, confidence_boost, created_at
           FROM equivalencias_ocr_cc
          WHERE client_id = $1
          ORDER BY keyword ASC`,
        [user.client_id],
      )
      .catch(() => []);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() body: any) {
    const keyword = String(body.keyword ?? '').trim();
    const categoria = String(body.categoria ?? '').trim();
    if (!keyword) throw new BadRequestException('keyword es obligatorio');
    if (!categoria) throw new BadRequestException('categoria es obligatoria');
    const destino = assertDestino(body.destino, true);

    const res = await this.ds.query(
      `INSERT INTO equivalencias_ocr_cc (client_id, keyword, categoria, destino, confidence_boost)
       VALUES ($1, $2, $3, $4::destino_reporte, $5)
       RETURNING id, keyword, categoria, destino, confidence_boost, created_at`,
      [user.client_id, keyword, categoria, destino, body.confidence_boost ?? 0.1],
    );
    return res[0];
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    // destino sólo se valida si viene en el body (PATCH parcial); null → COALESCE conserva.
    const destino = body.destino === undefined ? null : assertDestino(body.destino, false);

    const res = await this.ds.query(
      `UPDATE equivalencias_ocr_cc SET
         keyword          = COALESCE($1, keyword),
         categoria        = COALESCE($2, categoria),
         destino          = COALESCE($3::destino_reporte, destino),
         confidence_boost = COALESCE($4, confidence_boost)
       WHERE id = $5 AND client_id = $6
       RETURNING id, keyword, categoria, destino, confidence_boost, created_at`,
      [
        body.keyword ?? null,
        body.categoria ?? null,
        destino,
        body.confidence_boost ?? null,
        id,
        user.client_id,
      ],
    );
    if (!res[0]) throw new BadRequestException('Equivalencia no encontrada');
    return res[0];
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.ds.query(`DELETE FROM equivalencias_ocr_cc WHERE id=$1 AND client_id=$2`, [
      id,
      user.client_id,
    ]);
    return { deleted: true };
  }
}
