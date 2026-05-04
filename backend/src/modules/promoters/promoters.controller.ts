import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PromotersService } from './promoters.service';
import { CreatePromoterDto, UpdatePromoterDto } from './dto/promoter.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Controller('promoters')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class PromotersController {
  constructor(private readonly promotersService: PromotersService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.promotersService.findAll(user.client_id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promotersService.findOne(user.client_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePromoterDto,
  ) {
    return this.promotersService.create(user.client_id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoterDto,
  ) {
    return this.promotersService.update(user.client_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promotersService.remove(user.client_id, id);
  }
}