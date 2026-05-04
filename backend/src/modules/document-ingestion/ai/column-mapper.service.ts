import { Injectable } from '@nestjs/common';
import { TargetTable } from '../document-upload.entity';

export interface ColumnMapping {
  mapping: Record<string, string>;
  unmapped_source: string[];
  missing_required: string[];
  confidence: number;
}

/**
 * Synonyms per target field. Spanish and English variants.
 * Keys are target entity field names; values are accepted source-column aliases.
 */
const FIELD_SYNONYMS: Record<string, string[]> = {
  first_name: ['first_name', 'firstname', 'nombre', 'nombres', 'name'],
  last_name: ['last_name', 'lastname', 'apellido', 'apellidos', 'surname'],
  email: ['email', 'correo', 'correo_electronico', 'mail', 'e_mail'],
  phone: ['phone', 'telefono', 'celular', 'movil', 'mobile', 'tel'],
  rut: ['rut', 'dni', 'id_number', 'cedula', 'identificacion'],
  birth_date: ['birth_date', 'birthdate', 'fecha_nacimiento', 'nacimiento', 'dob'],
  gender: ['gender', 'genero', 'sexo'],
  full_name: ['full_name', 'nombre_completo', 'nombre', 'name'],
  role_label: ['role', 'rol', 'role_label', 'cargo'],
  name: ['name', 'nombre', 'titulo', 'title'],
  address: ['address', 'direccion', 'domicilio'],
  city: ['city', 'ciudad', 'comuna'],
  region: ['region', 'region_name', 'estado', 'provincia'],
  country: ['country', 'pais'],
  latitude: ['latitude', 'lat', 'latitud'],
  longitude: ['longitude', 'lng', 'longitud', 'lon'],
  notes: ['notes', 'notas', 'observaciones', 'comentarios', 'description'],
  description: ['description', 'descripcion', 'detalle'],
  start_date: ['start_date', 'startdate', 'fecha_inicio', 'inicio', 'from_date'],
  end_date: ['end_date', 'enddate', 'fecha_fin', 'fin', 'to_date'],
  budget: ['budget', 'presupuesto', 'monto'],
  status: ['status', 'estado', 'estatus'],
  campaign_name: ['campaign_name', 'campana', 'campana_nombre', 'campaign'],
  campaign_id: ['campaign_id', 'campana_id', 'id_campana'],
  activation_date: ['activation_date', 'fecha_activacion', 'fecha', 'date'],
  location_name: ['location_name', 'location', 'ubicacion', 'sitio', 'place'],
  promoter_email: ['promoter_email', 'promotor_email', 'promotora_email'],
};

const TARGET_FIELDS: Record<TargetTable, { required: string[]; optional: string[] }> = {
  promoters: {
    required: ['first_name', 'last_name', 'email'],
    optional: ['phone', 'rut', 'birth_date', 'gender', 'notes'],
  },
  locations: {
    required: ['name'],
    optional: ['address', 'city', 'region', 'country', 'latitude', 'longitude', 'notes'],
  },
  campaigns: {
    required: ['name', 'start_date', 'end_date'],
    optional: ['description', 'budget', 'status'],
  },
  activations: {
    required: ['campaign_name', 'activation_date'],
    optional: ['campaign_id', 'location_name', 'promoter_email', 'status', 'notes'],
  },
  collaborators: {
    required: ['full_name'],
    optional: ['email', 'phone', 'role_label'],
  },
};

@Injectable()
export class ColumnMapperService {
  /**
   * Maps source columns (from parsed file) to target entity fields.
   * Returns a mapping plus info on what's missing or unmapped.
   */
  map(sourceColumns: string[], targetTable: TargetTable): ColumnMapping {
    const schema = TARGET_FIELDS[targetTable];
    const mapping: Record<string, string> = {};
    const normalizedSources = sourceColumns.map((c) => this.normalize(c));

    const allTargetFields = [...schema.required, ...schema.optional];

    for (const targetField of allTargetFields) {
      const synonyms = FIELD_SYNONYMS[targetField] ?? [targetField];
      const normalizedSynonyms = synonyms.map((s) => this.normalize(s));

      for (let i = 0; i < normalizedSources.length; i++) {
        if (normalizedSynonyms.includes(normalizedSources[i])) {
          mapping[sourceColumns[i]] = targetField;
          break;
        }
      }
    }

    // Fallback: partial match (contains)
    for (const targetField of allTargetFields) {
      if (Object.values(mapping).includes(targetField)) continue;
      const synonyms = FIELD_SYNONYMS[targetField] ?? [targetField];
      const normalizedSynonyms = synonyms.map((s) => this.normalize(s));

      for (let i = 0; i < normalizedSources.length; i++) {
        if (sourceColumns[i] in mapping) continue;
        if (
          normalizedSynonyms.some(
            (syn) => normalizedSources[i].includes(syn) || syn.includes(normalizedSources[i]),
          )
        ) {
          mapping[sourceColumns[i]] = targetField;
          break;
        }
      }
    }

    const mappedTargets = new Set(Object.values(mapping));
    const missing_required = schema.required.filter((r) => !mappedTargets.has(r));
    const unmapped_source = sourceColumns.filter((c) => !(c in mapping));

    const totalMappable = allTargetFields.length;
    const mappedCount = mappedTargets.size;
    const requiredPenalty = missing_required.length * 0.15;
    const confidence = Math.max(0, Math.min(1, mappedCount / totalMappable - requiredPenalty));

    return { mapping, unmapped_source, missing_required, confidence };
  }

  private normalize(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\w]/g, '')
      .replace(/_+/g, '_');
  }
}
