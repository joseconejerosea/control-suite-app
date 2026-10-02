# Deuda técnica: resultados de `ds.query()` sin tipar (`no-unsafe-*` de ESLint)

**Estado:** abierta · **Severidad:** baja (calidad/robustez, no funcional) · **Alcance:** repo-wide (backend)
**Detectada:** durante la implementación del subsistema de notificaciones (Slices A/B).

## Qué es

El backend usa SQL crudo vía `ds.query(...)` (TypeORM `DataSource.query`) en toda la capa
de datos. Ese método devuelve `any`, así que TypeScript pierde la verificación de tipos
sobre el resultado: acceder a `rows[0].phone`, `result.length`, etc. no está chequeado en
compilación.

Las reglas de ESLint `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-member-access`
y `no-unsafe-argument` marcan cada uno de esos accesos.

## Magnitud (medido, no estimado)

- **~749** call sites de `.query(` en `backend/src`.
- **~3.023** errores `no-unsafe-*` en `backend/src` al correr ESLint.
- Presente en módulos preexistentes (ejemplo de referencia:
  `backend/src/modules/whatsapp/operator-notifier.service.ts` — 8 errores idénticos) y en
  la suite de tests e2e (`backend/test/rls-poc.e2e-spec.ts`, etc.).
- Conclusión: `npm run lint` **no está en verde** en el repo hoy; es una condición
  preexistente, no introducida por un cambio puntual.

## Por qué NO es un bug

- Es un aviso de tipado, no comportamiento en runtime. Agregar anotaciones de tipo es
  **solo tiempo de compilación**: el JavaScript emitido y la ejecución son idénticos.
- El código funciona y está cubierto por tests (el subsistema de notificaciones tiene
  54 tests verdes contra Postgres real).

## Por qué se deja como deuda y no se arregla puntualmente

1. **Fuera de alcance** de cualquier feature individual: mezclar un refactor de ~749 sitios
   con un cambio funcional ensucia el diff y el review.
2. **Consistencia**: tipar solo unos pocos archivos los deja distintos del resto del repo.
3. **Volumen**: merece su propio PR (o serie de PRs) revisable.

## Cómo se arreglaría (cuando se priorice)

Tipar el resultado de cada query:

```ts
// Antes (dispara no-unsafe):
const rows = await this.ds.query(`SELECT phone FROM ...`);

// Después:
const rows = await this.ds.query<{ phone: string }[]>(`SELECT phone FROM ...`);
```

### Precaución importante

Aunque el tipado no cambia el runtime, **puede revelar bugs latentes**: al declarar la
forma esperada de una query, se puede descubrir que devolvía algo distinto de lo asumido.
Esto ya pasó en Slice A — `markRead` asumía que `UPDATE ... RETURNING` devolvía un array
plano de filas, cuando TypeORM devuelve `[filas, affectedCount]`; el bug rompía el control
de "solo el dueño puede marcar leída su notificación". El tipado no rompe la app: **expone**
errores que ya estaban. Por eso este trabajo requiere tests/review, no es puramente
mecánico.

## Sugerencia de abordaje

- Hacerlo por módulo, no todo de una, para mantener PRs revisables.
- Priorizar rutas sensibles a seguridad/auth (donde un tipo equivocado = riesgo real).
- Considerar un patrón/helper tipado para `ds.query` o migrar consultas críticas a
  `TenantRepository` / query builder donde aporte.
