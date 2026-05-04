import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class UploadDocumentDto {
  @IsIn(['promoters', 'locations', 'campaigns', 'activations', 'collaborators'])
  target_table: 'promoters' | 'locations' | 'campaigns' | 'activations' | 'collaborators';

  @IsOptional()
  @IsUUID('4')
  project_id?: string;
}
